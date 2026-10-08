import type { Db } from "../db/client.js";
import type { Dateiablage } from "../ablage/dateien.js";
import { exponate } from "../db/schema.js";
import { conflict } from "../errors.js";
import { legeBesucherAn } from "./besucher.js";
import { legeDokumentAn, legeExponatAn, legeLinkAn } from "./exponate.js";
import { legeAnsprechpartnerAn, weiseZu } from "./ansprechpartner.js";
import { speichereDatei } from "./dateien.js";
import { ordneZu } from "./zuordnungen.js";

/**
 * Beispieldaten fuer Entwicklung und Abnahme.
 *
 * Sechs Exponate und 50 Besucher, angelehnt an die Beispieldaten des Design-Pakets. Die
 * Personen und Firmen sind **erfunden**; das steht so schon in der Uebergabe.
 *
 * Die Aussaat laeuft nur gegen eine Datenbank **ohne** Exponate. Ein zweiter Lauf wuerde
 * sonst die Kennungen doppelt vergeben und mitten darin abbrechen.
 */

/** Zehn Exponate, wie sie auf der Hauptversammlung stehen koennten. */
const EXPONATE = [
  {
    kennung: "E01",
    name: "Modulare Prozessautomation",
    beschreibung: "MTP-basierte Modulintegration",
  },
  {
    kennung: "E02",
    name: "Ethernet-APL Feldgeraete",
    beschreibung: "Zweileitertechnik bis in die Zone 0",
  },
  {
    kennung: "E03",
    name: "Verwaltungsschale in der Praxis",
    beschreibung: "AAS vom Typschild bis zur Wartung",
  },
  {
    kennung: "E04",
    name: "NOA Diagnose",
    beschreibung: "Zustandsueberwachung ohne Eingriff in die Kernautomation",
  },
  { kennung: "E05", name: "Digitale Typschilder", beschreibung: "ID-Link nach IDTA-01002" },
  {
    kennung: "E06",
    name: "Offene Leitsysteme",
    beschreibung: "Herstelleruebergreifende Bedienbilder",
  },
  { kennung: "E07", name: "Funk in der Anlage", beschreibung: "WirelessHART und 5G im Vergleich" },
  {
    kennung: "E08",
    name: "Durchflussmessung",
    beschreibung: "Coriolis und Ultraschall nebeneinander",
  },
  { kennung: "E09", name: "Explosionsschutz", beschreibung: "Zuendschutzarten und ihre Grenzen" },
  { kennung: "E10", name: "Alarmmanagement", beschreibung: "Von der Flut zur brauchbaren Meldung" },
];

const FIRMEN = [
  "Mueller Prozesstechnik",
  "Nordwerk Automation",
  "Rheinsteuer AG",
  "Hansa Messtechnik",
  "Alpenland Chemie",
  "Weserwerke",
  "Ostsee Anlagenbau",
  "Taunus Regeltechnik",
  "Spreewerk Verfahrenstechnik",
  "Isar Analytik",
  "Eifel Armaturen",
  "Lausitz Energie",
  "Harzer Leittechnik",
  "Bodensee Sensorik",
  "Ruhrpol Engineering",
  "Saarstahl Automation",
];

/*
 * 40 Vornamen und 40 Nachnamen ergeben 1600 unterschiedliche Paare.
 *
 * Die Paarung laeuft ueber `vorname[i % 40]` und `nachname[Math.floor(i / 40)]`: damit ist
 * **jedes Paar eindeutig**, solange weniger als 1600 Besucher entstehen. Einzelne Vor- und
 * Nachnamen wiederholen sich dabei, das ist bei 700 Personen unvermeidlich und richtig.
 *
 * Die fruehere Fassung zog beide per Modulo aus 25er-Listen und erzeugte dadurch dieselbe
 * Person mehrfach.
 */
const VORNAMEN = [
  "Anna",
  "Bernd",
  "Claudia",
  "Dirk",
  "Eva",
  "Frank",
  "Gesa",
  "Holger",
  "Ina",
  "Jens",
  "Katrin",
  "Lars",
  "Maren",
  "Nils",
  "Olga",
  "Peter",
  "Quirin",
  "Rita",
  "Sven",
  "Tanja",
  "Udo",
  "Vera",
  "Wolf",
  "Xenia",
  "Yvonne",
  "Zacharias",
  "Birgit",
  "Clemens",
  "Doris",
  "Emil",
  "Franziska",
  "Gerrit",
  "Heike",
  "Ingo",
  "Johanna",
  "Konrad",
  "Luise",
  "Markus",
  "Nadine",
  "Oskar",
];

const NACHNAMEN = [
  "Ahrens",
  "Brandt",
  "Clausen",
  "Dietrich",
  "Ebert",
  "Fischer",
  "Groth",
  "Hoffmann",
  "Iversen",
  "Jansen",
  "Kempf",
  "Lindner",
  "Mohr",
  "Neumann",
  "Osterloh",
  "Pfeiffer",
  "Quandt",
  "Richter",
  "Schulte",
  "Thiele",
  "Ulrich",
  "Vogt",
  "Wendt",
  "Zimmer",
  "Adler",
  "Bauer",
  "Christiansen",
  "Dreyer",
  "Engel",
  "Falk",
  "Giesen",
  "Hartmann",
  "Imhof",
  "Jungclaus",
  "Kettler",
  "Lorenz",
  "Marquardt",
  "Nolte",
  "Oelze",
  "Petersen",
];

if (VORNAMEN.length !== 40 || NACHNAMEN.length !== 40) {
  // Die Eindeutigkeit der Paare haengt an genau diesen Laengen.
  throw new Error("VORNAMEN und NACHNAMEN muessen je 40 Eintraege haben");
}

const STAEDTE: [string, string][] = [
  ["Leverkusen", "51373"],
  ["Ludwigshafen", "67061"],
  ["Marl", "45772"],
  ["Hamburg", "20095"],
  ["Frankfurt", "60311"],
  ["Koeln", "50667"],
  ["Dortmund", "44135"],
  ["Bremen", "28195"],
  ["Mannheim", "68159"],
  ["Burghausen", "84489"],
  ["Gendorf", "84508"],
  ["Schkopau", "06258"],
];

/** So viele Besucher legt die Aussaat an. */
const BESUCHER_ANZAHL = 700;

/** Ein winziges, gueltiges PNG: ein Pixel. Als Avatar genug, um den Wertweg zu pruefen. */
const EIN_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export interface AussaatErgebnis {
  exponate: number;
  besucher: number;
  dokumente: number;
  links: number;
  kontakte: number;
  zuordnungen: number;
}

export async function saeAus(
  db: Db,
  ablage: Dateiablage,
  nutzerId: string,
): Promise<AussaatErgebnis> {
  if (db.select({ id: exponate.id }).from(exponate).all().length > 0) {
    throw conflict(
      "aussaat-nicht-leer",
      "The database already contains exhibits. Seeding only runs on an empty set.",
    );
  }

  const ergebnis: AussaatErgebnis = {
    exponate: 0,
    besucher: 0,
    dokumente: 0,
    links: 0,
    kontakte: 0,
    zuordnungen: 0,
  };

  const angelegteExponate: {
    id: string;
    dokumente: string[];
    links: string[];
    kontakte: string[];
  }[] = [];

  /**
   * Einer fuer alle Exponate.
   *
   * Frueher war ein Ansprechpartner an genau ein Exponat gebunden; seit dem 08.10.2026 sind
   * sie Stammdaten. Dieser hier steht an **jedem** Exponat und deckt damit den Fall ab, der
   * den Umbau ausgeloest hat.
   */
  const gemeinsamer = legeAnsprechpartnerAn(db, {
    vorname: "Hendrik",
    nachname: "Sassenberg",
    firma: "NAMUR Geschaeftsstelle",
    position: "Organisation",
    email: "orga@example.invalid",
    ort: "Leverkusen",
    plz: "51373",
    land: "Deutschland",
  });
  ergebnis.kontakte++;

  for (const e of EXPONATE) {
    // Die Kennung vergibt der Server; `e.kennung` dient nur noch der Benennung der Dateien.
    const exponat = legeExponatAn(db, { name: e.name, beschreibung: e.beschreibung });
    ergebnis.exponate++;
    const dokumente: string[] = [];
    const links: string[] = [];
    const kontakte: string[] = [];

    /*
     * Zwei Dokumente je Exponat, und zwar **ein Bild und ein PDF**. Das ist Absicht: nur
     * so laeuft in jeder Abnahme beides durch, der Wertweg und der Ticketweg.
     */
    const pdf = await speichereDatei(
      db,
      ablage,
      `Datenblatt ${e.kennung} (DE).pdf`,
      Buffer.from(`%PDF-1.4\nDatenblatt zum Exponat ${e.kennung}.\n%%EOF\n`, "utf8"),
    );
    dokumente.push(
      legeDokumentAn(db, exponat.id, {
        dateiId: pdf.id,
        titel: `Datenblatt ${e.kennung}`,
        beschreibung: "Technische Daten",
      }).id,
    );
    ergebnis.dokumente++;

    const bild = await speichereDatei(db, ablage, `vorschau-${e.kennung}.png`, EIN_PIXEL_PNG);
    dokumente.push(
      legeDokumentAn(db, exponat.id, {
        dateiId: bild.id,
        titel: `Vorschau ${e.kennung}`,
        beschreibung: null,
      }).id,
    );
    ergebnis.dokumente++;

    links.push(legeLinkAn(db, exponat.id, { url: "https://www.namur.net/", titel: "NAMUR" }).id);
    links.push(
      legeLinkAn(db, exponat.id, { url: "https://www.neoception.com/", titel: "Neoception" }).id,
    );
    ergebnis.links += 2;

    /*
     * Jedes Exponat bekommt seinen eigenen Ansprechpartner **und zusaetzlich den
     * gemeinsamen**. Damit steht derselbe Mensch an allen zehn Exponaten, und der neue Fall
     * (eine Person, mehrere Exponate, je eigener Platz) kommt in den Testdaten vor.
     */
    const eigener = legeAnsprechpartnerAn(db, {
      vorname: VORNAMEN[ergebnis.exponate % VORNAMEN.length] ?? "Anna",
      nachname: NACHNAMEN[(ergebnis.exponate * 3) % NACHNAMEN.length] ?? "Ahrens",
      firma: "Neoception GmbH",
      position: "Produktmanagement",
      email: `kontakt-${e.kennung.toLowerCase()}@example.invalid`,
      ort: "Mannheim",
      plz: "68163",
      land: "Deutschland",
    });
    weiseZu(db, exponat.id, eigener.id);
    kontakte.push(eigener.id);
    ergebnis.kontakte++;

    weiseZu(db, exponat.id, gemeinsamer.id);
    kontakte.push(gemeinsamer.id);

    angelegteExponate.push({ id: exponat.id, dokumente, links, kontakte });
  }

  for (let i = 0; i < BESUCHER_ANZAHL; i++) {
    /*
     * **Jedes Paar genau einmal.** Der Vorname laeuft schnell durch, der Nachname wechselt
     * erst nach 40 Besuchern: so entsteht bis 1600 kein Paar doppelt.
     */
    const vorname = VORNAMEN[i % VORNAMEN.length] ?? "Anna";
    const nachname = NACHNAMEN[Math.floor(i / VORNAMEN.length)] ?? "Ahrens";
    const stadt = STAEDTE[i % STAEDTE.length] ?? ["Mannheim", "68163"];
    const person = legeBesucherAn(db, {
      guid: `NHV2026-${String(i + 1).padStart(4, "0")}`,
      vorname,
      nachname,
      firma: FIRMEN[i % FIRMEN.length] ?? "Mueller Prozesstechnik",
      position: i % 3 === 0 ? "Leitung Instandhaltung" : "Fachplanung EMSR",
      // Mit laufender Nummer, sonst waere die Adresse bei gleichem Paar nicht eindeutig.
      email: `${vorname.toLowerCase()}.${nachname.toLowerCase()}${String(i + 1)}@example.invalid`,
      strasse: `Werkstrasse ${String((i % 40) + 1)}`,
      plz: stadt[1] ?? null,
      ort: stadt[0] ?? null,
      land: "Deutschland",
      website: null,
    });
    ergebnis.besucher++;

    /*
     * **Keine Avatare mehr.** Seit dem 08.10.2026 bekommt jeder Besucher den
     * Standard-Avatar als Rueckfall, `avatarDateiId` bleibt `null`. Vorher legte die
     * Aussaat je Besucher eine eigene Datei an; das waren 356 der 419 Dateien im Bestand,
     * alle mit demselben Ein-Pixel-Bild.
     */

    /*
     * Jeder dritte Besucher bekommt Zuordnungen an einem Exponat. Die uebrigen bleiben
     * ohne: `values` muss fuer sie **nur** die Stammdaten liefern, und genau das ist eine
     * der vier Gegenproben.
     */
    if (i % 3 === 0) {
      const ziel = angelegteExponate[i % angelegteExponate.length];
      if (ziel !== undefined) {
        const elemente = [
          { art: "dokument" as const, zielId: ziel.dokumente[0] ?? "" },
          { art: "dokument" as const, zielId: ziel.dokumente[1] ?? "" },
          { art: "link" as const, zielId: ziel.links[0] ?? "" },
          { art: "kontakt" as const, zielId: ziel.kontakte[0] ?? "" },
        ].filter((el) => el.zielId !== "");
        const { neu } = ordneZu(db, { guid: person.guid, exponatId: ziel.id, elemente, nutzerId });
        ergebnis.zuordnungen += neu;
      }
    }
  }

  return ergebnis;
}
