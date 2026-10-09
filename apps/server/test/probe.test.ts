import { afterEach, describe, expect, it } from "vitest";
import { ENDPUNKTE } from "../src/services/probe.js";
import { SCHLUESSEL_CARRERA, setzeSchalter } from "../src/services/einstellungen.js";
import { melde, starte, verlangeAnmeldung, type Pruefstand } from "./hilfe.js";

/**
 * Der Pruefstand hinter der Seite API.
 *
 * Er fuehrt die festen Endpunkte beider Schnittstellen im Server aus und gibt die Antwort
 * zurueck. Die Pruefungen hier drehen sich um zwei Dinge: dass er **dasselbe** liefert wie
 * ein direkter Aufruf, und dass er **nichts anderes** aufrufen kann als die eingetragenen.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };
const BASIC = { CONNECTOR_BASIC_USER: "axon", CONNECTOR_BASIC_PASSWORT: "geheim-fuer-axon" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

interface Ergebnis {
  status: number;
  dauerMs: number;
  koerper: string;
  groesse: number;
  gekuerzt: boolean;
}

async function alsAdmin(zusatz: Record<string, string> = {}) {
  stand = await starte({ ...ADMIN, ...BASIC, ...zusatz });
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

/** Legt einen Besucher an und liefert seine GUID. */
async function besucher(s: Pruefstand, keks: string, guid: string): Promise<string> {
  await s.app.inject({
    method: "POST",
    url: "/api/besucher",
    headers: { cookie: keks },
    payload: { guid, vorname: "Probe", nachname: "Besucher" },
  });
  return guid;
}

function probe(s: Pruefstand, keks: string, rumpf: Record<string, unknown>) {
  return s.app.inject({
    method: "POST",
    url: "/api/konnektor/probe",
    headers: { cookie: keks },
    payload: rumpf,
  });
}

describe("Pruefstand: liefert dasselbe wie ein direkter Aufruf", () => {
  it("fuer jeden eingetragenen Endpunkt", async () => {
    const { s, keks } = await alsAdmin();
    const guid = await besucher(s, keks, "PROBE-0001");

    for (const [kennung, e] of Object.entries(ENDPUNKTE)) {
      const pfad = e.pfad.replace("{guid}", guid);
      /*
       * **Gegen den direkten Aufruf geprueft, nicht gegen eine erwartete Zahl.** Eine fest
       * eingetragene 200 verriete nicht, ob der Pruefstand denselben Weg nimmt; aendert
       * sich eine Route, muessen beide Seiten gleich falsch werden, damit es durchgeht.
       */
      /*
       * **Dieselbe Methode wie der Pruefstand.** Rief die Gegenprobe ueberall GET auf, waere
       * sie fuer `DELETE` ein Vergleich zweier verschiedener Aufrufe: 204 gegen 404, und das
       * sah nach einem Fehler im Pruefstand aus, wo keiner war.
       */
      const direkt = await s.app.inject(
        e.methode === "POST"
          ? { method: "POST", url: pfad, payload: {} }
          : { method: e.methode, url: pfad },
      );

      const ueber = await probe(s, keks, { endpunkt: kennung, guid, rumpf: "{}" });
      expect(ueber.statusCode, kennung).toBe(200);
      const ergebnis = ueber.json<Ergebnis>();
      expect(ergebnis.status, kennung).toBe(direkt.statusCode);
      expect(ergebnis.koerper, kennung).toBe(direkt.body);
      expect(ergebnis.groesse, kennung).toBe(direkt.body.length);
    }
  });

  it("haengt bei eingeschalteter Anmeldung die Zugangsdaten an", async () => {
    const { s, keks } = await alsAdmin();
    verlangeAnmeldung(s, true);

    // Ohne Kopf waere das 401; der Pruefstand kennt das Passwort und schickt es mit.
    const ergebnis = (await probe(s, keks, { endpunkt: "versions" })).json<Ergebnis>();
    expect(ergebnis.status).toBe(200);
  });

  it("meldet ehrlich 401, wenn die Anmeldung verlangt ist und nichts gesetzt wurde", async () => {
    stand = await starte(ADMIN);
    const keks = await melde(stand, "admin@namur.de", "startpasswort-123");
    verlangeAnmeldung(stand, true);

    const ergebnis = (await probe(stand, keks, { endpunkt: "versions" })).json<Ergebnis>();
    expect(ergebnis.status).toBe(401);
  });

  it("gibt einen Fehler der Route weiter, statt ihn zu verstecken", async () => {
    const { s, keks } = await alsAdmin();
    const ergebnis = (
      await probe(s, keks, { endpunkt: "hierarchy", guid: "GIBT-ES-NICHT" })
    ).json<Ergebnis>();
    expect(ergebnis.status).toBe(404);
  });
});

describe("Pruefstand: die Liste fuer die Oberflaeche", () => {
  /**
   * Der Anzeigepfad traegt kein `/connector` und kein `/carrera`, der ausfuehrbare schon.
   *
   * Beides zusammen geprueft, weil genau das die Falle waere: ein Kuerzen, das aus Versehen
   * auch den Aufruf trifft, und die Schnittstelle antwortet 404.
   *
   * **Je Gruppe das eigene Praefix.** Beides pauschal gegen `/connector` zu pruefen ginge
   * fuer die Bahn durch, ohne etwas zu belegen.
   */
  it("zeigt die Pfade ohne das Praefix ihrer Gruppe, ruft aber den vollen auf", async () => {
    const { s, keks } = await alsAdmin();

    const liste = (
      await s.app.inject({ url: "/api/konnektor/info", headers: { cookie: keks } })
    ).json<{ endpunkte: { kennung: string; anzeigePfad: string; gruppe: string }[] }>().endpunkte;
    expect(liste).toHaveLength(Object.keys(ENDPUNKTE).length);

    // Beide Gruppen stehen wirklich in der Liste, sonst prueft die Schleife nur eine.
    expect(new Set(liste.map((e) => e.gruppe))).toEqual(new Set(["konnektor", "carrera"]));

    for (const e of liste) {
      const echt = ENDPUNKTE[e.kennung];
      const praefix = e.gruppe === "carrera" ? "/carrera" : "/connector";
      expect(e.anzeigePfad, e.kennung).not.toContain(praefix);
      /*
       * Und er passt zum echten Pfad, ist also nicht irgendetwas. Der Platzhalter traegt
       * dabei den Namen des Feldes, beim Loeschen also `{lap_id}` statt `{guid}`.
       */
      const erwartet = echt?.pfad.replace("{guid}", `{${(echt.guidFeld ?? "GUID").toLowerCase()}}`);
      expect(`${praefix}${e.anzeigePfad}`, e.kennung).toBe(erwartet);
    }

    // Beim Loeschen steht wirklich `{lap_id}` da, nicht `{guid}`.
    const loeschen = liste.find((e) => e.kennung === "lap-loeschen");
    expect(loeschen?.anzeigePfad).toBe("/runden/{lap_id}");

    // Die Gegenrichtung: der Aufruf geht weiterhin an den vollen Pfad und liefert 200.
    expect((await probe(s, keks, { endpunkt: "versions" })).json<Ergebnis>().status).toBe(200);
    expect(
      (await probe(s, keks, { endpunkt: "lap-lesen", guid: "PROBE-0001" })).json<Ergebnis>().status,
    ).toBe(200);
  });

  /**
   * **Der Pruefstand nimmt die Zugangsdaten der jeweiligen Gruppe.**
   *
   * Die Falle ist, dass er ueberall die des Konnektors anhaengt: bei eingeschaltetem
   * Carrera-Schalter kaeme dann ein 401, das niemand sich erklaeren kann.
   */
  it("haengt bei der Bahn die Carrera-Zugangsdaten an, nicht die des Konnektors", async () => {
    const { s, keks } = await alsAdmin({
      CARRERA_BASIC_USER: "bahn",
      CARRERA_BASIC_PASSWORT: "geheim-fuer-die-bahn",
    });
    setzeSchalter(s.ctx.db, SCHLUESSEL_CARRERA, true);

    const mit = (
      await probe(s, keks, { endpunkt: "lap-lesen", guid: "PROBE-0001" })
    ).json<Ergebnis>();
    expect(mit.status, "mit eingeschaltetem Schalter abgewiesen").toBe(200);

    /*
     * Und die Gegenrichtung: der Konnektor-Schalter steht weiterhin aus, der Aufruf dorthin
     * geht also auch ohne Kopf durch. Beide Schalter sind getrennt.
     */
    expect((await probe(s, keks, { endpunkt: "versions" })).json<Ergebnis>().status).toBe(200);
  });
});

describe("Pruefstand: ruft nichts anderes auf", () => {
  it("weist eine unbekannte Kennung ab", async () => {
    const { s, keks } = await alsAdmin();
    const antwort = await probe(s, keks, { endpunkt: "gibt-es-nicht" });
    expect(antwort.statusCode).toBe(400);
    expect(antwort.json<{ code: string }>().code).toBe("endpunkt-unbekannt");
  });

  /**
   * **Die wichtigste Pruefung.** Naehme der Endpunkt einen Pfad entgegen, waere er eine
   * SSRF-Luecke: ein Admin koennte damit jede interne Adresse abrufen lassen.
   */
  it("ignoriert einen mitgeschickten Pfad", async () => {
    const { s, keks } = await alsAdmin();

    for (const versuch of [
      { endpunkt: "/api/nutzer" },
      { endpunkt: "http://127.0.0.1/api/nutzer" },
      { endpunkt: "../../api/nutzer" },
      { endpunkt: "versions/../../api/nutzer" },
    ]) {
      const antwort = await probe(s, keks, versuch);
      expect(antwort.statusCode, JSON.stringify(versuch)).toBe(400);
    }
  });

  it("verlangt eine GUID, wo der Pfad eine braucht", async () => {
    const { s, keks } = await alsAdmin();
    const antwort = await probe(s, keks, { endpunkt: "hierarchy" });
    expect(antwort.statusCode).toBe(400);
    expect(antwort.json<{ code: string }>().code).toBe("guid-fehlt");
  });

  it("weist einen kaputten Rumpf ab, bevor er hinausgeht", async () => {
    const { s, keks } = await alsAdmin();
    const guid = await besucher(s, keks, "PROBE-0002");
    const antwort = await probe(s, keks, { endpunkt: "values", guid, rumpf: "{kein json" });
    expect(antwort.statusCode).toBe(400);
    expect(antwort.json<{ code: string }>().code).toBe("rumpf-kein-json");
  });
});

describe("Pruefstand: wer darf", () => {
  it("weist den Aufruf ohne Anmeldung ab", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    const antwort = await stand.app.inject({
      method: "POST",
      url: "/api/konnektor/probe",
      payload: { endpunkt: "versions" },
    });
    expect(antwort.statusCode).toBe(401);
  });

  it("weist einen Betreuer ab", async () => {
    const { s, keks } = await alsAdmin();
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Betreuer Probe", email: "betreuer-probe@namur.de", rolle: "betreuer" },
    });
    const { startpasswort } = angelegt.json<{ startpasswort: string }>();
    const betreuerKeks = await melde(s, "betreuer-probe@namur.de", startpasswort);

    const antwort = await s.app.inject({
      method: "POST",
      url: "/api/konnektor/probe",
      headers: { cookie: betreuerKeks },
      payload: { endpunkt: "versions" },
    });
    expect(antwort.statusCode).toBe(403);
  });
});
