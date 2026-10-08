import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  dateien,
  exponate,
  exponatBetreuer,
  exponatDokumente,
  exponatAnsprechpartner,
  exponatLinks,
  zuordnungen,
} from "../db/schema.js";
import { badRequest, kontingentErschoepft, notFound } from "../errors.js";
import { MAX_DOKUMENTE, MAX_LINKS } from "../modell/felder.js";
import { ansprechpartnerVonExponat } from "./ansprechpartner.js";

/**
 * Exponate und ihre Inhalte.
 *
 * Der **Platz** eines Elements ist die Bruecke zum Konnektor-Modell: aus Platz 3 eines
 * Dokuments am Exponat `E03` wird `E03_Doc03_Title`, und genau das hat der Content-Admin
 * in Axon gemappt. Deshalb aendert sich ein einmal vergebener Platz nie.
 */

/**
 * Vergibt die naechste Kennung: **die kleinste freie Nummer**, `E01`, `E02`, …
 *
 * Entschieden am 08.10.2026. Zur Folge, damit sie nachlesbar bleibt: wird `E03` geloescht
 * und ein neues Exponat angelegt, heisst dieses wieder `E03` und **erbt das Axon-Mapping
 * des geloeschten**. Steht dort schon ein Mapping, zeigt der Viewer die Datenpunkte des
 * neuen Exponats an der Stelle des alten. Die Rueckfrage beim Loeschen sagt das.
 *
 * Der Nutzer gibt die Kennung nicht mehr ein und kann sie nicht aendern: sie steht in jedem
 * `propertyId` dieses Exponats, und ein Wechsel bricht das Mapping.
 */
export function naechsteKennung(db: Db): string {
  const belegt = new Set(
    db
      .select({ kennung: exponate.kennung })
      .from(exponate)
      .all()
      .map((e) => e.kennung),
  );
  for (let n = 1; n <= 99; n++) {
    const kennung = `E${String(n).padStart(2, "0")}`;
    if (!belegt.has(kennung)) return kennung;
  }
  throw kontingentErschoepft("All 99 exhibit codes are in use.", { obergrenze: 99 });
}

export function findeExponat(db: Db, id: string) {
  const reihe = db.select().from(exponate).where(eq(exponate.id, id)).get();
  if (reihe === undefined) throw notFound("exponat-unbekannt", "Unknown exhibit.");
  return reihe;
}

export function listeExponate(db: Db) {
  return db.select().from(exponate).orderBy(asc(exponate.kennung)).all();
}

export function legeExponatAn(db: Db, eingabe: { name: string; beschreibung?: string | null }) {
  if (eingabe.name.trim() === "") throw badRequest("feld-fehlt", "Field name is required.");

  const reihe = {
    id: randomUUID(),
    // Vom Server vergeben, siehe `naechsteKennung`.
    kennung: naechsteKennung(db),
    name: eingabe.name.trim(),
    beschreibung: eingabe.beschreibung?.trim() ?? null,
    angelegt: Date.now(),
  };
  db.insert(exponate).values(reihe).run();
  return reihe;
}

/**
 * Aendert Name und Beschreibung eines Exponats.
 *
 * **Die Kennung laesst sich nicht aendern.** Sie steht in jedem `propertyId` dieses
 * Exponats; ein Wechsel benennt alle Datenpunkte um und bricht das Mapping in Axon. Der
 * frueher dafuer vorgesehene Weg mit ausdruecklicher Bestaetigung ist entfallen, weil die
 * Kennung jetzt ohnehin vom Server vergeben wird.
 */
export function aendereExponat(
  db: Db,
  id: string,
  eingabe: { name?: string; beschreibung?: string | null },
) {
  findeExponat(db, id);
  const aenderung: Record<string, unknown> = {};

  if (eingabe.name !== undefined) {
    if (eingabe.name.trim() === "") throw badRequest("feld-fehlt", "Field name must not be empty.");
    aenderung["name"] = eingabe.name.trim();
  }
  if ("beschreibung" in eingabe) aenderung["beschreibung"] = eingabe.beschreibung?.trim() ?? null;

  if (Object.keys(aenderung).length > 0) {
    db.update(exponate).set(aenderung).where(eq(exponate.id, id)).run();
  }
  return findeExponat(db, id);
}

export function loescheExponat(db: Db, id: string): void {
  findeExponat(db, id);
  db.delete(exponate).where(eq(exponate.id, id)).run();
}

// --- Plaetze ---------------------------------------------------------------------------

/**
 * Die kleinste freie Nummer, eins-basiert.
 *
 * **Nicht `max + 1`.** Wird Platz 3 von fuenf geloescht, soll der naechste Upload dort
 * landen statt auf Platz 6: sonst waechst die Nummer immer weiter, obwohl Plaetze frei
 * sind, und die Obergrenze waere nach zehn Loeschvorgaengen erreicht, ohne dass zehn
 * Dokumente da sind.
 */
function kleinsterFreierPlatz(belegt: number[], obergrenze: number, was: string): number {
  const genommen = new Set(belegt);
  for (let p = 1; p <= obergrenze; p++) {
    if (!genommen.has(p)) return p;
  }
  throw kontingentErschoepft(`All ${String(obergrenze)} ${was} slots of this exhibit are in use.`, {
    obergrenze,
    was,
  });
}

export function legeDokumentAn(
  db: Db,
  exponatId: string,
  eingabe: { dateiId: string; titel: string; beschreibung?: string | null },
) {
  findeExponat(db, exponatId);
  const belegt = db
    .select({ platz: exponatDokumente.platz })
    .from(exponatDokumente)
    .where(eq(exponatDokumente.exponatId, exponatId))
    .all()
    .map((d) => d.platz);

  const reihe = {
    id: randomUUID(),
    exponatId,
    platz: kleinsterFreierPlatz(belegt, MAX_DOKUMENTE, "document"),
    dateiId: eingabe.dateiId,
    titel: eingabe.titel.trim(),
    beschreibung: eingabe.beschreibung?.trim() ?? null,
  };
  db.insert(exponatDokumente).values(reihe).run();
  return reihe;
}

export function legeLinkAn(db: Db, exponatId: string, eingabe: { url: string; titel: string }) {
  findeExponat(db, exponatId);
  const belegt = db
    .select({ platz: exponatLinks.platz })
    .from(exponatLinks)
    .where(eq(exponatLinks.exponatId, exponatId))
    .all()
    .map((l) => l.platz);

  const reihe = {
    id: randomUUID(),
    exponatId,
    platz: kleinsterFreierPlatz(belegt, MAX_LINKS, "link"),
    url: eingabe.url.trim(),
    titel: eingabe.titel.trim(),
  };
  db.insert(exponatLinks).values(reihe).run();
  return reihe;
}

/**
 * Die Inhalte eines Exponats, **mit den Angaben zur hinterlegten Datei**.
 *
 * `mimeType`, `originalName` und `groesse` kommen aus `dateien` dazu. Ohne sie kann die
 * Oberflaeche nicht entscheiden, ob ein Dokument als Bild in einem Fenster erscheint oder
 * als PDF in einem neuen Tab, und muesste je Zeile einzeln nachfragen.
 *
 * `leftJoin`, nicht `innerJoin`: fehlt die Datei (geloescht, Volume weg), soll das Dokument
 * trotzdem in der Liste stehen und sich entfernen lassen.
 */
export function inhalteVonExponat(db: Db, exponatId: string) {
  const dokumente = db
    .select({
      id: exponatDokumente.id,
      exponatId: exponatDokumente.exponatId,
      platz: exponatDokumente.platz,
      dateiId: exponatDokumente.dateiId,
      titel: exponatDokumente.titel,
      beschreibung: exponatDokumente.beschreibung,
      mimeType: dateien.mimeType,
      originalName: dateien.originalName,
      groesse: dateien.groesse,
    })
    .from(exponatDokumente)
    .leftJoin(dateien, eq(dateien.id, exponatDokumente.dateiId))
    .where(eq(exponatDokumente.exponatId, exponatId))
    .orderBy(asc(exponatDokumente.platz))
    .all();

  // Ansprechpartner liegen in eigenen Stammdaten und kommen ueber die Zuweisung.
  const kontakte = ansprechpartnerVonExponat(db, exponatId);

  return {
    dokumente,
    links: db
      .select()
      .from(exponatLinks)
      .where(eq(exponatLinks.exponatId, exponatId))
      .orderBy(asc(exponatLinks.platz))
      .all(),
    kontakte,
  };
}

/** Hat das Exponat ueberhaupt etwas, das sich zuordnen laesst? Sonst ist Scannen gesperrt. */
export function hatInhalte(db: Db, exponatId: string): boolean {
  const i = inhalteVonExponat(db, exponatId);
  return i.dokumente.length + i.links.length + i.kontakte.length > 0;
}

/**
 * Wie viele Besucher ein Loeschen betrifft.
 *
 * Die Oberflaeche nennt die Zahl **vor** dem Loeschen. Ein Betreuer soll nicht erfahren,
 * dass er zwoelf Besuchern etwas weggenommen hat, nachdem er es getan hat.
 */
export function betroffeneBesucher(
  db: Db,
  art: "dokument" | "link" | "kontakt",
  zielId: string,
): number {
  return db
    .select({ guid: zuordnungen.besucherGuid })
    .from(zuordnungen)
    .where(and(eq(zuordnungen.art, art), eq(zuordnungen.zielId, zielId)))
    .all().length;
}

export function loescheInhalt(
  db: Db,
  exponatId: string,
  art: "dokument" | "link" | "kontakt",
  zielId: string,
): void {
  db.transaction((tx) => {
    tx.delete(zuordnungen)
      .where(and(eq(zuordnungen.art, art), eq(zuordnungen.zielId, zielId)))
      .run();
    if (art === "dokument")
      tx.delete(exponatDokumente).where(eq(exponatDokumente.id, zielId)).run();
    else if (art === "link") tx.delete(exponatLinks).where(eq(exponatLinks.id, zielId)).run();
    else {
      /*
       * Bei einem Ansprechpartner wird **nur die Zuweisung** aufgehoben. Die Person bleibt
       * als Stammdatensatz stehen; sie haengt womoeglich noch an anderen Exponaten.
       */
      tx.delete(exponatAnsprechpartner)
        .where(
          and(
            eq(exponatAnsprechpartner.exponatId, exponatId),
            eq(exponatAnsprechpartner.ansprechpartnerId, zielId),
          ),
        )
        .run();
    }
  });
}

// --- Betreuer ---------------------------------------------------------------------------

export function betreuerVonExponat(db: Db, exponatId: string): string[] {
  return db
    .select({ id: exponatBetreuer.appNutzerId })
    .from(exponatBetreuer)
    .where(eq(exponatBetreuer.exponatId, exponatId))
    .all()
    .map((b) => b.id);
}

export function istBetreuer(db: Db, exponatId: string, nutzerId: string): boolean {
  return (
    db
      .select({ id: exponatBetreuer.appNutzerId })
      .from(exponatBetreuer)
      .where(
        and(eq(exponatBetreuer.exponatId, exponatId), eq(exponatBetreuer.appNutzerId, nutzerId)),
      )
      .get() !== undefined
  );
}
