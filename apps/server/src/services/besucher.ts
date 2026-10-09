import { randomUUID } from "node:crypto";
import { and, asc, eq, like, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { besucher, zuordnungen } from "../db/schema.js";
import type { Dateiablage } from "../ablage/dateien.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { findeDatei, leseInhalt } from "./dateien.js";
import { avatarFuer } from "./standardavatar.js";

/**
 * Besucher der Konferenz. Sie melden sich nie an, es gibt keine Selbstregistrierung.
 *
 * Die GUID ist der Primaerschluessel und zugleich die `itemId` fuer Axon. Sie steht im
 * QR-Code des Passes und in der Adresse des Viewers.
 */

/**
 * Erlaubt sind `A-Z a-z 0-9 - _`, 1 bis 50 Zeichen.
 *
 * Das ist **strenger als die Spec**, die bis zu 2048 Zeichen aus dem XML-Vorrat zulaesst,
 * und lehnt trotzdem niemanden ab, den Axon annaehme: der Guide empfiehlt selbst
 * hoechstens 50. Wer strenger prueft als die Gegenseite, erzeugt keine Faelle, die dort
 * scheitern.
 */
const GUID_MUSTER = /^[A-Za-z0-9_-]{1,50}$/;

export function pruefeGuid(guid: string): string {
  const sauber = guid.trim();
  if (!GUID_MUSTER.test(sauber)) {
    throw badRequest(
      "guid-ungueltig",
      "GUID must be 1 to 50 chars of A-Z, a-z, 0-9, hyphen or underscore.",
    );
  }
  return sauber;
}

export const TEXTFELDER = [
  "titel",
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

type Textfeld = (typeof TEXTFELDER)[number];

export interface BesucherEingabe {
  guid?: string;
  titel?: string | null;
  vorname: string;
  nachname: string;
  firma?: string | null;
  position?: string | null;
  email?: string | null;
  strasse?: string | null;
  plz?: string | null;
  ort?: string | null;
  land?: string | null;
  website?: string | null;
  avatarDateiId?: string | null;
}

export function findeBesucher(db: Db, guid: string) {
  const reihe = db.select().from(besucher).where(eq(besucher.guid, guid)).get();
  if (reihe === undefined) throw notFound("besucher-unbekannt", "Unknown visitor.");
  return reihe;
}

/**
 * Legt einen Besucher an.
 *
 * Ohne GUID wird eine UUID v4 erzeugt. Sie ist 36 Zeichen lang und passt damit in das
 * Muster und in die Empfehlung des Guides.
 */
export function legeBesucherAn(db: Db, eingabe: BesucherEingabe) {
  const guid =
    eingabe.guid === undefined || eingabe.guid.trim() === ""
      ? randomUUID()
      : pruefeGuid(eingabe.guid);

  if (db.select({ guid: besucher.guid }).from(besucher).where(eq(besucher.guid, guid)).get()) {
    throw conflict("guid-vergeben", "A visitor with this GUID already exists.");
  }
  if (eingabe.vorname.trim() === "" || eingabe.nachname.trim() === "") {
    throw badRequest("feld-fehlt", "Fields vorname and nachname are required.");
  }

  const jetzt = Date.now();
  const reihe = {
    guid,
    ...leseTextfelder(eingabe),
    /*
     * **Jeder neue Besucher traegt den Standard-Avatar**, auch der aus dem CSV-Import: der
     * laeuft durch dieselbe Funktion. `avatarFuer` liefert ihn nur, wenn die Zeile wirklich
     * existiert; ein fester Wert wuerde den Fremdschluessel verletzen, sobald das Bild im
     * Repo fehlt, und das Anlegen scheitern lassen. Eine mitgegebene Id gewinnt.
     */
    avatarDateiId: avatarFuer(db, eingabe.avatarDateiId ?? null),
    angelegt: jetzt,
    geaendert: jetzt,
  };
  db.insert(besucher).values(reihe).run();
  return reihe;
}

export function aendereBesucher(db: Db, guid: string, eingabe: Partial<BesucherEingabe>) {
  findeBesucher(db, guid);
  const aenderung: Record<string, unknown> = { geaendert: Date.now() };
  for (const feld of TEXTFELDER) {
    if (feld in eingabe) {
      const wert = eingabe[feld];
      aenderung[feld] = wert === null || wert === undefined ? null : String(wert).trim();
    }
  }
  if ("avatarDateiId" in eingabe) aenderung["avatarDateiId"] = eingabe.avatarDateiId ?? null;
  db.update(besucher).set(aenderung).where(eq(besucher.guid, guid)).run();
  return findeBesucher(db, guid);
}

/**
 * Loescht einen Besucher samt seiner Zuordnungen.
 *
 * Die Zuordnungen gehen ueber `on delete cascade` mit. Die hochgeladenen Dateien bleiben:
 * sie koennen an einem Exponat haengen und gehoeren dann nicht diesem Besucher.
 */
export function loescheBesucher(db: Db, guid: string): void {
  findeBesucher(db, guid);
  db.delete(besucher).where(eq(besucher.guid, guid)).run();
}

export interface Seite {
  /** Eins-basiert, wie in der Oberflaeche. */
  nummer: number;
  groesse: number;
}

/**
 * Liste mit Suche und Seitenumschaltung.
 *
 * Gesucht wird ueber Vorname, Nachname, Firma, E-Mail und GUID. Die Gesamtzahl wird mit
 * **demselben** Filter gezaehlt wie die Seite selbst: zwei Abfragen, von denen nur eine
 * den Filter kennt, ergeben eine Seitenumschaltung, die nicht aufgeht, und kein Test
 * schlaegt darauf an.
 */
export function listeBesucher(db: Db, suche: string, seite: Seite) {
  const begriff = suche.trim();
  const bedingung =
    begriff === ""
      ? undefined
      : or(
          like(besucher.vorname, `%${begriff}%`),
          like(besucher.nachname, `%${begriff}%`),
          like(besucher.firma, `%${begriff}%`),
          like(besucher.email, `%${begriff}%`),
          like(besucher.guid, `%${begriff}%`),
        );

  const gesamt = db
    .select({ anzahl: sql<number>`count(*)` })
    .from(besucher)
    .where(bedingung)
    .get();

  const eintraege = db
    .select()
    .from(besucher)
    .where(bedingung)
    .orderBy(asc(besucher.nachname), asc(besucher.vorname))
    .limit(seite.groesse)
    .offset((seite.nummer - 1) * seite.groesse)
    .all();

  return { eintraege, gesamt: gesamt?.anzahl ?? 0, seite };
}

/** Die Zuordnungen eines Besuchers, nach Exponat gruppiert. Fuer die Detailansicht. */
export function zuordnungenVonBesucher(db: Db, guid: string) {
  return db
    .select()
    .from(zuordnungen)
    .where(eq(zuordnungen.besucherGuid, guid))
    .orderBy(asc(zuordnungen.zeitpunkt))
    .all();
}

export function zaehleZuordnungen(db: Db, guid: string, exponatId: string): number {
  return db
    .select({ id: zuordnungen.id })
    .from(zuordnungen)
    .where(and(eq(zuordnungen.besucherGuid, guid), eq(zuordnungen.exponatId, exponatId)))
    .all().length;
}

/**
 * Die zehn Textfelder, getrimmt. Leeres wird `null`, nicht `""`.
 *
 * Vor- und Nachname sind in der Tabelle `not null` und tragen das auch im Typ: `sammleWerte`
 * laesst leere Felder aus, und ein Besucher ohne Namen waere im Viewer eine leere Karte.
 * Die Pflicht wird in `legeBesucherAn` geprueft, bevor diese Funktion laeuft.
 */
type Optionale = Exclude<Textfeld, "vorname" | "nachname">;

function leseTextfelder(
  eingabe: Partial<BesucherEingabe>,
): Record<Optionale, string | null> & { vorname: string; nachname: string } {
  const optional = {} as Record<Optionale, string | null>;
  for (const feld of TEXTFELDER) {
    if (feld === "vorname" || feld === "nachname") continue;
    const wert = eingabe[feld];
    optional[feld] =
      wert === null || wert === undefined || String(wert).trim() === ""
        ? null
        : String(wert).trim();
  }
  return {
    ...optional,
    vorname: (eingabe.vorname ?? "").trim(),
    nachname: (eingabe.nachname ?? "").trim(),
  };
}

/** Das Bild, wie es die Carrera-Bahn bekommt: eingebettet, nicht als Adresse. */
export interface Fahrerbild {
  mimeType: string;
  size: number;
  base64: string;
}

export interface Fahrerdaten {
  guid: string;
  titel: string | null;
  vorname: string;
  nachname: string;
  bild: Fahrerbild | null;
}

/**
 * Name und Bild eines Besuchers, fuer den Bildschirm an der Carrera-Bahn.
 *
 * **Das Bild geht eingebettet hinaus, nicht als Adresse.** `/api/dateien/:id` haengt an
 * `verlangeAnmeldung`, und die Software der Bahn hat keine Sitzung. Ein Avatar ist ein JPEG
 * von rund 45 KB, als Base64 etwa 61 KB; das faellt einmal je gescanntem Besucher an und
 * nicht je Runde.
 *
 * Wirft `notFound`, wenn die GUID unbekannt ist. **`bild` ist `null`**, wenn die Datei nicht
 * lesbar ist: ein fehlendes Foto darf nicht dazu fuehren, dass auch der Name nicht ankommt.
 */
export async function fahrerdaten(db: Db, ablage: Dateiablage, guid: string): Promise<Fahrerdaten> {
  const person = findeBesucher(db, guid);

  /*
   * Ueber `avatarFuer`, nicht ueber `person.avatarDateiId`: der Rueckfall auf das
   * Standardbild liegt dort, und eine zweite Stelle, die ihn kennt, laeuft frueher oder
   * spaeter auseinander.
   */
  const dateiId = avatarFuer(db, person.avatarDateiId);

  return {
    guid: person.guid,
    titel: person.titel,
    vorname: person.vorname,
    nachname: person.nachname,
    bild: dateiId === null ? null : await lies(db, ablage, dateiId),
  };
}

async function lies(db: Db, ablage: Dateiablage, dateiId: string): Promise<Fahrerbild | null> {
  const datei = findeDatei(db, dateiId);
  const inhalt = await leseInhalt(ablage, datei.pfad);
  if (inhalt === null) return null;
  /*
   * **Die Groesse kommt aus dem Gelesenen, nicht aus der Tabelle.** Beides sollte gleich
   * sein; weicht es ab, ist die Zahl in der Antwort die, zu der das Base64 wirklich passt.
   * Eine Gegenseite, die danach puffert, bekaeme sonst eine Groesse, die nicht stimmt.
   */
  return { mimeType: datei.mimeType, size: inhalt.length, base64: inhalt.toString("base64") };
}
