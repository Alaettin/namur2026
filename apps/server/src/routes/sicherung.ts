import type { FastifyInstance, FastifyRequest } from "fastify";
import { badRequest } from "../errors.js";
import type { Kontext } from "../kontext.js";
import { auswertungCsv } from "../services/auswertung.js";
import { erstelleSicherung, pruefeSicherung, spieleEin } from "../services/sicherung.js";

/**
 * Sicherung und Auswertung aus den Einstellungen, nur fuer Admins.
 *
 * Eine Sicherung enthaelt alles, auch die Passwort-Hashes der App-Nutzer und die Daten
 * aller Besucher. Wer sie herunterladen oder einspielen darf, darf ohnehin alles.
 */

/**
 * Eigene Grenze fuer Sicherungen, weit ueber den 50 MB fuer einzelne Dateien: die Sicherung
 * traegt **alle** Dateien. Der lokale Bestand lag am 19.10.2026 bei 6 MB.
 */
const MAX_SICHERUNG_BYTES = 500 * 1024 * 1024;

async function leseZip(req: FastifyRequest): Promise<Uint8Array> {
  const teil = await req.file({ limits: { fileSize: MAX_SICHERUNG_BYTES } });
  if (teil === undefined) throw badRequest("datei-fehlt", "Multipart field with a file required.");
  return await teil.toBuffer();
}

export function sicherungRoutes(app: FastifyInstance, ctx: Kontext): void {
  app.get("/api/sicherung", { preHandler: app.verlangeAdmin }, async (_req, reply) => {
    const { dateiname, inhalt } = await erstelleSicherung(ctx);
    void reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="${dateiname}"`)
      .header("cache-control", "no-store");
    return Buffer.from(inhalt);
  });

  /** Liest die Sicherung und nennt ihre Zahlen. **Aendert nichts.** */
  app.post("/api/sicherung/pruefen", { preHandler: app.verlangeAdmin }, async (req) =>
    pruefeSicherung(ctx, await leseZip(req)),
  );

  /** Ersetzt den gesamten Bestand. Die Oberflaeche fragt vorher mit Zahlen nach. */
  app.post("/api/sicherung", { preHandler: app.verlangeAdmin }, async (req) => ({
    bestand: await spieleEin(ctx, await leseZip(req)),
  }));

  /** Die Auswertung als CSV, im selben Format wie die CSV-Vorlage des Imports. */
  app.get("/api/auswertung", { preHandler: app.verlangeAdmin }, () => ({
    dateiname: `namur-hv-2026-besuche-${new Date().toISOString().slice(0, 10)}.csv`,
    inhalt: auswertungCsv(ctx.db),
  }));
}
