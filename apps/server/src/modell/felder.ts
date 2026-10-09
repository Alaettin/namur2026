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
   * **Der Titel hat bewusst keine eigene propertyId.** Er wird in `werte.ts` dem Vornamen
   * vorangestellt, sodass "Dr. Anna" als `FirstName` hinausgeht. Eine eigene Eigenschaft
   * haette der Content-Admin in Axon nachmappen muessen, sonst waere der Titel im Viewer
   * unsichtbar geblieben; so aendert sich das Modell ueberhaupt nicht.
   *
   * `id: null` ist deshalb kein Mangel, sondern die Aussage "geht nicht einzeln hinaus".
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

export function visitorFeld(id: string): string {
  return `Visitor_${id}`;
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
