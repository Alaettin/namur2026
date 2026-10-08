import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer } from "./app.js";
import { PROJEKT_WURZEL, readEnv } from "./env.js";

/**
 * Einstiegspunkt: Umgebung lesen, Server bauen, lauschen. Sonst nichts.
 *
 * Die Migrations- und Frontendordner werden hier aufgeloest, weil **nur diese Datei** in
 * beiden Faellen genau eine Ebene unter `apps/server` liegt: als `src/index.ts` im
 * Entwicklungsbetrieb und als gebuendeltes `dist/index.js` im Container. Diese Datei darf
 * deshalb nicht verschoben werden.
 */

// Die .env liegt im Wurzelverzeichnis des Repos, ueber dieselbe Wurzel wie der Datenort:
// zwei Rechenwege waeren zwei Gelegenheiten, auseinanderzulaufen. Im Container kommt die
// Umgebung von aussen, dort gibt es keine Datei und das ist kein Fehler.
try {
  process.loadEnvFile(join(PROJEKT_WURZEL, ".env"));
} catch {
  // absichtlich still
}

// Im Entwicklungsbetrieb laeuft der Server ueber tsx, dort ersetzt niemand `__APP_VERSION__`.
(globalThis as Record<string, unknown>)["__APP_VERSION__"] ??= "dev";

const env = readEnv();
const migrationsOrdner = fileURLToPath(new URL("../drizzle", import.meta.url));
const frontendOrdner = fileURLToPath(new URL("../../web/dist", import.meta.url));

const { app } = await buildServer(env, migrationsOrdner, frontendOrdner);

app.listen({ port: env.port, host: env.host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
