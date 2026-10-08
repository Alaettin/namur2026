import type { FastifyInstance } from "fastify";
import type { Kontext } from "../kontext.js";
import { leseMonitoring } from "../services/abrufe.js";

/**
 * Was Axon ueber die Konnektor-API abgefragt hat, nur fuer Admins.
 *
 * **Ohne Blaettern auf dem Server.** Die Liste hat hoechstens so viele Zeilen wie es
 * Besucher mit mindestens einem Abruf gibt, in der Praxis also einige hundert; das in
 * Seiten zu zerlegen kostet mehr Code als es spart. Geblaettert wird im Klienten.
 */
export function monitoringRoutes(app: FastifyInstance, ctx: Kontext): void {
  app.get("/api/monitoring", { preHandler: app.verlangeAdmin }, () => leseMonitoring(ctx.db));
}
