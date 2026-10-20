import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";
import { rangVonBild } from "./rahmen-hilfe.js";

/**
 * **Der Rahmen wandert, ohne Neustart.**
 *
 * Das ist die eigentliche Zusage: die Reihenfolge aendert sich waehrend der Messe mit jeder
 * gemeldeten Runde, und das Bild, das Axon bekommt, muss das sofort zeigen. Geprueft wird
 * deshalb nicht nur, **dass** ein Rahmen da ist, sondern dass er nach einer schnelleren
 * Runde eines anderen **das Overlay wechselt**, im selben Prozess.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

async function alsAdmin() {
  stand = await starte(ADMIN);
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

async function fahrer(s: Pruefstand, keks: string, guid: string, ms: number, nr = 1) {
  if (nr === 1) {
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid, vorname: "Renn", nachname: guid },
    });
    expect(angelegt.statusCode).toBe(201);
  }
  const gemeldet = await s.app.inject({
    method: "POST",
    url: "/carrera/runden",
    payload: {
      lap_id: `${guid}-${String(nr)}`,
      participant_id: guid,
      lap_number: nr,
      duration_ms: ms,
    },
  });
  expect(gemeldet.statusCode).toBe(200);
}

/** Das Avatarbild, so wie Axon es bekommt. */
async function avatarAusWerten(s: Pruefstand, guid: string): Promise<Buffer> {
  const antwort = await s.app.inject({
    method: "POST",
    url: `/connector/product/${guid}/values`,
    payload: {},
  });
  const werte =
    antwort.json<
      { propertyId: string; value: string; size?: number; mimeType?: string; filename?: string }[]
    >();
  const avatar = werte.find((w) => w.propertyId === "Visitor_Avatar");
  expect(avatar, "kein Avatar in der Antwort").toBeDefined();
  const roh = Buffer.from(avatar?.value ?? "", "base64");
  // Die gemeldete Groesse muss zu den gesendeten Bytes passen, nicht zur Ablage.
  expect(avatar?.size, "size passt nicht zum Inhalt").toBe(roh.length);
  // Gerahmt ist es ein PNG, ungerahmt das JPEG aus der Ablage; Typ und Endung muessen folgen.
  const istPng = roh[0] === 0x89 && roh[1] === 0x50;
  expect(avatar?.mimeType, "mimeType passt nicht zum Inhalt").toBe(
    istPng ? "image/png" : "image/jpeg",
  );
  expect(avatar?.filename ?? "", "Endung passt nicht zum Inhalt").toMatch(
    istPng ? /\.png$/ : /\.jpe?g$/,
  );
  return roh;
}

describe("Der Rahmen folgt der Bestenliste", () => {
  it("wandert, wenn jemand anders schneller faehrt", async () => {
    const { s, keks } = await alsAdmin();
    await fahrer(s, keks, "RAHM-A", 4500);
    await fahrer(s, keks, "RAHM-B", 5500);
    await fahrer(s, keks, "RAHM-C", 6500);
    await fahrer(s, keks, "RAHM-D", 9500);

    // Ausgangslage: A Gold, D ohne Rahmen.
    expect(rangVonBild(await avatarAusWerten(s, "RAHM-A")), "A nicht Gold").toBe(1);
    expect(rangVonBild(await avatarAusWerten(s, "RAHM-B")), "B nicht Silber").toBe(2);
    expect(rangVonBild(await avatarAusWerten(s, "RAHM-C")), "C nicht Bronze").toBe(3);
    expect(
      rangVonBild(await avatarAusWerten(s, "RAHM-D")),
      "Platz 4 traegt einen Rahmen",
    ).toBeNull();

    /*
     * **Jetzt faehrt D die schnellste Runde.** Kein Neustart, kein erneutes Laden: derselbe
     * Prozess, dieselbe Datenbank, nur eine Meldung mehr.
     */
    await fahrer(s, keks, "RAHM-D", 4000, 2);

    expect(rangVonBild(await avatarAusWerten(s, "RAHM-D")), "D nicht Gold").toBe(1);
    expect(rangVonBild(await avatarAusWerten(s, "RAHM-A")), "A nicht Silber").toBe(2);
    expect(rangVonBild(await avatarAusWerten(s, "RAHM-B")), "B nicht Bronze").toBe(3);

    // Und C ist vom Podest gefallen.
    expect(
      rangVonBild(await avatarAusWerten(s, "RAHM-C")),
      "C steht noch auf dem Podest",
    ).toBeNull();
  });

  /**
   * **Wer nie gefahren ist, bekommt sein Bild unveraendert.**
   *
   * Byteweise verglichen mit dem, was in der Ablage liegt: ein Rahmen auf jedem Bild waere
   * sonst nicht von „Rahmen nur fuer die ersten drei" zu unterscheiden.
   */
  it("laesst das Bild eines Besuchers ohne Runde unberuehrt", async () => {
    const { s, keks } = await alsAdmin();
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid: "RAHM-OHNE", vorname: "Ohne", nachname: "Runde" },
    });
    expect(angelegt.statusCode).toBe(201);

    const ausWerten = await avatarAusWerten(s, "RAHM-OHNE");
    const ausAblage = await s.app.inject({
      url: `/api/dateien/${angelegt.json<{ avatarDateiId: string }>().avatarDateiId}`,
      headers: { cookie: keks },
    });
    expect(ausAblage.statusCode).toBe(200);
    expect(ausWerten.equals(ausAblage.rawPayload), "Bild wurde veraendert").toBe(true);
  });
});
