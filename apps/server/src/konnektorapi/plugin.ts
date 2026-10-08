import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { besucher } from "../db/schema.js";
import type { Kontext } from "../kontext.js";
import { baueModell } from "../modell/modell.js";
import { leseAnfrage, nachAussen, sammleWerte } from "../modell/werte.js";
import { anmeldungVerlangt } from "../services/einstellungen.js";
import { pruefeBasic } from "./basic.js";
import {
  ApiFehler,
  itemUnbekannt,
  neueKorrelation,
  sendeResult,
  zuVieleFelder,
} from "./ergebnis.js";

/**
 * Die oeffentliche Konnektor-API unter `/connector/...`, nach Spec 1.0.0.
 *
 * Sie ist der Grund, warum es diese Anwendung gibt: Axon traegt die Basis-Adresse ein und
 * ruft danach auf, ohne Handbuch und ohne Rueckfrage. Laut Axon-Dokumentation ruft **jeder
 * Aufruf im Viewer** `hierarchy`, `values` und `documents` live ab; darauf beruht die
 * Zusage "sofort im Viewer".
 *
 * **Die Handler stehen bewusst in einer Datei.** Jeder ist ein Dutzend Zeilen, die Arbeit
 * liegt in `modell/`. Neun Dateien mit je einer Funktion waeren eine Ordnerstruktur, die
 * mehr verspricht als sie traegt.
 */

/**
 * Hoechstens so viele `propertyIds` je Aufruf.
 *
 * Der AXON Connector setzt 500. Hier ist der Wert hoeher, weil die Zahl der Exponate nicht
 * feststeht: ein Besucher mit Zuordnungen an zwoelf Exponaten kaeme bei 107 Datenpunkten
 * je Exponat sonst ueber die Grenze, und die Grenze soll vor einer Antwort schuetzen, die
 * im Speicher explodiert, nicht vor dem gewoehnlichen Fall.
 */
const HOECHSTZAHL_FELDER = 2000;

/** So lange darf ein Aufruf laufen, danach bricht der Dienst ihn ab. */
const ZEITGRENZE_MS = 30_000;

/** Die Fassung der Spezifikation, gegen die gebaut wurde. */
const SPEC_VERSION = "1.0.0";

/**
 * Die eine Hierarchieebene. Mehr gibt es hier nicht.
 *
 * **Zwei Namen, nicht einer.** Die Spezifikation meint damit Verschiedenes: `levels` nennt
 * den Namen der **Ebene** ("Human-readable level name shown to content admins"), die
 * beiden Hierarchie-Endpunkte den Namen des **Knotens**. Bis zum 08.10.2026 stand hier ein
 * gemeinsames Feld, und die Ebene hiess deshalb "Veranstaltung", der Knoten "NAMUR HV 2026".
 */
const EBENE_NR = 1;

/** Wie die Ebene in Axon heisst, fuer `/product/hierarchy/levels`. */
const EBENE_NAME = "Asset";

/** Wie der Knoten heisst, unter dem **jeder** Besucher haengt. */
const KNOTEN_NAME = "Besucher";

interface Pfadteile {
  itemId?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    korrelation: string;
  }
}

export function konnektorApiRoutes(app: FastifyInstance, ctx: Kontext): void {
  app.register((scope, _opts, fertig) => {
    scope.decorateRequest("korrelation", "");

    /*
     * Die Ratenbegrenzung haengt an der Adresse, weil es hier nur **eine** Gegenstelle
     * gibt. Im AXON Connector zaehlt sie je Schluessel, weil dort viele Kunden aus einem
     * Rechenzentrum rufen koennen; dieser Dienst bedient genau eine Axon-Instanz.
     */
    const grenzen = { rateLimit: { max: 600, timeWindow: "1 minute" } };

    scope.addHook("preHandler", (req, _reply, weiter) => {
      req.korrelation = neueKorrelation();
      /*
       * `/health` ist immer anonym, sonst meldete der Dienst sich selbst als krank.
       *
       * Alles andere verlangt Basic, **solange der Schalter an ist**. Er steht per Vorgabe
       * auf aus; dann ist die Schnittstelle ohne Anmeldung erreichbar. Das ist die
       * Entscheidung des Nutzers vom 08.10.2026, siehe `services/einstellungen.ts`. Der
       * Schalter wird bei **jeder** Anfrage gelesen, nicht beim Start zwischengespeichert:
       * ein Umlegen in der Oberflaeche muss sofort gelten, sonst sperrt man etwas ab und
       * es ist weiter offen.
       */
      if (!req.url.startsWith("/connector/health") && anmeldungVerlangt(ctx.db)) {
        pruefeBasic(req, ctx.env);
      }
      weiter();
    });

    /*
     * Der Fehlerhandler dieses Geltungsbereichs. Die oeffentliche API antwortet mit
     * `Result`, die Verwaltung mit `{code, message}`: zwei Vertraege, zwei Formen, und sie
     * duerfen nicht ineinanderlaufen.
     */
    scope.setErrorHandler((fehler, req, reply) => {
      const korrelation = req.korrelation === "" ? neueKorrelation() : req.korrelation;
      if (fehler instanceof ApiFehler) {
        req.log.info({ code: fehler.code, korrelation }, fehler.message);
        if (fehler.statusCode === 401) {
          // Ohne diesen Kopf ist die 401 nach RFC 7235 unvollstaendig.
          void reply.header("www-authenticate", 'Basic realm="connector", charset="UTF-8"');
        }
        return sendeResult(reply, fehler, korrelation);
      }
      /*
       * Fastify und seine Plugins melden manches selbst: zu grosse Rumpfe, kaputtes JSON,
       * die Ratenbegrenzung. Auch diese Antworten brauchen einen brauchbaren `code`, denn
       * er ist das Maschinenlesbare. Ein Sammelcode `bad-request` fuer eine
       * Ratenbegrenzung liesse die Gegenseite raten, ob sie ihre Anfrage reparieren oder
       * nur langsamer fragen muss.
       */
      const mitStatus = fehler as { statusCode?: number; message?: string };
      const status = mitStatus.statusCode ?? 500;
      const text = mitStatus.message ?? "Bad request.";
      if (status < 500) {
        req.log.info({ korrelation, status }, text);
        const code =
          status === 429
            ? "rate-limit"
            : status === 413
              ? "payload-too-large"
              : status === 415
                ? "unsupported-media-type"
                : "bad-request";
        const schwere = status === 429 ? "Warning" : "Error";
        return sendeResult(reply, new ApiFehler(status, code, text, schwere), korrelation);
      }
      req.log.error({ err: fehler, korrelation }, "Fehler in der Konnektor-API");
      return sendeResult(
        reply,
        new ApiFehler(500, "internal-error", "Unexpected error.", "Exception"),
        korrelation,
      );
    });

    const wurzel = "/connector";

    /*
     * `GET /health`: 200 ohne Rumpf, 5XX bei Stoerung. Der Inhalt wird nicht gelesen, nur
     * der Status. Ein echter Zugriff auf die Datenbank, nicht nur "der Prozess laeuft":
     * sonst meldet der Endpunkt Gesundheit, waehrend das Volume fehlt.
     */
    scope.get(`${wurzel}/health`, { config: grenzen }, (_req, reply) => {
      ctx.db.get(sql`select 1`);
      return reply.code(200).send();
    });

    scope.get(`${wurzel}/versions`, { config: grenzen }, () => ({
      spec: { version: SPEC_VERSION },
      application: { version: __APP_VERSION__ },
    }));

    scope.get(`${wurzel}/model`, { config: grenzen }, (_req, reply) => {
      const felder = baueModell(ctx.db);
      setzeEtag(reply, felder.length);
      return felder;
    });

    scope.get(`${wurzel}/product/ids`, { config: grenzen }, () =>
      ctx.db
        .select({ guid: besucher.guid })
        .from(besucher)
        .all()
        .map((b) => b.guid),
    );

    scope.get(`${wurzel}/product/hierarchies`, { config: grenzen }, () => [
      { level: EBENE_NR, name: KNOTEN_NAME, children: [] },
    ]);

    scope.get(`${wurzel}/product/hierarchy/levels`, { config: grenzen }, () => [
      { level: EBENE_NR, name: EBENE_NAME },
    ]);

    scope.get(`${wurzel}/product/:itemId/hierarchy`, { config: grenzen }, (req) => {
      const guid = itemIdAus(req);
      if (!besucherVorhanden(ctx, guid)) throw itemUnbekannt(guid);
      return [{ level: EBENE_NR, name: KNOTEN_NAME }];
    });

    scope.post(`${wurzel}/product/:itemId/values`, { config: grenzen }, async (req) => {
      const guid = itemIdAus(req);
      if (!besucherVorhanden(ctx, guid)) throw itemUnbekannt(guid);

      const anfrage = leseAnfrage(req.body);
      const gefragt = anfrage.mitSprache.length + anfrage.ohneSprache.length;
      if (gefragt > HOECHSTZAHL_FELDER) throw zuVieleFelder(HOECHSTZAHL_FELDER);

      const alle = sammleWerte(ctx.db, guid);
      const gewuenscht = anfrage.allesLiefern
        ? alle
        : alle.filter(
            (w) =>
              anfrage.mitSprache.includes(w.propertyId) ||
              anfrage.ohneSprache.includes(w.propertyId),
          );

      return await nachAussen(ctx.db, ctx.ablage, gewuenscht, {
        alsDokumente: false,
        ohneSprache: new Set(anfrage.ohneSprache),
      });
    });

    scope.post(`${wurzel}/product/:itemId/documents`, { config: grenzen }, async (req) => {
      const guid = itemIdAus(req);
      if (!besucherVorhanden(ctx, guid)) throw itemUnbekannt(guid);

      /*
       * Der Rumpf ist `PropertiesWithLanguage`, und `propertyIds` traegt hier laut Spec die
       * **Ticketwerte**. Weil unser Ticket die `propertyId` ist, ist das dasselbe Feld mit
       * derselben Bedeutung, und die Zuordnungsluecke der Spec entfaellt.
       */
      const koerper = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<
        string,
        unknown
      >;
      const tickets = Array.isArray(koerper["propertyIds"])
        ? (koerper["propertyIds"] as unknown[]).filter((t): t is string => typeof t === "string")
        : [];
      if (tickets.length > HOECHSTZAHL_FELDER) throw zuVieleFelder(HOECHSTZAHL_FELDER);

      const gesucht = new Set(tickets);
      const zeilen = sammleWerte(ctx.db, guid).filter(
        (w) => w.dateiId !== null && gesucht.has(w.propertyId),
      );

      return await nachAussen(ctx.db, ctx.ablage, zeilen, {
        alsDokumente: true,
        ohneSprache: new Set<string>(),
      });
    });

    /*
     * Ein unbekannter Pfad unterhalb von `/connector`.
     *
     * Nicht nur ein nackter 404: der haeufigste Fall ist die Gross- und Kleinschreibung.
     * Der Guide schreibt an mehreren Stellen `/Product/{itemId}/values` mit grossem P, die
     * Pfade der Spec sind klein. Wer das trifft, soll es aus der Antwort erfahren und nicht
     * aus einer Fehlersuche ueber zwei Haeuser.
     */
    scope.all(`${wurzel}/*`, { config: grenzen }, (req) => {
      const rest = (req.params as Record<string, string>)["*"] ?? "";
      const klein = rest.toLowerCase();
      const hinweis = klein !== rest ? ` Paths are lower-case, did you mean "/${klein}"?` : "";
      throw new ApiFehler(404, "unknown-path", `No endpoint "/${rest}".${hinweis}`);
    });

    fertig();
  });

  // Die Zeitgrenze gilt fuer den ganzen Dienst; Fastify kennt sie nur je Instanz.
  app.server.requestTimeout = ZEITGRENZE_MS;
}

/**
 * Die `itemId` aus dem Pfad.
 *
 * `decodeURIComponent`, weil eine GUID laut Spec URL-kodierbar sein muss und Axon sie
 * kodiert anhaengt.
 */
function itemIdAus(req: FastifyRequest): string {
  const roh = (req.params as Pfadteile).itemId ?? "";
  try {
    return decodeURIComponent(roh);
  } catch {
    // Eine kaputte Kodierung ist keine bekannte itemId, aber auch kein Serverfehler.
    return roh;
  }
}

function besucherVorhanden(ctx: Kontext, guid: string): boolean {
  return (
    ctx.db.select({ guid: besucher.guid }).from(besucher).where(eq(besucher.guid, guid)).get() !==
    undefined
  );
}

/**
 * Ein ETag ueber die Zahl der Datenpunkte.
 *
 * `/model` aendert sich nur, wenn ein Exponat dazukommt, verschwindet oder seine Kennung
 * wechselt. Ein ETag spart der Gegenseite die Antwort, nicht die Anfrage, und das ist bei
 * einem Modell mit tausend Eigenschaften bereits der groessere Teil.
 */
function setzeEtag(reply: FastifyReply, anzahl: number): void {
  void reply.header("etag", `W/"modell-${String(anzahl)}"`);
}
