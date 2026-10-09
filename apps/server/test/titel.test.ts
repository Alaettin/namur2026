import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Der akademische Titel.
 *
 * **Er hat bewusst keine eigene propertyId.** Das Konnektor-Modell hat der Content-Admin in
 * Axon gemappt; eine neue Eigenschaft haette er vor der Messe nachtragen muessen, sonst
 * waere der Titel im Viewer unsichtbar geblieben. Stattdessen geht er dem Vornamen voran.
 *
 * Diese Datei haelt beide Haelften fest: dass er ankommt, **und** dass das Modell sich
 * dabei nicht aendert.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

interface Eigenschaft {
  id: string;
  name: string;
  type: number;
}

interface Wert {
  propertyId: string;
  value?: unknown;
}

async function alsAdmin() {
  stand = await starte(ADMIN);
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

async function modell(s: Pruefstand): Promise<Eigenschaft[]> {
  const antwort = await s.app.inject({ url: "/connector/model" });
  expect(antwort.statusCode).toBe(200);
  return antwort.json<Eigenschaft[]>();
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

/** Der Text zu einer propertyId, oder `undefined`, wenn sie fehlt. */
function text(alle: Wert[], propertyId: string): string | undefined {
  const treffer = alle.find((w) => w.propertyId === propertyId);
  if (treffer === undefined) return undefined;
  const v = treffer.value;
  if (typeof v === "string") return v;
  // Werte mit Sprache kommen als Liste von { language, text }.
  if (Array.isArray(v) && typeof (v[0] as { text?: unknown } | undefined)?.text === "string") {
    return (v[0] as { text: string }).text;
  }
  return JSON.stringify(v);
}

describe("Das Modell aendert sich durch den Titel nicht", () => {
  /**
   * **Die wichtigste Pruefung dieser Runde.** Gaebe es `Visitor_Title`, haenge daran eine
   * Abstimmung mit Axon, von der niemand wuesste, bis am Stand ein Feld fehlt.
   */
  it("kennt keine Eigenschaft mit Title", async () => {
    const { s } = await alsAdmin();
    const felder = await modell(s);

    const titelartige = felder.filter((f) => /title/i.test(f.id));
    expect(
      titelartige.map((f) => f.id),
      "neue Eigenschaft im Modell",
    ).toEqual([]);
  });

  /**
   * Die Zahl der Datenpunkte speist den ETag des Modells. Haette der Titel eine eigene
   * Eigenschaft, aenderte sie sich, und Axon zoege das Modell neu.
   */
  it("hat genau die zehn Besucherfelder plus Foto", async () => {
    const { s } = await alsAdmin();
    const felder = await modell(s);

    const besucherfelder = felder.filter((f) => f.id.startsWith("Visitor_"));
    expect(besucherfelder).toHaveLength(11);
    expect(besucherfelder.map((f) => f.id)).toContain("Visitor_FirstName");
  });
});

describe("Der Titel geht am Vornamen hinaus", () => {
  it("stellt ihn dem Vornamen voran", async () => {
    const { s, keks } = await alsAdmin();
    await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid: "TITEL-0001", titel: "Dr.", vorname: "Anna", nachname: "Ahrens" },
    });

    const alle = await werte(s, "TITEL-0001");
    expect(text(alle, "Visitor_FirstName")).toBe("Dr. Anna");
    expect(text(alle, "Visitor_LastName")).toBe("Ahrens");
  });

  /**
   * **Die Gegenrichtung, und sie ist die heiklere.** Ohne Titel darf kein fuehrendes
   * Leerzeichen entstehen; genau das faellt niemandem auf, bis es auf einem Pass steht.
   */
  it("laesst den Vornamen ohne Titel unveraendert", async () => {
    const { s, keks } = await alsAdmin();
    await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid: "TITEL-0002", vorname: "Bernd", nachname: "Dietrich" },
    });

    const alle = await werte(s, "TITEL-0002");
    const vorname = text(alle, "Visitor_FirstName");
    expect(vorname).toBe("Bernd");
    expect(vorname?.startsWith(" "), "fuehrendes Leerzeichen").toBe(false);
  });

  it("gibt den Titel nicht zusaetzlich einzeln aus", async () => {
    const { s, keks } = await alsAdmin();
    await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid: "TITEL-0003", titel: "Prof. Dr.", vorname: "Clara", nachname: "Groth" },
    });

    const alle = await werte(s, "TITEL-0003");
    expect(alle.filter((w) => /title/i.test(w.propertyId))).toEqual([]);
  });

  /** Dieselbe Feldliste traegt die Ansprechpartner; also muss es dort genauso laufen. */
  it("gilt auch fuer einen Ansprechpartner am Exponat", async () => {
    const { s, keks } = await alsAdmin();

    const exponat = (
      await s.app.inject({
        method: "POST",
        url: "/api/exponate",
        headers: { cookie: keks },
        payload: { name: "Titelprobe" },
      })
    ).json<{ id: string; kennung: string }>();

    const person = (
      await s.app.inject({
        method: "POST",
        url: "/api/ansprechpartner",
        headers: { cookie: keks },
        payload: { titel: "Dr.", vorname: "Dirk", nachname: "Jansen" },
      })
    ).json<{ id: string }>();

    await s.app.inject({
      method: "POST",
      url: `/api/exponate/${exponat.id}/ansprechpartner`,
      headers: { cookie: keks },
      payload: { ansprechpartnerId: person.id },
    });

    await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid: "TITEL-0004", vorname: "Eva", nachname: "Klein" },
    });
    await s.app.inject({
      method: "POST",
      url: "/api/scan/zuordnen",
      headers: { cookie: keks },
      payload: {
        guid: "TITEL-0004",
        exponatId: exponat.id,
        elemente: [{ art: "kontakt", zielId: person.id }],
      },
    });

    const alle = await werte(s, "TITEL-0004");
    expect(text(alle, `${exponat.kennung}_Contact01_FirstName`)).toBe("Dr. Dirk");
  });
});
