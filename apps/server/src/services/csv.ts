import { parse } from "csv-parse/sync";
import { badRequest } from "../errors.js";

/**
 * CSV lesen: Zeichensatz, Trennzeichen, Spaltenzuordnung.
 *
 * Zerlegt wird mit `csv-parse`, nicht von Hand. Anfuehrungszeichen, eingebettete
 * Trennzeichen und Zeilenumbrueche **im Feld** sind genau die Stellen, an denen ein selbst
 * geschriebener Parser bei der echten Kundendatei scheitert, und zwar still: er liefert
 * dann Zeilen, die plausibel aussehen und falsch sind.
 *
 * Der **Zeichensatz** wird dagegen hier erkannt. Das kann keine CSV-Bibliothek: sie
 * bekommt bereits Text.
 */

/**
 * Liest die Rohbytes als Text.
 *
 * Erst UTF-8 **streng** versuchen, dann Windows-1252. Excel speichert CSV auf deutschen
 * Rechnern in der Windows-Codepage, und ohne diesen Rueckfall werden aus jedem Umlaut
 * Ersatzzeichen. Umgekehrt waere es falsch, immer 1252 zu nehmen: eine korrekte UTF-8-Datei
 * zerfiele dann in Mojibake.
 *
 * `fatal: true` ist der Kern: ohne das ersetzt der Dekodierer ungueltige Folgen still durch
 * U+FFFD, und die Erkennung liefe immer in den ersten Zweig.
 */
export function leseText(rohdaten: Buffer): {
  text: string;
  zeichensatz: "utf-8" | "windows-1252";
} {
  // Ein BOM gehoert nicht in den Inhalt; es wuerde sonst im ersten Spaltennamen stehen.
  const ohneBom =
    rohdaten.length >= 3 && rohdaten[0] === 0xef && rohdaten[1] === 0xbb && rohdaten[2] === 0xbf
      ? rohdaten.subarray(3)
      : rohdaten;

  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(ohneBom),
      zeichensatz: "utf-8",
    };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(ohneBom),
      zeichensatz: "windows-1252",
    };
  }
}

/**
 * Das Trennzeichen aus der **Kopfzeile**, nicht aus der ganzen Datei.
 *
 * In den Daten koennen Kommas in Freitextfeldern stehen; die Kopfzeile besteht dagegen aus
 * Spaltennamen. Gezaehlt wird ausserhalb von Anfuehrungszeichen, sonst gewinnt ein
 * `"Firma, Abteilung"` gegen das echte Semikolon.
 */
export function erkenneTrennzeichen(text: string): ";" | "," {
  const kopf = text.split(/\r?\n/, 1)[0] ?? "";
  let inAnfuehrung = false;
  let semikolon = 0;
  let komma = 0;
  for (const zeichen of kopf) {
    if (zeichen === '"') inAnfuehrung = !inAnfuehrung;
    else if (!inAnfuehrung && zeichen === ";") semikolon++;
    else if (!inAnfuehrung && zeichen === ",") komma++;
  }
  // Gleichstand und keine Treffer gehen auf Semikolon: so speichert Excel hier.
  return komma > semikolon ? "," : ";";
}

/** Die Zielfelder, auf die sich eine Spalte abbilden laesst. */
export const ZIELFELDER = [
  "guid",
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

export type Zielfeld = (typeof ZIELFELDER)[number];

/**
 * Eine leere Vorlage zum Herunterladen, erzeugt aus **`ZIELFELDER`**.
 *
 * Aus derselben Liste, gegen die der Import abgleicht. Eine von Hand gepflegte Vorlage
 * liefe auseinander, sobald eine Spalte dazukommt, und zwar still: die Datei bliebe
 * lesbar, nur fehlte die Spalte.
 *
 * **Mit BOM.** Excel liest eine UTF-8-Datei ohne Byte Order Mark als Windows-1252 und
 * macht aus jedem Umlaut zwei Zeichen. Der Import hier kaeme damit zurecht, der Weg
 * ueber Excel und zurueck nicht.
 */
export function vorlageCsv(): string {
  const beispiel: Partial<Record<Zielfeld, string>> = {
    guid: "A1B2C3D4",
    vorname: "Erika",
    nachname: "Mustermann",
    firma: "Beispiel GmbH",
    position: "Leitung Technik",
    email: "erika.mustermann@example.org",
    strasse: "Musterweg 1",
    plz: "68307",
    ort: "Mannheim",
    land: "Deutschland",
    website: "https://example.org",
  };
  const zeilen = [ZIELFELDER.join(";"), ZIELFELDER.map((f) => beispiel[f] ?? "").join(";")];
  // BOM und CRLF als Codepunkte, damit die Datei genau das enthaelt, was Excel erwartet.
  const bom = "\uFEFF";
  const zeilenende = "\r\n";
  return bom + zeilen.join(zeilenende) + zeilenende;
}

/**
 * Bekannte Spaltennamen, klein geschrieben und ohne Sonderzeichen verglichen.
 *
 * Mehrere Schreibweisen je Feld, weil die Datei aus einem Anmeldewerkzeug kommt und
 * niemand ihre Kopfzeile vorschreibt.
 */
const BEKANNT: Record<string, Zielfeld> = {
  guid: "guid",
  id: "guid",
  passid: "guid",
  ausweis: "guid",
  vorname: "vorname",
  firstname: "vorname",
  nachname: "nachname",
  name: "nachname",
  lastname: "nachname",
  familienname: "nachname",
  firma: "firma",
  unternehmen: "firma",
  company: "firma",
  organisation: "firma",
  position: "position",
  funktion: "position",
  rolle: "position",
  titel: "position",
  email: "email",
  mail: "email",
  epost: "email",
  strasse: "strasse",
  adresse: "strasse",
  street: "strasse",
  plz: "plz",
  postleitzahl: "plz",
  zip: "plz",
  ort: "ort",
  stadt: "ort",
  city: "ort",
  land: "land",
  country: "land",
  website: "website",
  webseite: "website",
  url: "website",
  homepage: "website",
};

/** Klein, ohne Leer- und Sonderzeichen: `E-Mail Adresse` wird zu `emailadresse`. */
function normalisiere(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z]/g, "");
}

/**
 * Schlaegt je Spalte ein Zielfeld vor.
 *
 * Erst der genaue Treffer, dann ein Praefixtreffer (`emailadresse` auf `email`). Ein
 * Zielfeld wird **hoechstens einmal** vergeben: zwei Spalten auf dasselbe Feld waeren
 * mehrdeutig, und die zweite bliebe stillschweigend wirkungslos.
 */
export function schlageZuordnungVor(spalten: string[]): (Zielfeld | null)[] {
  const vergeben = new Set<Zielfeld>();
  return spalten.map((spalte) => {
    const schluessel = normalisiere(spalte);
    let treffer = BEKANNT[schluessel];
    if (treffer === undefined) {
      const passend = Object.keys(BEKANNT).find((k) => schluessel.startsWith(k) && k.length >= 4);
      if (passend !== undefined) treffer = BEKANNT[passend];
    }
    if (treffer === undefined || vergeben.has(treffer)) return null;
    vergeben.add(treffer);
    return treffer;
  });
}

export interface CsvInhalt {
  zeichensatz: "utf-8" | "windows-1252";
  trennzeichen: ";" | ",";
  spalten: string[];
  /** Je Datenzeile die Werte in der Reihenfolge der Spalten. */
  zeilen: string[][];
}

export function leseCsv(rohdaten: Buffer): CsvInhalt {
  const { text, zeichensatz } = leseText(rohdaten);
  if (text.trim() === "") throw badRequest("csv-leer", "The file is empty.");

  const trennzeichen = erkenneTrennzeichen(text);

  let saetze: string[][];
  try {
    saetze = parse(text, {
      delimiter: trennzeichen,
      bom: false,
      skip_empty_lines: true,
      // Zeilen mit abweichender Spaltenzahl sind kein Grund abzubrechen; sie werden
      // weiter unten als Beanstandung gemeldet.
      relax_column_count: true,
      relax_quotes: true,
      trim: true,
    }) as string[][];
  } catch (ursache) {
    throw badRequest("csv-unlesbar", `The file could not be parsed: ${(ursache as Error).message}`);
  }

  const kopf = saetze[0];
  if (kopf === undefined) throw badRequest("csv-leer", "The file has no header row.");

  return { zeichensatz, trennzeichen, spalten: kopf, zeilen: saetze.slice(1) };
}
