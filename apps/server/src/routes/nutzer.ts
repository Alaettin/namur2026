import type { FastifyInstance } from "fastify";
import { badRequest } from "../errors.js";
import type { Kontext } from "../kontext.js";
import {
  aendereNutzer,
  exponateVonNutzer,
  legeNutzerAn,
  listeNutzer,
  setzeAktiv,
  setzeExponateVonNutzer,
  setzePasswort,
  type Rolle,
} from "../services/nutzer.js";

function alsRolle(wert: unknown): Rolle {
  if (wert !== "admin" && wert !== "betreuer") {
    throw badRequest("rolle-ungueltig", 'Field rolle must be "admin" or "betreuer".');
  }
  return wert;
}

function alsText(feld: string, wert: unknown, maxLaenge = 200): string {
  if (typeof wert !== "string" || wert.trim() === "") {
    throw badRequest("feld-fehlt", `Field ${feld} is required.`);
  }
  if (wert.length > maxLaenge) {
    throw badRequest("feld-zu-lang", `Field ${feld} is longer than ${String(maxLaenge)} chars.`);
  }
  return wert;
}

/**
 * Nutzerverwaltung, vollstaendig fuer Admins.
 *
 * Alle Routen haengen an `verlangeAdmin`. Ein Betreuer bekommt 403, nicht 404: anders als
 * bei Exponaten ist hier nichts zu verbergen, die Existenz einer Nutzerverwaltung ist
 * keine Auskunft.
 */
export function nutzerRoutes(app: FastifyInstance, ctx: Kontext): void {
  app.get("/api/nutzer", { preHandler: app.verlangeAdmin }, async () =>
    listeNutzer(ctx.db).map((n) => ({ ...n, exponate: exponateVonNutzer(ctx.db, n.id) })),
  );

  app.post<{ Body: { name?: unknown; email?: unknown; rolle?: unknown; exponate?: unknown } }>(
    "/api/nutzer",
    { preHandler: app.verlangeAdmin },
    async (req, reply) => {
      const { name, email, rolle, exponate } = req.body ?? {};
      const { nutzer, startpasswort } = await legeNutzerAn(ctx.db, {
        name: alsText("name", name),
        email: alsText("email", email),
        rolle: alsRolle(rolle),
      });
      if (Array.isArray(exponate)) {
        setzeExponateVonNutzer(
          ctx.db,
          nutzer.id,
          exponate.filter((e) => typeof e === "string"),
        );
      }
      // Das Startpasswort wird **hier und nur hier** zurueckgegeben. Es steht in keinem
      // Protokoll und laesst sich nicht noch einmal abrufen, nur neu setzen.
      void reply.code(201);
      return { ...nutzer, exponate: exponateVonNutzer(ctx.db, nutzer.id), startpasswort };
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: unknown; rolle?: unknown } }>(
    "/api/nutzer/:id",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      const { name, rolle } = req.body ?? {};
      return aendereNutzer(ctx.db, req.params.id, {
        ...(name !== undefined ? { name: alsText("name", name) } : {}),
        ...(rolle !== undefined ? { rolle: alsRolle(rolle) } : {}),
      });
    },
  );

  app.put<{ Params: { id: string }; Body: { exponate?: unknown } }>(
    "/api/nutzer/:id/exponate",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      const exponate = req.body?.exponate;
      if (!Array.isArray(exponate)) {
        throw badRequest("feld-fehlt", "Field exponate must be an array of ids.");
      }
      setzeExponateVonNutzer(
        ctx.db,
        req.params.id,
        exponate.filter((e): e is string => typeof e === "string"),
      );
      return { exponate: exponateVonNutzer(ctx.db, req.params.id) };
    },
  );

  /**
   * Passwort setzen oder erzeugen.
   *
   * Ohne Rumpf wird eines gewuerfelt, wie bisher. Mit `{ passwort }` wird genau dieses
   * gesetzt. Beides gibt den Wert **einmal** zurueck, damit die Oberflaeche denselben
   * Anzeigeweg nutzen kann.
   */
  app.post<{ Params: { id: string }; Body: { passwort?: unknown } }>(
    "/api/nutzer/:id/passwort",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      const wunsch = req.body?.passwort;
      if (wunsch !== undefined && typeof wunsch !== "string") {
        throw badRequest("passwort-ungueltig", "Field passwort must be a string.");
      }
      // Ein leeres Feld in der Oberflaeche heisst "erzeugen", nicht "leeres Passwort".
      const gewaehlt = typeof wunsch === "string" && wunsch !== "" ? wunsch : undefined;
      return { startpasswort: await setzePasswort(ctx.db, req.params.id, gewaehlt) };
    },
  );

  app.post<{ Params: { id: string }; Body: { aktiv?: unknown } }>(
    "/api/nutzer/:id/aktiv",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      const aktiv = req.body?.aktiv;
      if (typeof aktiv !== "boolean") {
        throw badRequest("feld-fehlt", "Field aktiv must be a boolean.");
      }
      return setzeAktiv(ctx.db, req.params.id, aktiv);
    },
  );
}
