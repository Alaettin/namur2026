import type { FastifyInstance } from "fastify";
import type { Kontext } from "../kontext.js";
import {
  aendereGlobal,
  legeGlobalAn,
  listeGlobaleDaten,
  loescheGlobal,
} from "../services/globaldaten.js";

/**
 * Globale Daten, nur fuer Admins. Seit dem 20.10.2026.
 *
 * Dateien kommen ueber die vorhandene `POST /api/dateien` und werden dann per PATCH mit
 * `dateiId` gesetzt, wie bei den Exponat-Dokumenten.
 */
export function globaldatenRoutes(app: FastifyInstance, ctx: Kontext): void {
  app.get("/api/globale-daten", { preHandler: app.verlangeAdmin }, () => listeGlobaleDaten(ctx.db));

  app.post<{ Body: { name?: unknown; art?: unknown } }>(
    "/api/globale-daten",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      void reply.code(201);
      return legeGlobalAn(ctx.db, req.body ?? {});
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { name?: unknown; text?: unknown; dateiId?: unknown };
  }>("/api/globale-daten/:id", { preHandler: app.verlangeAdmin }, async (req) =>
    aendereGlobal(ctx.db, ctx.ablage, req.params.id, req.body ?? {}),
  );

  app.delete<{ Params: { id: string } }>(
    "/api/globale-daten/:id",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      await loescheGlobal(ctx.db, ctx.ablage, req.params.id);
      void reply.code(204);
      return null;
    },
  );
}
