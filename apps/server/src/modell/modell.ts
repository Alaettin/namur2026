import { asc } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { exponate } from "../db/schema.js";
import {
  MAX_DOKUMENTE,
  MAX_KONTAKTE,
  MAX_RUNDEN_MODELL,
  MAX_LINKS,
  PERSONENFELDER,
  PROPERTY_TYPE,
  VISITOR_AVATAR,
  dokumentBeschreibung,
  dokumentDatei,
  dokumentTitel,
  exponatBeschreibung,
  exponatName,
  kontaktFeld,
  linkTitel,
  linkUrl,
  platzNr,
  visitorFeld,
  visitorRunde,
} from "./felder.js";

/**
 * Wie viele Personenfelder wirklich als Eigenschaft hinausgehen.
 *
 * **Nicht `PERSONENFELDER.length`.** Der Titel steht in der Liste, bekommt aber keine
 * propertyId; er wird dem Vornamen vorangestellt. Gerechnet statt eingetragen, damit die
 * Zahl beim naechsten Feld nicht still falsch wird: sie speist den ETag des Modells.
 */
const AUSGEGEBENE_PERSONENFELDER = PERSONENFELDER.filter((f) => f.id !== null).length;

/**
 * Das Datenmodell, das Axon beim Mappen liest.
 *
 * **Es enthaelt immer alle Plaetze bis zur Obergrenze, auch leere.** Der Nutzer mappt vor
 * der Konferenz, die Inhalte kommen erst waehrenddessen dazu. Enthielte das Modell nur die
 * gefuellten Plaetze, muesste nach jedem Upload neu gemappt werden, und genau das soll
 * nicht sein.
 */

/**
 * Ein Datenpunkt, wie Axon ihn beim Mappen sieht.
 *
 * **Nur drei Felder**, Entscheidung des Nutzers vom 08.10.2026. Die Spezifikation verlangt
 * keines von `description`, `filters` und `semanticIds` (`required: []` im Schema
 * `DataModelProperty`), der Vertrag bleibt also gewahrt. Von 195 auf rund 72 KB bei 1031
 * Datenpunkten.
 *
 * **Die Folge, die bleibt:** in Axon laesst sich beim Mappen nicht mehr nach Exponat, Art
 * und Platz eingrenzen; genau dafuer waren die Filter da. `semanticIds` war ohnehin immer
 * leer.
 */
export interface DataModelProperty {
  id: string;
  name: string;
  type: number;
}

function eintrag(id: string, name: string, type: number): DataModelProperty {
  return { id, name, type };
}

/**
 * Baut das vollstaendige Modell aus den angelegten Exponaten.
 *
 * Je Exponat 2 + 10*3 + 10*2 + 5*11 = 107 Datenpunkte, dazu 11 fuer den Besucher.
 */
export function baueModell(db: Db): DataModelProperty[] {
  const felder: DataModelProperty[] = [];

  // --- Der Besucher -------------------------------------------------------------------
  for (const { id, name } of PERSONENFELDER) {
    // `id: null` heisst "geht nicht einzeln hinaus", siehe den Titel in `felder.ts`.
    if (id === null) continue;
    felder.push(eintrag(visitorFeld(id), `Besucher ${name}`, PROPERTY_TYPE.property));
  }
  felder.push(eintrag(VISITOR_AVATAR, "Besucher Foto", PROPERTY_TYPE.document));

  /*
   * **Die 20 Rundenplaetze, immer alle.** Wie bei Dokumenten und Links: der Content-Admin
   * mappt vor der Konferenz, gefahren wird waehrenddessen. Enthielte das Modell nur die
   * gefahrenen Runden, muesste nach jedem Rennen neu gemappt werden.
   */
  for (let p = 1; p <= MAX_RUNDEN_MODELL; p++) {
    felder.push(eintrag(visitorRunde(p), `Besucher Runde ${platzNr(p)}`, PROPERTY_TYPE.property));
  }

  // --- Je Exponat ---------------------------------------------------------------------
  // Nach Kennung sortiert, damit die Liste in Axon stabil bleibt und zwei Abrufe
  // dieselbe Reihenfolge liefern.
  const alle = db.select().from(exponate).orderBy(asc(exponate.kennung)).all();

  for (const e of alle) {
    const k = e.kennung;
    felder.push(
      eintrag(exponatName(k), `${k} Name`, PROPERTY_TYPE.property),
      eintrag(exponatBeschreibung(k), `${k} Beschreibung`, PROPERTY_TYPE.property),
    );

    for (let p = 1; p <= MAX_DOKUMENTE; p++) {
      const nr = platzNr(p);
      felder.push(
        eintrag(dokumentDatei(k, p), `${k} Dokument ${nr} Datei`, PROPERTY_TYPE.document),
        eintrag(dokumentTitel(k, p), `${k} Dokument ${nr} Titel`, PROPERTY_TYPE.property),
        eintrag(
          dokumentBeschreibung(k, p),
          `${k} Dokument ${nr} Beschreibung`,
          PROPERTY_TYPE.property,
        ),
      );
    }

    for (let p = 1; p <= MAX_LINKS; p++) {
      const nr = platzNr(p);
      felder.push(
        eintrag(linkUrl(k, p), `${k} Link ${nr} Adresse`, PROPERTY_TYPE.property),
        eintrag(linkTitel(k, p), `${k} Link ${nr} Titel`, PROPERTY_TYPE.property),
      );
    }

    for (let p = 1; p <= MAX_KONTAKTE; p++) {
      const nr = platzNr(p);
      for (const { id, name } of PERSONENFELDER) {
        if (id === null) continue;
        felder.push(
          eintrag(
            kontaktFeld(k, p, id),
            `${k} Ansprechpartner ${nr} ${name}`,
            PROPERTY_TYPE.property,
          ),
        );
      }
    }
  }

  return felder;
}

/**
 * Zahl der Datenpunkte je Exponat, fuer den Bildschirm API.
 *
 * Ansprechpartner tragen **kein Foto** mehr, deshalb `PERSONENFELDER.length` statt `+ 1`:
 * aus 107 Datenpunkten je Exponat wurden 102.
 */
export const FELDER_JE_EXPONAT =
  2 + MAX_DOKUMENTE * 3 + MAX_LINKS * 2 + MAX_KONTAKTE * AUSGEGEBENE_PERSONENFELDER;

/** Zahl der Besucherdatenpunkte. */
export const FELDER_BESUCHER = AUSGEGEBENE_PERSONENFELDER + 1 + MAX_RUNDEN_MODELL;
