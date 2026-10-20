import type { FastifyInstance } from "fastify";
import { badRequest, unauthorized } from "../errors.js";
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
import { exponateFuerBesucher, leseElemente, setzeZuordnungen } from "../services/zuordnungen.js";
import { pruefeAvatarWahl } from "../services/avatare.js";

/**
 * Ein mitgeschicktes `avatarDateiId` geht durch dieselbe Pruefung wie am Tablet.
 *
 * Bis zum 20.10.2026 reichten Anlegen und Aendern es ungeprueft durch; ein Avatar haette auf
 * jede beliebige Datei zeigen koennen, etwa ein PDF, und das ginge in jede `values`-Antwort.
 */
function mitGeprueftemAvatar<T extends { avatarDateiId?: unknown }>(ctx: Kontext, koerper: T): T {
  if (!("avatarDateiId" in koerper)) return koerper;
  return { ...koerper, avatarDateiId: pruefeAvatarWahl(ctx.db, koerper.avatarDateiId) };
}

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
      return legeBesucherAn(ctx.db, mitGeprueftemAvatar(ctx, koerper));
    },
  );

  app.patch<{ Params: { guid: string }; Body: Partial<BesucherEingabe> }>(
    "/api/besucher/:guid",
    { preHandler: app.verlangeAdmin },
    async (req) =>
      aendereBesucher(ctx.db, req.params.guid, mitGeprueftemAvatar(ctx, req.body ?? {})),
  );

  /**
   * Den Avatar aus der Galerie waehlen, aus dem Besucherdetail. `null` ist der Standard.
   * Dieselbe Pruefung wie am Tablet, siehe `pruefeAvatarWahl`.
   */
  app.patch<{ Params: { guid: string }; Body: { avatarDateiId?: unknown } }>(
    "/api/besucher/:guid/avatar",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      const avatarDateiId = pruefeAvatarWahl(ctx.db, req.body?.avatarDateiId ?? null);
      const b = aendereBesucher(ctx.db, req.params.guid, { avatarDateiId });
      return { guid: b.guid, avatarDateiId: b.avatarDateiId };
    },
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

  /** Alle Exponate aus Sicht dieses Besuchers, fuer die Kaestchen im Besucherdetail. */
  app.get<{ Params: { guid: string } }>(
    "/api/besucher/:guid/exponate",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      findeBesucher(ctx.db, req.params.guid);
      return exponateFuerBesucher(ctx.db, req.params.guid);
    },
  );

  /**
   * Setzt die Zuordnungen an einem Exponat auf genau die mitgeschickten Elemente.
   *
   * Ersetzt das einzelne Entfernen: die Kaestchen im Besucherdetail schicken je Exponat den
   * ganzen Sollzustand, eine leere Liste nimmt das Exponat weg.
   */
  app.put<{ Params: { guid: string; exponatId: string }; Body: { elemente?: unknown } }>(
    "/api/besucher/:guid/zuordnungen/:exponatId",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      const nutzer = req.nutzer;
      if (nutzer === null) throw unauthorized();
      return setzeZuordnungen(ctx.db, {
        guid: req.params.guid,
        exponatId: req.params.exponatId,
        elemente: leseElemente(req.body?.elemente),
        nutzerId: nutzer.id,
      });
    },
  );
}
