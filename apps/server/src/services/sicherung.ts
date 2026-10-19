import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import type { Kontext } from "../kontext.js";
import { oeffneDb } from "../db/client.js";
import { migriere } from "../db/migrate.js";
import { AppError, badRequest, conflict } from "../errors.js";
import { leseBestand, type Bestand } from "./entwickler.js";

/**
 * Sicherung und Wiederherstellung des **gesamten** Bestands, seit dem 19.10.2026.
 *
 * Eine ZIP-Datei mit drei Teilen:
 *
 *   namur.db         konsistente Kopie der Datenbank ueber `sqlite.backup()`
 *   dateien/...      jede Datei, die ein Datensatz nennt, unter ihrem Ablagepfad
 *   sicherung.json   Kennung, Fassung, Zeitpunkt, Migrationsstand, Bestand in Zahlen
 *
 * Eingespielt wird **in die laufende Verbindung** ueber `ATTACH`, nicht durch Austausch der
 * Datei. Unter einem laufenden Prozess die Datei zu ersetzen hiesse, die Verbindung zu
 * schliessen und neu zu oeffnen, waehrend `ctx.db` in jeder Route steckt; und WAL-Dateien
 * neben der alten Datei gehoerten dann zu einer anderen Datenbank.
 */

const KENNUNG = "namur-hv-2026";
const DB_EINTRAG = "namur.db";
const META_EINTRAG = "sicherung.json";
const DATEI_PRAEFIX = "dateien/";

/** Tabellen, die nicht zum Bestand gehoeren, sondern zur Datenbank selbst. */
const NICHT_KOPIEREN = new Set(["__drizzle_migrations"]);

export interface Sicherungsinfo {
  kennung: string;
  fassung: string;
  erstellt: string;
  migrationen: number;
  bestand: Bestand;
  dateien: number;
}

function migrationsstand(sqlite: Database.Database, schema = "main"): number {
  const zeile = sqlite
    .prepare(`select count(*) as n from ${schema}."__drizzle_migrations"`)
    .get() as { n: number } | undefined;
  return zeile?.n ?? 0;
}

/** Ablagepfade mit `/`, egal auf welchem System sie geschrieben wurden. */
function normiere(pfad: string): string {
  return pfad.replaceAll("\\", "/");
}

function zeitstempel(d: Date): string {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
}

// --- Export ------------------------------------------------------------------------------

export async function erstelleSicherung(
  ctx: Kontext,
): Promise<{ dateiname: string; inhalt: Uint8Array }> {
  const tmp = join(tmpdir(), `namur-sicherung-${randomUUID()}.db`);
  try {
    /*
     * **`backup()`, nicht die Datei kopieren.** Im WAL-Betrieb steht der juengste Stand
     * teils noch in `namur.db-wal`; eine Kopie der Hauptdatei allein waere aelter als die
     * Anwendung, und zwar ohne Fehlermeldung.
     */
    await ctx.sqlite.backup(tmp);
    const db = await readFile(tmp);

    const pfade = (ctx.sqlite.prepare("select pfad from dateien").all() as { pfad: string }[]).map(
      (z) => z.pfad,
    );
    const eintraege: Zippable = {};
    let dateien = 0;
    for (const pfad of pfade) {
      const inhalt = await ctx.ablage.liesGanz(pfad);
      // Eine fehlende Datei bricht die Sicherung nicht ab; der Datensatz zeigte schon
      // vorher ins Leere, und die uebrigen Dateien sollen trotzdem gesichert sein.
      if (inhalt === null) continue;
      // Bilder und PDFs sind schon gepackt: Stufe 0 spart Zeit und kostet kaum Platz.
      eintraege[DATEI_PRAEFIX + normiere(pfad)] = [inhalt, { level: 0 }];
      dateien++;
    }

    const info: Sicherungsinfo = {
      kennung: KENNUNG,
      fassung: __APP_VERSION__,
      erstellt: new Date().toISOString(),
      migrationen: migrationsstand(ctx.sqlite),
      bestand: leseBestand(ctx.db),
      dateien,
    };
    eintraege[DB_EINTRAG] = [db, { level: 6 }];
    eintraege[META_EINTRAG] = strToU8(JSON.stringify(info, null, 2));

    return {
      dateiname: `${KENNUNG}-sicherung-${zeitstempel(new Date())}.zip`,
      inhalt: zipSync(eintraege),
    };
  } finally {
    await rm(tmp, { force: true });
  }
}

// --- Lesen und Pruefen ------------------------------------------------------------------

interface Gelesen {
  info: Sicherungsinfo;
  db: Uint8Array;
  dateien: Map<string, Uint8Array>;
}

function lese(zip: Uint8Array): Gelesen {
  let eintraege: Record<string, Uint8Array>;
  try {
    eintraege = unzipSync(zip);
  } catch {
    throw badRequest("sicherung-unlesbar", "The file is not a readable ZIP archive.");
  }

  const meta = eintraege[META_EINTRAG];
  const db = eintraege[DB_EINTRAG];
  if (meta === undefined || db === undefined) {
    throw badRequest("sicherung-unvollstaendig", "The archive is not a backup of this app.");
  }
  let info: Sicherungsinfo;
  try {
    info = JSON.parse(new TextDecoder().decode(meta)) as Sicherungsinfo;
  } catch {
    throw badRequest("sicherung-unvollstaendig", "The backup description is not valid JSON.");
  }
  if (info.kennung !== KENNUNG) {
    throw badRequest("sicherung-fremd", "The archive is a backup of a different app.");
  }

  const dateien = new Map<string, Uint8Array>();
  for (const [name, inhalt] of Object.entries(eintraege)) {
    if (!name.startsWith(DATEI_PRAEFIX) || name.endsWith("/")) continue;
    dateien.set(name.slice(DATEI_PRAEFIX.length), inhalt);
  }
  return { info, db, dateien };
}

export interface Pruefergebnis {
  sicherung: Sicherungsinfo;
  aktuell: Bestand;
}

/** Fuer die Rueckfrage: was in der Sicherung steckt, gegen den aktuellen Bestand. */
export function pruefeSicherung(ctx: Kontext, zip: Uint8Array): Pruefergebnis {
  const { info, dateien } = lese(zip);
  for (const pfad of dateien.keys()) pruefePfad(ctx, pfad);
  return { sicherung: info, aktuell: leseBestand(ctx.db) };
}

function pruefePfad(ctx: Kontext, pfad: string): void {
  try {
    ctx.ablage.pruefe(pfad);
  } catch {
    throw badRequest("sicherung-pfad", `Archive entry leaves the file store: ${pfad}`);
  }
}

// --- Import ------------------------------------------------------------------------------

/**
 * Spielt eine Sicherung ein und **ersetzt den gesamten Bestand**, App-Nutzer eingeschlossen.
 *
 * Reihenfolge:
 *  1. Datenbank aus der Sicherung in eine Temp-Datei, pruefen, bei aelterem Stand nachmigrieren.
 *  2. Dateien in die Ablage schreiben.
 *  3. In **einer** Transaktion alle Tabellen leeren und aus der Temp-Datei fuellen,
 *     danach `foreign_key_check`. Meldet er etwas, faellt alles zurueck.
 *  4. Dateien loeschen, die kein Datensatz mehr nennt, auch bei einem Fehler: dann sind es
 *     genau die eben geschriebenen.
 */
export async function spieleEin(ctx: Kontext, zip: Uint8Array): Promise<Bestand> {
  const { db, dateien } = lese(zip);
  for (const pfad of dateien.keys()) pruefePfad(ctx, pfad);

  const tmp = join(tmpdir(), `namur-einspielen-${randomUUID()}.db`);
  await writeFile(tmp, db);
  try {
    bereiteVor(ctx, tmp);

    for (const [pfad, inhalt] of dateien) await ctx.ablage.schreibe(pfad, inhalt);

    try {
      uebernimm(ctx, tmp);
    } finally {
      await raeumeAblageAuf(ctx);
    }
    return leseBestand(ctx.db);
  } finally {
    for (const endung of ["", "-wal", "-shm"]) await rm(tmp + endung, { force: true });
  }
}

/** Lesbar, unbeschaedigt, nicht neuer als diese Fassung; aeltere werden nachmigriert. */
function bereiteVor(ctx: Kontext, tmp: string): void {
  /*
   * **Die Pruefverbindung wird in jedem Fall geschlossen.** Bleibt sie bei einer kaputten
   * Datei offen, scheitert unter Windows das Loeschen der Temp-Datei, und dieser Fehler
   * ueberdeckt die eigentliche Meldung mit einem 500.
   */
  let stand: number;
  let probe: Database.Database;
  try {
    probe = new Database(tmp, { fileMustExist: true });
  } catch {
    throw badRequest("sicherung-db-defekt", "The database in the backup is damaged.");
  }
  try {
    const ok = probe.pragma("integrity_check", { simple: true });
    if (ok !== "ok") throw new Error(String(ok));
    stand = migrationsstand(probe);
  } catch {
    throw badRequest("sicherung-db-defekt", "The database in the backup is damaged.");
  } finally {
    probe.close();
  }

  const hier = migrationsstand(ctx.sqlite);
  if (stand > hier) {
    throw conflict(
      "sicherung-zu-neu",
      "The backup comes from a newer version of the app; update the app first.",
      { sicherung: stand, app: hier },
    );
  }
  if (stand < hier) {
    const { db, sqlite } = oeffneDb(tmp);
    try {
      migriere(db, ctx.migrationsOrdner);
    } finally {
      sqlite.close();
    }
  }
}

function uebernimm(ctx: Kontext, tmp: string): void {
  const s = ctx.sqlite;
  const tabellen = (
    s
      .prepare(
        "select name from main.sqlite_master where type = 'table' and name not like 'sqlite_%'",
      )
      .all() as { name: string }[]
  )
    .map((t) => t.name)
    .filter((t) => !NICHT_KOPIEREN.has(t));

  /*
   * `foreign_keys` laesst sich in einer Transaktion nicht umschalten, deshalb davor. Aus,
   * weil die Tabellen in beliebiger Reihenfolge geleert und gefuellt werden; geprueft wird
   * am Ende ueber `foreign_key_check`, und zwar auf den ganzen Bestand.
   */
  s.pragma("foreign_keys = OFF");
  s.prepare("attach database ? as sicherung").run(tmp);
  try {
    s.transaction(() => {
      for (const t of tabellen) {
        const spalten = (s.prepare(`pragma main.table_info("${t}")`).all() as { name: string }[])
          .map((c) => `"${c.name}"`)
          .join(", ");
        s.prepare(`delete from main."${t}"`).run();
        s.prepare(
          `insert into main."${t}" (${spalten}) select ${spalten} from sicherung."${t}"`,
        ).run();
      }
      /*
       * **Pfade auf `/` bringen.** Auf Windows legt die Ablage `ab\uuid` ab, auf Linux
       * `ab/uuid`. Eine lokal erstellte Sicherung fuehrte im Container sonst zu Dateien,
       * die da sind und nicht gefunden werden. `/` versteht auch Windows.
       */
      s.prepare("update main.dateien set pfad = replace(pfad, '\\', '/')").run();

      const verletzt = s.prepare("pragma main.foreign_key_check").all();
      if (verletzt.length > 0) {
        throw new AppError(400, "sicherung-inkonsistent", "The backup has dangling references.", {
          anzahl: verletzt.length,
        });
      }
    })();
  } catch (fehler) {
    if (fehler instanceof AppError) throw fehler;
    throw badRequest("sicherung-db-defekt", "The backup does not match this database layout.");
  } finally {
    s.prepare("detach database sicherung").run();
    s.pragma("foreign_keys = ON");
  }
}

/** Loescht Dateien, die kein Datensatz mehr nennt. */
async function raeumeAblageAuf(ctx: Kontext): Promise<void> {
  const genannt = new Set(
    (ctx.sqlite.prepare("select pfad from dateien").all() as { pfad: string }[]).map((z) =>
      normiere(z.pfad),
    ),
  );
  for (const pfad of await ctx.ablage.alle()) {
    if (!genannt.has(pfad)) await ctx.ablage.loesche(pfad);
  }
}
