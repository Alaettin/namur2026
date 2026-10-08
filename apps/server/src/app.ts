import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { Dateiablage } from "./ablage/dateien.js";
import { stelleStandardAvatarSicher } from "./services/standardavatar.js";
import { installAuth } from "./auth/plugin.js";
import { oeffneDb } from "./db/client.js";
import { migriere } from "./db/migrate.js";
import type { ServerEnv } from "./env.js";
import { registerErrorHandler } from "./errors.js";
import type { Kontext } from "./kontext.js";
import { konnektorApiRoutes } from "./konnektorapi/plugin.js";
import { ansprechpartnerRoutes } from "./routes/ansprechpartner.js";
import { authRoutes } from "./routes/auth.js";
import { besucherRoutes } from "./routes/besucher.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { monitoringRoutes } from "./routes/monitoring.js";
import { dateiRoutes } from "./routes/dateien.js";
import { entwicklerRoutes } from "./routes/entwickler.js";
import { exponatRoutes } from "./routes/exponate.js";
import { healthRoutes } from "./routes/health.js";
import { importRoutes } from "./routes/import.js";
import { nutzerRoutes } from "./routes/nutzer.js";
import { scanRoutes } from "./routes/scan.js";
import { frontendVorhanden, statischeDateien } from "./routes/statisch.js";
import { bootstrapAdmin } from "./services/bootstrap.js";
import { installiereSicherheitskopfzeilen } from "./sicherheitskopfzeilen.js";

export interface GebauterServer {
  readonly app: FastifyInstance;
  readonly ctx: Kontext;
  readonly close: () => Promise<void>;
}

/**
 * Baut die Instanz, **ohne zu lauschen**. Das Lauschen liegt allein in `index.ts`, damit
 * Tests ueber `app.inject()` ohne Port und ohne Netzwerk laufen koennen.
 */
export async function buildServer(
  env: ServerEnv,
  migrationsOrdner: string,
  frontendOrdner?: string,
): Promise<GebauterServer> {
  const { db, sqlite } = oeffneDb(env.dbPfad);
  migriere(db, migrationsOrdner);

  const app = Fastify({
    logger: {
      level: env.logLevel,
      redact: ["req.headers.cookie", "req.headers.authorization"],
    },
    /*
     * Genau **ein** vertrauter Sprung, nicht `true`.
     *
     * Ohne trustProxy saehe die Ratenbegrenzung hinter einem Rand nur dessen IP. Mit
     * `true` aber vertraut Fastify jedem Eintrag in `X-Forwarded-For`, und weil `req.ip`
     * der Rueckfallschluessel der Anmeldegrenze ist, liesse sich mit einer gefaelschten
     * Kopfzeile jede Grenze frei drehen. `req.protocol`, an dem das Sitzungscookie haengt,
     * kommt aus derselben Quelle.
     *
     * Als Funktion statt als Zahl: Fastify 5.12 nimmt fuer `trustProxy` nur noch
     * `boolean | string | string[] | TrustProxyFunction`. Die Funktion ist genau das, was
     * `proxy-addr` intern aus einer Zahl baut, naemlich "vertraue den n naechstgelegenen".
     */
    trustProxy: (_adresse, sprung) => sprung < 1,
    bodyLimit: 1024 * 1024,
  });

  const ctx: Kontext = {
    env,
    db,
    ablage: new Dateiablage(env.dateienDir),
  };

  /*
   * Der Standard-Avatar wird einmal abgelegt, falls er fehlt. Vor den Routen, damit die
   * erste Anfrage ihn schon vorfindet.
   */
  await stelleStandardAvatarSicher(db, ctx.ablage, (text) => {
    app.log.warn(text);
  });

  // Der SPA-Rueckfall haengt am 404-Handler, und den gibt es nur einmal je Instanz.
  const hatFrontend = frontendOrdner !== undefined && frontendVorhanden(frontendOrdner);
  registerErrorHandler(app, hatFrontend);
  installiereSicherheitskopfzeilen(app, env.production);
  await installAuth(app, ctx);
  /*
   * `bodyLimit` oben gilt fuer JSON und bleibt klein. Uploads laufen durch multipart und
   * haben ihre eigene, viel groessere Grenze: ein gemeinsamer Wert hiesse, dass auch jeder
   * JSON-Koerper 50 MB haben darf.
   */
  await app.register(multipart, { limits: { fileSize: env.maxUploadBytes, files: 1 } });
  /*
   * Einmal hier, nicht in den Routendateien. `@fastify/rate-limit` traegt sich immer in
   * die Wurzel ein, auch aus einem gekapselten Geltungsbereich heraus, und ein zweites Mal
   * scheitert an "already present". Ausserdem sieht sein onRoute-Haken nur Routen, die
   * **danach** angemeldet werden, es muss also vor allen stehen, die `config.rateLimit`
   * setzen. `global: false` heisst: es gilt nur, wo es dransteht.
   */
  /*
   * `hook: "preHandler"` ist **keine Feinheit, sondern die Bedingung dafuer, dass die
   * Anmeldegrenze ueberhaupt je E-Mail greift.**
   *
   * In der Vorgabe `onRequest` laeuft der Schluesselbildner, bevor Fastify den Rumpf
   * geparst hat: `req.body` ist dort `undefined`, der Schluessel faellt jedes Mal auf die
   * IP zurueck, und **alle** Anmeldeversuche aus einem Netz teilen sich einen Zaehler. Am
   * Stand haengen alle Handys am selben WLAN; der elfte Fehlversuch irgendeines Betreuers
   * sperrte dann die ganze Mannschaft aus.
   *
   * Das faellt in keinem Einzeltest auf, der nur die Grenze selbst prueft: die greift ja.
   * Sichtbar wird es erst an der Gegenprobe mit einer **zweiten** E-Mail.
   */
  await app.register(rateLimit, { global: false, hook: "preHandler" });

  healthRoutes(app, ctx);
  authRoutes(app, ctx);
  nutzerRoutes(app, ctx);
  dateiRoutes(app, ctx);
  besucherRoutes(app, ctx);
  importRoutes(app, ctx);
  exponatRoutes(app, ctx);
  ansprechpartnerRoutes(app, ctx);
  scanRoutes(app, ctx);
  dashboardRoutes(app, ctx);
  monitoringRoutes(app, ctx);
  entwicklerRoutes(app, ctx);
  /*
   * Die oeffentliche API. Eigener Geltungsbereich mit eigenem Fehlerhandler: sie antwortet
   * mit `Result`, die Verwaltung mit `{code, message}`.
   */
  konnektorApiRoutes(app, ctx);

  await bootstrapAdmin(db, env, (text) => {
    app.log.info(text);
  });

  // Zuletzt, damit keine API-Route verdeckt wird.
  if (hatFrontend) await statischeDateien(app, frontendOrdner);
  else app.log.info("kein gebautes Frontend gefunden, Server laeuft als reine API");

  return {
    app,
    ctx,
    close: async () => {
      await app.close();
      (sqlite as SqliteDatabase).close();
    },
  };
}
