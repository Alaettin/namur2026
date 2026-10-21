import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Gewertete Events der Carrera-Bahn, seit dem 21.10.2026.
 *
 * Die Bahn schickt mit jeder Runde `event_id` und `event_name` (zum Testen "DevTest", auf
 * der HV etwa "NHV-2026"). In den Einstellungen hakt der Admin an, welche Events zaehlen;
 * nichts angehakt heisst alle. Gespeichert wird immer alles.
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

interface Event {
  eventId: string;
  eventName: string | null;
  runden: number;
  gewertet: boolean;
}

async function alsAdmin() {
  stand = await starte(ADMIN);
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

async function besucher(s: Pruefstand, keks: string, guid: string) {
  const antwort = await s.app.inject({
    method: "POST",
    url: "/api/besucher",
    headers: { cookie: keks },
    payload: { guid, vorname: "Renn", nachname: guid, alias: `Alias-${guid}` },
  });
  expect(antwort.statusCode).toBe(201);
}

async function runde(s: Pruefstand, lap: string, guid: string, ms: number, event?: string) {
  const antwort = await s.app.inject({
    method: "POST",
    url: "/carrera/runden",
    payload: {
      lap_id: lap,
      participant_id: guid,
      lap_number: 1,
      duration_ms: ms,
      ...(event === undefined ? {} : { event_id: event, event_name: `Name ${event}` }),
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

function waehle(s: Pruefstand, keks: string, eventIds: unknown) {
  return s.app.inject({
    method: "PUT",
    url: "/api/carrera/events",
    headers: { cookie: keks },
    payload: { eventIds },
  });
}

/**
 * A faehrt nur im Test schnell (1 s), B nur auf der HV (5 s), C auf der HV (6 s) und ohne
 * Event (2 s). Ohne Filter liegt A vorn, mit "NHV-2026" B.
 */
async function bahn() {
  const { s, keks } = await alsAdmin();
  for (const g of ["A", "B", "C"]) await besucher(s, keks, g);
  await runde(s, "a1", "A", 1000, "DevTest");
  await runde(s, "b1", "B", 5000, "NHV-2026");
  await runde(s, "c1", "C", 6000, "NHV-2026");
  await runde(s, "c2", "C", 2000);
  return { s, keks };
}

async function bestenliste(s: Pruefstand, keks: string) {
  const antwort = await s.app.inject({
    url: "/api/carrera/bestenliste",
    headers: { cookie: keks },
  });
  expect(antwort.statusCode).toBe(200);
  return antwort.json<{
    fahrer: number;
    runden: number;
    bestMs: number | null;
    plaetze: { guid: string; bestMs: number }[];
    gewertet: Event[];
  }>();
}

describe("Auswahl der Events", () => {
  it("listet jedes Event mit Name und Rundenzahl, ohne Event als Leerstring", async () => {
    const { s, keks } = await bahn();
    const antwort = await s.app.inject({ url: "/api/carrera/events", headers: { cookie: keks } });
    expect(antwort.json<{ events: Event[] }>().events).toEqual([
      { eventId: "", eventName: null, runden: 1, gewertet: false },
      { eventId: "DevTest", eventName: "Name DevTest", runden: 1, gewertet: false },
      { eventId: "NHV-2026", eventName: "Name NHV-2026", runden: 2, gewertet: false },
    ]);
  });

  it("verlangt einen Admin und eine Liste aus Texten", async () => {
    const { s, keks } = await bahn();
    expect((await s.app.inject({ method: "PUT", url: "/api/carrera/events" })).statusCode).toBe(
      401,
    );
    expect((await waehle(s, keks, "NHV-2026")).statusCode).toBe(400);
    expect((await waehle(s, keks, [1])).statusCode).toBe(400);
  });

  it("behaelt einen Haken auch fuer ein Event ohne Runden, damit er sich entfernen laesst", async () => {
    const { s, keks } = await bahn();
    const antwort = await waehle(s, keks, ["Spaeter"]);
    expect(antwort.json<{ events: Event[] }>().events).toContainEqual({
      eventId: "Spaeter",
      eventName: null,
      runden: 0,
      gewertet: true,
    });
  });
});

describe("Filter nach gewerteten Events", () => {
  it("ohne Auswahl zaehlen alle Runden", async () => {
    const { s, keks } = await bahn();
    const liste = await bestenliste(s, keks);
    expect(liste.plaetze.map((p) => p.guid)).toEqual(["A", "C", "B"]);
    expect(liste.runden).toBe(4);
    expect(liste.gewertet).toEqual([]);
  });

  it("mit NHV-2026 zaehlen nur dessen Runden: Bestenliste und Kennzahlen", async () => {
    const { s, keks } = await bahn();
    expect((await waehle(s, keks, ["NHV-2026"])).statusCode).toBe(200);

    const liste = await bestenliste(s, keks);
    expect(liste.plaetze.map((p) => [p.guid, p.bestMs])).toEqual([
      ["B", 5000],
      ["C", 6000],
    ]);
    expect(liste.fahrer).toBe(2);
    expect(liste.runden).toBe(2);
    expect(liste.bestMs).toBe(5000);
    expect(liste.gewertet.map((e) => e.eventId)).toEqual(["NHV-2026"]);
  });

  it("filtert auch Top 10, Podestrahmen und Visitor_LapNN im Konnektor", async () => {
    const { s, keks } = await bahn();
    await waehle(s, keks, ["NHV-2026"]);

    const vonA = await werte(s, "A");
    expect(vonA.find((w) => w.propertyId === "pos1")?.value).toBe("Alias-B - 5,000 s");
    expect(
      vonA.some((w) => w.propertyId.startsWith("Visitor_Lap")),
      "A fuhr nur im Test",
    ).toBe(false);

    const vonC = await werte(s, "C");
    const laps = vonC.filter((w) => w.propertyId.startsWith("Visitor_Lap"));
    expect(laps.map((w) => w.value)).toEqual(["Runde 1 · 6,000 s"]);

    // Der Rahmen haengt am Rang: A steht nicht mehr auf dem Podest, B schon.
    const avatarTyp = (w: Wert[]) =>
      (w.find((x) => x.propertyId === "Visitor_Avatar") as { mimeType?: string } | undefined)
        ?.mimeType;
    expect(avatarTyp(vonA)).toBe("image/jpeg");
    expect(avatarTyp(await werte(s, "B"))).toBe("image/png");
  });

  it("filtert die Runden im Besucherdetail", async () => {
    const { s, keks } = await bahn();
    await waehle(s, keks, ["NHV-2026"]);
    const detail = await s.app.inject({ url: "/api/besucher/C", headers: { cookie: keks } });
    expect(detail.json<{ runden: { lapId: string }[] }>().runden.map((r) => r.lapId)).toEqual([
      "c1",
    ]);
  });

  it("Runden ohne Event lassen sich gezielt werten", async () => {
    const { s, keks } = await bahn();
    await waehle(s, keks, [""]);
    const liste = await bestenliste(s, keks);
    expect(liste.plaetze.map((p) => [p.guid, p.bestMs])).toEqual([["C", 2000]]);
  });

  it("die Gegenpruefung der Bahn zeigt weiter alles", async () => {
    const { s, keks } = await bahn();
    await waehle(s, keks, ["DevTest"]);
    const antwort = await s.app.inject({ url: "/carrera/runden/besucher/C" });
    expect(antwort.json<{ anzahl: number }>().anzahl).toBe(2);
  });

  it("Haken wieder weg: alles zaehlt wieder, nichts wurde geloescht", async () => {
    const { s, keks } = await bahn();
    await waehle(s, keks, ["NHV-2026"]);
    await waehle(s, keks, []);
    expect((await bestenliste(s, keks)).runden).toBe(4);
  });
});
