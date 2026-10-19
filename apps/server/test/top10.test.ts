import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Die Top 10 der Carrera-Bahn im Konnektor, seit dem 19.10.2026.
 *
 * Fuer **jeden** Besucher dieselbe Liste, je Platz Platzierung, Fahrer und Bestzeit. Der
 * Fahrer ist nur sein Alias, ohne Alias "Anonym".
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

interface Wert {
  propertyId: string;
  value?: unknown;
}

async function alsAdmin() {
  stand = await starte(ADMIN);
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

async function besucher(s: Pruefstand, keks: string, guid: string, alias?: string) {
  const antwort = await s.app.inject({
    method: "POST",
    url: "/api/besucher",
    headers: { cookie: keks },
    payload: { guid, vorname: "Klar", nachname: `Name${guid}`, ...(alias ? { alias } : {}) },
  });
  expect(antwort.statusCode).toBe(201);
}

async function runde(s: Pruefstand, guid: string, ms: number, nr = 1) {
  const antwort = await s.app.inject({
    method: "POST",
    url: "/carrera/runden",
    payload: {
      lap_id: `${guid}-${String(nr)}`,
      participant_id: guid,
      lap_number: nr,
      duration_ms: ms,
    },
  });
  expect(antwort.statusCode).toBe(200);
}

async function werte(s: Pruefstand, guid: string): Promise<Wert[]> {
  const antwort = await s.app.inject({
    method: "POST",
    url: `/connector/product/${guid}/values`,
    payload: {},
  });
  expect(antwort.statusCode).toBe(200);
  return antwort.json<Wert[]>();
}

/** Die Top-10-Werte als `{ "01": { Place, Driver, BestLap } }`. */
function top(alle: Wert[]): Record<string, Record<string, unknown>> {
  const liste: Record<string, Record<string, unknown>> = {};
  for (const w of alle) {
    const m = /^Carrera_Top(\d{2})_(Place|Driver|BestLap)$/.exec(w.propertyId);
    if (m === null) continue;
    const [, nr = "", feld = ""] = m;
    liste[nr] = { ...liste[nr], [feld]: w.value };
  }
  return liste;
}

describe("Top 10 im Modell", () => {
  it("kuendigt alle 30 Datenpunkte an, auch ohne gefahrene Runde", async () => {
    const { s } = await alsAdmin();
    const felder = (await s.app.inject({ url: "/connector/model" })).json<
      { id: string; type: number }[]
    >();
    const topFelder = felder.filter((f) => f.id.startsWith("Carrera_Top"));

    expect(topFelder).toHaveLength(30);
    expect(topFelder.every((f) => f.type === 0)).toBe(true);
    expect(topFelder.map((f) => f.id)).toContain("Carrera_Top10_BestLap");
    expect(topFelder.map((f) => f.id)).not.toContain("Carrera_Top11_Place");
  });
});

describe("Top 10 in values", () => {
  /**
   * **Ein unbeteiligter Besucher**, ohne Runde und ohne Zuordnung. Bei ihm greift der fruehe
   * `return` in `sammleWerte`; stuende die Liste dahinter, saehe er sie nicht.
   */
  it("steht auch bei einem Besucher, der weder faehrt noch etwas zugeordnet hat", async () => {
    const { s, keks } = await alsAdmin();
    await besucher(s, keks, "TOP-A", "Blitz");
    await besucher(s, keks, "TOP-B", "Turbo");
    await besucher(s, keks, "TOP-C");
    await besucher(s, keks, "TOP-ZUSCHAUER");
    await runde(s, "TOP-A", 5100);
    await runde(s, "TOP-B", 4827);
    await runde(s, "TOP-C", 5300);

    expect(top(await werte(s, "TOP-ZUSCHAUER"))).toEqual({
      "01": { Place: "1", Driver: "Turbo", BestLap: "4,827 s" },
      "02": { Place: "2", Driver: "Blitz", BestLap: "5,100 s" },
      "03": { Place: "3", Driver: "Anonym", BestLap: "5,300 s" },
    });
  });

  it("nennt den Klarnamen nie, auch ohne Alias", async () => {
    const { s, keks } = await alsAdmin();
    await besucher(s, keks, "TOP-OHNE");
    await runde(s, "TOP-OHNE", 4900);

    const fahrer = Object.values(top(await werte(s, "TOP-OHNE"))).map((p) => p["Driver"]);
    expect(fahrer).toEqual(["Anonym"]);
    expect(JSON.stringify(fahrer)).not.toMatch(/Klar|NameTOP/);
  });

  it("fuehrt einen Fahrer einmal, mit seiner besten Runde", async () => {
    const { s, keks } = await alsAdmin();
    await besucher(s, keks, "TOP-VIEL", "Dauerfahrer");
    await runde(s, "TOP-VIEL", 5400, 1);
    await runde(s, "TOP-VIEL", 4830, 2);
    await runde(s, "TOP-VIEL", 5050, 3);

    expect(top(await werte(s, "TOP-VIEL"))).toEqual({
      "01": { Place: "1", Driver: "Dauerfahrer", BestLap: "4,830 s" },
    });
  });

  it("endet nach dem zehnten Platz", async () => {
    const { s, keks } = await alsAdmin();
    for (let i = 1; i <= 11; i++) {
      const guid = `TOP-${String(i).padStart(2, "0")}`;
      await besucher(s, keks, guid, `F${String(i)}`);
      await runde(s, guid, 4000 + i * 10);
    }

    const liste = top(await werte(s, "TOP-01"));
    expect(Object.keys(liste).sort()).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
    ]);
    expect(liste["10"]).toMatchObject({ Driver: "F10", BestLap: "4,100 s" });
    expect(JSON.stringify(liste)).not.toContain("F11");
  });
});
