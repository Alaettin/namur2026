import { afterEach, describe, expect, it } from "vitest";
import { ENDPUNKTE } from "../src/services/probe.js";
import { melde, starte, verlangeAnmeldung, type Pruefstand } from "./hilfe.js";

/**
 * Der Pruefstand hinter der Seite API.
 *
 * Er fuehrt die neun Konnektor-Endpunkte im Server aus und gibt die Antwort zurueck. Die
 * Pruefungen hier drehen sich um zwei Dinge: dass er **dasselbe** liefert wie ein direkter
 * Aufruf, und dass er **nichts anderes** aufrufen kann als die neun.
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
  it("fuer jeden der neun Endpunkte", async () => {
    const { s, keks } = await alsAdmin();
    const guid = await besucher(s, keks, "PROBE-0001");

    for (const [kennung, e] of Object.entries(ENDPUNKTE)) {
      const pfad = e.pfad.replace("{guid}", guid);
      /*
       * **Gegen den direkten Aufruf geprueft, nicht gegen eine erwartete Zahl.** Eine fest
       * eingetragene 200 verriete nicht, ob der Pruefstand denselben Weg nimmt; aendert
       * sich eine Route, muessen beide Seiten gleich falsch werden, damit es durchgeht.
       */
      const direkt =
        e.methode === "POST"
          ? await s.app.inject({ method: "POST", url: pfad, payload: {} })
          : await s.app.inject({ method: "GET", url: pfad });

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
   * Der Anzeigepfad traegt kein `/connector`, der ausfuehrbare schon.
   *
   * Beides zusammen geprueft, weil genau das die Falle waere: ein Kuerzen, das aus Versehen
   * auch den Aufruf trifft, und die Schnittstelle antwortet 404.
   */
  it("zeigt die Pfade ohne /connector, ruft aber den vollen auf", async () => {
    const { s, keks } = await alsAdmin();

    const liste = (
      await s.app.inject({ url: "/api/konnektor/info", headers: { cookie: keks } })
    ).json<{ endpunkte: { kennung: string; anzeigePfad: string }[] }>().endpunkte;
    expect(liste).toHaveLength(Object.keys(ENDPUNKTE).length);

    for (const e of liste) {
      expect(e.anzeigePfad, e.kennung).not.toContain("/connector");
      // Und er passt zum echten Pfad, ist also nicht irgendetwas.
      expect(`/connector${e.anzeigePfad}`, e.kennung).toBe(ENDPUNKTE[e.kennung]?.pfad);
    }

    // Die Gegenrichtung: der Aufruf geht weiterhin an /connector und liefert 200.
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
