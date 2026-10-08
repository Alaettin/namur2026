import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { besucher, exponate, zuordnungen } from "../db/schema.js";
import { badRequest, notFound } from "../errors.js";
import { inhalteVonExponat } from "./exponate.js";

/**
 * Was ein Besucher an einem Exponat bekommen hat.
 *
 * Eine Zuordnung zeigt auf das **Element**, nicht auf eine Momentaufnahme seines Inhalts.
 * Wird die Datei eines Dokuments ersetzt, sieht der Besucher die neue Fassung; ein spaeter
 * neu angelegtes Dokument kommt nicht automatisch dazu. Niemand soll etwas bekommen, das
 * der Betreuer ihm nicht gegeben hat, und eine Korrektur soll trotzdem ankommen.
 */

export type Art = "dokument" | "link" | "kontakt";

export interface ZuOrdnend {
  art: Art;
  zielId: string;
}

export function leseElemente(wert: unknown): ZuOrdnend[] {
  if (!Array.isArray(wert)) {
    throw badRequest("feld-fehlt", "Field elemente must be an array of {art, zielId}.");
  }
  return wert.map((roh) => {
    const o = (typeof roh === "object" && roh !== null ? roh : {}) as Record<string, unknown>;
    const art = o["art"];
    const zielId = o["zielId"];
    if (art !== "dokument" && art !== "link" && art !== "kontakt") {
      throw badRequest("art-ungueltig", 'Field art must be "dokument", "link" or "kontakt".');
    }
    if (typeof zielId !== "string" || zielId === "") {
      throw badRequest("feld-fehlt", "Field zielId is required.");
    }
    return { art, zielId };
  });
}

/**
 * Ordnet zu und meldet, wie viele Zuordnungen **neu** entstanden sind.
 *
 * **Idempotent.** Der Eindeutigkeitsschluessel `(besucher_guid, art, ziel_id)` haelt
 * Doppelte ab; ein zweiter Versuch nach einem Netzfehler legt nichts an und meldet 0.
 * Genau darauf verlaesst sich der Scan-Ablauf: bei `ErrOffline` schickt "Erneut versuchen"
 * denselben Rumpf.
 *
 * Alles in **einer** Transaktion: ein halb zugeordneter Besucher waere ein Zustand, den
 * niemand sieht und den der Betreuer fuer vollstaendig haelt.
 */
export function ordneZu(
  db: Db,
  eingabe: { guid: string; exponatId: string; elemente: ZuOrdnend[]; nutzerId: string },
): { neu: number; bereits: number } {
  if (
    db
      .select({ guid: besucher.guid })
      .from(besucher)
      .where(eq(besucher.guid, eingabe.guid))
      .get() === undefined
  ) {
    throw notFound("besucher-unbekannt", "Unknown visitor.");
  }
  if (
    db
      .select({ id: exponate.id })
      .from(exponate)
      .where(eq(exponate.id, eingabe.exponatId))
      .get() === undefined
  ) {
    throw notFound("exponat-unbekannt", "Unknown exhibit.");
  }

  /*
   * Jedes Element muss zu **diesem** Exponat gehoeren. Ohne diese Pruefung liesse sich
   * ueber einen untergeschobenen `zielId` ein Dokument eines fremden Exponats zuordnen,
   * und der Betreuer dieses Exponats haette es nie freigegeben.
   */
  const inhalte = inhalteVonExponat(db, eingabe.exponatId);
  const erlaubt = new Map<Art, Set<string>>([
    ["dokument", new Set(inhalte.dokumente.map((d) => d.id))],
    ["link", new Set(inhalte.links.map((l) => l.id))],
    ["kontakt", new Set(inhalte.kontakte.map((c) => c.id))],
  ]);
  for (const el of eingabe.elemente) {
    if (!erlaubt.get(el.art)?.has(el.zielId)) {
      throw notFound("element-unbekannt", `No ${el.art} with this id at this exhibit.`);
    }
  }

  const vorhanden = new Set(
    db
      .select({ art: zuordnungen.art, zielId: zuordnungen.zielId })
      .from(zuordnungen)
      .where(eq(zuordnungen.besucherGuid, eingabe.guid))
      .all()
      .map((z) => `${z.art}:${z.zielId}`),
  );

  const neue = eingabe.elemente.filter((el) => !vorhanden.has(`${el.art}:${el.zielId}`));
  const bereits = eingabe.elemente.length - neue.length;

  if (neue.length > 0) {
    const jetzt = Date.now();
    db.transaction((tx) => {
      tx.insert(zuordnungen)
        .values(
          neue.map((el) => ({
            id: randomUUID(),
            besucherGuid: eingabe.guid,
            exponatId: eingabe.exponatId,
            art: el.art,
            zielId: el.zielId,
            appNutzerId: eingabe.nutzerId,
            zeitpunkt: jetzt,
          })),
        )
        .run();
    });
  }

  return { neu: neue.length, bereits };
}

export function entferneZuordnung(db: Db, guid: string, art: Art, zielId: string): void {
  const reihe = db
    .select({ id: zuordnungen.id })
    .from(zuordnungen)
    .where(
      and(
        eq(zuordnungen.besucherGuid, guid),
        eq(zuordnungen.art, art),
        eq(zuordnungen.zielId, zielId),
      ),
    )
    .get();
  if (reihe === undefined) throw notFound("zuordnung-unbekannt", "No such assignment.");
  db.delete(zuordnungen).where(eq(zuordnungen.id, reihe.id)).run();
}

/** Die letzten Zuordnungen, fuer das Dashboard und den Scan-Bildschirm. */
export function letzteZuordnungen(db: Db, grenze: number, exponatId?: string) {
  return db
    .select()
    .from(zuordnungen)
    .where(exponatId === undefined ? undefined : eq(zuordnungen.exponatId, exponatId))
    .orderBy(desc(zuordnungen.zeitpunkt))
    .limit(grenze)
    .all();
}
