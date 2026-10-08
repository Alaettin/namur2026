import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kontext } from "../kontext.js";
import { forbidden, unauthorized } from "../errors.js";
import { findeNutzerPerId } from "../services/nutzer.js";
import type { Nutzer } from "../services/nutzer.js";
import { readSession } from "./session.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Jede angemeldete Rolle. Wirft 401, wenn keine gueltige Sitzung vorliegt. */
    verlangeAnmeldung: (req: FastifyRequest) => Promise<void>;
    /** Nur Admins. Wirft 401 ohne Sitzung, 403 fuer Betreuer und Kiosk. */
    verlangeAdmin: (req: FastifyRequest) => Promise<void>;
    /**
     * Das Selbstbedienungs-Tablet. Laesst `kiosk` **und** `admin` durch.
     *
     * Der Admin ist dabei, damit sich der Ablauf ohne zweites Geraet pruefen laesst; ein
     * Betreuer bleibt draussen, denn die Rolle ist eng und nicht nur anders.
     */
    verlangeKiosk: (req: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    nutzer: Nutzer | null;
  }
}

/**
 * Haengt die Sitzungspruefung an die Instanz.
 *
 * Bewusst kein gekapseltes Plugin: die Dekoration soll auf der Wurzelinstanz liegen, damit
 * jede Route sie sieht.
 */
export async function installAuth(app: FastifyInstance, ctx: Kontext): Promise<void> {
  await app.register(cookie, { secret: ctx.env.sessionSecret });
  app.decorateRequest("nutzer", null);

  /**
   * **Der Nutzer wird bei jeder Anfrage nachgeschlagen, nicht aus dem Cookie gelesen.**
   *
   * Das Cookie traegt nur die Kennung. Stuenden Rolle und Status darin, waere beides bis
   * zu zwoelf Stunden alt: ein deaktivierter Nutzer bliebe angemeldet, und ein zum
   * Betreuer herabgestufter Admin behielte seine Rechte bis zum Ablauf. Die Zusage der
   * Uebergabe lautet aber, dass eine laufende Sitzung bei der naechsten Anfrage endet.
   *
   * Der Preis ist eine Abfrage je Anfrage auf einen Primaerschluessel in einer lokalen
   * SQLite-Datei. Das ist nicht messbar.
   */
  app.decorate("verlangeAnmeldung", async function (req: FastifyRequest) {
    const sitzung = readSession(req);
    if (sitzung === null) throw unauthorized();

    const reihe = findeNutzerPerId(ctx.db, sitzung.sub);
    if (reihe === null || !reihe.aktiv) throw unauthorized();

    req.nutzer = {
      id: reihe.id,
      name: reihe.name,
      email: reihe.email,
      rolle: reihe.rolle,
      aktiv: reihe.aktiv,
      angelegt: reihe.angelegt,
      zuletztAngemeldet: reihe.zuletztAngemeldet,
    };
    return Promise.resolve();
  });

  app.decorate("verlangeAdmin", async function (this: FastifyInstance, req: FastifyRequest) {
    await this.verlangeAnmeldung(req);
    if (req.nutzer?.rolle !== "admin") {
      throw forbidden("nur-admin", "This action requires the admin role.");
    }
  });

  app.decorate("verlangeKiosk", async function (this: FastifyInstance, req: FastifyRequest) {
    await this.verlangeAnmeldung(req);
    const rolle = req.nutzer?.rolle;
    if (rolle !== "kiosk" && rolle !== "admin") {
      throw forbidden("nur-kiosk", "This action requires the kiosk role.");
    }
  });
}
