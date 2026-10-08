import type { FastifyInstance } from "fastify";
import { badRequest, forbidden } from "../errors.js";
import type { Kontext } from "../kontext.js";
import { findeDatei, loescheDatei, speichereDatei } from "../services/dateien.js";
import { STANDARD_AVATAR_ID } from "../services/standardavatar.js";

export function dateiRoutes(app: FastifyInstance, ctx: Kontext): void {
  /**
   * Hochladen. Jede angemeldete Rolle darf das: ein Betreuer laedt am Stand ein Dokument
   * zu seinem Exponat hoch.
   */
  /*
   * **Nur Admins.** Stand bis zum 08.10.2026 auf `verlangeAnmeldung` und damit jeder
   * angemeldeten Rolle offen. Gebraucht wird es ausschliesslich beim Anhaengen von
   * Dokumenten an ein Exponat, und das ist selbst Admin-Sache. Mit dem
   * Selbstbedienungs-Tablet gibt es jetzt eine Rolle, die auf einem unbeaufsichtigten
   * Geraet im Publikum laeuft; die soll nichts in die Ablage schreiben koennen.
   */
  app.post("/api/dateien", { preHandler: app.verlangeAdmin }, async (req, reply) => {
    const teil = await req.file();
    if (teil === undefined)
      throw badRequest("datei-fehlt", "Multipart field with a file required.");

    /*
     * `toBuffer()` wirft bei Ueberschreiten des Limits aus `@fastify/multipart`. Der
     * Fehler traegt statusCode 413 und geht unveraendert durch den Fehlerhandler; er muss
     * hier nicht gefangen werden.
     *
     * Der Strom muss **vollstaendig** gelesen werden, bevor geantwortet wird. Eine Antwort
     * auf einen halb gelesenen Multipart-Koerper laesst die Verbindung haengen.
     */
    const inhalt = await teil.toBuffer();
    const meta = await speichereDatei(ctx.db, ctx.ablage, teil.filename, inhalt);
    void reply.code(201);
    return meta;
  });

  /**
   * Ausliefern, nur an Angemeldete.
   *
   * Der oeffentliche Weg zu denselben Inhalten ist die Konnektor-API in Auftrag 2; sie hat
   * ihre eigene Authentifizierung und liefert nur, was einem Besucher zugeordnet wurde.
   */
  /**
   * Der Standard-Avatar, ohne dass die Oberflaeche seine Id kennen muss.
   *
   * **Vor** `/api/dateien/:id` eingetragen waere sie nicht noetig, weil der Pfad ein anderer
   * ist; sie steht hier trotzdem daneben, weil sie dieselbe Datei aus derselben Ablage
   * liefert. Fehlt das Bild im Repo, gibt es 404 statt eines kaputten Streams.
   */
  app.get("/api/standard-avatar", { preHandler: app.verlangeAnmeldung }, async (_req, reply) => {
    const reihe = findeDatei(ctx.db, STANDARD_AVATAR_ID);
    void reply
      .header("content-type", reihe.mimeType)
      .header("content-length", String(reihe.groesse))
      .header("cache-control", "private, max-age=3600");
    return ctx.ablage.lies(reihe.pfad);
  });

  app.get<{ Params: { id: string } }>(
    "/api/dateien/:id",
    { preHandler: app.verlangeAnmeldung },
    async (req, reply) => {
      const reihe = findeDatei(ctx.db, req.params.id);
      /*
       * `attachment` fuer alles ausser Bildern waere bequemer, ist aber nicht noetig:
       * `nosniff` steht auf jeder Antwort, und der Typ kommt aus unserer Endungstabelle,
       * nicht vom Hochladenden. Der Name wird in `filename*` nach RFC 5987 kodiert, sonst
       * zerfaellt jeder Umlaut.
       */
      void reply
        .header("content-type", reihe.mimeType)
        .header("content-length", String(reihe.groesse))
        .header(
          "content-disposition",
          `inline; filename*=UTF-8''${encodeURIComponent(reihe.originalName)}`,
        )
        // Privat: die Datei haengt an einer Sitzung, ein geteilter Zwischenspeicher
        // duerfte sie nie an einen anderen Nutzer ausliefern.
        .header("cache-control", "private, max-age=3600");
      return ctx.ablage.lies(reihe.pfad);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/dateien/:id",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      /*
       * **Der Standard-Avatar ist nicht loeschbar.** Er haengt an keinem Besucher, die
       * Fremdschluessel schuetzen ihn also nicht; geloescht faellt er bei *allen* aus dem
       * Viewer, und beim naechsten Start kaeme er mit neuer Ablage, aber derselben Id
       * zurueck. Lieber eine klare Absage als ein Bestand, der sich selbst repariert.
       */
      if (req.params.id === STANDARD_AVATAR_ID) {
        throw forbidden(
          "standard-avatar-geschuetzt",
          "The default avatar cannot be deleted; it is used by every visitor without an own image.",
        );
      }
      await loescheDatei(ctx.db, ctx.ablage, req.params.id);
      void reply.code(204);
      return null;
    },
  );
}
