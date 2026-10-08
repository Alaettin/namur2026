import type { FastifyInstance } from "fastify";
import { normalisiereEmail, pruefeInsLeere, pruefePasswort } from "../auth/passwort.js";
import { clearSession, issueSession } from "../auth/session.js";
import { anmeldungFalsch, badRequest } from "../errors.js";
import type { Kontext } from "../kontext.js";
import { findeNutzerPerEmail, merkeAnmeldung } from "../services/nutzer.js";

interface AnmeldeKoerper {
  email?: unknown;
  passwort?: unknown;
}

export function authRoutes(app: FastifyInstance, ctx: Kontext): void {
  app.post<{ Body: AnmeldeKoerper }>(
    "/api/auth/anmelden",
    {
      config: {
        /*
         * 10 Versuche je Viertelstunde, **je E-Mail** statt je IP.
         *
         * Je IP waere hier falsch herum: am Stand haengen alle Handys am selben WLAN und
         * damit an einer Adresse, ein Betreuer mit Tippfehler sperrte die ganze Mannschaft
         * aus. Die E-Mail trifft dagegen genau das Konto, auf das geraten wird.
         *
         * Fehlt sie im Rumpf, faellt der Schluessel auf die IP zurueck: ein Angreifer soll
         * die Grenze nicht dadurch umgehen koennen, dass er das Feld weglaesst.
         */
        rateLimit: {
          max: 10,
          timeWindow: "15 minutes",
          keyGenerator: (req: { body?: unknown; ip: string }) => {
            const email = (req.body as AnmeldeKoerper | undefined)?.email;
            return typeof email === "string" && email.trim() !== ""
              ? `anmeldung:${normalisiereEmail(email)}`
              : `anmeldung-ip:${req.ip}`;
          },
        },
      },
    },
    async (req, reply) => {
      const { email, passwort } = req.body ?? {};
      if (typeof email !== "string" || typeof passwort !== "string") {
        throw badRequest("felder-fehlen", "Fields email and passwort are required.");
      }

      const reihe = findeNutzerPerEmail(ctx.db, email);

      /*
       * **Auch ohne Treffer wird gehasht**, siehe `pruefeInsLeere`.
       *
       * Deaktivierte Nutzer laufen durch dieselbe Pruefung und bekommen dieselbe Meldung:
       * ob jemand gesperrt ist, geht die Anmeldemaske nichts an.
       */
      const stimmt =
        reihe === null
          ? await pruefeInsLeere(passwort)
          : await pruefePasswort(reihe.passwortHash, passwort);

      if (reihe === null || !reihe.aktiv || !stimmt) throw anmeldungFalsch();

      merkeAnmeldung(ctx.db, reihe.id);
      issueSession(req, reply, { sub: reihe.id, exp: Date.now() + ctx.env.sessionTtlMs }, ctx.env);
      return {
        id: reihe.id,
        name: reihe.name,
        email: reihe.email,
        rolle: reihe.rolle,
      };
    },
  );

  app.post("/api/auth/abmelden", async (req, reply) => {
    clearSession(req, reply);
    return { abgemeldet: true };
  });

  /**
   * Wer bin ich.
   *
   * Die Oberflaeche ruft das beim Start und richtet sich danach. Sie hat **keinen**
   * Zwischenspeicher im localStorage, der sofort rendert: der haette den Anmeldezustand
   * von gestern, und ein deaktivierter Nutzer saehe die Verwaltung aufblitzen.
   */
  app.get("/api/auth/ich", { preHandler: app.verlangeAnmeldung }, async (req) => {
    const nutzer = req.nutzer;
    return {
      id: nutzer?.id,
      name: nutzer?.name,
      email: nutzer?.email,
      rolle: nutzer?.rolle,
      appName: ctx.env.appName,
      viewerBaseUrl: ctx.env.viewerBaseUrl,
    };
  });
}
