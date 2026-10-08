import type { FastifyInstance } from "fastify";
import { badRequest } from "../errors.js";
import type { Kontext } from "../kontext.js";
import { leseCsv } from "../services/csv.js";
import { leseZuordnung, pruefeImport, uebernehmeImport, type Modus } from "../services/import.js";

/**
 * Der CSV-Import, nur fuer Admins.
 *
 * Zwei Schritte, und der erste aendert **nichts**: der Nutzer soll die Beanstandungen sehen
 * und die Datei korrigieren koennen, bevor etwas passiert.
 *
 * Die Datei wird in beiden Schritten hochgeladen, statt sie zwischen den Aufrufen auf dem
 * Server zu halten. Das spart einen Zustand mit Verfallszeit, und die Dateien sind klein:
 * 500 Besucher sind etwa 60 KB.
 */
export function importRoutes(app: FastifyInstance, ctx: Kontext): void {
  app.post("/api/besucher/import/pruefen", { preHandler: app.verlangeAdmin }, async (req) => {
    const { inhalt, zuordnung } = await leseAnfrage(req);
    return pruefeImport(ctx.db, inhalt, zuordnung);
  });

  app.post("/api/besucher/import/uebernehmen", { preHandler: app.verlangeAdmin }, async (req) => {
    const { inhalt, zuordnung, modus } = await leseAnfrage(req);
    if (modus === undefined) {
      throw badRequest("modus-fehlt", 'Field modus must be "ergaenzen" or "ersetzen".');
    }
    const gewaehlt = zuordnung ?? pruefeImport(ctx.db, inhalt).zuordnung;
    return uebernehmeImport(ctx.db, inhalt, gewaehlt, modus);
  });
}

/**
 * Liest Datei, Spaltenzuordnung und Modus aus einem Multipart-Koerper.
 *
 * Die Felder kommen **nach** der Datei nur dann an, wenn der Strom vollstaendig gelesen
 * wird; `req.parts()` tut genau das, in der Reihenfolge des Koerpers.
 */
async function leseAnfrage(req: {
  parts: () => AsyncIterableIterator<{
    type: string;
    fieldname: string;
    value?: unknown;
    toBuffer?: () => Promise<Buffer>;
  }>;
}) {
  let rohdaten: Buffer | null = null;
  let zuordnungRoh: string | null = null;
  let modus: Modus | undefined;

  for await (const teil of req.parts()) {
    if (teil.type === "file" && teil.toBuffer !== undefined) {
      rohdaten = await teil.toBuffer();
      continue;
    }
    const wert = typeof teil.value === "string" ? teil.value : "";
    if (teil.fieldname === "zuordnung") zuordnungRoh = wert;
    else if (teil.fieldname === "modus") {
      if (wert !== "ergaenzen" && wert !== "ersetzen") {
        throw badRequest("modus-ungueltig", 'Field modus must be "ergaenzen" or "ersetzen".');
      }
      modus = wert;
    }
  }

  if (rohdaten === null) throw badRequest("datei-fehlt", "A CSV file is required.");

  const inhalt = leseCsv(rohdaten);

  let zuordnung: ReturnType<typeof leseZuordnung> | undefined;
  if (zuordnungRoh !== null && zuordnungRoh !== "") {
    let geparst: unknown;
    try {
      geparst = JSON.parse(zuordnungRoh);
    } catch {
      throw badRequest("zuordnung-ungueltig", "Field zuordnung must be valid JSON.");
    }
    zuordnung = leseZuordnung(geparst, inhalt.spalten.length);
  }

  return { inhalt, zuordnung, modus };
}
