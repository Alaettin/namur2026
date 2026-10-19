import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
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

/**
 * `kontakt` steht nur noch fuer den Bestand: seit dem 19.10.2026 kommen Ansprechpartner mit
 * dem Exponat und werden nicht mehr einzeln zugeordnet. Alte Zeilen bleiben gueltig und
 * zaehlen weiter als "an diesem Exponat etwas bekommen".
 */
export type Art = "dokument" | "link" | "kontakt";

export interface ZuOrdnend {
  art: "dokument" | "link";
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
    if (art === "kontakt") {
      throw badRequest(
        "kontakt-automatisch",
        "Contacts are not assigned individually; they come with the exhibit.",
      );
    }
    if (art !== "dokument" && art !== "link") {
      throw badRequest("art-ungueltig", 'Field art must be "dokument" or "link".');
    }
    if (typeof zielId !== "string" || zielId === "") {
      throw badRequest("feld-fehlt", "Field zielId is required.");
    }
    return { art, zielId };
  });
}

/**
 * Besucher und Exponat muessen existieren, und jedes Element muss zu **diesem** Exponat
 * gehoeren.
 */
function pruefeElemente(
  db: Db,
  eingabe: { guid: string; exponatId: string; elemente: ZuOrdnend[] },
): void {
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
  const erlaubt = new Map<ZuOrdnend["art"], Set<string>>([
    ["dokument", new Set(inhalte.dokumente.map((d) => d.id))],
    ["link", new Set(inhalte.links.map((l) => l.id))],
  ]);
  for (const el of eingabe.elemente) {
    if (!erlaubt.get(el.art)?.has(el.zielId)) {
      throw notFound("element-unbekannt", `No ${el.art} with this id at this exhibit.`);
    }
  }
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
  pruefeElemente(db, eingabe);

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

/**
 * Setzt die Zuordnungen eines Besuchers an **einem** Exponat auf genau diese Elemente.
 *
 * Fuer die Kaestchen im Besucherdetail: was dort angehakt ist, ist der Sollzustand. Fehlende
 * kommen dazu, alles andere an diesem Exponat geht weg, auch alte `kontakt`-Zeilen aus der
 * Zeit vor dem 19.10.2026. Eine leere Liste heisst "an diesem Exponat nichts", der Besucher
 * verliert dort damit auch die Ansprechpartner.
 *
 * Eine Transaktion: ein halb gesetztes Exponat waere ein Zustand, den die Oberflaeche nie
 * gezeigt hat.
 */
export function setzeZuordnungen(
  db: Db,
  eingabe: { guid: string; exponatId: string; elemente: ZuOrdnend[]; nutzerId: string },
): { neu: number; entfernt: number } {
  pruefeElemente(db, eingabe);

  const soll = new Set(eingabe.elemente.map((el) => `${el.art}:${el.zielId}`));
  const ist = db
    .select({ id: zuordnungen.id, art: zuordnungen.art, zielId: zuordnungen.zielId })
    .from(zuordnungen)
    .where(
      and(eq(zuordnungen.besucherGuid, eingabe.guid), eq(zuordnungen.exponatId, eingabe.exponatId)),
    )
    .all();
  const istSchluessel = new Set(ist.map((z) => `${z.art}:${z.zielId}`));

  const weg = ist.filter((z) => !soll.has(`${z.art}:${z.zielId}`));
  // Doppelt geschickte Elemente einmal, sonst schluege der Eindeutigkeitsschluessel an.
  const eindeutig = [
    ...new Map(eingabe.elemente.map((el) => [`${el.art}:${el.zielId}`, el])).values(),
  ];
  const dazu = eindeutig.filter((el) => !istSchluessel.has(`${el.art}:${el.zielId}`));

  db.transaction((tx) => {
    for (const z of weg) tx.delete(zuordnungen).where(eq(zuordnungen.id, z.id)).run();
    if (dazu.length > 0) {
      const jetzt = Date.now();
      tx.insert(zuordnungen)
        .values(
          dazu.map((el) => ({
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
    }
  });

  return { neu: dazu.length, entfernt: weg.length };
}

/**
 * Alle Exponate aus Sicht eines Besuchers, fuer das Besucherdetail.
 *
 * Je Exponat seine Dokumente und Links mit dem Vermerk, ob sie zugeordnet sind, und die
 * Ansprechpartner, die mitkommen. `besucht` heisst: irgendeine Zuordnung an diesem Exponat,
 * auch eine alte `kontakt`-Zeile; dieselbe Regel wie in `sammleWerte`.
 */
export function exponateFuerBesucher(db: Db, guid: string) {
  const meine = db.select().from(zuordnungen).where(eq(zuordnungen.besucherGuid, guid)).all();

  return db
    .select()
    .from(exponate)
    .orderBy(asc(exponate.kennung))
    .all()
    .map((e) => {
      const hier = meine.filter((z) => z.exponatId === e.id);
      const hat = (art: Art, id: string) => hier.some((z) => z.art === art && z.zielId === id);
      const inhalte = inhalteVonExponat(db, e.id);
      return {
        id: e.id,
        kennung: e.kennung,
        name: e.name,
        besucht: hier.length > 0,
        dokumente: inhalte.dokumente.map((d) => ({
          id: d.id,
          titel: d.titel,
          zugeordnet: hat("dokument", d.id),
        })),
        links: inhalte.links.map((l) => ({
          id: l.id,
          titel: l.titel,
          url: l.url,
          zugeordnet: hat("link", l.id),
        })),
        kontakte: inhalte.kontakte.map((c) => ({
          id: c.id,
          name: [c.titel, c.vorname, c.nachname].filter((t) => t !== null && t !== "").join(" "),
        })),
      };
    });
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
