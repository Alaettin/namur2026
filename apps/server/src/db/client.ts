import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database, { type Database as SqliteDatabase } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Oeffnet die SQLite-Datei und setzt die PRAGMAs, auf die sich der Rest verlaesst.
 *
 * `foreign_keys` ist in SQLite **je Verbindung** aus. Ohne dieses PRAGMA greift kein
 * ON DELETE CASCADE, und ein geloeschtes Exponat liesse seine Dokumente, Links und
 * Zuordnungen als Waisen zurueck.
 *
 * `journal_mode = WAL`: ein Schreiber, beliebig viele Leser. Waehrend am Stand zugeordnet
 * wird, fragt Axon fuer jeden Viewer-Aufruf dieselbe Datei ab; ohne WAL blockierte jeder
 * Scan diese Abfragen.
 */
export function oeffneDb(pfad: string): { db: Db; sqlite: SqliteDatabase } {
  mkdirSync(dirname(pfad), { recursive: true });
  const sqlite = new Database(pfad);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  return { db: drizzle(sqlite, { schema }), sqlite };
}
