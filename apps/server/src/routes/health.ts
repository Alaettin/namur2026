import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { Kontext } from "../kontext.js";

/**
 * Gesundheitspruefung fuer Sliplane und fuer die eigene Abnahme.
 *
 * **Die Datenbank wird tatsaechlich gefragt**, nicht nur ein `{ status: "ok" }`
 * zurueckgegeben. Ein Dienst, dessen Volume fehlt oder dessen SQLite-Datei nicht
 * beschreibbar ist, laeuft als Prozess einwandfrei weiter und antwortet auf jede
 * Gesundheitspruefung mit 200. Genau dieser Fall soll hier auffallen, bevor ihn ein Nutzer
 * findet.
 */
export function healthRoutes(app: FastifyInstance, ctx: Kontext): void {
  app.get("/api/health", async (_req, reply) => {
    let db: "ok" | "fehler" = "ok";
    try {
      ctx.db.get(sql`select 1`);
    } catch {
      db = "fehler";
      void reply.code(503);
    }
    return { status: db === "ok" ? "ok" : "fehler", version: __APP_VERSION__, db };
  });
}
