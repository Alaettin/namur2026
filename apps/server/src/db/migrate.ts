import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Db } from "./client.js";

/**
 * Migriert programmatisch beim Start.
 *
 * drizzle-kit ist eine devDependency und liegt im Container nicht vor, dort wird nur der
 * erzeugte Ordner mitgeliefert. Der Pfad kommt von aussen, weil er sich nur vom
 * Einstiegspunkt aus zuverlaessig ausrechnen laesst: `src/index.ts` und das gebuendelte
 * `dist/index.js` liegen beide genau eine Ebene unter `apps/server`, jede andere Datei
 * nicht.
 */
export function migriere(db: Db, ordner: string): void {
  migrate(db, { migrationsFolder: ordner });
}
