import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

describe("Anmeldung", () => {
  it("legt den ersten Admin beim Start an und meldet ihn an", async () => {
    stand = await starte(ADMIN);
    const keks = await melde(stand, "admin@namur.de", "startpasswort-123");

    const ich = await stand.app.inject({ url: "/api/auth/ich", headers: { cookie: keks } });
    expect(ich.statusCode).toBe(200);
    expect(ich.json()).toMatchObject({ email: "admin@namur.de", rolle: "admin" });
  });

  it("legt keinen zweiten Admin an, wenn schon einer da ist", async () => {
    stand = await starte(ADMIN);
    const keks = await melde(stand, "admin@namur.de", "startpasswort-123");
    const vorher = await stand.app.inject({ url: "/api/nutzer", headers: { cookie: keks } });
    expect(vorher.json()).toHaveLength(1);

    // Gleicher Ordner, anderes Bootstrap-Passwort: es darf nichts passieren.
    const zweiterLauf = await stand.app.inject({
      method: "POST",
      url: "/api/auth/anmelden",
      payload: { email: "admin@namur.de", passwort: "ein-anderes-passwort" },
    });
    expect(zweiterLauf.statusCode).toBe(401);
  });

  it("nennt denselben Grund fuer falsches Passwort und unbekannte E-Mail", async () => {
    stand = await starte(ADMIN);
    const falsch = await stand.app.inject({
      method: "POST",
      url: "/api/auth/anmelden",
      payload: { email: "admin@namur.de", passwort: "stimmt-nicht" },
    });
    const unbekannt = await stand.app.inject({
      method: "POST",
      url: "/api/auth/anmelden",
      payload: { email: "niemand@namur.de", passwort: "stimmt-nicht" },
    });
    expect(falsch.statusCode).toBe(401);
    expect(unbekannt.statusCode).toBe(401);
    expect(falsch.json()).toEqual(unbekannt.json());
  });

  it("vergleicht E-Mails ohne Ruecksicht auf Gross- und Kleinschreibung", async () => {
    stand = await starte(ADMIN);
    const antwort = await stand.app.inject({
      method: "POST",
      url: "/api/auth/anmelden",
      payload: { email: "ADMIN@Namur.de", passwort: "startpasswort-123" },
    });
    expect(antwort.statusCode).toBe(200);
  });

  /**
   * **Es gibt keine Anmeldegrenze mehr.**
   *
   * Bis zum 09.10.2026 waren es 10 Versuche je Viertelstunde und E-Mail. Auf ausdrueckliche
   * Entscheidung entfernt, weil sie am Stand einen Betreuer mit Tippfehler fuer eine
   * Viertelstunde aussperrte.
   *
   * Der Fall steht hier weiter, nur umgedreht: faellt die Entscheidung einmal anders,
   * faellt er auf und niemand muss raten, ob die Grenze absichtlich fehlt.
   */
  it("laesst auch den elften Fehlversuch durch, ohne zu sperren", async () => {
    stand = await starte(ADMIN);
    const versuch = () =>
      stand!.app.inject({
        method: "POST",
        url: "/api/auth/anmelden",
        payload: { email: "admin@namur.de", passwort: "stimmt-nicht" },
      });

    for (let i = 0; i < 12; i++) {
      expect((await versuch()).statusCode, `Versuch ${String(i + 1)}`).toBe(401);
    }

    // Und das richtige Passwort geht danach weiterhin durch, nicht erst nach Wartezeit.
    const richtig = await stand.app.inject({
      method: "POST",
      url: "/api/auth/anmelden",
      payload: { email: "admin@namur.de", passwort: "startpasswort-123" },
    });
    expect(richtig.statusCode).toBe(200);
  });

  it("beendet die laufende Sitzung eines deaktivierten Nutzers", async () => {
    stand = await starte(ADMIN);
    const adminKeks = await melde(stand, "admin@namur.de", "startpasswort-123");

    const angelegt = await stand.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: adminKeks },
      payload: { name: "Betreuer", email: "b@namur.de", rolle: "betreuer" },
    });
    const { id, startpasswort } = angelegt.json<{ id: string; startpasswort: string }>();
    const betreuerKeks = await melde(stand, "b@namur.de", startpasswort);

    // Sitzung greift.
    expect(
      (await stand.app.inject({ url: "/api/auth/ich", headers: { cookie: betreuerKeks } }))
        .statusCode,
    ).toBe(200);

    await stand.app.inject({
      method: "POST",
      url: `/api/nutzer/${id}/aktiv`,
      headers: { cookie: adminKeks },
      payload: { aktiv: false },
    });

    // Dasselbe Cookie, unveraendert gueltig signiert, gilt ab jetzt nicht mehr.
    expect(
      (await stand.app.inject({ url: "/api/auth/ich", headers: { cookie: betreuerKeks } }))
        .statusCode,
    ).toBe(401);
  });

  it("laesst einen deaktivierten Nutzer sich nicht neu anmelden", async () => {
    stand = await starte(ADMIN);
    const adminKeks = await melde(stand, "admin@namur.de", "startpasswort-123");
    const angelegt = await stand.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: adminKeks },
      payload: { name: "Betreuer", email: "b2@namur.de", rolle: "betreuer" },
    });
    const { id, startpasswort } = angelegt.json<{ id: string; startpasswort: string }>();
    await stand.app.inject({
      method: "POST",
      url: `/api/nutzer/${id}/aktiv`,
      headers: { cookie: adminKeks },
      payload: { aktiv: false },
    });

    const antwort = await stand.app.inject({
      method: "POST",
      url: "/api/auth/anmelden",
      payload: { email: "b2@namur.de", passwort: startpasswort },
    });
    expect(antwort.statusCode).toBe(401);
  });
});
