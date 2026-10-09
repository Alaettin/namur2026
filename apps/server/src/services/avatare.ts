import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Dateiablage } from "../ablage/dateien.js";
import type { Db } from "../db/client.js";
import { avatare, dateien, einstellungen } from "../db/schema.js";
import { PROJEKT_WURZEL } from "../env.js";
import { badRequest, notFound } from "../errors.js";
import { mimeAusName } from "./mime.js";

/**
 * Die Avatare, die am Selbstbedienungs-Tablet zur Auswahl stehen.
 *
 * **Zeilen in der Datenbank, nicht Dateien im Repo.** Bis zum 09.10.2026 war die Galerie
 * eine feste Liste von 20 Ids, und der Start legte jedes fehlende Bild neu an. Seit ein
 * Admin sie verwalten darf, waere genau das falsch: ein geloeschter Avatar kaeme beim
 * naechsten Neustart zurueck. Die Bilder aus dem Repo sind nur noch die **Erstbefuellung**,
 * und die laeuft genau einmal.
 */

/** Wie viele Bilder in `apps/server/assets/avatare/` liegen. */
const ERSTBESTAND = 20;

/** Der Ordner mit den mitgelieferten Bildern, am selben Anker wie der Standard-Avatar. */
const ORDNER = resolve(PROJEKT_WURZEL, "apps/server/assets/avatare");

/**
 * Merkt, dass die Erstbefuellung gelaufen ist.
 *
 * **Der Kern der Umstellung.** Ohne diesen Schluessel waere "geloescht" nur bis zum
 * naechsten Neustart wahr, und das faellt niemandem auf, bis am Stand ein entferntes Bild
 * wieder in der Auswahl steht.
 */
export const SCHLUESSEL_ERSTBEFUELLUNG = "avatare.erstbefuellung";

/** Was ein Avatar hochgeladen sein darf. Siehe `HOECHSTGROESSE`. */
const ERLAUBTE_TYPEN = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * **300 KB**, deutlich unter der allgemeinen Uploadgrenze von 50 MB.
 *
 * Ein Avatar geht als Base64 in **jede** `values`-Antwort der Konnektor-API. Ohne eigene
 * Grenze koennte ein einziges Bild jede Besucherabfrage aufblaehen. Die Oberflaeche
 * verkleinert vorher auf 512 px, was rund 40 KB ergibt; diese Grenze ist der Rueckhalt
 * fuer den Fall, dass jemand an der Oberflaeche vorbei hochlaedt.
 */
export const HOECHSTGROESSE = 300 * 1024;

/**
 * Legt die mitgelieferten Bilder an, **einmalig**.
 *
 * Ist der Schluessel gesetzt, geschieht nichts, auch wenn die Galerie leer ist: dann hat
 * jemand alle geloescht, und das ist eine Entscheidung und kein Fehler.
 *
 * Eine fehlende Bilddatei bricht den Start **nicht** ab. Ein Dienst, der wegen eines
 * Schmuckbildes nicht hochkommt, nimmt der Konferenz den Scan weg.
 */
export async function befuelleGalerieEinmalig(
  db: Db,
  ablage: Dateiablage,
  warne: (text: string) => void,
): Promise<void> {
  const schon = db
    .select({ wert: einstellungen.wert })
    .from(einstellungen)
    .where(eq(einstellungen.schluessel, SCHLUESSEL_ERSTBEFUELLUNG))
    .get();
  if (schon !== undefined) return;

  for (let nummer = 1; nummer <= ERSTBESTAND; nummer++) {
    const name = `avatar-${String(nummer).padStart(2, "0")}.jpg`;
    let inhalt: Buffer;
    try {
      inhalt = await readFile(resolve(ORDNER, name));
    } catch {
      warne(`Avatarbild fehlt: ${name}. Es steht am Tablet nicht zur Auswahl.`);
      continue;
    }
    const { pfad, sha256, groesse } = await ablage.lege(inhalt);
    const id = randomUUID();
    db.insert(dateien)
      .values({
        id,
        pfad,
        mimeType: "image/jpeg",
        groesse,
        originalName: name,
        sha256,
        angelegt: Date.now(),
      })
      .run();
    db.insert(avatare).values({ dateiId: id, sortierung: nummer }).run();
  }

  db.insert(einstellungen)
    .values({ schluessel: SCHLUESSEL_ERSTBEFUELLUNG, wert: "1" })
    .onConflictDoUpdate({ target: einstellungen.schluessel, set: { wert: "1" } })
    .run();
}

export interface Avatarzeile {
  dateiId: string;
  sortierung: number;
}

/** Die Galerie in Anzeigereihenfolge. */
export function leseGalerie(db: Db): Avatarzeile[] {
  return db
    .select({ dateiId: avatare.dateiId, sortierung: avatare.sortierung })
    .from(avatare)
    .orderBy(asc(avatare.sortierung))
    .all();
}

/** Nur die Ids, fuer die Pruefung am Tablet. */
export function galerieIds(db: Db): string[] {
  return leseGalerie(db).map((a) => a.dateiId);
}

/**
 * Nimmt ein Bild in die Galerie auf. Haengt hinten an.
 *
 * Prueft Typ und Groesse **hier**, nicht in der Route: wer die Funktion spaeter von einer
 * zweiten Stelle ruft, soll dieselben Grenzen bekommen.
 */
export async function legeAvatarAn(
  db: Db,
  ablage: Dateiablage,
  inhalt: Buffer,
  originalName: string,
): Promise<Avatarzeile> {
  /*
   * **Der Typ kommt aus der Endung, nicht aus dem Kopf.** So macht es die vorhandene
   * Dateiroute auch, und dort haengt ein eigener Test daran: ein Kopf laesst sich frei
   * setzen, eine Endung steht im Dateinamen, den der Nutzer sieht.
   */
  const mimeType = mimeAusName(originalName);
  if (!ERLAUBTE_TYPEN.has(mimeType)) {
    throw badRequest(
      "typ-ungeeignet",
      `Only ${[...ERLAUBTE_TYPEN].join(", ")} are allowed for avatars.`,
    );
  }
  if (inhalt.byteLength > HOECHSTGROESSE) {
    throw badRequest(
      "datei-zu-gross",
      `An avatar must not exceed ${String(Math.round(HOECHSTGROESSE / 1024))} KB.`,
    );
  }

  const { pfad, sha256, groesse } = await ablage.lege(inhalt);
  const id = randomUUID();
  db.insert(dateien)
    .values({ id, pfad, mimeType, groesse, originalName, sha256, angelegt: Date.now() })
    .run();

  const hoechste =
    db
      .select({ n: sql<number>`coalesce(max(${avatare.sortierung}), 0)` })
      .from(avatare)
      .get()?.n ?? 0;
  const zeile = { dateiId: id, sortierung: hoechste + 1 };
  db.insert(avatare).values(zeile).run();
  return zeile;
}

/**
 * Nimmt ein Bild aus der Galerie und loescht es.
 *
 * Besucher, die es tragen, fallen ueber `on delete set null` auf den Standard zurueck. Die
 * Datei verlaesst auch die Ablage; ein Bild, das niemand mehr waehlen kann, waere sonst
 * eine Waise auf der Platte.
 */
export async function loescheAvatar(db: Db, ablage: Dateiablage, dateiId: string): Promise<void> {
  const zeile = db.select().from(avatare).where(eq(avatare.dateiId, dateiId)).get();
  if (zeile === undefined) throw notFound("avatar-unbekannt", "Unknown avatar.");

  const datei = db
    .select({ pfad: dateien.pfad })
    .from(dateien)
    .where(eq(dateien.id, dateiId))
    .get();

  // Erst die Zeile, dann die Platte: ein Fehler beim Loeschen laesst eine Waise liegen,
  // keine Luecke in der Oberflaeche.
  db.delete(dateien).where(eq(dateien.id, dateiId)).run();
  neuNummerieren(db);
  if (datei !== undefined) await ablage.loesche(datei.pfad);
}

/**
 * Setzt die Reihenfolge neu.
 *
 * Erwartet **alle** Ids der Galerie. Eine unvollstaendige Liste waere nicht entscheidbar:
 * wohin gehoerte, was fehlt? Danach wird durchnummeriert, nicht verschoben, damit keine
 * Luecken und keine doppelten Nummern entstehen.
 */
export function setzeReihenfolge(db: Db, ids: string[]): Avatarzeile[] {
  const vorhanden = galerieIds(db);
  const eindeutig = new Set(ids);
  if (ids.length !== eindeutig.size) {
    throw badRequest("reihenfolge-doppelt", "Field ids must not contain duplicates.");
  }
  if (ids.length !== vorhanden.length || !vorhanden.every((id) => eindeutig.has(id))) {
    throw badRequest(
      "reihenfolge-unvollstaendig",
      "Field ids must contain exactly all avatars of the gallery.",
    );
  }

  db.transaction((tx) => {
    ids.forEach((id, i) => {
      tx.update(avatare)
        .set({ sortierung: i + 1 })
        .where(eq(avatare.dateiId, id))
        .run();
    });
  });
  return leseGalerie(db);
}

/** Vergibt 1..n neu, nach der bestehenden Folge. Nach dem Loeschen noetig. */
function neuNummerieren(db: Db): void {
  const ids = galerieIds(db);
  db.transaction((tx) => {
    ids.forEach((id, i) => {
      tx.update(avatare)
        .set({ sortierung: i + 1 })
        .where(eq(avatare.dateiId, id))
        .run();
    });
  });
}

/** Fuer das Zuruecksetzen: die Galerie leeren, damit die Erstbefuellung wieder greift. */
export function vergissErstbefuellung(db: Db): void {
  db.delete(einstellungen)
    .where(inArray(einstellungen.schluessel, [SCHLUESSEL_ERSTBEFUELLUNG]))
    .run();
}
