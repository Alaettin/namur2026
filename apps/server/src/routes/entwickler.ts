import type { FastifyInstance } from "fastify";
import { badRequest } from "../errors.js";
import type { Kontext } from "../kontext.js";
import { leseBestand, setzeZurueck } from "../services/entwickler.js";

/**
 * Die Endpunkte hinter dem Entwicklermodus.
 *
 * **Beide verlangen die Admin-Rolle.** Der Schalter in der Oberflaeche blendet die Knoepfe
 * nur aus; wer die Adresse kennt, kaeme sonst ohne Rolle an das Zuruecksetzen. Eine
 * Sichtbarkeit ist keine Berechtigung.
 */

/** Das Wort, das im Rueckfragedialog einzutippen ist. Ohne Umlaut, es wird abgetippt. */
const BESTAETIGUNG = "ZURUECKSETZEN";

export function entwicklerRoutes(app: FastifyInstance, ctx: Kontext): void {
  app.get("/api/entwickler/bestand", { preHandler: app.verlangeAdmin }, async () =>
    leseBestand(ctx.db),
  );

  app.post<{ Body: { bestaetigung?: unknown } }>(
    "/api/entwickler/zuruecksetzen",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      /*
       * Die Bestaetigung wird **auch auf dem Server** verlangt, nicht nur im Dialog.
       * Ein Aufruf per curl oder ein doppelter Klick, der am Dialog vorbeigeht, soll
       * nicht den ganzen Bestand loeschen.
       */
      if (req.body?.bestaetigung !== BESTAETIGUNG) {
        throw badRequest(
          "bestaetigung-fehlt",
          `Field bestaetigung must be exactly "${BESTAETIGUNG}".`,
        );
      }
      const geloescht = await setzeZurueck(ctx.db, ctx.ablage);
      return { geloescht };
    },
  );
}
