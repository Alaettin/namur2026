import { afterEach, describe, expect, it } from "vitest";
import { FELDER_BESUCHER } from "../src/modell/modell.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Der akademische Titel.
 *
 * **Beim Besucher getrennt** (`Visitor_Title`), seit dem 19.10.2026; vorher stand er vorn im
 * Vornamen. **Beim Ansprechpartner weiter im Vornamen**, eine `_Contact*_Title`-Eigenschaft
 * gibt es nicht. Diese Datei haelt beide Seiten fest.
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

/** Ein Exponat mit einem Link, damit `{K}_Link01_Title` im Modell auftaucht. */
async function legeExponatMitInhalt(s: Pruefstand, keks: string): Promise<void> {
  const exponat = (
    await s.app.inject({
      method: "POST",
      url: "/api/exponate",
      headers: { cookie: keks },
      payload: { name: "Mit Link" },
    })
  ).json<{ id: string }>();

  await s.app.inject({
    method: "POST",
    url: `/api/exponate/${exponat.id}/links`,
    headers: { cookie: keks },
    payload: { url: "https://www.namur.net/", titel: "NAMUR" },
  });
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
  // Nur was einen Wert traegt; Leeres kommt seit dem 30.10.2026 als `value: null`.
  return antwort.json<Wert[]>().filter((w) => w.value !== null);
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

describe("Der Titel im Modell", () => {
  /**
   * **Genau diese beiden Formen, nicht alles mit "Title".** Der erste Anlauf suchte
   * `/title/i` ueber alle Eigenschaften und ging durch, weil der Pruefstand gar keine
   * Exponate hatte. Am Betriebsdienst traf dieselbe Suche 200 Eigenschaften, naemlich die
   * Dokument- und Linktitel, die es laengst gibt. Ein Kriterium, das bei richtigem Aufbau
   * rot wird, taugt nicht; deshalb legt dieser Fall ausdruecklich ein Exponat mit Link an,
   * damit die harmlosen Treffer ueberhaupt vorkommen.
   */
  it("kennt Visitor_Title, aber keinen Contact-Title, und die Dokumenttitel bleiben", async () => {
    const { s, keks } = await alsAdmin();
    await legeExponatMitInhalt(s, keks);
    const felder = await modell(s);
    const ids = felder.map((f) => f.id);

    expect(ids, "eigene Eigenschaft fuer den Titel").toContain("Visitor_Title");
    expect(
      ids.filter((i) => /_Contact\d+_Title$/.test(i)),
      "Titel am Ansprechpartner",
    ).toEqual([]);

    // Gegenprobe im selben Fall: die harmlosen Titel sind da, die Suche greift also.
    expect(ids.filter((i) => /_Link\d+_Title$/.test(i)).length).toBeGreaterThan(0);
  });

  /**
   * Die Zahl der Datenpunkte speist den ETag des Modells. Haette der Titel eine eigene
   * Eigenschaft, aenderte sie sich, und Axon zoege das Modell neu.
   */
  it("hat genau die Besucherfelder, die das Modell vorsieht", async () => {
    const { s } = await alsAdmin();
    const felder = await modell(s);

    /*
     * Gegen `FELDER_BESUCHER` geprueft, nicht gegen eine Zahl: seit dem 09.10.2026 kamen
     * 20 Rundenplaetze dazu, und eine abgetippte 11 waere dabei still falsch geworden.
     * Die Konstante speist zugleich die Anzeige auf der Seite Einstellungen.
     */
    const besucherfelder = felder.filter((f) => f.id.startsWith("Visitor_"));
    expect(besucherfelder).toHaveLength(FELDER_BESUCHER);
    expect(besucherfelder.map((f) => f.id)).toContain("Visitor_FirstName");
  });
});

describe("Der Titel in values", () => {
  it("liefert ihn beim Besucher getrennt vom Vornamen", async () => {
    const { s, keks } = await alsAdmin();
    await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid: "TITEL-0001", titel: "Dr.", vorname: "Anna", nachname: "Ahrens" },
    });

    const alle = await werte(s, "TITEL-0001");
    expect(text(alle, "Visitor_Title")).toBe("Dr.");
    expect(text(alle, "Visitor_FirstName")).toBe("Anna");
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
    expect(text(alle, "Visitor_Title"), "leerer Titel ausgeliefert").toBeUndefined();
  });

  it("nennt den Titel genau einmal und nicht noch im Vornamen", async () => {
    const { s, keks } = await alsAdmin();
    await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid: "TITEL-0003", titel: "Prof. Dr.", vorname: "Clara", nachname: "Groth" },
    });

    const alle = await werte(s, "TITEL-0003");
    expect(alle.filter((w) => /title/i.test(w.propertyId)).map((w) => w.propertyId)).toEqual([
      "Visitor_Title",
    ]);
    expect(text(alle, "Visitor_FirstName")).toBe("Clara");
  });

  /** Beim Ansprechpartner bleibt der Titel im Vornamen, Entscheidung vom 19.10.2026. */
  it("steht beim Ansprechpartner weiter im Vornamen", async () => {
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
    // Ansprechpartner kommen mit dem Exponat, sobald etwas zugeordnet ist; also ein Link.
    const link = (
      await s.app.inject({
        method: "POST",
        url: `/api/exponate/${exponat.id}/links`,
        headers: { cookie: keks },
        payload: { url: "https://www.namur.net/", titel: "NAMUR" },
      })
    ).json<{ id: string }>();

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
        elemente: [{ art: "link", zielId: link.id }],
      },
    });

    const alle = await werte(s, "TITEL-0004");
    expect(text(alle, `${exponat.kennung}_Contact01_FirstName`)).toBe("Dr. Dirk");
  });
});
