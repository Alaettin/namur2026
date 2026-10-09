import type { FastifyInstance } from "fastify";
import { unauthorized } from "../errors.js";
import type { Kontext } from "../kontext.js";
import { pruefeBasicGegen } from "../konnektorapi/basic.js";
import { carreraAnmeldungVerlangt } from "../services/einstellungen.js";
import {
  loescheRunde,
  nimmRundeAuf,
  rundeAlsText,
  rundenVonBesucher,
  type Rundenmeldung,
} from "../services/runden.js";

/**
 * Die Schnittstelle der Carrera-Bahn.
 *
 * Die Software der Bahn meldet nach jeder gefahrenen Runde einen Datensatz. Eigener Zweig
 * neben `/connector`, weil es ein anderer Partner mit anderen Rechten ist: diese Routen
 * **schreiben**, der Konnektor liest nur.
 *
 * **Der Zugang ist abschaltbar und steht standardmaessig offen**, wie beim Konnektor. Der
 * Schalter liegt in den Einstellungen; die Zugangsdaten kommen aus `CARRERA_BASIC_*`.
 * Beides getrennt vom Konnektor: wer den einen zumacht, will nicht zwangslaeufig den
 * anderen aussperren.
 */
export function carreraRoutes(app: FastifyInstance, ctx: Kontext): void {
  /** Haengt vor jede Route dieses Zweigs, wenn der Schalter an ist. */
  function pruefeZugang(req: Parameters<typeof pruefeBasicGegen>[0]): void {
    if (!carreraAnmeldungVerlangt(ctx.db)) return;
    pruefeBasicGegen(req, ctx.env.carreraBasic, () =>
      unauthorized("Basic authentication is required."),
    );
  }

  /**
   * Eine gefahrene Runde melden.
   *
   * Antwortet **200 auch dann, wenn nichts gespeichert wurde**: anonyme Runden und
   * zurueckgenommene sind laut der Mail des Entwicklers vorgesehen, und ein 4xx darauf
   * fuellte sein Protokoll mit Fehlern, die keine sind. Was passiert ist, steht im Rumpf.
   *
   * Fehler bleiben Fehler: unbekannte GUID 404, 21. Runde 409, kaputter Rumpf 400.
   */
  app.post<{ Body: Rundenmeldung }>("/carrera/runden", async (req) => {
    pruefeZugang(req);
    return nimmRundeAuf(ctx.db, req.body ?? {});
  });

  /**
   * Eine Runde zuruecknehmen, ueber seine `lap_id`.
   *
   * 204 auch dann, wenn es sie nicht gab: ein zweiter Loeschversuch nach einem Netzfehler
   * soll nicht wie ein Fehler aussehen, und das Ziel ist in beiden Faellen erreicht.
   */
  app.delete<{ Params: { lapId: string } }>("/carrera/runden/:lapId", async (req, reply) => {
    pruefeZugang(req);
    loescheRunde(ctx.db, req.params.lapId);
    void reply.code(204);
    return null;
  });

  /** Was zu einem Besucher gespeichert ist, zum Gegenpruefen von seiner Seite aus. */
  app.get<{ Params: { guid: string } }>("/carrera/runden/besucher/:guid", async (req) => {
    pruefeZugang(req);
    const alle = rundenVonBesucher(ctx.db, req.params.guid);
    return {
      guid: req.params.guid,
      anzahl: alle.length,
      runden: alle.map((r) => ({
        lapId: r.lapId,
        platz: r.platz,
        lapNumber: r.lapNumber,
        laneNumber: r.laneNumber,
        durationMs: r.durationMs,
        startedUtcMs: r.startedUtcMs,
        anzeige: rundeAlsText(r),
      })),
    };
  });
}
