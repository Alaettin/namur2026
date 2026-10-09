import type { FastifyInstance } from "fastify";
import { badRequest } from "../errors.js";
import type { Kontext } from "../kontext.js";
import {
  HOECHSTGROESSE,
  legeAvatarAn,
  leseGalerie,
  loescheAvatar,
  setzeReihenfolge,
} from "../services/avatare.js";

/**
 * Die Avatare, die am Selbstbedienungs-Tablet zur Auswahl stehen. **Nur Admins.**
 *
 * Das Tablet liest die Galerie ueber `/api/kiosk/avatare`; verwaltet wird sie hier. Zwei
 * Routensaetze, weil die Rechte verschieden sind: ein Geraet im Publikum darf waehlen,
 * nicht aendern.
 */
export function avatarRoutes(app: FastifyInstance, ctx: Kontext): void {
  app.get("/api/avatare", { preHandler: app.verlangeAdmin }, () => ({
    avatare: leseGalerie(ctx.db),
    hoechstgroesse: HOECHSTGROESSE,
  }));

  /**
   * Ein Bild aufnehmen.
   *
   * Die Oberflaeche verkleinert vorher im Browser auf 512 px; der Server verlaesst sich
   * darauf aber nicht, sondern prueft Typ und Groesse selbst (siehe `legeAvatarAn`).
   */
  app.post("/api/avatare", { preHandler: app.verlangeAdmin }, async (req, reply) => {
    const teil = await req.file();
    if (teil === undefined) throw badRequest("datei-fehlt", "A file is required.");

    const inhalt = await teil.toBuffer();
    const zeile = await legeAvatarAn(ctx.db, ctx.ablage, inhalt, teil.filename || "avatar");
    void reply.code(201);
    return zeile;
  });

  app.delete<{ Params: { dateiId: string } }>(
    "/api/avatare/:dateiId",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      await loescheAvatar(ctx.db, ctx.ablage, req.params.dateiId);
      void reply.code(204);
      return null;
    },
  );

  /**
   * Die Reihenfolge setzen. Erwartet **alle** Ids.
   *
   * Eine unvollstaendige Liste waere nicht entscheidbar: wohin gehoerte, was fehlt?
   */
  app.patch<{ Body: { ids?: unknown } }>(
    "/api/avatare/reihenfolge",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) {
        throw badRequest("ids-ungueltig", "Field ids must be an array of strings.");
      }
      return { avatare: setzeReihenfolge(ctx.db, ids as string[]) };
    },
  );
}
