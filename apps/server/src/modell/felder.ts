/**
 * Die Datenpunkte des Konnektor-Modells, an **einer** Stelle gebildet.
 *
 * `/model` kuendigt sie an, `/values` liefert sie, und der Content-Admin mappt sie in Axon
 * auf Submodellelemente. Entstuenden die Namen an zwei Stellen, genuegte ein Tippfehler in
 * einer davon, damit Axon einen Datenpunkt mappt, den `/values` nie liefert: der Viewer
 * bliebe leer, und zwar ohne Fehlermeldung irgendwo.
 *
 * **Das Modell ist nach dem Mappen unveraenderlich.** Ein neues Exponat, eine geaenderte
 * Kennung oder andere Obergrenzen aendern die Liste und verlangen ein neues Mapping in
 * Axon. Deshalb stehen die Obergrenzen hier als benannte Konstanten und nicht verstreut.
 */

/** Entschieden am 07.10.2026. Jede Aenderung kostet ein neues Mapping in Axon. */
export const MAX_DOKUMENTE = 10;
export const MAX_LINKS = 10;
export const MAX_KONTAKTE = 5;

/**
 * Rundenzeiten von der Carrera-Bahn, je Besucher.
 *
 * Dieselbe Zahl wie `MAX_RUNDEN` in `services/runden.ts`; sie steht hier, weil das Modell
 * **alle** Plaetze enthalten muss, auch leere, und dort, weil die Aufnahme sie durchsetzt.
 * Zwei Stellen, eine Zahl: die Pruefungen halten sie zusammen.
 */
export const MAX_RUNDEN_MODELL = 20;

/**
 * Die zehn schnellsten Fahrer der Carrera-Bahn, seit dem 19.10.2026.
 *
 * **Fuer alle Besucher gleich**: jede `values`-Antwort traegt dieselbe Liste, damit jeder Pass
 * im Viewer die aktuelle Top 10 zeigt, ohne eigenes Item in Axon.
 */
export const MAX_TOP_MODELL = 10;

/** Der Typ laut Spec. Ausgegeben wird die Zahl, siehe `PROPERTY_TYPE`. */
export const PROPERTY_TYPE = { property: 0, document: 1 } as const;

/**
 * Die zehn Textfelder eines Besuchers, in der Reihenfolge des Entwurfs.
 *
 * Dieselbe Liste traegt die Ansprechpartner eines Exponats: die Spalten sind dort
 * dieselben, nur ohne GUID. Eine Liste statt zwei, damit sie nicht auseinanderlaufen.
 */
export const PERSONENFELDER = [
  /*
   * **Der Titel hat hier keine propertyId.** Beim Ansprechpartner wird er in `werte.ts` dem
   * Vornamen vorangestellt ("Dr. Dirk" als `FirstName`). Beim Besucher geht er seit dem
   * 19.10.2026 getrennt als `VISITOR_TITLE` hinaus; das steht unten, weil diese Liste auch die
   * Ansprechpartner traegt.
   *
   * `id: null` heisst also "geht nicht ueber diese Liste einzeln hinaus".
   */
  { feld: "titel", id: null, name: "Titel" },
  { feld: "vorname", id: "FirstName", name: "Vorname" },
  { feld: "nachname", id: "LastName", name: "Nachname" },
  { feld: "firma", id: "Company", name: "Firma" },
  { feld: "position", id: "Position", name: "Position" },
  { feld: "email", id: "Email", name: "E-Mail" },
  { feld: "strasse", id: "Street", name: "Strasse" },
  { feld: "plz", id: "PostalCode", name: "PLZ" },
  { feld: "ort", id: "City", name: "Ort" },
  { feld: "land", id: "Country", name: "Land" },
  { feld: "website", id: "Website", name: "Website" },
] as const;

export type Personenfeld = (typeof PERSONENFELDER)[number]["feld"];

/** Zweistellig, `01` bis `10`. Der Platz steht so in jeder propertyId. */
export function platzNr(platz: number): string {
  return String(platz).padStart(2, "0");
}

// --- Die propertyIds ------------------------------------------------------------------

export const VISITOR_AVATAR = "Visitor_Avatar";

/**
 * Der Alias eines Besuchers, seit dem 19.10.2026.
 *
 * **Bewusst nicht in `PERSONENFELDER`.** Die Liste traegt auch die Ansprechpartner, und ein
 * Eintrag dort erzeugte je Exponat fuenf `{K}_Contact{NN}_Alias`, die es nicht gibt. Anders
 * als der Titel geht der Alias als eigene Eigenschaft hinaus; der Content-Admin muss sie in
 * Axon nachmappen.
 */
export const VISITOR_ALIAS = "Visitor_Alias";

/**
 * Der akademische Titel eines Besuchers, getrennt vom Vornamen, seit dem 19.10.2026.
 *
 * Vorher stand er vorn im Vornamen, damit kein neues Mapping noetig war. Der Nutzer will ihn
 * getrennt; `Visitor_FirstName` traegt seitdem nur noch den Vornamen. **Nur beim Besucher**,
 * die Ansprechpartner behalten den Titel im Vornamen.
 */
export const VISITOR_TITLE = "Visitor_Title";

export function visitorFeld(id: string): string {
  return `Visitor_${id}`;
}

/**
 * `Visitor_Lap01` bis `Visitor_Lap20`.
 *
 * Eine Eigenschaft je Runde statt mehrerer je Runde: der Content-Admin mappt von Hand, und
 * 20 Zeilen sind machbar, 80 Felder waeren es nicht. Der Wert ist eine lesbare Zeile,
 * siehe `rundeAlsText`.
 */
export function visitorRunde(platz: number): string {
  return `Visitor_Lap${platzNr(platz)}`;
}

/**
 * `pos1` bis `pos10`, je Platz **eine** Eigenschaft mit dem Wert "Alias - Rundenzeit".
 *
 * Seit dem 20.10.2026, so vom Nutzer vorgegeben, auch die Schreibweise ohne fuehrende Null.
 * Vorher drei Eigenschaften je Platz (`Carrera_Top01_Place`, `_Driver`, `_BestLap`).
 *
 * **Der Fahrer ist nur sein Alias**, Entscheidung des Nutzers: die Liste steht in jedem
 * oeffentlichen Viewer, und Klarnamen anderer Besucher gehoeren dort nicht hin.
 */
export function topPosition(platz: number): string {
  return `pos${String(platz)}`;
}

/**
 * `Global01` bis `Global99`: Datenpunkte, die jeder Besucher gleich bekommt, seit dem
 * 20.10.2026. Siehe `services/globaldaten.ts`.
 */
export function globalId(nummer: number): string {
  return `Global${platzNr(nummer)}`;
}

export function exponatName(kennung: string): string {
  return `${kennung}_Name`;
}
export function exponatBeschreibung(kennung: string): string {
  return `${kennung}_Description`;
}

export function dokumentDatei(kennung: string, platz: number): string {
  return `${kennung}_Doc${platzNr(platz)}_File`;
}
export function dokumentTitel(kennung: string, platz: number): string {
  return `${kennung}_Doc${platzNr(platz)}_Title`;
}
export function dokumentBeschreibung(kennung: string, platz: number): string {
  return `${kennung}_Doc${platzNr(platz)}_Description`;
}

export function linkUrl(kennung: string, platz: number): string {
  return `${kennung}_Link${platzNr(platz)}_Url`;
}
export function linkTitel(kennung: string, platz: number): string {
  return `${kennung}_Link${platzNr(platz)}_Title`;
}

export function kontaktFeld(kennung: string, platz: number, id: string): string {
  return `${kennung}_Contact${platzNr(platz)}_${id}`;
}
// --- Filter ---------------------------------------------------------------------------
