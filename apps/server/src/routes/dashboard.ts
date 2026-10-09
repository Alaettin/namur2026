import { asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  ansprechpartner,
  appNutzer,
  besucher,
  exponatDokumente,
  exponatLinks,
  exponate,
  zuordnungen,
} from "../db/schema.js";
import { badRequest, unauthorized } from "../errors.js";
import type { Kontext } from "../kontext.js";
import { saeAus } from "../services/aussaat.js";
import { endpunktListe, fuehreProbeAus } from "../services/probe.js";
import {
  SCHLUESSEL_ANMELDUNG,
  SCHLUESSEL_CARRERA,
  anmeldungVerlangt,
  carreraAnmeldungVerlangt,
  setzeSchalter,
} from "../services/einstellungen.js";
import { FELDER_BESUCHER, baueModell } from "../modell/modell.js";
import { listeExponate } from "../services/exponate.js";

/**
 * Dashboard und der Bildschirm API.
 *
 * Beide nur fuer Admins: ein Betreuer sieht laut Uebergabe allein seine Exponate.
 */
export function dashboardRoutes(app: FastifyInstance, ctx: Kontext): void {
  app.get("/api/dashboard", { preHandler: app.verlangeAdmin }, async () => {
    const besucherGesamt =
      ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(besucher)
        .get()?.n ?? 0;
    const exponateGesamt =
      ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(exponate)
        .get()?.n ?? 0;
    /*
     * **Personal: Admins und Betreuer zusammen.** Die Zahl sagt, wie viele Zugaenge es
     * gibt, nicht wie viele gerade am Stand stehen; deaktivierte zaehlen mit, weil sie
     * weiterhin Zugaenge sind.
     */
    const personalGesamt =
      ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(appNutzer)
        .get()?.n ?? 0;

    const dokumenteGesamt =
      ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(exponatDokumente)
        .get()?.n ?? 0;
    const linksGesamt =
      ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(exponatLinks)
        .get()?.n ?? 0;
    /*
     * **Angelegte Personen, nicht Zuweisungen.** Wer an drei Exponaten steht, zaehlt
     * einmal. Das passt zu den Kacheln darueber, die ebenfalls Bestaende zaehlen; die
     * Zuweisungen stehen in `exponat_ansprechpartner` und waeren eine andere Zahl.
     */
    const ansprechpartnerGesamt =
      ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(ansprechpartner)
        .get()?.n ?? 0;

    const jeExponat = listeExponate(ctx.db).map((e) => ({
      id: e.id,
      kennung: e.kennung,
      name: e.name,
      zuordnungen:
        ctx.db
          .select({ n: sql<number>`count(*)` })
          .from(zuordnungen)
          .where(eq(zuordnungen.exponatId, e.id))
          .get()?.n ?? 0,
    }));

    return {
      kennzahlen: {
        besucherGesamt,
        exponateGesamt,
        personalGesamt,
        dokumenteGesamt,
        linksGesamt,
        ansprechpartnerGesamt,
      },
      jeExponat,
    };
  });

  /**
   * Der Bildschirm API.
   *
   * **Das Passwort wird nicht angezeigt**, nur der Benutzername und der Hinweis, wo es
   * steht. Eine Seite hinter der Anmeldung ist kein Grund, ein Geheimnis auszugeben.
   */
  app.get("/api/konnektor/info", { preHandler: app.verlangeAdmin }, async () => {
    const felder = baueModell(ctx.db);
    const exponateGesamt =
      ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(exponate)
        .get()?.n ?? 0;

    return {
      basisUrl: `${ctx.env.publicBaseUrl ?? ""}/connector`,
      basicUser: ctx.env.connectorBasic?.user ?? null,
      basicGesetzt: ctx.env.connectorBasic !== null,
      anmeldungVerlangt: anmeldungVerlangt(ctx.db),
      specVersion: "1.0.0",
      /*
       * **Die Bahn hat eigene Zugangsdaten und einen eigenen Schalter.** Wer den Konnektor
       * zumacht, will nicht zwangslaeufig den Partner an der Bahn aussperren, und
       * umgekehrt. Das Passwort steht auch hier nicht in der Antwort.
       */
      carrera: {
        basisUrl: `${ctx.env.publicBaseUrl ?? ""}/carrera`,
        basicUser: ctx.env.carreraBasic?.user ?? null,
        basicGesetzt: ctx.env.carreraBasic !== null,
        anmeldungVerlangt: carreraAnmeldungVerlangt(ctx.db),
      },
      endpunkte: endpunktListe(),
      /*
       * Eine echte GUID aus dem Bestand als Vorbelegung des Pruefstands. Ohne sie tippt
       * man erst eine ab, bevor man ueberhaupt etwas sieht.
       */
      beispielGuid:
        ctx.db
          .select({ guid: besucher.guid })
          .from(besucher)
          // **Nach Anlagezeitpunkt**, sonst liefert SQLite irgendeine Zeile und das war
          // zuletzt ein Rueckstand aus einem Pruefauf, nicht der erste echte Besucher.
          .orderBy(asc(besucher.angelegt))
          .limit(1)
          .get()?.guid ?? null,
      modell: {
        datenpunkte: felder.length,
        jeBesucher: FELDER_BESUCHER,
        exponate: exponateGesamt,
      },
    };
  });

  /**
   * Legt den Schalter um, ob die Konnektor-API eine Anmeldung verlangt.
   *
   * **Nur fuer Admins.** Der Schalter entscheidet, ob die Besucherdaten aller Teilnehmer
   * ohne Anmeldung abrufbar sind; wer ihn umlegen darf, muss selbst angemeldet sein.
   */
  app.patch<{ Body: { anmeldungVerlangt?: unknown } }>(
    "/api/konnektor/zugang",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      const wert = req.body?.anmeldungVerlangt;
      if (typeof wert !== "boolean") {
        throw badRequest("felder-fehlen", "Field anmeldungVerlangt must be a boolean.");
      }
      setzeSchalter(ctx.db, SCHLUESSEL_ANMELDUNG, wert);
      return { anmeldungVerlangt: wert };
    },
  );

  /**
   * Derselbe Schalter fuer die Schnittstelle der Carrera-Bahn.
   *
   * Eigene Route statt eines Feldes an der vorhandenen: beide Schalter zusammen in einem
   * Aufruf hiesse, dass ein unbedacht mitgesendetes Feld den jeweils anderen umlegt.
   */
  app.patch<{ Body: { anmeldungVerlangt?: unknown } }>(
    "/api/carrera/zugang",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      const wert = req.body?.anmeldungVerlangt;
      if (typeof wert !== "boolean") {
        throw badRequest("felder-fehlen", "Field anmeldungVerlangt must be a boolean.");
      }
      setzeSchalter(ctx.db, SCHLUESSEL_CARRERA, wert);
      return { anmeldungVerlangt: wert };
    },
  );

  /**
   * Einen Konnektor-Endpunkt ausfuehren und die Antwort zuruecksenden.
   *
   * **Nur fuer Admins**, und nur die neun festen Endpunkte: der Rumpf nennt eine Kennung,
   * keinen Pfad. Siehe `services/probe.ts`, dort steht die Begruendung.
   */
  app.post<{ Body: { endpunkt?: unknown; guid?: unknown; rumpf?: unknown } }>(
    "/api/konnektor/probe",
    { preHandler: app.verlangeAdmin },
    async (req) => {
      const { endpunkt, guid, rumpf } = req.body ?? {};
      if (typeof endpunkt !== "string") {
        throw badRequest("endpunkt-fehlt", "Field endpunkt must be a string.");
      }
      return fuehreProbeAus(
        app,
        ctx.db,
        ctx.env,
        endpunkt,
        typeof guid === "string" ? guid : undefined,
        typeof rumpf === "string" ? rumpf : undefined,
      );
    },
  );

  /**
   * Beispieldaten einspielen. Angemeldet und nur fuer Admins, **nie** oeffentlich.
   *
   * Laeuft nur auf einem Bestand ohne Exponate und meldet sonst einen Konflikt: ein
   * zweiter Lauf wuerde die Kennungen doppelt vergeben und mittendrin abbrechen.
   */
  app.post("/api/aussaat", { preHandler: app.verlangeAdmin }, async (req) => {
    const nutzer = req.nutzer;
    if (nutzer === null) throw unauthorized();
    /*
     * Kein try/catch hier. `saeAus` wirft bereits den richtigen `AppError`, und ein
     * Sammel-catch machte aus **jedem** Fehler einen Konflikt, auch aus einem Schreibfehler
     * der Ablage: der Beweis fuer die eigentliche Ursache waere damit verschluckt.
     */
    return saeAus(ctx.db, ctx.ablage, nutzer.id);
  });
}
