import type { FastifyInstance } from "fastify";
import { badRequest } from "../errors.js";
import type { Kontext } from "../kontext.js";
import {
  aendereExponat,
  betreuerVonExponat,
  betroffeneBesucher,
  findeExponat,
  hatInhalte,
  inhalteVonExponat,
  legeDokumentAn,
  legeExponatAn,
  legeLinkAn,
  listeExponate,
  loescheExponat,
  loescheInhalt,
} from "../services/exponate.js";
import { weiseZu } from "../services/ansprechpartner.js";
import { verlangeExponatBearbeiten, verlangeExponatZugriff } from "../services/zugriff.js";
import type { Art } from "../services/zuordnungen.js";

function alsArt(wert: string): Art {
  if (wert !== "dokument" && wert !== "link" && wert !== "kontakt") {
    throw badRequest("art-ungueltig", 'Path segment art must be "dokument", "link" or "kontakt".');
  }
  return wert;
}

export function exponatRoutes(app: FastifyInstance, ctx: Kontext): void {
  /**
   * Die Liste.
   *
   * Ein Admin sieht alle, ein Betreuer **nur die eigenen**. Das ist zugleich der
   * Einstieg in den Scan-Ablauf: `ScanPick` zeigt genau diese Liste.
   */
  app.get("/api/exponate", { preHandler: app.verlangeAnmeldung }, async (req) => {
    const nutzer = req.nutzer;
    const alle = listeExponate(ctx.db);
    const sichtbar =
      nutzer?.rolle === "admin"
        ? alle
        : alle.filter((e) => betreuerVonExponat(ctx.db, e.id).includes(nutzer?.id ?? ""));

    return sichtbar.map((e) => {
      const i = inhalteVonExponat(ctx.db, e.id);
      return {
        ...e,
        anzahl: {
          dokumente: i.dokumente.length,
          links: i.links.length,
          kontakte: i.kontakte.length,
        },
        // Scannen ist gesperrt, solange nichts da ist, das sich zuordnen liesse.
        scanbar: i.dokumente.length + i.links.length + i.kontakte.length > 0,
      };
    });
  });

  app.get<{ Params: { id: string } }>(
    "/api/exponate/:id",
    { preHandler: app.verlangeAnmeldung },
    async (req) => {
      verlangeExponatZugriff(ctx, req, req.params.id);
      return {
        ...findeExponat(ctx.db, req.params.id),
        ...inhalteVonExponat(ctx.db, req.params.id),
        betreuer: betreuerVonExponat(ctx.db, req.params.id),
        scanbar: hatInhalte(ctx.db, req.params.id),
      };
    },
  );

  app.post<{ Body: { name?: unknown; beschreibung?: unknown } }>(
    "/api/exponate",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      const { name, beschreibung } = req.body ?? {};
      if (typeof name !== "string") throw badRequest("feld-fehlt", "Field name is required.");
      // Die Kennung vergibt der Server, siehe `naechsteKennung`.
      void reply.code(201);
      return legeExponatAn(ctx.db, {
        name,
        beschreibung: typeof beschreibung === "string" ? beschreibung : null,
      });
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: unknown; beschreibung?: unknown } }>(
    "/api/exponate/:id",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      const { name, beschreibung } = req.body ?? {};
      /*
       * **Die Kennung wird hier nicht angenommen.** Sie steht in jedem `propertyId` dieses
       * Exponats; ein Wechsel benennt alle Datenpunkte um und bricht das Mapping in Axon.
       * Seit dem 08.10.2026 vergibt sie der Server und sie bleibt unveraendert.
       */
      return aendereExponat(ctx.db, req.params.id, {
        ...(typeof name === "string" ? { name } : {}),
        ...("beschreibung" in (req.body ?? {})
          ? { beschreibung: typeof beschreibung === "string" ? beschreibung : null }
          : {}),
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/exponate/:id",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      loescheExponat(ctx.db, req.params.id);
      void reply.code(204);
      return null;
    },
  );

  // --- Inhalte ------------------------------------------------------------------------

  app.post<{
    Params: { id: string };
    Body: { dateiId?: unknown; titel?: unknown; beschreibung?: unknown };
  }>("/api/exponate/:id/dokumente", { preHandler: app.verlangeAdmin }, async (req, reply) => {
    verlangeExponatBearbeiten(ctx, req, req.params.id);
    const { dateiId, titel, beschreibung } = req.body ?? {};
    if (typeof dateiId !== "string" || typeof titel !== "string" || titel.trim() === "") {
      throw badRequest("felder-fehlen", "Fields dateiId and titel are required.");
    }
    void reply.code(201);
    return legeDokumentAn(ctx.db, req.params.id, {
      dateiId,
      titel,
      beschreibung: typeof beschreibung === "string" ? beschreibung : null,
    });
  });

  app.post<{ Params: { id: string }; Body: { url?: unknown; titel?: unknown } }>(
    "/api/exponate/:id/links",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      verlangeExponatBearbeiten(ctx, req, req.params.id);
      const { url, titel } = req.body ?? {};
      if (
        typeof url !== "string" ||
        typeof titel !== "string" ||
        url.trim() === "" ||
        titel.trim() === ""
      ) {
        throw badRequest("felder-fehlen", "Fields url and titel are required.");
      }
      void reply.code(201);
      return legeLinkAn(ctx.db, req.params.id, { url, titel });
    },
  );

  /**
   * Weist dem Exponat einen **vorhandenen** Ansprechpartner zu.
   *
   * Angelegt werden sie unter `/api/ansprechpartner`: sie sind Stammdaten, die mehrere
   * Exponate teilen koennen.
   */
  app.post<{ Params: { id: string }; Body: { ansprechpartnerId?: unknown } }>(
    "/api/exponate/:id/ansprechpartner",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      verlangeExponatBearbeiten(ctx, req, req.params.id);
      const ansprechpartnerId = req.body?.ansprechpartnerId;
      if (typeof ansprechpartnerId !== "string" || ansprechpartnerId === "") {
        throw badRequest("feld-fehlt", "Field ansprechpartnerId is required.");
      }
      void reply.code(201);
      return weiseZu(ctx.db, req.params.id, ansprechpartnerId);
    },
  );

  /**
   * Wie viele Besucher ein Loeschen betrifft.
   *
   * Die Oberflaeche fragt das **vor** dem Loeschen und nennt die Zahl in der Rueckfrage.
   */
  app.get<{ Params: { id: string; art: string; zielId: string } }>(
    "/api/exponate/:id/inhalte/:art/:zielId/betroffene",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      verlangeExponatBearbeiten(ctx, req, req.params.id);
      return { betroffene: betroffeneBesucher(ctx.db, alsArt(req.params.art), req.params.zielId) };
    },
  );

  app.delete<{ Params: { id: string; art: string; zielId: string } }>(
    "/api/exponate/:id/inhalte/:art/:zielId",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      verlangeExponatBearbeiten(ctx, req, req.params.id);
      loescheInhalt(ctx.db, req.params.id, alsArt(req.params.art), req.params.zielId);
      void reply.code(204);
      return null;
    },
  );
}
