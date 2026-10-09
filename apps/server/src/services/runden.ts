import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { besucher, runden } from "../db/schema.js";
import { badRequest, kontingentErschoepft, notFound } from "../errors.js";

/**
 * Rundenzeiten von der Carrera-Bahn.
 *
 * Die Software der Bahn meldet **nach jeder gefahrenen Runde** einen Datensatz. Die Felder
 * stammen aus der Mail des Entwicklers; das entscheidende ist `participant_id`, laut Mail
 * die "gescannte AAS-Item-ID", also unsere GUID.
 */

/**
 * **20 Runden je Besucher.**
 *
 * Nicht je Rennen: das Konnektor-Modell hat 20 feste Plaetze je Besucher, und einen
 * 21. Platz gaebe es dort nicht. Die Grenze der Datenhaltung und die des Modells sind
 * damit dieselbe Zahl an einer Stelle.
 */
export const MAX_RUNDEN = 20;

/** Der Datensatz, so wie die Bahn ihn schickt. Schlangenschrift, nicht unsere Schreibweise. */
export interface Rundenmeldung {
  lap_id?: unknown;
  race_id?: unknown;
  event_id?: unknown;
  event_name?: unknown;
  identity_namespace?: unknown;
  participant_id?: unknown;
  pseudonym?: unknown;
  is_anonymous?: unknown;
  lane_number?: unknown;
  target_lap_count?: unknown;
  installation_label?: unknown;
  lap_number?: unknown;
  started_utc_ms?: unknown;
  local_date?: unknown;
  local_utc_offset_minutes?: unknown;
  duration_ms?: unknown;
  deleted_utc_ms?: unknown;
  deletion_reason?: unknown;
}

export type Aufnahmegrund = "gespeichert" | "anonym" | "geloescht";

export interface Aufnahme {
  gespeichert: boolean;
  grund: Aufnahmegrund;
  lapId: string;
  platz: number | null;
}

function text(wert: unknown): string | null {
  return typeof wert === "string" && wert.trim() !== "" ? wert : null;
}

function zahl(wert: unknown): number | null {
  if (typeof wert === "number" && Number.isFinite(wert)) return wert;
  // Seine Software kann Zahlen als Text schicken; eine 3 als "3" ist keine Fehleingabe.
  if (typeof wert === "string" && wert.trim() !== "" && Number.isFinite(Number(wert))) {
    return Number(wert);
  }
  return null;
}

/**
 * Die kleinste freie Platznummer, eins-basiert.
 *
 * **Nicht `max + 1`.** Wird Platz 3 von fuenf geloescht, soll die naechste Runde dort
 * landen statt auf Platz 6: sonst waere die Obergrenze nach zwanzig Loeschvorgaengen
 * erreicht, obwohl keine zwanzig Runden da sind. Dieselbe Ueberlegung wie bei den
 * Dokumenten eines Exponats.
 */
function kleinsterFreierPlatz(belegt: number[]): number {
  const genommen = new Set(belegt);
  for (let p = 1; p <= MAX_RUNDEN; p++) {
    if (!genommen.has(p)) return p;
  }
  throw kontingentErschoepft(`A visitor can have at most ${String(MAX_RUNDEN)} laps.`, {
    obergrenze: MAX_RUNDEN,
  });
}

/**
 * Nimmt eine gemeldete Runde auf.
 *
 * Wirft `notFound`, wenn die GUID unbekannt ist, und `kontingentErschoepft` bei der
 * 21. Runde. Anonyme Runden und solche mit gesetztem `deleted_utc_ms` sind **kein
 * Fehler**: sie sind laut Mail vorgesehen und werden nur nicht gespeichert.
 */
export function nimmRundeAuf(db: Db, meldung: Rundenmeldung): Aufnahme {
  const lapId = text(meldung.lap_id);
  if (lapId === null) throw badRequest("lap-id-fehlt", "Field lap_id is required.");

  const dauer = zahl(meldung.duration_ms);
  if (dauer === null || dauer <= 0) {
    throw badRequest("dauer-fehlt", "Field duration_ms must be a positive number.");
  }

  /*
   * **Eine zurueckgenommene Runde wird geloescht, nicht markiert.** Seine Software
   * loescht weich und schickt den Datensatz trotzdem; wir fuehren das aus.
   */
  if (zahl(meldung.deleted_utc_ms) !== null) {
    db.delete(runden).where(eq(runden.lapId, lapId)).run();
    return { gespeichert: false, grund: "geloescht", lapId, platz: null };
  }

  /*
   * **Anonym ist ein Normalfall, kein Fehler.** Laut Mail traegt `participant_id` dann
   * `null`. Ein 4xx darauf fuellte sein Protokoll mit Fehlern, die keine sind.
   */
  const guid = text(meldung.participant_id);
  if (guid === null) return { gespeichert: false, grund: "anonym", lapId, platz: null };

  /*
   * Eine unbekannte GUID ist dagegen ein Fehler und soll sichtbar sein: sie heisst, dass
   * ein Pass gescannt wurde, den wir nicht kennen, oder dass die Zuordnung klemmt.
   */
  const vorhanden = db
    .select({ guid: besucher.guid })
    .from(besucher)
    .where(eq(besucher.guid, guid))
    .get();
  if (vorhanden === undefined) {
    // **404, nicht 200.** Anonym und unbekannt sind verschiedene Dinge; wer beides gleich
    // beantwortet, merkt ein kaputtes Mapping nicht.
    throw notFound("besucher-unbekannt", `Unknown participant_id "${guid}".`);
  }

  const schon = db.select().from(runden).where(eq(runden.lapId, lapId)).get();
  const werte = {
    besucherGuid: guid,
    raceId: text(meldung.race_id),
    eventId: text(meldung.event_id),
    eventName: text(meldung.event_name),
    identityNamespace: text(meldung.identity_namespace),
    pseudonym: text(meldung.pseudonym),
    installationLabel: text(meldung.installation_label),
    isAnonymous: zahl(meldung.is_anonymous),
    laneNumber: zahl(meldung.lane_number),
    targetLapCount: zahl(meldung.target_lap_count),
    lapNumber: zahl(meldung.lap_number),
    startedUtcMs: zahl(meldung.started_utc_ms),
    localDate: text(meldung.local_date),
    localUtcOffsetMinutes: zahl(meldung.local_utc_offset_minutes),
    durationMs: dauer,
  };

  /*
   * **Dieselbe `lap_id` noch einmal aktualisiert, statt eine zweite Zeile anzulegen.**
   * Ein Wiederholungsversuch nach einem Netzfehler darf nichts verdoppeln, und der Platz
   * bleibt dabei derselbe.
   */
  if (schon !== undefined) {
    db.update(runden).set(werte).where(eq(runden.lapId, lapId)).run();
    return { gespeichert: true, grund: "gespeichert", lapId, platz: schon.platz };
  }

  const belegt = db
    .select({ platz: runden.platz })
    .from(runden)
    .where(eq(runden.besucherGuid, guid))
    .all()
    .map((r) => r.platz);
  const platz = kleinsterFreierPlatz(belegt);

  db.insert(runden)
    .values({ lapId, platz, ...werte })
    .run();
  return { gespeichert: true, grund: "gespeichert", lapId, platz };
}

/** Nimmt eine Runde zurueck. Gibt `false`, wenn es sie gar nicht gab. */
export function loescheRunde(db: Db, lapId: string): boolean {
  const schon = db
    .select({ lapId: runden.lapId })
    .from(runden)
    .where(eq(runden.lapId, lapId))
    .get();
  if (schon === undefined) return false;
  db.delete(runden).where(eq(runden.lapId, lapId)).run();
  return true;
}

/** Die Runden eines Besuchers, nach Platz. */
export function rundenVonBesucher(db: Db, guid: string) {
  return db
    .select()
    .from(runden)
    .where(eq(runden.besucherGuid, guid))
    .orderBy(asc(runden.platz))
    .all();
}

/**
 * Die Rundenzeit, wie sie ein Mensch liest.
 *
 * Sekunden mit drei Nachkommastellen, wie im Motorsport ueblich, und mit **Komma**: die
 * Oberflaeche ist deutsch, und 4.827 lesen manche als viertausend.
 */
export function dauerAlsText(ms: number): string {
  return `${(ms / 1000).toFixed(3).replace(".", ",")} s`;
}

/**
 * Die Zeile, die in den Viewer geht.
 *
 * Aus den Feldern, die seine Mail als anzeigenswert markiert: Rundennummer, Zeit, Spur.
 * Fehlt eines, faellt nur dieses Stueck weg und nicht die ganze Zeile.
 */
export function rundeAlsText(runde: {
  lapNumber: number | null;
  durationMs: number;
  laneNumber: number | null;
}): string {
  const teile = [
    runde.lapNumber === null ? null : `Runde ${String(runde.lapNumber)}`,
    dauerAlsText(runde.durationMs),
    runde.laneNumber === null ? null : `Spur ${String(runde.laneNumber)}`,
  ].filter((t): t is string => t !== null);
  return teile.join(" · ");
}
