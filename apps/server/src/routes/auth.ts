import type { FastifyInstance } from "fastify";
import { pruefeInsLeere, pruefePasswort } from "../auth/passwort.js";
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
      /*
       * **Keine Anmeldegrenze.** Bis zum 09.10.2026 standen hier 10 Versuche je
       * Viertelstunde und E-Mail. Auf ausdrueckliche Entscheidung entfernt: am Stand
       * sperrte sie einen Betreuer mit Tippfehler fuer eine Viertelstunde aus, und sie
       * legte wiederholt die eigene Abnahme lahm.
       *
       * **Was damit wegfaellt:** das Durchprobieren von Passwoertern ist jetzt
       * unbegrenzt. Wer eine Betreuer-E-Mail kennt, kann beliebig raten. Geblieben sind
       * argon2id beim Hashen und die gleiche Fehlermeldung fuer jeden Fall, also kein
       * Hinweis darauf, ob eine Adresse existiert.
       */
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
