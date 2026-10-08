import type { FastifyInstance } from "fastify";
import type { ServerEnv } from "../env.js";
import { badRequest } from "../errors.js";
import { anmeldungVerlangt } from "./einstellungen.js";
import type { Db } from "../db/client.js";

/**
 * Der Pruefstand hinter der Seite API: einen Konnektor-Endpunkt aufrufen und die Antwort
 * zeigen, wie auf einer Swagger-Seite.
 *
 * **Warum das der Server tut und nicht der Browser.** Ist die Anmeldung eingeschaltet,
 * braeuchte der Browser die Basic-Zugangsdaten, und das Passwort wird auf dieser Seite
 * bewusst nie ausgegeben. Der Server kennt es und haengt den Kopf selbst an.
 *
 * **Warum ueber `app.inject` und nicht ueber HTTP.** Kein Netzwerk, kein Port, keine zweite
 * Vertrauensgrenze. Es ist trotzdem ein echter Durchlauf durch die Route samt Anmeldung,
 * Ratenbegrenzung und Fehlerbehandlung; der Pruefstand zeigt also genau das, was Axon
 * bekaeme, und nicht das Ergebnis eines nachgebauten Aufrufs.
 */

/** Ein Platzhalter im Pfad, der durch die eingegebene GUID ersetzt wird. */
const GUID_PLATZ = "{guid}";

interface Endpunkt {
  readonly methode: "GET" | "POST";
  readonly pfad: string;
  /** Braucht eine GUID im Pfad. */
  readonly guid: boolean;
  /** Nimmt einen JSON-Rumpf an; der Text ist der Vorschlag in der Oberflaeche. */
  readonly rumpfVorschlag: string | null;
}

/**
 * Die neun Endpunkte, **fest verdrahtet**.
 *
 * Der Aufruf nennt nur eine Kennung daraus; Methode und Pfad bildet der Server. Naehme der
 * Endpunkt eine frei waehlbare URL entgegen und riefe sie ab, waere das eine SSRF-Luecke,
 * und ein Admin-Konto ist kein Grund, sie aufzumachen.
 */
export const ENDPUNKTE: Readonly<Record<string, Endpunkt>> = {
  health: { methode: "GET", pfad: "/connector/health", guid: false, rumpfVorschlag: null },
  versions: { methode: "GET", pfad: "/connector/versions", guid: false, rumpfVorschlag: null },
  model: { methode: "GET", pfad: "/connector/model", guid: false, rumpfVorschlag: null },
  "hierarchy-levels": {
    methode: "GET",
    pfad: "/connector/product/hierarchy/levels",
    guid: false,
    rumpfVorschlag: null,
  },
  hierarchies: {
    methode: "GET",
    pfad: "/connector/product/hierarchies",
    guid: false,
    rumpfVorschlag: null,
  },
  hierarchy: {
    methode: "GET",
    pfad: `/connector/product/${GUID_PLATZ}/hierarchy`,
    guid: true,
    rumpfVorschlag: null,
  },
  values: {
    methode: "POST",
    pfad: `/connector/product/${GUID_PLATZ}/values`,
    guid: true,
    // Ein leerer Rumpf liefert alles; so sieht man ohne Vorwissen etwas.
    rumpfVorschlag: "{}",
  },
  documents: {
    methode: "POST",
    pfad: `/connector/product/${GUID_PLATZ}/documents`,
    guid: true,
    rumpfVorschlag: '{\n  "propertyIds": []\n}',
  },
  ids: { methode: "GET", pfad: "/connector/product/ids", guid: false, rumpfVorschlag: null },
};

/** Was die Oberflaeche braucht, um die Formulare zu bauen. */
export function endpunktListe() {
  return Object.entries(ENDPUNKTE).map(([kennung, e]) => ({
    kennung,
    methode: e.methode,
    /*
     * **Der Pfad zum Anzeigen, ohne `/connector`.** Die Basis-Adresse oben auf der Seite
     * endet bereits darauf, der Zusatz stand also doppelt da.
     *
     * Das Feld heisst ausdruecklich nicht `pfad`: der ausfuehrbare Pfad bleibt in
     * `ENDPUNKTE` und verlaesst den Server nicht. Ein `pfad`, der nicht der echte Pfad
     * ist, fuehrt spaeter jemanden in die Irre.
     */
    anzeigePfad: e.pfad.replace(/^\/connector/, ""),
    guid: e.guid,
    rumpfVorschlag: e.rumpfVorschlag,
  }));
}

export interface Probeergebnis {
  status: number;
  dauerMs: number;
  contentType: string | null;
  koerper: string;
  groesse: number;
  gekuerzt: boolean;
}

/**
 * Ab hier wird gekuerzt.
 *
 * Das Modell wiegt auch verschlankt rund 72 KB, `values` mit Foto gut 60. Eine halbe
 * Antwort darf nicht wie eine ganze aussehen, deshalb meldet das Ergebnis die Kuerzung
 * ausdruecklich und nennt die volle Groesse.
 */
const HOECHSTLAENGE = 256 * 1024;

/**
 * Fuehrt einen der festen Endpunkte aus.
 *
 * Wirft `badRequest`, wenn die Kennung unbekannt ist oder eine noetige GUID fehlt. Alles
 * andere ist das Ergebnis des Aufrufs, auch ein 401 oder 404: der Pruefstand soll zeigen,
 * was passiert, nicht beschoenigen.
 */
export async function fuehreProbeAus(
  app: FastifyInstance,
  db: Db,
  env: ServerEnv,
  kennung: string,
  guid: string | undefined,
  rumpf: string | undefined,
): Promise<Probeergebnis> {
  const endpunkt = Object.hasOwn(ENDPUNKTE, kennung) ? ENDPUNKTE[kennung] : undefined;
  if (endpunkt === undefined) {
    throw badRequest("endpunkt-unbekannt", `Unknown endpoint "${kennung}".`);
  }

  let pfad = endpunkt.pfad;
  if (endpunkt.guid) {
    const wert = guid?.trim() ?? "";
    if (wert === "") throw badRequest("guid-fehlt", "Field guid is required for this endpoint.");
    pfad = pfad.replace(GUID_PLATZ, encodeURIComponent(wert));
  }

  /*
   * Der Rumpf geht als **Text** hinaus, nicht als geparstes Objekt: so bekommt die Route
   * genau das, was eingetippt wurde. Geparst wird trotzdem, aber nur zum Pruefen; ein
   * kaputtes JSON soll hier auffallen und nicht als 400 aus der Route zurueckkommen.
   */
  let koerperText = "{}";
  if (endpunkt.methode === "POST") {
    const text = rumpf?.trim() ?? "";
    if (text !== "") {
      try {
        JSON.parse(text);
      } catch (ursache) {
        throw badRequest(
          "rumpf-kein-json",
          `Body is not valid JSON: ${(ursache as Error).message}`,
        );
      }
      koerperText = text;
    }
  }

  /*
   * Der Basic-Kopf nur, wenn die Anmeldung eingeschaltet **und** etwas gesetzt ist. Sonst
   * bewusst ohne: dann zeigt der Pruefstand denselben 401, den Axon bekaeme.
   */
  const kopf: Record<string, string> = {};
  if (anmeldungVerlangt(db) && env.connectorBasic !== null) {
    const roh = `${env.connectorBasic.user}:${env.connectorBasic.passwort}`;
    kopf["authorization"] = `Basic ${Buffer.from(roh, "utf8").toString("base64")}`;
  }

  /*
   * Zwei Zweige statt eines Aufrufs mit bedingtem `payload`: ein zusammengesetztes Objekt
   * loest die Ueberladung von `inject` nicht mehr auf, und TypeScript bietet dann die
   * Kettenform an, die kein `statusCode` hat.
   */
  const begonnen = Date.now();
  const antwort =
    endpunkt.methode === "POST"
      ? await app.inject({
          method: "POST",
          url: pfad,
          headers: { ...kopf, "content-type": "application/json" },
          payload: koerperText,
        })
      : await app.inject({ method: "GET", url: pfad, headers: kopf });
  const dauerMs = Date.now() - begonnen;

  const voll = antwort.body;
  return {
    status: antwort.statusCode,
    dauerMs,
    contentType: antwort.headers["content-type"]?.toString() ?? null,
    koerper: voll.length > HOECHSTLAENGE ? voll.slice(0, HOECHSTLAENGE) : voll,
    groesse: voll.length,
    gekuerzt: voll.length > HOECHSTLAENGE,
  };
}
