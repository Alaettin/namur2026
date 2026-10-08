import type { FastifyInstance } from "fastify";
import { badRequest } from "../errors.js";
import type { Kontext } from "../kontext.js";
import {
  aendereAnsprechpartner,
  exponateVonAnsprechpartner,
  findeAnsprechpartner,
  legeAnsprechpartnerAn,
  listeAnsprechpartner,
  loescheAnsprechpartner,
  type Eingabe,
} from "../services/ansprechpartner.js";

/**
 * Ansprechpartner als Stammdaten, nur fuer Admins.
 *
 * Ein Betreuer sieht sie am Exponat, legt aber keine an: sie wirken sich ueber das Modell
 * auf Axon aus.
 */
export function ansprechpartnerRoutes(app: FastifyInstance, ctx: Kontext): void {
  app.get("/api/ansprechpartner", { preHandler: app.verlangeAdmin }, async () =>
    listeAnsprechpartner(ctx.db).map((a) => ({
      ...a,
      exponate: exponateVonAnsprechpartner(ctx.db, a.id),
    })),
  );

  app.get<{ Params: { id: string } }>(
    "/api/ansprechpartner/:id",
    { preHandler: app.verlangeAdmin },
    async (req) => ({
      ...findeAnsprechpartner(ctx.db, req.params.id),
      exponate: exponateVonAnsprechpartner(ctx.db, req.params.id),
    }),
  );

  app.post<{ Body: Eingabe }>(
    "/api/ansprechpartner",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      const koerper = req.body ?? {};
      if (typeof koerper.vorname !== "string" || typeof koerper.nachname !== "string") {
        throw badRequest("felder-fehlen", "Fields vorname and nachname are required.");
      }
      void reply.code(201);
      return legeAnsprechpartnerAn(ctx.db, koerper);
    },
  );

  app.patch<{ Params: { id: string }; Body: Eingabe }>(
    "/api/ansprechpartner/:id",
    { preHandler: app.verlangeAdmin },
    async (req) => aendereAnsprechpartner(ctx.db, req.params.id, req.body ?? {}),
  );

  app.delete<{ Params: { id: string } }>(
    "/api/ansprechpartner/:id",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      loescheAnsprechpartner(ctx.db, req.params.id);
      void reply.code(204);
      return null;
    },
  );
}
