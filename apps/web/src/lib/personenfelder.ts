/**
 * Die Felder einer Person, gruppiert. Eine Liste für alle Masken.
 *
 * **Vorher stand dieselbe Liste viermal da**: in der Besucherdetailseite, am Tablet, bei den
 * Ansprechpartnern und noch einmal im Server. Beim ersten neuen Feld fiel das auf: der
 * Titel war in drei Masken eingetragen und fehlte in der vierten Abfrage, stand also in der
 * Datenbank und kam nie im Viewer an.
 *
 * Die Gruppen sind der eigentliche Zweck: zehn Felder am Stück liest niemand, und am Tablet
 * steht jemand dabei.
 */

export type Feldgruppe = "Person" | "Firma" | "Anschrift" | "Kontakt";

export interface Personenfeld {
  name: string;
  text: string;
  gruppe: Feldgruppe;
  pflicht?: boolean;
  typ?: "text" | "email";
}

export const PERSONENFELDER: Personenfeld[] = [
  { name: "titel", text: "Titel", gruppe: "Person" },
  { name: "vorname", text: "Vorname", gruppe: "Person", pflicht: true },
  { name: "nachname", text: "Nachname", gruppe: "Person", pflicht: true },
  { name: "firma", text: "Firma", gruppe: "Firma" },
  { name: "position", text: "Position", gruppe: "Firma" },
  { name: "strasse", text: "Straße", gruppe: "Anschrift" },
  { name: "plz", text: "PLZ", gruppe: "Anschrift" },
  { name: "ort", text: "Ort", gruppe: "Anschrift" },
  { name: "land", text: "Land", gruppe: "Anschrift" },
  { name: "email", text: "E-Mail", gruppe: "Kontakt", typ: "email" },
  { name: "website", text: "Website", gruppe: "Kontakt" },
];

/** In Anzeigereihenfolge, damit keine Maske eine eigene Folge erfindet. */
export const GRUPPEN: Feldgruppe[] = ["Person", "Firma", "Anschrift", "Kontakt"];

/** Die Felder einer Gruppe, in der Reihenfolge der Liste oben. */
export function felderDerGruppe(gruppe: Feldgruppe): Personenfeld[] {
  return PERSONENFELDER.filter((f) => f.gruppe === gruppe);
}

/**
 * Titel und Vorname, wie sie zusammen gelesen werden.
 *
 * Dieselbe Regel wie in der Konnektor-Antwort: ohne Titel bleibt der Vorname unverändert,
 * insbesondere **ohne** führendes Leerzeichen.
 */
export function mitTitel(titel: string | null | undefined, vorname: string): string {
  const t = (titel ?? "").trim();
  return t === "" ? vorname : `${t} ${vorname}`;
}
