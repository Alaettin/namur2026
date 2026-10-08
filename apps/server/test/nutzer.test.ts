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

/**
 * Ein Passwort laesst sich **waehlen**, nicht nur wuerfeln.
 *
 * Bis zum 08.10.2026 gab es nur den Zufall: ein Betreuer, der sein Startpasswort verlor,
 * bekam ein neues zufaelliges und konnte es nie aendern.
 */
describe("Passwort setzen", () => {
  /** Legt einen Betreuer an und liefert Id und Startpasswort. */
  async function betreuer(s: Pruefstand, keks: string, email: string) {
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Probe Betreuer", email, rolle: "betreuer" },
    });
    return angelegt.json<{ id: string; startpasswort: string }>();
  }

  it("setzt genau das gewuenschte Passwort, und das alte gilt nicht mehr", async () => {
    const { stand: s, keks } = await alsAdmin();
    const b = await betreuer(s, keks, "waehlbar@namur.de");

    const gesetzt = await s.app.inject({
      method: "POST",
      url: `/api/nutzer/${b.id}/passwort`,
      headers: { cookie: keks },
      payload: { passwort: "Neo@Namur2026" },
    });
    expect(gesetzt.statusCode).toBe(200);
    expect(gesetzt.json<{ startpasswort: string }>().startpasswort).toBe("Neo@Namur2026");

    // Die eigentliche Pruefung: eine echte Anmeldung damit.
    await melde(s, "waehlbar@namur.de", "Neo@Namur2026");

    // Und die Gegenrichtung, sonst belegte der Fall nur, dass irgendetwas angenommen wurde.
    const alt = await s.app.inject({
      method: "POST",
      url: "/api/auth/anmelden",
      payload: { email: "waehlbar@namur.de", passwort: b.startpasswort },
    });
    expect(alt.statusCode).toBe(401);
  });

  it("wuerfelt weiterhin, wenn kein Passwort mitkommt", async () => {
    const { stand: s, keks } = await alsAdmin();
    const b = await betreuer(s, keks, "gewuerfelt@namur.de");

    for (const payload of [undefined, {}, { passwort: "" }]) {
      const antwort = await s.app.inject({
        method: "POST",
        url: `/api/nutzer/${b.id}/passwort`,
        headers: { cookie: keks },
        ...(payload === undefined ? {} : { payload }),
      });
      expect(antwort.statusCode, JSON.stringify(payload)).toBe(200);
      const neu = antwort.json<{ startpasswort: string }>().startpasswort;
      expect(neu, JSON.stringify(payload)).not.toBe("");
      // Das Erzeugte funktioniert auch wirklich.
      await melde(s, "gewuerfelt@namur.de", neu);
    }
  });

  /**
   * **Erst pruefen, dann schreiben.** Ein abgewiesener Versuch darf das Konto nicht
   * beschaedigen; sonst steht der Nutzer ohne gueltiges Passwort da.
   */
  it("weist zu kurze Passwoerter ab und laesst das alte gelten", async () => {
    const { stand: s, keks } = await alsAdmin();
    const b = await betreuer(s, keks, "zukurz@namur.de");

    const antwort = await s.app.inject({
      method: "POST",
      url: `/api/nutzer/${b.id}/passwort`,
      headers: { cookie: keks },
      payload: { passwort: "elfzeichen" },
    });
    expect(antwort.statusCode).toBe(400);
    expect(antwort.json<{ code: string }>().code).toBe("passwort-zu-kurz");

    // Das Startpasswort gilt weiterhin.
    await melde(s, "zukurz@namur.de", b.startpasswort);
  });

  it("nimmt genau zwoelf Zeichen an", async () => {
    const { stand: s, keks } = await alsAdmin();
    const b = await betreuer(s, keks, "genauzwoelf@namur.de");
    const antwort = await s.app.inject({
      method: "POST",
      url: `/api/nutzer/${b.id}/passwort`,
      headers: { cookie: keks },
      payload: { passwort: "zwoelfzeich" + "n" },
    });
    expect(antwort.statusCode).toBe(200);
    await melde(s, "genauzwoelf@namur.de", "zwoelfzeichn");
  });

  it("weist einen Betreuer ab", async () => {
    const { stand: s, keks } = await alsAdmin();
    const b = await betreuer(s, keks, "fremd@namur.de");
    const fremdKeks = await melde(s, "fremd@namur.de", b.startpasswort);

    const antwort = await s.app.inject({
      method: "POST",
      url: `/api/nutzer/${b.id}/passwort`,
      headers: { cookie: fremdKeks },
      payload: { passwort: "Neo@Namur2026" },
    });
    expect(antwort.statusCode).toBe(403);
  });
});
