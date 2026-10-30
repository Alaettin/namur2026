import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Der eigene Carrera-Platz eines Besuchers im Konnektor, seit dem 30.10.2026.
 *
 * `Visitor_Rank` ist ein Satz: "Platz 2 von 3, beste Runde 5,000 s". Gerechnet wie die
 * Bestenliste; wer nicht gefahren ist, bekommt nichts.
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

async function besucher(s: Pruefstand, keks: string, guid: string) {
  const antwort = await s.app.inject({
    method: "POST",
    url: "/api/besucher",
    headers: { cookie: keks },
    payload: { guid, vorname: "Renn", nachname: guid },
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

async function platz(s: Pruefstand, guid: string): Promise<unknown> {
  const antwort = await s.app.inject({
    method: "POST",
    url: `/connector/product/${guid}/values`,
    payload: {},
  });
  expect(antwort.statusCode).toBe(200);
  return antwort.json<Wert[]>().find((w) => w.propertyId === "Visitor_Rank")?.value;
}

describe("Visitor_Rank im Konnektor", () => {
  it("steht im Modell", async () => {
    const { s } = await alsAdmin();
    const modell = (await s.app.inject({ url: "/connector/model" })).json<{ id: string }[]>();
    expect(modell.map((f) => f.id)).toContain("Visitor_Rank");
  });

  it("nennt Platz, Gesamtzahl und die beste eigene Runde", async () => {
    const { s, keks } = await alsAdmin();
    for (const g of ["P-A", "P-B", "P-C", "P-D"]) await besucher(s, keks, g);
    await runde(s, "a1", "P-A", 4000);
    // B faehrt zweimal und zaehlt einmal, mit der besten Runde.
    await runde(s, "b1", "P-B", 7000);
    await runde(s, "b2", "P-B", 5000);
    await runde(s, "c1", "P-C", 6000);

    expect(await platz(s, "P-A")).toBe("Platz 1 von 3, beste Runde 4,000 s");
    expect(await platz(s, "P-B")).toBe("Platz 2 von 3, beste Runde 5,000 s");
    expect(await platz(s, "P-C")).toBe("Platz 3 von 3, beste Runde 6,000 s");
    // Nicht gefahren: nichts, nicht "Platz 4".
    expect(await platz(s, "P-D")).toBeUndefined();
  });

  it("entscheidet Gleichstand wie die Bestenliste, nach GUID", async () => {
    const { s, keks } = await alsAdmin();
    for (const g of ["G-2", "G-1"]) await besucher(s, keks, g);
    await runde(s, "x2", "G-2", 5000);
    await runde(s, "x1", "G-1", 5000);

    expect(await platz(s, "G-1")).toBe("Platz 1 von 2, beste Runde 5,000 s");
    expect(await platz(s, "G-2")).toBe("Platz 2 von 2, beste Runde 5,000 s");
  });

  it("zaehlt nur gewertete Events", async () => {
    const { s, keks } = await alsAdmin();
    for (const g of ["E-A", "E-B", "E-C"]) await besucher(s, keks, g);
    // A ist nur im Test schnell und faellt mit der Wahl heraus.
    await runde(s, "t1", "E-A", 1000, "DevTest");
    await runde(s, "h1", "E-B", 5000, "NHV-2026");
    await runde(s, "h2", "E-C", 6000, "NHV-2026");
    expect(await platz(s, "E-B")).toBe("Platz 2 von 3, beste Runde 5,000 s");

    const wahl = await s.app.inject({
      method: "PUT",
      url: "/api/carrera/events",
      headers: { cookie: keks },
      payload: { eventIds: ["NHV-2026"] },
    });
    expect(wahl.statusCode).toBe(200);

    expect(await platz(s, "E-B")).toBe("Platz 1 von 2, beste Runde 5,000 s");
    expect(await platz(s, "E-C")).toBe("Platz 2 von 2, beste Runde 6,000 s");
    expect(await platz(s, "E-A")).toBeUndefined();
  });
});
