import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { Dateiablage } from "../ablage/dateien.js";
import { avatare, besucher, dateien, exponatDokumente, globaleDaten } from "../db/schema.js";
import { badRequest, kontingentErschoepft, notFound } from "../errors.js";
import { globalId } from "../modell/felder.js";
import { findeDatei, loescheDatei } from "./dateien.js";
import { STANDARD_AVATAR_ID } from "./standardavatar.js";

/**
 * Globale Daten: Datenpunkte, die der Konnektor jedem Besucher gleich ausliefert.
 *
 * Seit dem 20.10.2026. Die propertyId vergibt der Server (`Global01`, ...), siehe
 * `globaleDaten` im Schema zur Frage, warum Nummern nicht wiederverwendet werden.
 */

/** Zweistellig in der propertyId, also hoechstens 99. */
export const MAX_GLOBALE_DATEN = 99;

export type Art = "text" | "datei";

/** Mit Name und Typ der Datei, damit die Oberflaeche ein Bild zeigen kann. */
export function listeGlobaleDaten(db: Db) {
  return db
    .select({
      id: globaleDaten.id,
      nummer: globaleDaten.nummer,
      name: globaleDaten.name,
      art: globaleDaten.art,
      text: globaleDaten.text,
      dateiId: globaleDaten.dateiId,
      dateiname: dateien.originalName,
      mimeType: dateien.mimeType,
    })
    .from(globaleDaten)
    .leftJoin(dateien, eq(dateien.id, globaleDaten.dateiId))
    .orderBy(asc(globaleDaten.nummer))
    .all()
    .map((g) => ({ ...g, propertyId: globalId(g.nummer) }));
}

function finde(db: Db, id: string) {
  const g = db.select().from(globaleDaten).where(eq(globaleDaten.id, id)).get();
  if (g === undefined) throw notFound("global-unbekannt", "Unknown global data point.");
  return g;
}

function pruefeName(name: unknown): string {
  if (typeof name !== "string" || name.trim() === "") {
    throw badRequest("feld-fehlt", "Field name is required.");
  }
  return name.trim();
}

export function legeGlobalAn(db: Db, eingabe: { name?: unknown; art?: unknown }) {
  const name = pruefeName(eingabe.name);
  const art = eingabe.art;
  if (art !== "text" && art !== "datei") {
    throw badRequest("art-ungueltig", 'Field art must be "text" or "datei".');
  }

  // **Hoechste je vergebene Nummer plus eins**, nicht die kleinste freie; siehe unten.
  const nummer = naechsteNummer(db);
  if (nummer > MAX_GLOBALE_DATEN) {
    throw kontingentErschoepft(
      `All ${String(MAX_GLOBALE_DATEN)} global data point numbers have been used.`,
      { obergrenze: MAX_GLOBALE_DATEN, was: "global" },
    );
  }

  const reihe = { id: randomUUID(), nummer, name, art: art as Art, text: null, dateiId: null };
  db.insert(globaleDaten).values(reihe).run();
  return { ...finde(db, reihe.id), propertyId: globalId(nummer) };
}

const ZAEHLER = "globale-daten.letzteNummer";

/**
 * Die naechste Nummer, **nie eine schon einmal vergebene**.
 *
 * Das Maximum der Tabelle allein reicht nicht: wird `Global05` geloescht, waere es danach 4,
 * und der naechste bekaeme wieder 5. Deshalb merkt sich `einstellungen` die zuletzt vergebene
 * Nummer. Beides zusammen haelt auch, wenn der Zaehler fehlt, etwa nach dem Einspielen einer
 * Sicherung aus der Zeit davor. Laeuft in derselben Verbindung ohne `await` dazwischen, also
 * ohne Wettlauf zweier Anlagen.
 */
function naechsteNummer(db: Db): number {
  const hoechste =
    db
      .select({ n: sql<number | null>`max(${globaleDaten.nummer})` })
      .from(globaleDaten)
      .get()?.n ?? 0;
  const zeile = db.all<{ wert: string }>(
    sql`select wert from einstellungen where schluessel = ${ZAEHLER}`,
  )[0];
  const gemerkt = zeile === undefined ? 0 : Number(zeile.wert) || 0;
  const nummer = Math.max(hoechste, gemerkt) + 1;
  db.run(
    sql`insert into einstellungen (schluessel, wert) values (${ZAEHLER}, ${String(nummer)})
        on conflict (schluessel) do update set wert = excluded.wert`,
  );
  return nummer;
}

/**
 * Aendert Name und Inhalt. Text nur bei `art: text`, Datei nur bei `art: datei`.
 *
 * Eine ersetzte Datei wird geloescht, wenn sie sonst nirgends haengt.
 */
export async function aendereGlobal(
  db: Db,
  ablage: Dateiablage,
  id: string,
  eingabe: { name?: unknown; text?: unknown; dateiId?: unknown },
) {
  const g = finde(db, id);
  const aenderung: Partial<typeof globaleDaten.$inferInsert> = {};

  if ("name" in eingabe) aenderung.name = pruefeName(eingabe.name);

  if ("text" in eingabe) {
    if (g.art !== "text") throw badRequest("art-passt-nicht", "This data point holds a file.");
    const t = eingabe.text;
    if (t !== null && typeof t !== "string") {
      throw badRequest("feld-ungueltig", "Field text must be a string or null.");
    }
    aenderung.text = t === null || t.trim() === "" ? null : t;
  }

  let alteDatei: string | null = null;
  if ("dateiId" in eingabe) {
    if (g.art !== "datei") throw badRequest("art-passt-nicht", "This data point holds text.");
    const d = eingabe.dateiId;
    if (d !== null && typeof d !== "string") {
      throw badRequest("feld-ungueltig", "Field dateiId must be a string or null.");
    }
    if (d !== null) findeDatei(db, d);
    aenderung.dateiId = d;
    if (g.dateiId !== null && g.dateiId !== d) alteDatei = g.dateiId;
  }

  if (Object.keys(aenderung).length > 0) {
    db.update(globaleDaten).set(aenderung).where(eq(globaleDaten.id, id)).run();
  }
  if (alteDatei !== null) await raeumeDateiAuf(db, ablage, alteDatei);
  return { ...finde(db, id), propertyId: globalId(g.nummer) };
}

/** Loescht den Datenpunkt und seine Datei, wenn sie sonst nirgends haengt. DB zuerst. */
export async function loescheGlobal(db: Db, ablage: Dateiablage, id: string): Promise<void> {
  const g = finde(db, id);
  db.delete(globaleDaten).where(eq(globaleDaten.id, id)).run();
  if (g.dateiId !== null) await raeumeDateiAuf(db, ablage, g.dateiId);
}

/**
 * Loescht eine Datei nur, wenn sie **nirgends sonst** haengt.
 *
 * Die Datei-Id kommt per PATCH von aussen; sie kann auch ein Exponat-Dokument oder ein
 * Galeriebild sein. Ein blindes Loeschen naehme es dort mit.
 */
async function raeumeDateiAuf(db: Db, ablage: Dateiablage, dateiId: string): Promise<void> {
  if (dateiId === STANDARD_AVATAR_ID) return;
  const genutzt =
    db
      .select({ id: exponatDokumente.id })
      .from(exponatDokumente)
      .where(eq(exponatDokumente.dateiId, dateiId))
      .get() !== undefined ||
    db.select({ id: avatare.dateiId }).from(avatare).where(eq(avatare.dateiId, dateiId)).get() !==
      undefined ||
    db
      .select({ g: besucher.guid })
      .from(besucher)
      .where(eq(besucher.avatarDateiId, dateiId))
      .get() !== undefined ||
    db
      .select({ id: globaleDaten.id })
      .from(globaleDaten)
      .where(eq(globaleDaten.dateiId, dateiId))
      .get() !== undefined;
  if (!genutzt) await loescheDatei(db, ablage, dateiId);
}
