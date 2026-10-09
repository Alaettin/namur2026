import type { FastifyInstance } from "fastify";
import type { ServerEnv } from "../env.js";
import { badRequest } from "../errors.js";
import { anmeldungVerlangt, carreraAnmeldungVerlangt } from "./einstellungen.js";
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

/**
 * Zu welcher Schnittstelle ein Endpunkt gehoert.
 *
 * Bestimmt zweierlei: unter welcher Ueberschrift er auf der Seite API steht, und
 * **welche Zugangsdaten** der Pruefstand anhaengt. Die beiden Schnittstellen gehoeren
 * verschiedenen Partnern und haben eigene Schalter.
 */
export type Gruppe = "konnektor" | "carrera";

interface Endpunkt {
  readonly gruppe: Gruppe;
  readonly methode: "GET" | "POST" | "DELETE";
  readonly pfad: string;
  /** Braucht eine Kennung im Pfad. */
  readonly guid: boolean;
  /** Wie diese Kennung heisst. Ohne Angabe eine GUID, denn das ist sie fast ueberall. */
  readonly guidFeld?: string;
  /** Nimmt einen JSON-Rumpf an; der Text ist der Vorschlag in der Oberflaeche. */
  readonly rumpfVorschlag: string | null;
}

/**
 * Der Vorschlag im Formular: ein vollstaendiger Datensatz, wie die Bahn ihn schickt.
 *
 * Mit allen Feldern aus der Mail des Entwicklers, damit jemand am Stand sofort sieht, was
 * erwartet wird, statt die Mail zu suchen.
 */
const BEISPIELRUNDE = JSON.stringify(
  {
    lap_id: "8af90dec-c04e-45a4-907d-e684ec735af5",
    race_id: "fc7bd88d-eb8c-42c1-a722-e07377863972",
    event_id: "Hauptversammlung-2026",
    event_name: "Hauptversammlung 2026",
    identity_namespace: "PF-CA-1",
    participant_id: "NHV2026-0001",
    pseudonym: "Racing Fox",
    is_anonymous: 0,
    lane_number: 3,
    target_lap_count: 3,
    installation_label: "Messestand 123",
    lap_number: 2,
    started_utc_ms: 1790858096000,
    local_date: "2026-11-25",
    local_utc_offset_minutes: 120,
    duration_ms: 4827,
    deleted_utc_ms: null,
    deletion_reason: null,
  },
  null,
  2,
);

/**
 * Die Endpunkte beider Schnittstellen, **fest verdrahtet**.
 *
 * Der Aufruf nennt nur eine Kennung daraus; Methode und Pfad bildet der Server. Naehme der
 * Endpunkt eine frei waehlbare URL entgegen und riefe sie ab, waere das eine SSRF-Luecke,
 * und ein Admin-Konto ist kein Grund, sie aufzumachen.
 */
export const ENDPUNKTE: Readonly<Record<string, Endpunkt>> = {
  health: {
    gruppe: "konnektor",
    methode: "GET",
    pfad: "/connector/health",
    guid: false,
    rumpfVorschlag: null,
  },
  versions: {
    gruppe: "konnektor",
    methode: "GET",
    pfad: "/connector/versions",
    guid: false,
    rumpfVorschlag: null,
  },
  model: {
    gruppe: "konnektor",
    methode: "GET",
    pfad: "/connector/model",
    guid: false,
    rumpfVorschlag: null,
  },
  "hierarchy-levels": {
    gruppe: "konnektor",
    methode: "GET",
    pfad: "/connector/product/hierarchy/levels",
    guid: false,
    rumpfVorschlag: null,
  },
  hierarchies: {
    gruppe: "konnektor",
    methode: "GET",
    pfad: "/connector/product/hierarchies",
    guid: false,
    rumpfVorschlag: null,
  },
  hierarchy: {
    gruppe: "konnektor",
    methode: "GET",
    pfad: `/connector/product/${GUID_PLATZ}/hierarchy`,
    guid: true,
    rumpfVorschlag: null,
  },
  values: {
    gruppe: "konnektor",
    methode: "POST",
    pfad: `/connector/product/${GUID_PLATZ}/values`,
    guid: true,
    // Ein leerer Rumpf liefert alles; so sieht man ohne Vorwissen etwas.
    rumpfVorschlag: "{}",
  },
  documents: {
    gruppe: "konnektor",
    methode: "POST",
    pfad: `/connector/product/${GUID_PLATZ}/documents`,
    guid: true,
    rumpfVorschlag: '{\n  "propertyIds": []\n}',
  },
  ids: {
    gruppe: "konnektor",
    methode: "GET",
    pfad: "/connector/product/ids",
    guid: false,
    rumpfVorschlag: null,
  },

  // --- Die Carrera-Bahn ---------------------------------------------------------------
  "lap-melden": {
    gruppe: "carrera",
    methode: "POST",
    pfad: "/carrera/runden",
    guid: false,
    rumpfVorschlag: BEISPIELRUNDE,
  },
  "lap-loeschen": {
    gruppe: "carrera",
    methode: "DELETE",
    pfad: `/carrera/runden/${GUID_PLATZ}`,
    guid: true,
    guidFeld: "lap_id",
    rumpfVorschlag: null,
  },
  "lap-lesen": {
    gruppe: "carrera",
    methode: "GET",
    pfad: `/carrera/runden/besucher/${GUID_PLATZ}`,
    guid: true,
    rumpfVorschlag: null,
  },
};

/**
 * Was vom angezeigten Pfad abgeschnitten wird.
 *
 * Die Basis-Adresse ueber der Liste endet bereits darauf, der Zusatz stuende sonst doppelt
 * da. Je Gruppe eine eigene Basis, weil es zwei Schnittstellen sind.
 */
const gruppenPraefix: Record<Gruppe, string> = {
  konnektor: "/connector",
  carrera: "/carrera",
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
    /*
     * **Der Platzhalter traegt den Namen des Feldes.** Stand ueber dem Loeschendpunkt
     * `{guid}`, waehrend das Feld darunter `lap_id` verlangt, widersprachen sich Pfad und
     * Formular, und wer dem Pfad glaubt, bekommt ein 204 ohne Wirkung.
     */
    anzeigePfad: e.pfad
      .replace(gruppenPraefix[e.gruppe], "")
      .replace(GUID_PLATZ, `{${(e.guidFeld ?? "GUID").toLowerCase()}}`),
    gruppe: e.gruppe,
    guid: e.guid,
    /*
     * **Die Beschriftung des Feldes gehoert zum Endpunkt, nicht zur Oberflaeche.** Beim
     * Loeschen steht dort eine `lap_id`, keine GUID; stuende ueberall "GUID", traege man
     * die falsche Kennung ein und bekaeme ein stummes 204.
     */
    guidFeld: e.guidFeld ?? "GUID",
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
  const verlangt =
    endpunkt.gruppe === "carrera" ? carreraAnmeldungVerlangt(db) : anmeldungVerlangt(db);
  const zugang = endpunkt.gruppe === "carrera" ? env.carreraBasic : env.connectorBasic;

  const kopf: Record<string, string> = {};
  if (verlangt && zugang !== null) {
    const roh = `${zugang.user}:${zugang.passwort}`;
    kopf["authorization"] = `Basic ${Buffer.from(roh, "utf8").toString("base64")}`;
  }

  /*
   * Ein Zweig je Methode statt eines Aufrufs mit bedingtem `payload`: ein zusammengesetztes
   * Objekt loest die Ueberladung von `inject` nicht mehr auf, und TypeScript bietet dann die
   * Kettenform an, die kein `statusCode` hat.
   */
  const begonnen = Date.now();
  let antwort;
  if (endpunkt.methode === "POST") {
    antwort = await app.inject({
      method: "POST",
      url: pfad,
      headers: { ...kopf, "content-type": "application/json" },
      payload: koerperText,
    });
  } else if (endpunkt.methode === "DELETE") {
    antwort = await app.inject({ method: "DELETE", url: pfad, headers: kopf });
  } else {
    antwort = await app.inject({ method: "GET", url: pfad, headers: kopf });
  }
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
