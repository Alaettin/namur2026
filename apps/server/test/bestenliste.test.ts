import { afterEach, describe, expect, it } from "vitest";
import { BESTENLISTE_LAENGE } from "../src/services/runden.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Die Bestenliste der Carrera-Bahn.
 *
 * **Der Kern ist die Gruppierung:** eine Person darf nur einmal vorkommen, mit ihrer besten
 * Zeit. Alles andere haengt daran, auch die Grenze von 50, die sonst auf Runden statt auf
 * Fahrer wirkte.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

interface Platz {
  rang: number;
  guid: string;
  name: string;
  bestMs: number;
  anzeige: string;
  runden: number;
  avatarDateiId: string | null;
}

interface Stand {
  fahrer: number;
  runden: number;
  bestMs: number | null;
  plaetze: Platz[];
}

async function alsAdmin() {
  stand = await starte(ADMIN);
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

async function legeBesucher(s: Pruefstand, keks: string, guid: string) {
  const antwort = await s.app.inject({
    method: "POST",
    url: "/api/besucher",
    headers: { cookie: keks },
    payload: { guid, vorname: "Renn", nachname: guid },
  });
  expect(antwort.statusCode).toBe(201);
}

/** Meldet eine Runde ueber die echte Schnittstelle. */
async function melderunde(s: Pruefstand, guid: string, nr: number, dauerMs: number) {
  const antwort = await s.app.inject({
    method: "POST",
    url: "/carrera/runden",
    payload: {
      lap_id: `${guid}-${String(nr)}`,
      participant_id: guid,
      lane_number: 3,
      lap_number: nr,
      started_utc_ms: 1790858096000 + nr,
      duration_ms: dauerMs,
    },
  });
  expect(antwort.statusCode, JSON.stringify(antwort.json())).toBe(200);
}

/** Legt einen Fahrer mit den genannten Zeiten an. */
async function fahrer(s: Pruefstand, keks: string, guid: string, zeiten: number[]) {
  await legeBesucher(s, keks, guid);
  for (const [i, ms] of zeiten.entries()) await melderunde(s, guid, i + 1, ms);
}

async function liste(s: Pruefstand, keks: string): Promise<Stand> {
  const antwort = await s.app.inject({
    url: "/api/carrera/bestenliste",
    headers: { cookie: keks },
  });
  expect(antwort.statusCode).toBe(200);
  return antwort.json<Stand>();
}

describe("Bestenliste", () => {
  /**
   * **Beide Haelften der Anforderung in einem Fall.** Nur zu pruefen, dass der Fahrer einmal
   * vorkommt, liesse offen, ob dort seine schnellste Zeit steht; nur die Zeit zu pruefen
   * liesse offen, ob er daneben noch zweimal auftaucht.
   */
  it("fuehrt einen Fahrer einmal, mit seiner besten Zeit", async () => {
    const { s, keks } = await alsAdmin();
    await fahrer(s, keks, "BEST-0001", [6200, 4830, 5500]);
    /*
     * **Ein zweiter Fahrer gehoert dazu.** Mit nur einem belegte der Fall nichts: faellt die
     * Gruppierung weg, liefert SQLite genau **eine** Zeile mit dem Minimum ueber die ganze
     * Tabelle, und die Pruefung "kommt einmal vor, mit 4,830 s" ginge durch. Erst zwei
     * Fahrer unterscheiden "einer je Person" von "eine Zeile insgesamt".
     */
    await fahrer(s, keks, "BEST-0002", [5900, 7100]);

    const stand = await liste(s, keks);
    expect(stand.plaetze, "nicht beide Fahrer in der Liste").toHaveLength(2);
    const seine = stand.plaetze.filter((p) => p.guid === "BEST-0001");
    expect(seine, "mehrfach in der Liste").toHaveLength(1);
    expect(seine[0]?.bestMs).toBe(4830);
    expect(seine[0]?.anzeige).toBe("4,830 s");
    expect(seine[0]?.runden, "gefahrene Runden").toBe(3);
  });

  it("sortiert aufsteigend nach Zeit und vergibt die Raenge", async () => {
    const { s, keks } = await alsAdmin();
    await fahrer(s, keks, "BEST-0010", [7000]);
    await fahrer(s, keks, "BEST-0011", [4500]);
    await fahrer(s, keks, "BEST-0012", [5800]);

    const stand = await liste(s, keks);
    expect(stand.plaetze.map((p) => p.guid)).toEqual(["BEST-0011", "BEST-0012", "BEST-0010"]);
    expect(stand.plaetze.map((p) => p.rang)).toEqual([1, 2, 3]);
  });

  /**
   * **Die Grenze wirkt auf Fahrer, nicht auf Runden.**
   *
   * 51 Fahrer, und der langsamste faellt heraus. Haette die Abfrage keine Gruppierung,
   * kaemen hier 50 **Runden** zurueck und damit weniger als 50 Fahrer.
   */
  it("zeigt hoechstens 50 Fahrer und laesst den langsamsten weg", async () => {
    const { s, keks } = await alsAdmin();
    for (let i = 0; i <= BESTENLISTE_LAENGE; i++) {
      // Der letzte ist der langsamste, alle anderen schneller.
      await fahrer(s, keks, `VOLL-${String(i).padStart(3, "0")}`, [4000 + i * 10]);
    }

    const stand = await liste(s, keks);
    expect(stand.plaetze).toHaveLength(BESTENLISTE_LAENGE);
    expect(stand.fahrer, "die Kopfzahl zaehlt alle, nicht nur die Liste").toBe(
      BESTENLISTE_LAENGE + 1,
    );
    const letzter = `VOLL-${String(BESTENLISTE_LAENGE).padStart(3, "0")}`;
    expect(stand.plaetze.map((p) => p.guid)).not.toContain(letzter);
  });

  /** Bei gleicher Zeit entscheidet die GUID, sonst waere die Reihenfolge Zufall. */
  it("liefert bei Gleichstand immer dieselbe Reihenfolge", async () => {
    const { s, keks } = await alsAdmin();
    await fahrer(s, keks, "GLEICH-B", [5000]);
    await fahrer(s, keks, "GLEICH-A", [5000]);

    const ersterLauf = (await liste(s, keks)).plaetze.map((p) => p.guid);
    const zweiterLauf = (await liste(s, keks)).plaetze.map((p) => p.guid);
    expect(ersterLauf).toEqual(zweiterLauf);
    expect(ersterLauf[0]).toBe("GLEICH-A");
  });

  it("ist ohne Runden leer, nicht kaputt", async () => {
    const { s, keks } = await alsAdmin();
    const stand = await liste(s, keks);
    expect(stand.plaetze).toEqual([]);
    expect(stand).toMatchObject({ fahrer: 0, runden: 0, bestMs: null });
  });

  /** Jeder Fahrer traegt ein Bild, auch ohne eigenes: sonst bleibt das Podest leer. */
  it("nennt zu jedem Platz ein Bild", async () => {
    const { s, keks } = await alsAdmin();
    await fahrer(s, keks, "BILD-0001", [5000]);
    const stand = await liste(s, keks);
    expect(stand.plaetze[0]?.avatarDateiId).not.toBeNull();
  });
});

describe("Die Bestenliste ist nicht oeffentlich", () => {
  it("weist einen Aufruf ohne Anmeldung ab", async () => {
    const { s } = await alsAdmin();
    expect((await s.app.inject({ url: "/api/carrera/bestenliste" })).statusCode).toBe(401);
  });

  it("weist einen Betreuer ab", async () => {
    const { s, keks } = await alsAdmin();
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Betreuer Bestenliste", email: "betreuer-best@namur.de", rolle: "betreuer" },
    });
    expect(angelegt.statusCode).toBe(201);

    // Das Startpasswort gibt es **nur** in dieser Antwort, es laesst sich nicht nachlesen.
    const { startpasswort } = angelegt.json<{ startpasswort: string }>();
    const seiner = await melde(s, "betreuer-best@namur.de", startpasswort);
    const antwort = await s.app.inject({
      url: "/api/carrera/bestenliste",
      headers: { cookie: seiner },
    });
    expect(antwort.statusCode).toBe(403);
  });
});
