import type { Database as SqliteDatabase } from "better-sqlite3";
import type { Dateiablage } from "./ablage/dateien.js";
import type { Db } from "./db/client.js";
import type { ServerEnv } from "./env.js";

/**
 * Was eine Route braucht, um zu arbeiten: die Konfiguration, die Datenbank und die
 * Dateiablage.
 *
 * Ein Buendel statt drei Parametern an jeder Routenfunktion. Es waechst nicht beliebig:
 * alles Fachliche gehoert in `services/`, hier stehen nur die Zugaenge.
 */
export interface Kontext {
  readonly env: ServerEnv;
  readonly db: Db;
  readonly ablage: Dateiablage;
  /**
   * Die rohe Verbindung hinter `db`, fuer die Sicherung: `backup()` und `ATTACH` gibt es
   * nur dort. Fachlogik nimmt `db`.
   */
  readonly sqlite: SqliteDatabase;
  /** Fuer die Sicherung: eine aeltere Sicherung wird vor dem Einspielen nachmigriert. */
  readonly migrationsOrdner: string;
}
