import { randomUUID } from "node:crypto";
import { eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { besucher, zuordnungen } from "../db/schema.js";
import { badRequest } from "../errors.js";
import { avatarFuer } from "./standardavatar.js";
import { leseCsv, schlageZuordnungVor, ZIELFELDER, type CsvInhalt, type Zielfeld } from "./csv.js";

/**
 * Besucher aus einer CSV uebernehmen.
 *
 * **Alle Beanstandungen stehen vor der Uebernahme fest.** Der Nutzer soll die Datei
 * korrigieren koennen, bevor etwas passiert, und nicht hinterher erfahren, dass 14 Zeilen
 * fehlen.
 */

export type Beanstandungsart =
  "guid-doppelt" | "email-ungueltig" | "pflicht-fehlt" | "spalten-zahl";

export interface Beanstandung {
  /** Eins-basiert und **inklusive Kopfzeile**, damit sie zur Anzeige in Excel passt. */
  zeile: number;
  art: Beanstandungsart;
  text: string;
}

export interface Zeilenbefund {
  zeile: number;
  werte: Partial<Record<Zielfeld, string>>;
  beanstandungen: Beanstandung[];
  /** Gibt es diese GUID schon in der Datenbank? Nur bei vorhandener GUID belegt. */
  bekannt: boolean;
}

export interface Pruefergebnis {
  zeichensatz: string;
  trennzeichen: string;
  spalten: string[];
  /** Je Spalte das vorgeschlagene oder gewaehlte Zielfeld. */
  zuordnung: (Zielfeld | null)[];
  zeilenGesamt: number;
  uebernehmbar: number;
  uebersprungen: number;
  neu: number;
  aktualisiert: number;
  beanstandungen: Beanstandung[];
  /** Die ersten Zeilen zur Ansicht, beanstandete zuerst. */
  vorschau: Zeilenbefund[];
}

/*
 * Bewusst einfach: ein Zeichen, ein @, ein Punkt dahinter. Eine strenge Pruefung nach
 * RFC 5322 lehnt gueltige Adressen ab, und die E-Mail ist hier kein Anmeldename, sondern
 * eine Angabe, die im Viewer steht.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Dasselbe Muster wie beim Anlegen von Hand, siehe `pruefeGuid`. */
const GUID_MUSTER = /^[A-Za-z0-9_-]{1,50}$/;

function werteZeile(
  zeile: string[],
  zuordnung: (Zielfeld | null)[],
): Partial<Record<Zielfeld, string>> {
  const werte: Partial<Record<Zielfeld, string>> = {};
  zuordnung.forEach((feld, i) => {
    if (feld === null) return;
    const roh = zeile[i];
    if (typeof roh === "string" && roh.trim() !== "") werte[feld] = roh.trim();
  });
  return werte;
}

/**
 * Prueft **jede** Zeile und liefert alle Befunde.
 *
 * Die Grundlage sowohl der Vorschau als auch der Uebernahme: beide muessen zum selben
 * Urteil kommen. Liefe die Uebernahme ueber eine zweite, aehnliche Schleife, koennten die
 * beiden auseinanderlaufen, und der Nutzer saehe eine Vorschau, die nicht zum Ergebnis
 * passt.
 */
function befundeJeZeile(db: Db, inhalt: CsvInhalt, zuordnung: (Zielfeld | null)[]): Zeilenbefund[] {
  const befunde: Zeilenbefund[] = [];
  /** GUIDs **innerhalb der Datei**, zur Erkennung von Doppeln. */
  const gesehen = new Map<string, number>();

  inhalt.zeilen.forEach((zeile, i) => {
    // +2: eins fuer die Kopfzeile, eins fuer die Eins-Basierung.
    const nummer = i + 2;
    const eigene: Beanstandung[] = [];

    if (zeile.length !== inhalt.spalten.length) {
      eigene.push({
        zeile: nummer,
        art: "spalten-zahl",
        text: `${String(zeile.length)} Felder statt ${String(inhalt.spalten.length)}`,
      });
    }

    const werte = werteZeile(zeile, zuordnung);

    if (werte.vorname === undefined || werte.nachname === undefined) {
      eigene.push({ zeile: nummer, art: "pflicht-fehlt", text: "Vorname oder Nachname fehlt" });
    }
    if (werte.email !== undefined && !EMAIL.test(werte.email)) {
      eigene.push({ zeile: nummer, art: "email-ungueltig", text: werte.email });
    }
    if (werte.guid !== undefined) {
      if (!GUID_MUSTER.test(werte.guid)) {
        eigene.push({
          zeile: nummer,
          art: "pflicht-fehlt",
          text: `GUID "${werte.guid}" passt nicht auf das erlaubte Muster`,
        });
      }
      const vorher = gesehen.get(werte.guid);
      if (vorher !== undefined) {
        eigene.push({
          zeile: nummer,
          art: "guid-doppelt",
          text: `${werte.guid} steht schon in Zeile ${String(vorher)}`,
        });
      } else {
        gesehen.set(werte.guid, nummer);
      }
    }

    const bekannt =
      werte.guid !== undefined &&
      db.select({ g: besucher.guid }).from(besucher).where(eq(besucher.guid, werte.guid)).get() !==
        undefined;

    befunde.push({ zeile: nummer, werte, beanstandungen: eigene, bekannt });
  });

  return befunde;
}

/** Die zu verwendende Spaltenzuordnung: die gewaehlte, sonst der Vorschlag. */
function waehleZuordnung(inhalt: CsvInhalt, gewaehlt?: (Zielfeld | null)[]): (Zielfeld | null)[] {
  return gewaehlt !== undefined && gewaehlt.length === inhalt.spalten.length
    ? gewaehlt
    : schlageZuordnungVor(inhalt.spalten);
}

/**
 * Prueft den Inhalt, ohne etwas zu aendern.
 *
 * @param gewaehlteZuordnung Vom Nutzer bestaetigte oder geaenderte Spaltenzuordnung. Fehlt
 * sie, wird vorgeschlagen.
 */
export function pruefeImport(
  db: Db,
  inhalt: CsvInhalt,
  gewaehlteZuordnung?: (Zielfeld | null)[],
): Pruefergebnis {
  const zuordnung = waehleZuordnung(inhalt, gewaehlteZuordnung);
  const befunde = befundeJeZeile(db, inhalt, zuordnung);
  const sauber = befunde.filter((b) => b.beanstandungen.length === 0);

  return {
    zeichensatz: inhalt.zeichensatz,
    trennzeichen: inhalt.trennzeichen,
    spalten: inhalt.spalten,
    zuordnung,
    zeilenGesamt: inhalt.zeilen.length,
    uebernehmbar: sauber.length,
    uebersprungen: befunde.length - sauber.length,
    neu: sauber.filter((b) => !b.bekannt).length,
    aktualisiert: sauber.filter((b) => b.bekannt).length,
    beanstandungen: befunde.flatMap((b) => b.beanstandungen),
    // Beanstandete zuerst, wie im Entwurf: sie sind das, was der Nutzer sehen muss.
    vorschau: [...befunde]
      .sort((a, b) => b.beanstandungen.length - a.beanstandungen.length || a.zeile - b.zeile)
      .slice(0, 25),
  };
}

export type Modus = "ergaenzen" | "ersetzen";

export interface Uebernahmeergebnis {
  neu: number;
  aktualisiert: number;
  uebersprungen: number;
  /** Nur bei `ersetzen`: entfernte Besucher samt ihren Zuordnungen. */
  entfernt: number;
  /** Die uebersprungenen Zeilen als CSV, zum Herunterladen. */
  uebersprungeneCsv: string;
}

/**
 * Uebernimmt die sauberen Zeilen.
 *
 * Alles in **einer** Transaktion: ein halb eingespielter Bestand waere schlimmer als gar
 * keiner, weil niemand sieht, wo abgebrochen wurde.
 */
export function uebernehmeImport(
  db: Db,
  inhalt: CsvInhalt,
  zuordnung: (Zielfeld | null)[],
  modus: Modus,
): Uebernahmeergebnis {
  // Dieselbe Pruefung wie in der Vorschau, damit beide zum selben Urteil kommen.
  const befunde = befundeJeZeile(db, inhalt, zuordnung);
  const gut = befunde.filter((z) => z.beanstandungen.length === 0);
  const schlecht = befunde.filter((z) => z.beanstandungen.length > 0);

  let neu = 0;
  let aktualisiert = 0;
  let entfernt = 0;

  db.transaction((tx) => {
    const behalten: string[] = [];
    const jetzt = Date.now();
    // Einmal vor der Schleife: bei 700 Zeilen waere eine Abfrage je Zeile reine Last.
    const standard = avatarFuer(db, null);

    for (const z of gut) {
      const guid = z.werte.guid ?? randomUUID();
      behalten.push(guid);

      const vorhanden = tx
        .select({ g: besucher.guid })
        .from(besucher)
        .where(eq(besucher.guid, guid))
        .get();

      const felder = {
        vorname: z.werte.vorname ?? "",
        nachname: z.werte.nachname ?? "",
        firma: z.werte.firma ?? null,
        position: z.werte.position ?? null,
        email: z.werte.email ?? null,
        strasse: z.werte.strasse ?? null,
        plz: z.werte.plz ?? null,
        ort: z.werte.ort ?? null,
        land: z.werte.land ?? null,
        website: z.werte.website ?? null,
        geaendert: jetzt,
      };

      if (vorhanden === undefined) {
        /*
         * **Neu angelegte bekommen den Standard-Avatar**, seit dem 08.10.2026, genau wie
         * beim Anlegen von Hand. Die CSV bringt weiterhin keine Bilder mit; gesetzt wird
         * nur der eine Standard, und auch der nur, wenn es ihn gibt.
         *
         * Im Zweig darunter steht `avatarDateiId` weiterhin **nicht** in `felder`: beim
         * Aktualisieren wuerde es ein vorhandenes Bild ueberschreiben.
         */
        tx.insert(besucher)
          .values({ guid, ...felder, avatarDateiId: standard, angelegt: jetzt })
          .run();
        neu++;
      } else {
        tx.update(besucher).set(felder).where(eq(besucher.guid, guid)).run();
        aktualisiert++;
      }
    }

    if (modus === "ersetzen") {
      /*
       * Die nicht enthaltenen Besucher samt ihren Zuordnungen. `on delete cascade` wuerde
       * die Zuordnungen mitnehmen; sie werden trotzdem ausdruecklich geloescht, damit das
       * nicht an einem PRAGMA haengt.
       */
      const weg =
        behalten.length === 0
          ? tx.select({ g: besucher.guid }).from(besucher).all()
          : tx
              .select({ g: besucher.guid })
              .from(besucher)
              .where(notInArray(besucher.guid, behalten))
              .all();
      const guids = weg.map((w) => w.g);
      if (guids.length > 0) {
        tx.delete(zuordnungen).where(inArray(zuordnungen.besucherGuid, guids)).run();
        tx.delete(besucher).where(inArray(besucher.guid, guids)).run();
      }
      entfernt = guids.length;
    }
  });

  return {
    neu,
    aktualisiert,
    uebersprungen: schlecht.length,
    entfernt,
    uebersprungeneCsv: alsCsv(inhalt, schlecht),
  };
}

/**
 * Die uebersprungenen Zeilen als CSV, mit einer zusaetzlichen Spalte fuer den Grund.
 *
 * Damit laesst sich die Datei korrigieren und erneut einspielen, ohne dass jemand die
 * Beanstandungen von Hand abschreibt.
 */
function alsCsv(inhalt: CsvInhalt, zeilen: Zeilenbefund[]): string {
  const zelle = (wert: string) => `"${wert.replace(/"/g, '""')}"`;
  const kopf = [...inhalt.spalten, "Beanstandung"].map(zelle).join(inhalt.trennzeichen);
  const koerper = zeilen.map((z) => {
    const roh = inhalt.zeilen[z.zeile - 2] ?? [];
    const gruende = z.beanstandungen.map((b) => b.text).join(" | ");
    return [...inhalt.spalten.map((_, i) => roh[i] ?? ""), gruende]
      .map(zelle)
      .join(inhalt.trennzeichen);
  });
  // Mit BOM, sonst zeigt Excel Umlaute als Ersatzzeichen.
  return "﻿" + [kopf, ...koerper].join("\r\n") + "\r\n";
}

export function leseZuordnung(wert: unknown, spaltenZahl: number): (Zielfeld | null)[] {
  if (!Array.isArray(wert) || wert.length !== spaltenZahl) {
    throw badRequest(
      "zuordnung-ungueltig",
      `Field zuordnung must be an array with ${String(spaltenZahl)} entries.`,
    );
  }
  return wert.map((e) => {
    if (e === null || e === "") return null;
    if (typeof e !== "string" || !(ZIELFELDER as readonly string[]).includes(e)) {
      throw badRequest("zuordnung-ungueltig", `Unknown target field "${String(e)}".`);
    }
    return e as Zielfeld;
  });
}

export { leseCsv };
