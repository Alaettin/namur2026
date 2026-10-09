import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { ansprechpartner, exponatAnsprechpartner, exponate } from "../db/schema.js";
import { badRequest, conflict, kontingentErschoepft, notFound } from "../errors.js";
import { MAX_KONTAKTE } from "../modell/felder.js";

/**
 * Ansprechpartner als eigenstaendige Stammdaten.
 *
 * Sie gehoeren **keinem** Exponat. Ein Exponat weist sich einen zu, und derselbe Mensch
 * kann an mehreren stehen; frueher lag er dann doppelt im Bestand und lief beim Korrigieren
 * auseinander.
 */

export const TEXTFELDER = [
  "titel",
  "vorname",
  "nachname",
  "firma",
  "position",
  "email",
  "strasse",
  "plz",
  "ort",
  "land",
  "website",
] as const;

type Textfeld = (typeof TEXTFELDER)[number];
type Optionale = Exclude<Textfeld, "vorname" | "nachname">;

export type Eingabe = Partial<Record<Textfeld, string | null>>;

/** Getrimmt, Leeres wird `null`. Vor- und Nachname sind Pflicht und nie `null`. */
function felder(eingabe: Eingabe): Record<Optionale, string | null> & {
  vorname: string;
  nachname: string;
} {
  const optional = {} as Record<Optionale, string | null>;
  for (const feld of TEXTFELDER) {
    if (feld === "vorname" || feld === "nachname") continue;
    const wert = eingabe[feld];
    optional[feld] =
      wert === null || wert === undefined || String(wert).trim() === ""
        ? null
        : String(wert).trim();
  }
  return {
    ...optional,
    vorname: (eingabe.vorname ?? "").trim(),
    nachname: (eingabe.nachname ?? "").trim(),
  };
}

export function listeAnsprechpartner(db: Db) {
  return db
    .select()
    .from(ansprechpartner)
    .orderBy(asc(ansprechpartner.nachname), asc(ansprechpartner.vorname))
    .all();
}

export function findeAnsprechpartner(db: Db, id: string) {
  const reihe = db.select().from(ansprechpartner).where(eq(ansprechpartner.id, id)).get();
  if (reihe === undefined) throw notFound("ansprechpartner-unbekannt", "Unknown contact.");
  return reihe;
}

export function legeAnsprechpartnerAn(db: Db, eingabe: Eingabe) {
  const werte = felder(eingabe);
  if (werte.vorname === "" || werte.nachname === "") {
    throw badRequest("feld-fehlt", "Fields vorname and nachname are required.");
  }
  const jetzt = Date.now();
  const reihe = { id: randomUUID(), ...werte, angelegt: jetzt, geaendert: jetzt };
  db.insert(ansprechpartner).values(reihe).run();
  return reihe;
}

export function aendereAnsprechpartner(db: Db, id: string, eingabe: Eingabe) {
  const vorher = findeAnsprechpartner(db, id);
  const werte = felder({ ...vorher, ...eingabe });
  if (werte.vorname === "" || werte.nachname === "") {
    throw badRequest("feld-fehlt", "Fields vorname and nachname must not be empty.");
  }
  db.update(ansprechpartner)
    .set({ ...werte, geaendert: Date.now() })
    .where(eq(ansprechpartner.id, id))
    .run();
  return findeAnsprechpartner(db, id);
}

/**
 * An wie vielen Exponaten haengt dieser Ansprechpartner?
 *
 * Die Oberflaeche nennt die Zahl **vor** dem Loeschen, wie beim Entfernen eines Dokuments:
 * wer loescht, soll wissen, an wie vielen Staenden die Angabe danach fehlt.
 */
export function exponateVonAnsprechpartner(db: Db, id: string): string[] {
  return db
    .select({ exponatId: exponatAnsprechpartner.exponatId })
    .from(exponatAnsprechpartner)
    .where(eq(exponatAnsprechpartner.ansprechpartnerId, id))
    .all()
    .map((z) => z.exponatId);
}

/** Loescht den Ansprechpartner; seine Zuweisungen gehen ueber `cascade` mit. */
export function loescheAnsprechpartner(db: Db, id: string): void {
  findeAnsprechpartner(db, id);
  db.delete(ansprechpartner).where(eq(ansprechpartner.id, id)).run();
}

// --- Zuweisung an ein Exponat ---------------------------------------------------------

/** Die Ansprechpartner eines Exponats, mit ihrem Platz, nach Platz sortiert. */
export function ansprechpartnerVonExponat(db: Db, exponatId: string) {
  return db
    .select({
      id: ansprechpartner.id,
      platz: exponatAnsprechpartner.platz,
      /*
       * **Spalten einzeln gewaehlt, also hier nachtragen.** Der Titel fehlte beim ersten
       * Anlauf genau hier: er stand in der Tabelle und im Formular, kam aber nie in der
       * Konnektor-Antwort an. Eine Auswahl, die Felder aufzaehlt, muss bei jedem neuen
       * Feld mitwachsen.
       */
      titel: ansprechpartner.titel,
      vorname: ansprechpartner.vorname,
      nachname: ansprechpartner.nachname,
      firma: ansprechpartner.firma,
      position: ansprechpartner.position,
      email: ansprechpartner.email,
      strasse: ansprechpartner.strasse,
      plz: ansprechpartner.plz,
      ort: ansprechpartner.ort,
      land: ansprechpartner.land,
      website: ansprechpartner.website,
    })
    .from(exponatAnsprechpartner)
    .innerJoin(ansprechpartner, eq(ansprechpartner.id, exponatAnsprechpartner.ansprechpartnerId))
    .where(eq(exponatAnsprechpartner.exponatId, exponatId))
    .orderBy(asc(exponatAnsprechpartner.platz))
    .all();
}

/**
 * Weist einem Exponat einen vorhandenen Ansprechpartner zu.
 *
 * Der Platz ist die kleinste freie Nummer dieses Exponats und aendert sich danach nie: aus
 * ihm entsteht `{K}_Contact03_Email`, und das hat der Content-Admin in Axon gemappt.
 */
export function weiseZu(db: Db, exponatId: string, ansprechpartnerId: string) {
  if (
    db.select({ id: exponate.id }).from(exponate).where(eq(exponate.id, exponatId)).get() ===
    undefined
  ) {
    throw notFound("exponat-unbekannt", "Unknown exhibit.");
  }
  findeAnsprechpartner(db, ansprechpartnerId);

  const schon = db
    .select({ platz: exponatAnsprechpartner.platz })
    .from(exponatAnsprechpartner)
    .where(
      and(
        eq(exponatAnsprechpartner.exponatId, exponatId),
        eq(exponatAnsprechpartner.ansprechpartnerId, ansprechpartnerId),
      ),
    )
    .get();
  if (schon !== undefined) {
    throw conflict("schon-zugewiesen", "This contact is already assigned to this exhibit.");
  }

  const belegt = new Set(
    db
      .select({ platz: exponatAnsprechpartner.platz })
      .from(exponatAnsprechpartner)
      .where(eq(exponatAnsprechpartner.exponatId, exponatId))
      .all()
      .map((z) => z.platz),
  );
  let platz = 0;
  for (let p = 1; p <= MAX_KONTAKTE; p++) {
    if (!belegt.has(p)) {
      platz = p;
      break;
    }
  }
  if (platz === 0) {
    throw kontingentErschoepft(
      `All ${String(MAX_KONTAKTE)} contact slots of this exhibit are in use.`,
      { obergrenze: MAX_KONTAKTE, was: "contact" },
    );
  }

  db.insert(exponatAnsprechpartner).values({ exponatId, ansprechpartnerId, platz }).run();
  return { ansprechpartnerId, platz };
}

/** Nimmt die Zuweisung zurueck. Der Ansprechpartner selbst bleibt. */
export function hebeZuweisungAuf(db: Db, exponatId: string, ansprechpartnerId: string): void {
  const reihe = db
    .select({ platz: exponatAnsprechpartner.platz })
    .from(exponatAnsprechpartner)
    .where(
      and(
        eq(exponatAnsprechpartner.exponatId, exponatId),
        eq(exponatAnsprechpartner.ansprechpartnerId, ansprechpartnerId),
      ),
    )
    .get();
  if (reihe === undefined) throw notFound("zuweisung-unbekannt", "No such assignment.");

  db.delete(exponatAnsprechpartner)
    .where(
      and(
        eq(exponatAnsprechpartner.exponatId, exponatId),
        eq(exponatAnsprechpartner.ansprechpartnerId, ansprechpartnerId),
      ),
    )
    .run();
}
