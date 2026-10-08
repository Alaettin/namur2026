import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { besucher } from "../db/schema.js";
import { badRequest, notFound, unauthorized } from "../errors.js";
import type { Kontext } from "../kontext.js";
import { inhalteVonExponat } from "../services/exponate.js";
import { leseElemente, letzteZuordnungen, ordneZu } from "../services/zuordnungen.js";
import { zuordnungenVonBesucher } from "../services/besucher.js";
import { verlangeExponatZugriff } from "../services/zugriff.js";

/**
 * Der Scan-Ablauf am Exponat.
 *
 * Hier kommt ein Betreuer an Besucherdaten, und **nur hier**: an den einen Besucher,
 * dessen Pass gerade vor ihm liegt. Die Besucherliste bleibt ihm verschlossen.
 */
export function scanRoutes(app: FastifyInstance, ctx: Kontext): void {
  /**
   * Der Treffer nach dem Scannen: Besucherkarte plus alle Inhalte des Exponats, jeweils
   * mit der Angabe, ob dieser Besucher sie schon hat.
   *
   * Bereits zugeordnete Elemente sind markiert und zaehlen nicht in "Zuordnen (n)".
   */
  app.get<{ Params: { guid: string }; Querystring: { exponat?: string } }>(
    "/api/scan/besucher/:guid",
    { preHandler: app.verlangeAnmeldung },
    async (req) => {
      const exponatId = req.query.exponat;
      if (typeof exponatId !== "string" || exponatId === "") {
        throw badRequest("exponat-fehlt", "Query parameter exponat is required.");
      }
      verlangeExponatZugriff(ctx, req, exponatId);

      const person = ctx.db.select().from(besucher).where(eq(besucher.guid, req.params.guid)).get();
      // Dieselbe Meldung wie im Entwurf `ErrUnknown`: die GUID ist unbekannt.
      if (person === undefined) throw notFound("besucher-unbekannt", "Unknown visitor.");

      const inhalte = inhalteVonExponat(ctx.db, exponatId);
      const schon = new Set(
        zuordnungenVonBesucher(ctx.db, req.params.guid).map((z) => `${z.art}:${z.zielId}`),
      );
      const markiere = <T extends { id: string }>(art: string, liste: T[]) =>
        liste.map((e) => ({ ...e, bereitsZugeordnet: schon.has(`${art}:${e.id}`) }));

      const dokumente = markiere("dokument", inhalte.dokumente);
      const links = markiere("link", inhalte.links);
      const kontakte = markiere("kontakt", inhalte.kontakte);
      const offen = [...dokumente, ...links, ...kontakte].filter(
        (e) => !e.bereitsZugeordnet,
      ).length;

      return {
        besucher: person,
        dokumente,
        links,
        kontakte,
        /** Die Zahl fuer den Knopf "Zuordnen (n)". */
        offen,
      };
    },
  );

  /**
   * Zuordnen. **Idempotent**, siehe `ordneZu`.
   *
   * Bei `ErrOffline` schickt "Erneut versuchen" denselben Rumpf; ein zweiter Durchgang
   * legt nichts doppelt an und meldet `neu: 0`.
   */
  app.post<{ Body: { guid?: unknown; exponatId?: unknown; elemente?: unknown } }>(
    "/api/scan/zuordnen",
    { preHandler: app.verlangeAnmeldung },
    async (req) => {
      const { guid, exponatId, elemente } = req.body ?? {};
      if (typeof guid !== "string" || typeof exponatId !== "string") {
        throw badRequest("felder-fehlen", "Fields guid and exponatId are required.");
      }
      verlangeExponatZugriff(ctx, req, exponatId);

      const nutzer = req.nutzer;
      if (nutzer === null) throw unauthorized();

      return ordneZu(ctx.db, {
        guid,
        exponatId,
        elemente: leseElemente(elemente),
        nutzerId: nutzer.id,
      });
    },
  );

  /** Die letzten Zuordnungen an diesem Exponat, fuer den Bildschirm `ScanReady`. */
  app.get<{ Params: { id: string } }>(
    "/api/scan/exponate/:id/letzte",
    { preHandler: app.verlangeAnmeldung },
    async (req) => {
      verlangeExponatZugriff(ctx, req, req.params.id);
      return letzteZuordnungen(ctx.db, 10, req.params.id);
    },
  );
}
