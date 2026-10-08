import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

async function mitSaat() {
  stand = await starte(ADMIN);
  const keks = await melde(stand, "admin@namur.de", "startpasswort-123");
  await stand.app.inject({ method: "POST", url: "/api/aussaat", headers: { cookie: keks } });
  return { s: stand, keks };
}

describe("Entwicklermodus", () => {
  it("nennt den Bestand, der verschwinden wuerde", async () => {
    const { s, keks } = await mitSaat();
    const bestand = (
      await s.app.inject({ url: "/api/entwickler/bestand", headers: { cookie: keks } })
    ).json<Record<string, number>>();

    expect(bestand["besucher"]).toBe(700);
    expect(bestand["exponate"]).toBe(10);
    expect(bestand["zuordnungen"]).toBeGreaterThan(0);
    expect(bestand["dateien"]).toBeGreaterThan(0);
    // Die Nutzer bleiben, werden aber genannt, damit der Dialog es sagen kann.
    expect(bestand["appNutzer"]).toBe(1);
  });

  it("verlangt die Bestaetigung auch auf dem Server", async () => {
    const { s, keks } = await mitSaat();
    for (const koerper of [
      {},
      { bestaetigung: "" },
      { bestaetigung: "zuruecksetzen" },
      { bestaetigung: "ja" },
    ]) {
      const antwort = await s.app.inject({
        method: "POST",
        url: "/api/entwickler/zuruecksetzen",
        headers: { cookie: keks },
        payload: koerper,
      });
      expect(antwort.statusCode, JSON.stringify(koerper)).toBe(400);
    }
    // Der Bestand steht noch.
    const bestand = (
      await s.app.inject({ url: "/api/entwickler/bestand", headers: { cookie: keks } })
    ).json<Record<string, number>>();
    expect(bestand["besucher"]).toBe(700);
  });

  it("loescht den Fachbestand vollstaendig", async () => {
    const { s, keks } = await mitSaat();
    const antwort = await s.app.inject({
      method: "POST",
      url: "/api/entwickler/zuruecksetzen",
      headers: { cookie: keks },
      payload: { bestaetigung: "ZURUECKSETZEN" },
    });
    expect(antwort.statusCode).toBe(200);
    expect(antwort.json<{ geloescht: Record<string, number> }>().geloescht["besucher"]).toBe(700);

    const nachher = (
      await s.app.inject({ url: "/api/entwickler/bestand", headers: { cookie: keks } })
    ).json<Record<string, number>>();
    for (const feld of ["besucher", "exponate", "dokumente", "links", "kontakte", "zuordnungen"]) {
      expect(nachher[feld], feld).toBe(0);
    }
    /*
     * **Dateien: genau eine, nicht null.** Der Standard-Avatar wird nach dem Leeren wieder
     * angelegt. Vorher war er weg und kam erst beim naechsten Serverstart zurueck; bis
     * dahin antwortete `/api/standard-avatar` mit 404 und jeder Besucher erschien ohne Bild.
     */
    expect(nachher["dateien"], "nur der Standard-Avatar").toBe(1);
  });

  /**
   * **Die wichtigste Gegenprobe.** Nimmt das Zuruecksetzen die App-Nutzer mit, kommt danach
   * niemand mehr hinein: der Bootstrap aus `ADMIN_EMAIL` greift erst beim naechsten Start
   * und nur, solange kein Admin existiert.
   */
  it("laesst die App-Nutzer stehen, und die Anmeldung geht weiter", async () => {
    const { s, keks } = await mitSaat();
    await s.app.inject({
      method: "POST",
      url: "/api/entwickler/zuruecksetzen",
      headers: { cookie: keks },
      payload: { bestaetigung: "ZURUECKSETZEN" },
    });

    const nachher = (
      await s.app.inject({ url: "/api/entwickler/bestand", headers: { cookie: keks } })
    ).json<Record<string, number>>();
    expect(nachher["appNutzer"]).toBe(1);

    // Die laufende Sitzung gilt weiter.
    expect(
      (await s.app.inject({ url: "/api/auth/ich", headers: { cookie: keks } })).statusCode,
    ).toBe(200);
    // Und eine frische Anmeldung ebenfalls.
    await expect(melde(s, "admin@namur.de", "startpasswort-123")).resolves.toBeTruthy();
  });

  it("laesst danach erneut aussaeen", async () => {
    const { s, keks } = await mitSaat();
    // Vorher ist die Aussaat gesperrt, weil Exponate da sind.
    const gesperrt = await s.app.inject({
      method: "POST",
      url: "/api/aussaat",
      headers: { cookie: keks },
    });
    expect(gesperrt.statusCode).toBe(409);
    expect(gesperrt.json<{ code: string }>().code).toBe("aussaat-nicht-leer");

    await s.app.inject({
      method: "POST",
      url: "/api/entwickler/zuruecksetzen",
      headers: { cookie: keks },
      payload: { bestaetigung: "ZURUECKSETZEN" },
    });

    const wieder = await s.app.inject({
      method: "POST",
      url: "/api/aussaat",
      headers: { cookie: keks },
    });
    expect(wieder.statusCode).toBe(200);
    expect(wieder.json<{ besucher: number }>().besucher).toBe(700);
  });

  /** Die zweite Gegenprobe: ein Betreuer kommt an keinen der beiden Endpunkte. */
  it("weist Betreuer ab", async () => {
    const { s, keks } = await mitSaat();
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Kai", email: "kai@namur.de", rolle: "betreuer" },
    });
    const { startpasswort } = angelegt.json<{ startpasswort: string }>();
    const betreuerKeks = await melde(s, "kai@namur.de", startpasswort);

    expect(
      (await s.app.inject({ url: "/api/entwickler/bestand", headers: { cookie: betreuerKeks } }))
        .statusCode,
    ).toBe(403);
    const verwehrt = await s.app.inject({
      method: "POST",
      url: "/api/entwickler/zuruecksetzen",
      headers: { cookie: betreuerKeks },
      payload: { bestaetigung: "ZURUECKSETZEN" },
    });
    expect(verwehrt.statusCode).toBe(403);

    // Und der Bestand steht noch.
    const bestand = (
      await s.app.inject({ url: "/api/entwickler/bestand", headers: { cookie: keks } })
    ).json<Record<string, number>>();
    expect(bestand["besucher"]).toBe(700);
  });

  it("weist Unangemeldete ab", async () => {
    const { s } = await mitSaat();
    expect((await s.app.inject({ url: "/api/entwickler/bestand" })).statusCode).toBe(401);
    expect(
      (
        await s.app.inject({
          method: "POST",
          url: "/api/entwickler/zuruecksetzen",
          payload: { bestaetigung: "ZURUECKSETZEN" },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe("Aussaat", () => {
  it("legt 700 Besucher und 10 Exponate an", async () => {
    const { s, keks } = await mitSaat();
    const e = (
      await s.app.inject({ url: "/api/entwickler/bestand", headers: { cookie: keks } })
    ).json<Record<string, number>>();
    expect(e["besucher"]).toBe(700);
    expect(e["exponate"]).toBe(10);
  });

  /**
   * **Kein Vorname-Nachname-Paar zweimal.**
   *
   * Die fruehere Fassung zog beide per Modulo aus 25er-Listen und erzeugte dadurch dieselbe
   * Person mehrfach. Geprueft wird das Paar, nicht der einzelne Name: dass sich Vornamen
   * bei 700 Personen wiederholen, ist richtig.
   */
  it("vergibt kein Namenspaar doppelt", async () => {
    const { s, keks } = await mitSaat();
    const alle = (
      await s.app.inject({ url: "/api/besucher?groesse=200&seite=1", headers: { cookie: keks } })
    ).json<{ gesamt: number }>();
    expect(alle.gesamt).toBe(700);

    const paare = new Set<string>();
    for (let seite = 1; seite <= 4; seite++) {
      const liste = (
        await s.app.inject({
          url: `/api/besucher?groesse=200&seite=${String(seite)}`,
          headers: { cookie: keks },
        })
      ).json<{ eintraege: { vorname: string; nachname: string }[] }>();
      for (const b of liste.eintraege) paare.add(`${b.vorname} ${b.nachname}`);
    }
    expect(paare.size).toBe(700);
  });

  it("liefert zu Dokumenten den MIME-Typ mit", async () => {
    const { s, keks } = await mitSaat();
    const liste = (await s.app.inject({ url: "/api/exponate", headers: { cookie: keks } })).json<
      { id: string }[]
    >();
    const erstes = liste[0];
    expect(erstes).toBeDefined();

    const detail = (
      await s.app.inject({ url: `/api/exponate/${erstes!.id}`, headers: { cookie: keks } })
    ).json<{ dokumente: { mimeType: string | null; originalName: string | null }[] }>();

    // Die Aussaat legt je Exponat ein PDF und ein Bild an; beide Wege muessen erkennbar sein.
    const typen = detail.dokumente.map((d) => d.mimeType);
    expect(typen).toContain("application/pdf");
    expect(typen).toContain("image/png");
    expect(detail.dokumente[0]?.originalName).toBeTruthy();
  });
});
