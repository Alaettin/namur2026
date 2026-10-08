import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Ein Exponat loeschen, und was dabei mitgeht.
 *
 * Der Fremdschluessel steht auf `onDelete: "cascade"`: Dokumente, Links, Ansprechpartner,
 * Betreuer **und die Zuordnungen an Besucher** verschwinden mit. Was ein Besucher am Stand
 * schon bekommen hat, ist danach aus seinem Viewer weg. Die Oberflaeche nennt die Zahl
 * vorher; diese Pruefungen halten fest, dass die Zahl stimmt und dass der Schnitt nicht zu
 * weit greift.
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

/** Exponat mit einem Link, dazu ein Besucher, dem der Link zugeordnet wird. */
async function aufbau(s: Pruefstand, keks: string, name: string, guid: string) {
  const exponat = (
    await s.app.inject({
      method: "POST",
      url: "/api/exponate",
      headers: { cookie: keks },
      payload: { name },
    })
  ).json<{ id: string }>();

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
    payload: { guid, vorname: "Weg", nachname: "Damit" },
  });

  await s.app.inject({
    method: "POST",
    url: "/api/scan/zuordnen",
    headers: { cookie: keks },
    payload: { guid, exponatId: exponat.id, elemente: [{ art: "link", zielId: link.id }] },
  });

  return exponat.id;
}

/**
 * Wie viele Elemente der Viewer fuer diese GUID sieht.
 *
 * **Eine Differenz, kein absoluter Wert.** `/values` liefert immer auch die Stammdaten des
 * Besuchers, Null kann hier also nie herauskommen; geprueft wird deshalb, um wie viel die
 * Zahl faellt.
 */
async function sichtbareElemente(s: Pruefstand, guid: string): Promise<number> {
  const antwort = await s.app.inject({
    method: "POST",
    url: `/connector/product/${guid}/values`,
    payload: {},
  });
  return antwort.statusCode === 200 ? antwort.json<unknown[]>().length : -1;
}

describe("Exponat loeschen", () => {
  it("nennt vorher die Zahl der betroffenen Besucher", async () => {
    const { s, keks } = await alsAdmin();
    const id = await aufbau(s, keks, "Mit Zuordnung", "LOESCH-0001");

    const detail = (
      await s.app.inject({ url: `/api/exponate/${id}`, headers: { cookie: keks } })
    ).json<{ betroffeneBesucher: number }>();
    expect(detail.betroffeneBesucher).toBe(1);
  });

  /**
   * **Beide Haelften.** Dass die eigenen Zuordnungen weg sind, ist der Zweck; dass die
   * eines anderen Exponats bleiben, ist die eigentliche Pruefung. Ein zu weit greifendes
   * `delete` waere ohne sie unsichtbar, weil der gewollte Teil ja stimmt.
   */
  it("nimmt die eigenen Zuordnungen mit und laesst fremde stehen", async () => {
    const { s, keks } = await alsAdmin();
    const eins = await aufbau(s, keks, "Wird geloescht", "LOESCH-0002");
    const zwei = await aufbau(s, keks, "Bleibt stehen", "LOESCH-0003");

    /*
     * Ein dritter Besucher **ohne** jede Zuordnung ist der Vergleichswert. Eine feste Zahl
     * waere bruechig: eine Zuordnung erzeugt mehrere Eigenschaften im Modell, und wie
     * viele, ist eine Entscheidung des Modellschnitts und nicht Gegenstand dieser Pruefung.
     */
    await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid: "LOESCH-LEER", vorname: "Ohne", nachname: "Zuordnung" },
    });
    const nurStammdaten = await sichtbareElemente(s, "LOESCH-LEER");

    const vorher = await sichtbareElemente(s, "LOESCH-0002");
    const vorherAmAnderen = await sichtbareElemente(s, "LOESCH-0003");
    expect(vorher).toBeGreaterThan(nurStammdaten);
    expect(vorherAmAnderen).toBeGreaterThan(nurStammdaten);

    const weg = await s.app.inject({
      method: "DELETE",
      url: `/api/exponate/${eins}`,
      headers: { cookie: keks },
    });
    expect(weg.statusCode).toBe(204);

    // Das Exponat selbst ist fort.
    expect(
      (await s.app.inject({ url: `/api/exponate/${eins}`, headers: { cookie: keks } })).statusCode,
    ).toBe(404);

    /*
     * Der Besucher existiert weiter und sieht jetzt genau so viel wie einer, der nie
     * etwas zugeordnet bekam: seine Stammdaten, sonst nichts.
     */
    expect(await sichtbareElemente(s, "LOESCH-0002")).toBe(nurStammdaten);

    // Und das andere Exponat ist unberuehrt.
    expect(await sichtbareElemente(s, "LOESCH-0003")).toBe(vorherAmAnderen);
    expect(
      (await s.app.inject({ url: `/api/exponate/${zwei}`, headers: { cookie: keks } })).statusCode,
    ).toBe(200);
  });

  it("ist fuer Betreuer gesperrt", async () => {
    const { s, keks } = await alsAdmin();
    const id = await aufbau(s, keks, "Geschuetzt", "LOESCH-0004");

    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Betreuer Loesch", email: "betreuer-loesch@namur.de", rolle: "betreuer" },
    });
    const { startpasswort } = angelegt.json<{ startpasswort: string }>();
    const betreuerKeks = await melde(s, "betreuer-loesch@namur.de", startpasswort);

    const antwort = await s.app.inject({
      method: "DELETE",
      url: `/api/exponate/${id}`,
      headers: { cookie: betreuerKeks },
    });
    expect(antwort.statusCode).toBe(403);
  });
});
