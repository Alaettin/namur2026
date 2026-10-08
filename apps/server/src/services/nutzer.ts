import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { appNutzer, exponatBetreuer } from "../db/schema.js";
import { erzeugeStartpasswort, hashePasswort, normalisiereEmail } from "../auth/passwort.js";
import { conflict, notFound } from "../errors.js";

export type Rolle = "admin" | "betreuer";

export interface Nutzer {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly rolle: Rolle;
  readonly aktiv: boolean;
  readonly angelegt: number;
  readonly zuletztAngemeldet: number | null;
}

/** Ohne `passwortHash`. Er verlaesst diese Datei nicht. */
function oeffentlich(reihe: typeof appNutzer.$inferSelect): Nutzer {
  return {
    id: reihe.id,
    name: reihe.name,
    email: reihe.email,
    rolle: reihe.rolle,
    aktiv: reihe.aktiv,
    angelegt: reihe.angelegt,
    zuletztAngemeldet: reihe.zuletztAngemeldet,
  };
}

export function findeNutzerPerId(db: Db, id: string): typeof appNutzer.$inferSelect | null {
  return db.select().from(appNutzer).where(eq(appNutzer.id, id)).get() ?? null;
}

export function findeNutzerPerEmail(db: Db, email: string): typeof appNutzer.$inferSelect | null {
  return (
    db
      .select()
      .from(appNutzer)
      .where(eq(appNutzer.email, normalisiereEmail(email)))
      .get() ?? null
  );
}

export function listeNutzer(db: Db): Nutzer[] {
  return db.select().from(appNutzer).all().map(oeffentlich);
}

export async function legeNutzerAn(
  db: Db,
  eingabe: { name: string; email: string; rolle: Rolle },
): Promise<{ nutzer: Nutzer; startpasswort: string }> {
  const email = normalisiereEmail(eingabe.email);
  if (findeNutzerPerEmail(db, email) !== null) {
    throw conflict("email-vergeben", "A user with this email already exists.");
  }

  const startpasswort = erzeugeStartpasswort();
  const reihe = {
    id: randomUUID(),
    name: eingabe.name.trim(),
    email,
    passwortHash: await hashePasswort(startpasswort),
    rolle: eingabe.rolle,
    aktiv: true,
    angelegt: Date.now(),
    zuletztAngemeldet: null,
  };
  db.insert(appNutzer).values(reihe).run();
  return { nutzer: oeffentlich(reihe), startpasswort };
}

/**
 * Setzt ein neues Startpasswort und gibt es **einmal** zurueck.
 *
 * Es wird nirgends gespeichert und steht in keinem Protokoll. Geht es verloren, wird ein
 * neues gesetzt; das ist der gewollte Weg.
 */
export async function setzePasswortZurueck(db: Db, id: string): Promise<string> {
  if (findeNutzerPerId(db, id) === null) throw notFound("nutzer-unbekannt", "Unknown user.");
  const startpasswort = erzeugeStartpasswort();
  db.update(appNutzer)
    .set({ passwortHash: await hashePasswort(startpasswort) })
    .where(eq(appNutzer.id, id))
    .run();
  return startpasswort;
}

/**
 * Aktiviert oder deaktiviert einen Nutzer.
 *
 * **Der letzte aktive Admin laesst sich nicht deaktivieren.** Sonst sperrt ein einzelner
 * Klick alle aus der Verwaltung aus, und es gibt keinen Weg zurueck: der Bootstrap aus
 * ADMIN_EMAIL greift nur, solange ueberhaupt kein Admin existiert, und ein deaktivierter
 * zaehlt dafuer weiter mit. Dasselbe gilt fuers Herabstufen, siehe `aendereNutzer`.
 */
export function setzeAktiv(db: Db, id: string, aktiv: boolean): Nutzer {
  const reihe = findeNutzerPerId(db, id);
  if (reihe === null) throw notFound("nutzer-unbekannt", "Unknown user.");
  if (!aktiv && reihe.rolle === "admin" && zaehleAktiveAdmins(db) <= 1) {
    throw conflict("letzter-admin", "The last active admin cannot be deactivated.");
  }
  db.update(appNutzer).set({ aktiv }).where(eq(appNutzer.id, id)).run();
  return oeffentlich({ ...reihe, aktiv });
}

export function aendereNutzer(
  db: Db,
  id: string,
  aenderung: { name?: string; rolle?: Rolle },
): Nutzer {
  const reihe = findeNutzerPerId(db, id);
  if (reihe === null) throw notFound("nutzer-unbekannt", "Unknown user.");

  const wirdHerabgestuft =
    aenderung.rolle !== undefined && aenderung.rolle !== "admin" && reihe.rolle === "admin";
  if (wirdHerabgestuft && zaehleAktiveAdmins(db) <= 1) {
    throw conflict("letzter-admin", "The last active admin cannot be demoted.");
  }

  const neu = {
    ...reihe,
    ...(aenderung.name !== undefined ? { name: aenderung.name.trim() } : {}),
    ...(aenderung.rolle !== undefined ? { rolle: aenderung.rolle } : {}),
  };
  db.update(appNutzer).set({ name: neu.name, rolle: neu.rolle }).where(eq(appNutzer.id, id)).run();
  return oeffentlich(neu);
}

function zaehleAktiveAdmins(db: Db): number {
  return db
    .select({ id: appNutzer.id })
    .from(appNutzer)
    .where(and(eq(appNutzer.rolle, "admin"), eq(appNutzer.aktiv, true)))
    .all().length;
}

export function merkeAnmeldung(db: Db, id: string): void {
  db.update(appNutzer).set({ zuletztAngemeldet: Date.now() }).where(eq(appNutzer.id, id)).run();
}

// --- Zuweisung von Exponaten ---------------------------------------------------------

export function exponateVonNutzer(db: Db, nutzerId: string): string[] {
  return db
    .select({ exponatId: exponatBetreuer.exponatId })
    .from(exponatBetreuer)
    .where(eq(exponatBetreuer.appNutzerId, nutzerId))
    .all()
    .map((r) => r.exponatId);
}

/**
 * Setzt die Exponate eines Betreuers auf genau diese Liste.
 *
 * Ersetzen statt Hinzufuegen: die Oberflaeche zeigt eine Liste mit Haekchen, und wer ein
 * Haekchen entfernt, erwartet, dass es weg ist. Beides in **einer** Transaktion, sonst
 * steht der Betreuer zwischen Loeschen und Einfuegen ohne Exponat da und wird in genau
 * diesem Moment von einer Rechtepruefung abgewiesen.
 */
export function setzeExponateVonNutzer(db: Db, nutzerId: string, exponatIds: string[]): void {
  db.transaction((tx) => {
    tx.delete(exponatBetreuer).where(eq(exponatBetreuer.appNutzerId, nutzerId)).run();
    const eindeutig = [...new Set(exponatIds)];
    if (eindeutig.length > 0) {
      tx.insert(exponatBetreuer)
        .values(eindeutig.map((exponatId) => ({ exponatId, appNutzerId: nutzerId })))
        .run();
    }
  });
}

export { oeffentlich as alsOeffentlicherNutzer };
