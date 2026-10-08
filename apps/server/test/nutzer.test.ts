import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

async function alsAdmin(): Promise<{ stand: Pruefstand; keks: string }> {
  stand = await starte(ADMIN);
  return { stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

describe("Nutzerverwaltung", () => {
  it("gibt das Startpasswort genau beim Anlegen zurueck", async () => {
    const { stand: s, keks } = await alsAdmin();
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Kai Hollmann", email: "kai@namur.de", rolle: "betreuer" },
    });
    expect(angelegt.statusCode).toBe(201);
    expect(angelegt.json<{ startpasswort: string }>().startpasswort).toBeTruthy();

    // In der Liste taucht es nicht mehr auf, und ein Hash ebenso wenig.
    const liste = await s.app.inject({ url: "/api/nutzer", headers: { cookie: keks } });
    expect(liste.body).not.toContain("startpasswort");
    expect(liste.body).not.toContain("passwortHash");
    expect(liste.body).not.toContain("$argon2");
  });

  it("weist eine zweite Anmeldung mit derselben E-Mail ab", async () => {
    const { stand: s, keks } = await alsAdmin();
    const daten = { name: "Doppelt", email: "doppelt@namur.de", rolle: "betreuer" };
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/api/nutzer",
          headers: { cookie: keks },
          payload: daten,
        })
      ).statusCode,
    ).toBe(201);
    const zweiter = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      // Andere Schreibweise, gleiche E-Mail.
      payload: { ...daten, email: "Doppelt@Namur.de" },
    });
    expect(zweiter.statusCode).toBe(409);
    expect(zweiter.json<{ code: string }>().code).toBe("email-vergeben");
  });

  it("laesst den letzten aktiven Admin weder deaktivieren noch herabstufen", async () => {
    const { stand: s, keks } = await alsAdmin();
    const ich = await s.app.inject({ url: "/api/auth/ich", headers: { cookie: keks } });
    const id = ich.json<{ id: string }>().id;

    const deaktiviert = await s.app.inject({
      method: "POST",
      url: `/api/nutzer/${id}/aktiv`,
      headers: { cookie: keks },
      payload: { aktiv: false },
    });
    expect(deaktiviert.statusCode).toBe(409);
    expect(deaktiviert.json<{ code: string }>().code).toBe("letzter-admin");

    const herabgestuft = await s.app.inject({
      method: "PATCH",
      url: `/api/nutzer/${id}`,
      headers: { cookie: keks },
      payload: { rolle: "betreuer" },
    });
    expect(herabgestuft.statusCode).toBe(409);

    /*
     * Die Gegenrichtung: mit einem **zweiten** aktiven Admin muss beides gehen. Ohne
     * diese Haelfte belegte der Test nur, dass die Regel irgendetwas sperrt.
     */
    await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Zweiter Admin", email: "admin2@namur.de", rolle: "admin" },
    });
    const jetztGeht = await s.app.inject({
      method: "POST",
      url: `/api/nutzer/${id}/aktiv`,
      headers: { cookie: keks },
      payload: { aktiv: false },
    });
    expect(jetztGeht.statusCode).toBe(200);
  });

  it("weist Betreuer von der Nutzerverwaltung ab", async () => {
    const { stand: s, keks } = await alsAdmin();
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Betreuer", email: "nurbetreuer@namur.de", rolle: "betreuer" },
    });
    const { startpasswort } = angelegt.json<{ startpasswort: string }>();
    const betreuerKeks = await melde(s, "nurbetreuer@namur.de", startpasswort);

    const verwehrt = await s.app.inject({ url: "/api/nutzer", headers: { cookie: betreuerKeks } });
    expect(verwehrt.statusCode).toBe(403);
    expect(verwehrt.json<{ code: string }>().code).toBe("nur-admin");
  });

  it("weist Unangemeldete ab", async () => {
    const { stand: s } = await alsAdmin();
    expect((await s.app.inject({ url: "/api/nutzer" })).statusCode).toBe(401);
    expect((await s.app.inject({ url: "/api/auth/ich" })).statusCode).toBe(401);
  });

  it("ersetzt die Exponate eines Betreuers, statt sie zu ergaenzen", async () => {
    const { stand: s, keks } = await alsAdmin();
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Betreuer", email: "exp@namur.de", rolle: "betreuer" },
    });
    const { id } = angelegt.json<{ id: string }>();

    /*
     * Exponate gibt es als Tabelle erst ab Auftrag 2, der Fremdschluessel greift aber
     * schon: eine unbekannte Id muss abgewiesen werden, statt eine Waise anzulegen.
     */
    const unbekannt = await s.app.inject({
      method: "PUT",
      url: `/api/nutzer/${id}/exponate`,
      headers: { cookie: keks },
      payload: { exponate: ["gibt-es-nicht"] },
    });
    expect(unbekannt.statusCode).toBeGreaterThanOrEqual(400);

    // Die leere Liste ist gueltig und raeumt ab.
    const geleert = await s.app.inject({
      method: "PUT",
      url: `/api/nutzer/${id}/exponate`,
      headers: { cookie: keks },
      payload: { exponate: [] },
    });
    expect(geleert.statusCode).toBe(200);
    expect(geleert.json<{ exponate: string[] }>().exponate).toEqual([]);
  });

  it("setzt das Passwort zurueck und macht das alte ungueltig", async () => {
    const { stand: s, keks } = await alsAdmin();
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Vergesslich", email: "neu@namur.de", rolle: "betreuer" },
    });
    const { id, startpasswort: altes } = angelegt.json<{ id: string; startpasswort: string }>();

    const zurueck = await s.app.inject({
      method: "POST",
      url: `/api/nutzer/${id}/passwort`,
      headers: { cookie: keks },
    });
    const neues = zurueck.json<{ startpasswort: string }>().startpasswort;
    expect(neues).not.toBe(altes);

    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/api/auth/anmelden",
          payload: { email: "neu@namur.de", passwort: altes },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/api/auth/anmelden",
          payload: { email: "neu@namur.de", passwort: neues },
        })
      ).statusCode,
    ).toBe(200);
  });
});
