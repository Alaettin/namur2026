import { describe, expect, it } from "vitest";
import {
  erkenneTrennzeichen,
  leseCsv,
  leseText,
  schlageZuordnungVor,
} from "../src/services/csv.js";

/** Kodiert Text als Windows-1252, so wie Excel es auf einem deutschen Rechner speichert. */
function alsWindows1252(text: string): Buffer {
  const tabelle: Record<string, number> = {
    ä: 0xe4,
    ö: 0xf6,
    ü: 0xfc,
    Ä: 0xc4,
    Ö: 0xd6,
    Ü: 0xdc,
    ß: 0xdf,
    é: 0xe9,
  };
  const bytes: number[] = [];
  for (const zeichen of text) {
    const sonder = tabelle[zeichen];
    if (sonder !== undefined) bytes.push(sonder);
    else if (zeichen.charCodeAt(0) < 128) bytes.push(zeichen.charCodeAt(0));
    else throw new Error(`Zeichen ${zeichen} fehlt in der Testtabelle`);
  }
  return Buffer.from(bytes);
}

describe("Zeichensatz", () => {
  it("liest UTF-8 ohne BOM", () => {
    const { text, zeichensatz } = leseText(Buffer.from("Grüße, Maße", "utf8"));
    expect(zeichensatz).toBe("utf-8");
    expect(text).toBe("Grüße, Maße");
  });

  it("entfernt ein BOM", () => {
    const mitBom = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("guid;vorname", "utf8"),
    ]);
    const { text, zeichensatz } = leseText(mitBom);
    expect(zeichensatz).toBe("utf-8");
    // Ohne das Entfernen stuende das BOM im ersten Spaltennamen und die Zuordnung scheiterte.
    expect(text).toBe("guid;vorname");
    expect(text.startsWith("guid")).toBe(true);
  });

  /**
   * **Die Falle.** Ohne `fatal: true` ersetzt der Dekodierer ungueltige Folgen still durch
   * U+FFFD, die Erkennung liefe immer in den UTF-8-Zweig, und aus jedem Umlaut wuerde ein
   * Ersatzzeichen.
   */
  it("faellt bei ungueltigem UTF-8 auf Windows-1252 zurueck", () => {
    const { text, zeichensatz } = leseText(alsWindows1252("Grüße aus Köln"));
    expect(zeichensatz).toBe("windows-1252");
    expect(text).toBe("Grüße aus Köln");
    expect(text).not.toContain("�");
  });

  /** Die Gegenrichtung: eine echte UTF-8-Datei darf **nicht** als 1252 gelesen werden. */
  it("liest gueltiges UTF-8 nicht als Windows-1252", () => {
    const { text, zeichensatz } = leseText(Buffer.from("Köln", "utf8"));
    expect(zeichensatz).toBe("utf-8");
    expect(text).toBe("Köln");
    // Als 1252 gelesen stuende hier "KÃ¶ln".
    expect(text).not.toContain("Ã");
  });
});

describe("Trennzeichen", () => {
  it("erkennt Semikolon und Komma aus der Kopfzeile", () => {
    expect(erkenneTrennzeichen("guid;vorname;nachname\na;b;c")).toBe(";");
    expect(erkenneTrennzeichen("guid,vorname,nachname\na,b,c")).toBe(",");
  });

  it("laesst sich von Kommas in Anfuehrungszeichen nicht taeuschen", () => {
    // Ein Freitextfeld in der Kopfzeile mit zwei Kommas, aber das echte Trennzeichen ist ;
    expect(erkenneTrennzeichen('guid;"Firma, Abteilung, Ort";ort')).toBe(";");
  });

  /**
   * **Gezaehlt wird in der Kopfzeile, nicht in der ganzen Datei.**
   *
   * Hier stehen in den Daten mehr Kommas als in der ganzen Datei Semikola. Wer ueber alle
   * Zeilen zaehlt, entscheidet sich fuer das Komma, zerlegt die Datei falsch und bekommt
   * Spalten, die plausibel aussehen.
   */
  it("zaehlt nur die Kopfzeile, nicht die Daten", () => {
    const datei = "guid;bemerkung\nA1;rot, gruen, blau, gelb\nA2;eins, zwei, drei, vier\n";
    expect(erkenneTrennzeichen(datei)).toBe(";");
  });

  it("nimmt bei einer einspaltigen Datei Semikolon an", () => {
    expect(erkenneTrennzeichen("guid\nabc")).toBe(";");
  });
});

describe("Spaltenzuordnung", () => {
  it("erkennt gelaeufige Schreibweisen", () => {
    const vorschlag = schlageZuordnungVor([
      "GUID",
      "Vorname",
      "Nachname",
      "Unternehmen",
      "Funktion",
      "E-Mail",
      "PLZ",
      "Stadt",
    ]);
    expect(vorschlag).toEqual([
      "guid",
      "vorname",
      "nachname",
      "firma",
      "position",
      "email",
      "plz",
      "ort",
    ]);
  });

  it("laesst unbekannte Spalten offen", () => {
    expect(schlageZuordnungVor(["Vorname", "Lieblingsfarbe"])).toEqual(["vorname", null]);
  });

  /**
   * Ein Zielfeld darf **hoechstens einmal** vergeben werden. Zwei Spalten auf dasselbe Feld
   * waeren mehrdeutig, und die zweite bliebe stillschweigend wirkungslos.
   */
  it("vergibt ein Zielfeld nur einmal", () => {
    const vorschlag = schlageZuordnungVor(["E-Mail", "Mail"]);
    expect(vorschlag[0]).toBe("email");
    expect(vorschlag[1]).toBeNull();
  });
});

describe("Zerlegen", () => {
  it("haelt Anfuehrungszeichen und eingebettete Trennzeichen aus", () => {
    const csv = 'guid;vorname;firma\nA1;Anna;"Mueller, Meier & Co."\n';
    const inhalt = leseCsv(Buffer.from(csv, "utf8"));
    expect(inhalt.spalten).toEqual(["guid", "vorname", "firma"]);
    expect(inhalt.zeilen[0]).toEqual(["A1", "Anna", "Mueller, Meier & Co."]);
  });

  it("haelt einen Zeilenumbruch im Feld aus", () => {
    const csv = 'guid;bemerkung\nA1;"erste Zeile\nzweite Zeile"\n';
    const inhalt = leseCsv(Buffer.from(csv, "utf8"));
    // Eine Datenzeile, nicht zwei.
    expect(inhalt.zeilen).toHaveLength(1);
    expect(inhalt.zeilen[0]?.[1]).toContain("zweite Zeile");
  });

  it("kommt mit CRLF zurecht", () => {
    const inhalt = leseCsv(Buffer.from("guid;vorname\r\nA1;Anna\r\n", "utf8"));
    expect(inhalt.zeilen).toEqual([["A1", "Anna"]]);
  });

  it("weist eine leere Datei ab", () => {
    expect(() => leseCsv(Buffer.from("", "utf8"))).toThrow(/empty/);
  });
});
