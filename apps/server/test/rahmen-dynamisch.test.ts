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

interface Punkt {
  r: number;
  g: number;
  b: number;
}

function abstand(a: Punkt, b: Punkt): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/**
 * Welchen Rang ein Bild traegt, oder `null` fuer keinen.
 *
 * **Gemessen wird mitten im linken Rand**, nicht in der Ecke: dort liegt seit dem
 * Metallrahmen die dunkle Aussenlinie, und die traegt absichtlich nicht die reine
 * Rangfarbe. Verglichen wird der **Farbton**, also auf gleiche Helligkeit gebracht; sonst
 * wandert aufgehelltes Bronze rechnerisch zu Gold.
 */
function rangVonBild(jpeg: Buffer): 1 | 2 | 3 | null {
  const bild = decode(jpeg, { useTArray: true });
  const rand = Math.round(Math.min(bild.width, bild.height) * 0.06);
  const i = (Math.floor(bild.height / 2) * bild.width + Math.floor(rand / 2)) * 4;
  const p: Punkt = { r: bild.data[i] ?? 0, g: bild.data[i + 1] ?? 0, b: bild.data[i + 2] ?? 0 };

  let bester: 1 | 2 | 3 = 1;
  let kleinster = Infinity;
  for (const rang of [1, 2, 3] as const) {
    const ziel = RANGFARBEN[rang];
    const f = (ziel.r + ziel.g + ziel.b) / (p.r + p.g + p.b || 1);
    const d = abstand({ r: p.r * f, g: p.g * f, b: p.b * f }, ziel);
    if (d < kleinster) {
      kleinster = d;
      bester = rang;
    }
  }

  /*
   * **Ein ungerahmtes Bild kommt irgendeiner Farbe am naechsten**, das sagt fuer sich
   * genommen nichts. Deshalb zusaetzlich die Schranke: nur wer nah genug dran ist, traegt
   * wirklich einen Rahmen.
   */
  return kleinster < 60 ? bester : null;
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
