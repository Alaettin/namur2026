import { afterEach, describe, expect, it } from "vitest";
import { SCHLUESSEL_UNBEKANNT } from "../src/services/abrufe.js";
import { ZIELFELDER } from "../src/services/csv.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Das Monitoring der Konnektor-Abrufe.
 *
 * **Zaehler, kein Protokoll.** Ein Protokoll mit einer Zeile je Anfrage gab es hier schon
 * einmal und flog am 08.10.2026 raus, weil es unbegrenzt waechst. Die Pruefungen hier
 * halten genau das fest, was die neue Fassung anders macht: eine Zeile je Besucher, und
 * fuer Unbekanntes gar keine.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

interface Monitoring {
  abgefragt: number;
  besucherGesamt: number;
  abrufeGesamt: number;
  unbekannteAbrufe: number;
  letzter: number | null;
  eintraege: {
    guid: string;
    name: string;
    hierarchy: number;
    werte: number;
    dokumente: number;
    gesamt: number;
  }[];
}

async function alsAdmin() {
  stand = await starte(ADMIN);
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

async function legeBesucherAn(s: Pruefstand, keks: string, guid: string) {
  await s.app.inject({
    method: "POST",
    url: "/api/besucher",
    headers: { cookie: keks },
    payload: { guid, vorname: "Mess", nachname: "Besucher" },
  });
}

async function stand_(s: Pruefstand, keks: string): Promise<Monitoring> {
  const antwort = await s.app.inject({ url: "/api/monitoring", headers: { cookie: keks } });
  expect(antwort.statusCode).toBe(200);
  return antwort.json<Monitoring>();
}

describe("Abrufzaehler", () => {
  /**
   * **Je Endpunkt genau sein Zaehler.** Eine Pruefung, die nur die Summe ansieht, ginge
   * auch dann durch, wenn alle drei auf dieselbe Spalte zaehlten, und genau dafuer ist die
   * Aufteilung ja da.
   */
  it("zaehlt jeden der drei Endpunkte getrennt", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucherAn(s, keks, "MESS-0001");

    await s.app.inject({ url: "/connector/product/MESS-0001/hierarchy" });
    let m = await stand_(s, keks);
    expect(m.eintraege[0]).toMatchObject({ hierarchy: 1, werte: 0, dokumente: 0, gesamt: 1 });

    await s.app.inject({ method: "POST", url: "/connector/product/MESS-0001/values", payload: {} });
    m = await stand_(s, keks);
    expect(m.eintraege[0]).toMatchObject({ hierarchy: 1, werte: 1, dokumente: 0, gesamt: 2 });

    await s.app.inject({
      method: "POST",
      url: "/connector/product/MESS-0001/documents",
      payload: { propertyIds: [] },
    });
    m = await stand_(s, keks);
    expect(m.eintraege[0]).toMatchObject({ hierarchy: 1, werte: 1, dokumente: 1, gesamt: 3 });
  });

  it("zaehlt mehrfach und fuehrt zuletzt mit", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucherAn(s, keks, "MESS-0002");

    await s.app.inject({ url: "/connector/product/MESS-0002/hierarchy" });
    const ersterStand = await stand_(s, keks);
    const zuerst = ersterStand.letzter;

    await new Promise((loese) => setTimeout(loese, 5));
    await s.app.inject({ url: "/connector/product/MESS-0002/hierarchy" });

    const m = await stand_(s, keks);
    expect(m.eintraege).toHaveLength(1);
    expect(m.eintraege[0]?.hierarchy).toBe(2);
    expect(m.letzter).not.toBeNull();
    expect(m.letzter ?? 0).toBeGreaterThanOrEqual(zuerst ?? 0);
  });

  /**
   * **Die wichtigste Pruefung.** Die Konnektor-API verlangt bewusst keine Anmeldung. Legte
   * jede unbekannte GUID eine Zeile an, koennte jeder die Tabelle mit erfundenen GUIDs
   * fluten; genau daran war das alte Protokoll gescheitert.
   */
  it("legt fuer unbekannte GUIDs keine Zeile an, sondern zaehlt sie einzeln", async () => {
    const { s, keks } = await alsAdmin();

    for (const guid of ["GIBT-ES-NICHT-1", "GIBT-ES-NICHT-2", "GIBT-ES-NICHT-3"]) {
      const antwort = await s.app.inject({ url: `/connector/product/${guid}/hierarchy` });
      expect(antwort.statusCode).toBe(404);
    }

    const m = await stand_(s, keks);
    expect(m.eintraege).toHaveLength(0);
    expect(m.abgefragt).toBe(0);
    expect(m.unbekannteAbrufe).toBe(3);
  });

  it("nennt abgefragte Besucher und die Gesamtzahl", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucherAn(s, keks, "MESS-0003");
    await legeBesucherAn(s, keks, "MESS-0004");
    await s.app.inject({ url: "/connector/product/MESS-0003/hierarchy" });

    const m = await stand_(s, keks);
    expect(m.abgefragt).toBe(1);
    expect(m.besucherGesamt).toBe(2);
    expect(m.abrufeGesamt).toBe(1);
    expect(m.eintraege[0]?.name).toBe("Mess Besucher");
  });

  it("verliert die Zaehler beim Zuruecksetzen", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucherAn(s, keks, "MESS-0005");
    await s.app.inject({ url: "/connector/product/MESS-0005/hierarchy" });
    await s.app.inject({ url: "/connector/product/GIBT-ES-NICHT/hierarchy" });

    expect((await stand_(s, keks)).abgefragt).toBe(1);

    const weg = await s.app.inject({
      method: "POST",
      url: "/api/entwickler/zuruecksetzen",
      headers: { cookie: keks },
      // Der Server verlangt das Wort auch dann, wenn kein Dialog davorsteht.
      payload: { bestaetigung: "ZURUECKSETZEN" },
    });
    expect(weg.statusCode).toBe(200);

    const m = await stand_(s, keks);
    expect(m.eintraege).toHaveLength(0);
    expect(m.abrufeGesamt).toBe(0);
    // Der Zaehler fuer Unbekanntes haengt an keinem Besucher und muss eigens weg.
    expect(m.unbekannteAbrufe, `Schluessel ${SCHLUESSEL_UNBEKANNT} blieb stehen`).toBe(0);
  });

  it("weist einen Betreuer ab", async () => {
    const { s, keks } = await alsAdmin();
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Betreuer Mess", email: "betreuer-mess@namur.de", rolle: "betreuer" },
    });
    const { startpasswort } = angelegt.json<{ startpasswort: string }>();
    const betreuerKeks = await melde(s, "betreuer-mess@namur.de", startpasswort);

    const antwort = await s.app.inject({
      url: "/api/monitoring",
      headers: { cookie: betreuerKeks },
    });
    expect(antwort.statusCode).toBe(403);
  });
});

describe("CSV-Vorlage", () => {
  /**
   * Geprueft gegen **`ZIELFELDER`**, nicht gegen eine abgetippte Liste: sonst beweist der
   * Test nur, dass zwei Stellen dasselbe behaupten, und beide koennen zugleich veralten.
   */
  it("traegt alle Zielfelder als Kopfzeile und beginnt mit dem BOM", async () => {
    const { s, keks } = await alsAdmin();
    const antwort = await s.app.inject({
      url: "/api/besucher/import/vorlage",
      headers: { cookie: keks },
    });
    expect(antwort.statusCode).toBe(200);

    const { dateiname, inhalt } = antwort.json<{ dateiname: string; inhalt: string }>();
    expect(dateiname).toMatch(/\.csv$/);
    expect(inhalt.charCodeAt(0), "ohne BOM zeigt Excel Umlaute falsch").toBe(0xfeff);

    const kopf = inhalt.slice(1).split("\r\n")[0];
    expect(kopf?.split(";")).toEqual([...ZIELFELDER]);
  });

  it("ist fuer Betreuer gesperrt", async () => {
    stand = await starte(ADMIN);
    const antwort = await stand.app.inject({ url: "/api/besucher/import/vorlage" });
    expect(antwort.statusCode).toBe(401);
  });
});
