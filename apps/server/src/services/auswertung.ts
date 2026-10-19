import { asc } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { besucher, exponate, zuordnungen } from "../db/schema.js";

/**
 * Die Auswertung nach der Messe: wer welches Exponat besucht hat, als CSV fuer Excel.
 *
 * Eine Zeile je Besucher mit allen Stammdaten, danach eine Spalte je Exponat mit `x`.
 * **Besucht** heisst: mindestens eine Zuordnung an diesem Exponat, dieselbe Regel wie im
 * Konnektor und im Besucherdetail.
 */

const STAMMDATEN = [
  ["guid", "GUID"],
  ["titel", "Titel"],
  ["vorname", "Vorname"],
  ["nachname", "Nachname"],
  ["alias", "Alias"],
  ["firma", "Firma"],
  ["position", "Position"],
  ["email", "E-Mail"],
  ["strasse", "Straße"],
  ["plz", "PLZ"],
  ["ort", "Ort"],
  ["land", "Land"],
  ["website", "Website"],
] as const;

/**
 * Ein Feld fuer Excel.
 *
 * **Formeln entschaerft:** ein Wert, der mit `=`, `+`, `-`, `@` oder einem Tab beginnt,
 * bekommt ein Hochkomma davor. Excel fuehrte ihn sonst als Formel aus, und die Felder
 * kommen aus CSV-Importen und vom Tablet, also von aussen.
 *
 * In Anfuehrungszeichen, sobald Trennzeichen, Anfuehrungszeichen oder Zeilenumbruch darin
 * stehen; innere Anfuehrungszeichen werden verdoppelt.
 */
export function csvFeld(wert: string | null): string {
  let t = wert ?? "";
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function auswertungCsv(db: Db): string {
  const alleExponate = db.select().from(exponate).orderBy(asc(exponate.kennung)).all();
  /*
   * **Deutsch sortiert, nicht in SQLite.** SQLite vergleicht Bytes, und "Ährens" stuende
   * hinter "Zander". In Excel liest man die Liste von oben nach unten.
   */
  const deutsch = new Intl.Collator("de", { sensitivity: "base" });
  const leute = db
    .select()
    .from(besucher)
    .all()
    .sort(
      (a, b) =>
        deutsch.compare(a.nachname, b.nachname) ||
        deutsch.compare(a.vorname, b.vorname) ||
        a.guid.localeCompare(b.guid),
    );

  // Eine Abfrage fuer alle Besuche statt einer je Besucher.
  const besuche = new Set(
    db
      .selectDistinct({ guid: zuordnungen.besucherGuid, exponatId: zuordnungen.exponatId })
      .from(zuordnungen)
      .all()
      .map((b) => `${b.guid}\u0000${b.exponatId}`),
  );

  const kopf = [
    ...STAMMDATEN.map(([, text]) => text),
    ...alleExponate.map((e) => `${e.kennung} ${e.name}`),
  ];
  const zeilen = leute.map((p) => [
    ...STAMMDATEN.map(([feld]) => p[feld]),
    ...alleExponate.map((e) => (besuche.has(`${p.guid}\u0000${e.id}`) ? "x" : "")),
  ]);

  // BOM und CRLF wie bei der CSV-Vorlage: so oeffnet Excel die Datei mit Umlauten.
  return (
    "\uFEFF" + [kopf, ...zeilen].map((z) => z.map((f) => csvFeld(f)).join(";")).join("\r\n") + "\r\n"
  );
}
