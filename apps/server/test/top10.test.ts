import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Die Top 10 der Carrera-Bahn im Konnektor, seit dem 19.10.2026.
 *
 * Fuer **jeden** Besucher dieselbe Liste, seit dem 20.10.2026 als `pos1` bis `pos10` mit dem
 * Wert "Alias - Rundenzeit". Der Fahrer ist nur sein Alias, ohne Alias "Anonym".
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
  // Nur was einen Wert traegt; Leeres kommt seit dem 30.10.2026 als `value: null`.
  return antwort.json<Wert[]>().filter((w) => w.value !== null);
}

/** Die Top-10-Werte als `{ pos1: "Alias - Zeit", ... }`. */
function top(alle: Wert[]): Record<string, unknown> {
  return Object.fromEntries(
    alle.filter((w) => /^pos\d+$/.test(w.propertyId)).map((w) => [w.propertyId, w.value]),
  );
}

describe("Top 10 im Modell", () => {
  it("kuendigt pos1 bis pos10 an, auch ohne gefahrene Runde, und nichts Altes", async () => {
    const { s } = await alsAdmin();
    const felder = (await s.app.inject({ url: "/connector/model" })).json<
      { id: string; type: number }[]
    >();
    const ids = felder.map((f) => f.id);
    const topFelder = felder.filter((f) => /^pos\d+$/.test(f.id));

    expect(topFelder.map((f) => f.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `pos${String(i + 1)}`),
    );
    expect(topFelder.every((f) => f.type === 0)).toBe(true);
    expect(
      ids.filter((i) => i.startsWith("Carrera_Top")),
      "alte Eigenschaften",
    ).toEqual([]);
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
      pos1: "Turbo - 4,827 s",
      pos2: "Blitz - 5,100 s",
      pos3: "Anonym - 5,300 s",
    });
  });

  it("nennt den Klarnamen nie, auch ohne Alias", async () => {
    const { s, keks } = await alsAdmin();
    await besucher(s, keks, "TOP-OHNE");
    await runde(s, "TOP-OHNE", 4900);

    const liste = top(await werte(s, "TOP-OHNE"));
    expect(liste).toEqual({ pos1: "Anonym - 4,900 s" });
    expect(JSON.stringify(liste)).not.toMatch(/Klar|NameTOP/);
  });

  it("fuehrt einen Fahrer einmal, mit seiner besten Runde", async () => {
    const { s, keks } = await alsAdmin();
    await besucher(s, keks, "TOP-VIEL", "Dauerfahrer");
    await runde(s, "TOP-VIEL", 5400, 1);
    await runde(s, "TOP-VIEL", 4830, 2);
    await runde(s, "TOP-VIEL", 5050, 3);

    expect(top(await werte(s, "TOP-VIEL"))).toEqual({ pos1: "Dauerfahrer - 4,830 s" });
  });

  it("endet nach dem zehnten Platz", async () => {
    const { s, keks } = await alsAdmin();
    for (let i = 1; i <= 11; i++) {
      const guid = `TOP-${String(i).padStart(2, "0")}`;
      await besucher(s, keks, guid, `F${String(i)}`);
      await runde(s, guid, 4000 + i * 10);
    }

    const liste = top(await werte(s, "TOP-01"));
    expect(Object.keys(liste)).toHaveLength(10);
    expect(liste["pos10"]).toBe("F10 - 4,100 s");
    expect(liste).not.toHaveProperty("pos11");
    expect(JSON.stringify(liste)).not.toContain("F11");
  });
});
