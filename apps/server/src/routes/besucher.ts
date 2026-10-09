import type { FastifyInstance } from "fastify";
import { badRequest } from "../errors.js";
import { rundeAlsText, rundenVonBesucher } from "../services/runden.js";
import type { Kontext } from "../kontext.js";
import {
  aendereBesucher,
  findeBesucher,
  legeBesucherAn,
  listeBesucher,
  loescheBesucher,
  zuordnungenVonBesucher,
  type BesucherEingabe,
} from "../services/besucher.js";
import { entferneZuordnung, type Art } from "../services/zuordnungen.js";

/**
 * Besucherverwaltung, nur fuer Admins.
 *
 * Ein Betreuer kommt an Besucherdaten ausschliesslich ueber den Scan-Ablauf, und dort nur
 * an den einen, dessen Pass vor ihm liegt.
 */
export function besucherRoutes(app: FastifyInstance, ctx: Kontext): void {
  app.get<{ Querystring: { suche?: string; seite?: string; groesse?: string } }>(
    "/api/besucher",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      const nummer = Number(req.query.seite ?? "1");
      const groesse = Number(req.query.groesse ?? "25");
      if (!Number.isInteger(nummer) || nummer < 1) {
        throw badRequest("seite-ungueltig", "Query seite must be a positive integer.");
      }
      // Eine Obergrenze, damit ein `groesse=100000` nicht die ganze Tabelle in eine
      // Antwort laedt.
      if (!Number.isInteger(groesse) || groesse < 1 || groesse > 200) {
        throw badRequest("groesse-ungueltig", "Query groesse must be between 1 and 200.");
      }
      return listeBesucher(ctx.db, req.query.suche ?? "", { nummer, groesse });
    },
  );

  app.get<{ Params: { guid: string } }>(
    "/api/besucher/:guid",
    { preHandler: app.verlangeAdmin },
    async (req) => ({
      ...findeBesucher(ctx.db, req.params.guid),
      zuordnungen: zuordnungenVonBesucher(ctx.db, req.params.guid),
      /*
       * Die gefahrenen Runden, mit fertiger Anzeigezeile. Die Formatierung steht im
       * Server, weil dieselbe Zeile auch in die Konnektor-Antwort geht; zwei Fassungen
       * liefen beim ersten Feinschliff auseinander.
       */
      runden: rundenVonBesucher(ctx.db, req.params.guid).map((r) => ({
        lapId: r.lapId,
        platz: r.platz,
        lapNumber: r.lapNumber,
        laneNumber: r.laneNumber,
        durationMs: r.durationMs,
        startedUtcMs: r.startedUtcMs,
        anzeige: rundeAlsText(r),
      })),
    }),
  );

  app.post<{ Body: BesucherEingabe }>(
    "/api/besucher",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      const koerper = req.body ?? ({} as BesucherEingabe);
      if (typeof koerper.vorname !== "string" || typeof koerper.nachname !== "string") {
        throw badRequest("felder-fehlen", "Fields vorname and nachname are required.");
      }
      void reply.code(201);
      return legeBesucherAn(ctx.db, koerper);
    },
  );

  app.patch<{ Params: { guid: string }; Body: Partial<BesucherEingabe> }>(
    "/api/besucher/:guid",
    { preHandler: app.verlangeAdmin },
    async (req) => aendereBesucher(ctx.db, req.params.guid, req.body ?? {}),
  );

  app.delete<{ Params: { guid: string } }>(
    "/api/besucher/:guid",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      loescheBesucher(ctx.db, req.params.guid);
      void reply.code(204);
      return null;
    },
  );

  /** Eine einzelne Zuordnung zuruecknehmen, aus der Detailansicht des Besuchers. */
  app.delete<{ Params: { guid: string; art: string; zielId: string } }>(
    "/api/besucher/:guid/zuordnungen/:art/:zielId",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      const { art } = req.params;
      if (art !== "dokument" && art !== "link" && art !== "kontakt") {
        throw badRequest(
          "art-ungueltig",
          'Path segment art must be "dokument", "link" or "kontakt".',
        );
      }
      entferneZuordnung(ctx.db, req.params.guid, art as Art, req.params.zielId);
      void reply.code(204);
      return null;
    },
  );
}
