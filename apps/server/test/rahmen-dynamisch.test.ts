import { decode } from "jpeg-js";
import { afterEach, describe, expect, it } from "vitest";
import { RANGFARBEN } from "../src/services/rahmen.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * **Der Rahmen wandert, ohne Neustart.**
 *
 * Das ist die eigentliche Zusage: die Reihenfolge aendert sich waehrend der Messe mit jeder
 * gemeldeten Runde, und das Bild, das Axon bekommt, muss das sofort zeigen. Geprueft wird
 * deshalb nicht nur, **dass** ein Rahmen da ist, sondern dass er nach einer schnelleren
 * Runde eines anderen **die Farbe wechselt**, im selben Prozess.
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
  const werte = antwort.json<{ propertyId: string; value: string; size?: number }[]>();
  const avatar = werte.find((w) => w.propertyId === "Visitor_Avatar");
  expect(avatar, "kein Avatar in der Antwort").toBeDefined();
  const roh = Buffer.from(avatar?.value ?? "", "base64");
  // Die gemeldete Groesse muss zu den gesendeten Bytes passen, nicht zur Ablage.
  expect(avatar?.size, "size passt nicht zum Inhalt").toBe(roh.length);
  return roh;
}

/** Die Farbe der linken oberen Ecke. Dort liegt der Rahmen, wenn es einen gibt. */
function ecke(jpeg: Buffer) {
  const bild = decode(jpeg, { useTArray: true });
  return { r: bild.data[0] ?? 0, g: bild.data[1] ?? 0, b: bild.data[2] ?? 0 };
}

function abstand(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

describe("Der Rahmen folgt der Bestenliste", () => {
  it("wandert, wenn jemand anders schneller faehrt", async () => {
    const { s, keks } = await alsAdmin();
    await fahrer(s, keks, "RAHM-A", 4500);
    await fahrer(s, keks, "RAHM-B", 5500);
    await fahrer(s, keks, "RAHM-C", 6500);
    await fahrer(s, keks, "RAHM-D", 9500);

    // Ausgangslage: A Gold, D ohne Rahmen.
    expect(abstand(ecke(await avatarAusWerten(s, "RAHM-A")), RANGFARBEN[1])).toBeLessThan(40);
    expect(abstand(ecke(await avatarAusWerten(s, "RAHM-B")), RANGFARBEN[2])).toBeLessThan(40);
    expect(abstand(ecke(await avatarAusWerten(s, "RAHM-C")), RANGFARBEN[3])).toBeLessThan(40);

    const ohne = await avatarAusWerten(s, "RAHM-D");
    const eckeOhne = ecke(ohne);
    for (const rang of [1, 2, 3] as const) {
      expect(abstand(eckeOhne, RANGFARBEN[rang]), `Platz 4 traegt Farbe ${String(rang)}`).toBeGreaterThan(
        40,
      );
    }

    /*
     * **Jetzt faehrt D die schnellste Runde.** Kein Neustart, kein erneutes Laden: derselbe
     * Prozess, dieselbe Datenbank, nur eine Meldung mehr.
     */
    await fahrer(s, keks, "RAHM-D", 4000, 2);

    expect(abstand(ecke(await avatarAusWerten(s, "RAHM-D")), RANGFARBEN[1]), "D nicht Gold").toBeLessThan(
      40,
    );
    expect(abstand(ecke(await avatarAusWerten(s, "RAHM-A")), RANGFARBEN[2]), "A nicht Silber").toBeLessThan(
      40,
    );
    expect(abstand(ecke(await avatarAusWerten(s, "RAHM-B")), RANGFARBEN[3]), "B nicht Bronze").toBeLessThan(
      40,
    );

    // Und C ist vom Podest gefallen: keine der drei Farben mehr.
    const eckeC = ecke(await avatarAusWerten(s, "RAHM-C"));
    for (const rang of [1, 2, 3] as const) {
      expect(abstand(eckeC, RANGFARBEN[rang]), "C steht noch auf dem Podest").toBeGreaterThan(40);
    }
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
