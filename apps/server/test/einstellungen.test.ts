import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, verlangeAnmeldung, type Pruefstand } from "./hilfe.js";

/**
 * Der Schalter, ob die Konnektor-API eine Anmeldung verlangt.
 *
 * **Die Vorgabe ist aus**, entschieden vom Nutzer am 08.10.2026. Sie kehrt die Entscheidung
 * vom 07.10. um, deshalb steht sie hier als eigener Fall: faellt sie eines Tages still auf
 * den alten Wert zurueck, soll ein Test das melden und nicht erst der Betrieb.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };
const BASIC = { CONNECTOR_BASIC_USER: "axon", CONNECTOR_BASIC_PASSWORT: "geheim-fuer-axon" };
const KOPF = { authorization: `Basic ${Buffer.from("axon:geheim-fuer-axon").toString("base64")}` };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

async function alsAdmin(): Promise<{ s: Pruefstand; keks: string }> {
  stand = await starte({ ...ADMIN, ...BASIC });
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

describe("Konnektor-Zugang: der Schalter", () => {
  it("steht auf einem frischen Bestand auf aus und laesst ohne Zugangsdaten durch", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });

    const info = await stand.app.inject({
      url: "/api/konnektor/info",
      headers: { cookie: await melde(stand, "admin@namur.de", "startpasswort-123") },
    });
    expect(info.json<{ anmeldungVerlangt: boolean }>().anmeldungVerlangt).toBe(false);

    // **Ohne** Authorization-Kopf, und trotzdem 200: das ist die gewuenschte Vorgabe.
    const offen = await stand.app.inject({ url: "/connector/versions" });
    expect(offen.statusCode).toBe(200);
  });

  /**
   * Die Gegenrichtung. Ohne sie belegte der Fall oben nur, dass etwas durchkommt, nicht
   * dass der Schalter ueberhaupt etwas bewirkt.
   */
  it("sperrt, sobald er an ist, und laesst mit Zugangsdaten wieder durch", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    verlangeAnmeldung(stand, true);

    expect((await stand.app.inject({ url: "/connector/versions" })).statusCode).toBe(401);
    expect((await stand.app.inject({ url: "/connector/versions", headers: KOPF })).statusCode).toBe(
      200,
    );
  });

  it("laesst /health in beiden Stellungen anonym durch", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    expect((await stand.app.inject({ url: "/connector/health" })).statusCode).toBe(200);
    verlangeAnmeldung(stand, true);
    expect((await stand.app.inject({ url: "/connector/health" })).statusCode).toBe(200);
  });

  /**
   * Der Schalter wird bei **jeder** Anfrage gelesen, nicht beim Start gemerkt. Sonst legte
   * man ihn in der Oberflaeche um, die Schnittstelle bliebe offen, und nichts sagte es.
   */
  it("wirkt sofort, ohne Neustart", async () => {
    const { s, keks } = await alsAdmin();
    expect((await s.app.inject({ url: "/connector/versions" })).statusCode).toBe(200);

    const gesetzt = await s.app.inject({
      method: "PATCH",
      url: "/api/konnektor/zugang",
      headers: { cookie: keks },
      payload: { anmeldungVerlangt: true },
    });
    expect(gesetzt.statusCode).toBe(200);

    expect((await s.app.inject({ url: "/connector/versions" })).statusCode).toBe(401);
  });

  it("meldet die neue Stellung in der Auskunft zurueck", async () => {
    const { s, keks } = await alsAdmin();
    await s.app.inject({
      method: "PATCH",
      url: "/api/konnektor/zugang",
      headers: { cookie: keks },
      payload: { anmeldungVerlangt: true },
    });
    const info = await s.app.inject({ url: "/api/konnektor/info", headers: { cookie: keks } });
    expect(info.json<{ anmeldungVerlangt: boolean }>().anmeldungVerlangt).toBe(true);
  });

  it("nimmt nur einen Wahrheitswert an", async () => {
    const { s, keks } = await alsAdmin();
    for (const payload of [{}, { anmeldungVerlangt: "ja" }, { anmeldungVerlangt: 1 }]) {
      const antwort = await s.app.inject({
        method: "PATCH",
        url: "/api/konnektor/zugang",
        headers: { cookie: keks },
        payload,
      });
      expect(antwort.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });
});

/**
 * Wer den Schalter umlegen darf, entscheidet darueber, ob die Besucherdaten aller
 * Teilnehmer ohne Anmeldung abrufbar sind. Das ist Admin-Sache.
 */
describe("Konnektor-Zugang: wer darf umlegen", () => {
  it("weist den Aufruf ohne Anmeldung ab", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    const antwort = await stand.app.inject({
      method: "PATCH",
      url: "/api/konnektor/zugang",
      payload: { anmeldungVerlangt: true },
    });
    expect(antwort.statusCode).toBe(401);
  });

  it("weist einen Betreuer ab", async () => {
    const { s, keks } = await alsAdmin();
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Betreuer Probe", email: "betreuer@namur.de", rolle: "betreuer" },
    });
    const { startpasswort } = angelegt.json<{ startpasswort: string }>();
    const betreuerKeks = await melde(s, "betreuer@namur.de", startpasswort);

    const antwort = await s.app.inject({
      method: "PATCH",
      url: "/api/konnektor/zugang",
      headers: { cookie: betreuerKeks },
      payload: { anmeldungVerlangt: true },
    });
    expect(antwort.statusCode).toBe(403);

    // Und die Stellung hat sich dadurch nicht geaendert.
    const info = await s.app.inject({ url: "/api/konnektor/info", headers: { cookie: keks } });
    expect(info.json<{ anmeldungVerlangt: boolean }>().anmeldungVerlangt).toBe(false);
  });
});
