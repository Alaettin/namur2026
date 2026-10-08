import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";

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

/** Legt ein Exponat mit einer Datei und einem Dokument an. */
async function mitExponat(s: Pruefstand, keks: string, name = "Pruefexponat") {
  const exponat = (
    await s.app.inject({
      method: "POST",
      url: "/api/exponate",
      headers: { cookie: keks },
      // Die Kennung vergibt der Server.
      payload: { name },
    })
  ).json<{ id: string }>();

  const grenze = "----namur";
  const koerper = Buffer.concat([
    Buffer.from(
      `--${grenze}\r\nContent-Disposition: form-data; name="datei"; filename="blatt.pdf"\r\n` +
        "Content-Type: application/octet-stream\r\n\r\n",
      "utf8",
    ),
    Buffer.from("%PDF-1.4 test\n"),
    Buffer.from(`\r\n--${grenze}--\r\n`, "utf8"),
  ]);
  const datei = (
    await s.app.inject({
      method: "POST",
      url: "/api/dateien",
      headers: { cookie: keks, "content-type": `multipart/form-data; boundary=${grenze}` },
      payload: koerper,
    })
  ).json<{ id: string }>();

  const dok = (
    await s.app.inject({
      method: "POST",
      url: `/api/exponate/${exponat.id}/dokumente`,
      headers: { cookie: keks },
      payload: { dateiId: datei.id, titel: "Datenblatt" },
    })
  ).json<{ id: string; platz: number }>();

  return { exponatId: exponat.id, dateiId: datei.id, dokumentId: dok.id, platz: dok.platz };
}

describe("Besucher", () => {
  it("erzeugt eine GUID, wenn keine angegeben ist", async () => {
    const { s, keks } = await alsAdmin();
    const antwort = await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { vorname: "Anna", nachname: "Ahrens" },
    });
    expect(antwort.statusCode).toBe(201);
    expect(antwort.json<{ guid: string }>().guid).toMatch(/^[A-Za-z0-9_-]{1,50}$/);
  });

  it("weist eine GUID ab, die das Muster verletzt", async () => {
    const { s, keks } = await alsAdmin();
    for (const guid of [
      "mit leerzeichen",
      "mit/schraegstrich",
      "a".repeat(51),
      "mit:doppelpunkt",
    ]) {
      const antwort = await s.app.inject({
        method: "POST",
        url: "/api/besucher",
        headers: { cookie: keks },
        payload: { guid, vorname: "A", nachname: "B" },
      });
      expect(antwort.statusCode, guid).toBe(400);
    }
    // Gegenrichtung: genau 50 Zeichen sind erlaubt.
    const grenzfall = await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid: "a".repeat(50), vorname: "A", nachname: "B" },
    });
    expect(grenzfall.statusCode).toBe(201);
  });

  it("zaehlt die Gesamtzahl mit demselben Filter wie die Seite", async () => {
    const { s, keks } = await alsAdmin();
    for (const name of ["Ahrens", "Brandt", "Ahrens"]) {
      await s.app.inject({
        method: "POST",
        url: "/api/besucher",
        headers: { cookie: keks },
        payload: { vorname: "Test", nachname: name },
      });
    }
    const gefiltert = (
      await s.app.inject({ url: "/api/besucher?suche=Ahrens", headers: { cookie: keks } })
    ).json<{ eintraege: unknown[]; gesamt: number }>();

    /*
     * Die Gesamtzahl muss den Filter kennen. Zaehlt eine der beiden Abfragen ohne ihn,
     * zeigt die Seitenumschaltung Seiten an, die es nicht gibt, und kein Test schlaegt
     * darauf an, solange nur die Liste geprueft wird.
     */
    expect(gefiltert.gesamt).toBe(2);
    expect(gefiltert.eintraege).toHaveLength(2);
  });
});

describe("Exponate und Plaetze", () => {
  it("vergibt die kleinste freie Nummer, nicht die naechsthoehere", async () => {
    const { s, keks } = await alsAdmin();
    const { exponatId, dateiId, dokumentId } = await mitExponat(s, keks, "Eins");

    const zweites = (
      await s.app.inject({
        method: "POST",
        url: `/api/exponate/${exponatId}/dokumente`,
        headers: { cookie: keks },
        payload: { dateiId, titel: "Zweites" },
      })
    ).json<{ platz: number }>();
    expect(zweites.platz).toBe(2);

    // Platz 1 freigeben.
    await s.app.inject({
      method: "DELETE",
      url: `/api/exponate/${exponatId}/inhalte/dokument/${dokumentId}`,
      headers: { cookie: keks },
    });

    const drittes = (
      await s.app.inject({
        method: "POST",
        url: `/api/exponate/${exponatId}/dokumente`,
        headers: { cookie: keks },
        payload: { dateiId, titel: "Drittes" },
      })
    ).json<{ platz: number }>();
    /*
     * **1, nicht 3.** Waere es `max + 1`, waere die Obergrenze nach zehn Loeschvorgaengen
     * erreicht, obwohl kaum Dokumente da sind.
     */
    expect(drittes.platz).toBe(1);
  });

  it("sperrt das Hinzufuegen, wenn alle zehn Plaetze belegt sind", async () => {
    const { s, keks } = await alsAdmin();
    const { exponatId, dateiId } = await mitExponat(s, keks, "Eins");

    for (let i = 2; i <= 10; i++) {
      const antwort = await s.app.inject({
        method: "POST",
        url: `/api/exponate/${exponatId}/dokumente`,
        headers: { cookie: keks },
        payload: { dateiId, titel: `Nr ${String(i)}` },
      });
      expect(antwort.statusCode, `Platz ${String(i)}`).toBe(201);
    }

    const elftes = await s.app.inject({
      method: "POST",
      url: `/api/exponate/${exponatId}/dokumente`,
      headers: { cookie: keks },
      payload: { dateiId, titel: "Eins zu viel" },
    });
    expect(elftes.statusCode).toBe(409);
    expect(elftes.json<{ code: string }>().code).toBe("kontingent-erschoepft");
  });

  /**
   * Die Kennung vergibt seit dem 08.10.2026 der Server, und zwar die **kleinste freie
   * Nummer**. Sie laesst sich nicht mehr aendern: sie steht in jedem propertyId dieses
   * Exponats, und ein Wechsel braeche das Mapping in Axon.
   */
  it("vergibt Kennungen fortlaufend und nimmt keine aus der Eingabe an", async () => {
    const { s, keks } = await alsAdmin();

    const erstes = await s.app.inject({
      method: "POST",
      url: "/api/exponate",
      headers: { cookie: keks },
      // Eine mitgeschickte Kennung wird **ignoriert**, nicht uebernommen.
      payload: { name: "Erstes", kennung: "ZZZ" },
    });
    expect(erstes.json<{ kennung: string }>().kennung).toBe("E01");

    const zweites = await s.app.inject({
      method: "POST",
      url: "/api/exponate",
      headers: { cookie: keks },
      payload: { name: "Zweites" },
    });
    expect(zweites.json<{ kennung: string }>().kennung).toBe("E02");
  });

  it("vergibt nach dem Loeschen die frei gewordene Kennung erneut", async () => {
    const { s, keks } = await alsAdmin();
    const anlegen = async (name: string) =>
      (
        await s.app.inject({
          method: "POST",
          url: "/api/exponate",
          headers: { cookie: keks },
          payload: { name },
        })
      ).json<{ id: string; kennung: string }>();

    const eins = await anlegen("Eins");
    await anlegen("Zwei");
    expect(eins.kennung).toBe("E01");

    await s.app.inject({
      method: "DELETE",
      url: `/api/exponate/${eins.id}`,
      headers: { cookie: keks },
    });

    /*
     * **E01 wird wieder vergeben**, Entscheidung des Nutzers vom 08.10.2026. Folge: das
     * neue Exponat erbt das Axon-Mapping des geloeschten. Der Test haelt das Verhalten
     * fest, damit es nicht versehentlich kippt.
     */
    const drittes = await anlegen("Drittes");
    expect(drittes.kennung).toBe("E01");
  });

  it("nimmt eine Kennungsaenderung nicht an", async () => {
    const { s, keks } = await alsAdmin();
    const { exponatId } = await mitExponat(s, keks);

    const antwort = await s.app.inject({
      method: "PATCH",
      url: `/api/exponate/${exponatId}`,
      headers: { cookie: keks },
      payload: { kennung: "E99", name: "Neuer Name" },
    });
    expect(antwort.statusCode).toBe(200);
    // Der Name wurde uebernommen, die Kennung nicht.
    const danach = antwort.json<{ kennung: string; name: string }>();
    expect(danach.name).toBe("Neuer Name");
    expect(danach.kennung).not.toBe("E99");
  });

  it("nennt die Zahl der betroffenen Besucher vor dem Loeschen", async () => {
    const { s, keks } = await alsAdmin();
    const { exponatId, dokumentId } = await mitExponat(s, keks, "Eins");
    const besucher = (
      await s.app.inject({
        method: "POST",
        url: "/api/besucher",
        headers: { cookie: keks },
        payload: { vorname: "Anna", nachname: "Ahrens" },
      })
    ).json<{ guid: string }>();

    await s.app.inject({
      method: "POST",
      url: "/api/scan/zuordnen",
      headers: { cookie: keks },
      payload: {
        guid: besucher.guid,
        exponatId,
        elemente: [{ art: "dokument", zielId: dokumentId }],
      },
    });

    const betroffene = (
      await s.app.inject({
        url: `/api/exponate/${exponatId}/inhalte/dokument/${dokumentId}/betroffene`,
        headers: { cookie: keks },
      })
    ).json<{ betroffene: number }>();
    expect(betroffene.betroffene).toBe(1);
  });
});

describe("Scan und Zuordnungen", () => {
  it("ist idempotent und meldet beim zweiten Mal null neue", async () => {
    const { s, keks } = await alsAdmin();
    const { exponatId, dokumentId } = await mitExponat(s, keks, "Eins");
    const besucher = (
      await s.app.inject({
        method: "POST",
        url: "/api/besucher",
        headers: { cookie: keks },
        payload: { vorname: "Anna", nachname: "Ahrens" },
      })
    ).json<{ guid: string }>();

    const rumpf = {
      guid: besucher.guid,
      exponatId,
      elemente: [{ art: "dokument", zielId: dokumentId }],
    };

    const erst = await s.app.inject({
      method: "POST",
      url: "/api/scan/zuordnen",
      headers: { cookie: keks },
      payload: rumpf,
    });
    expect(erst.json()).toEqual({ neu: 1, bereits: 0 });

    /*
     * **Derselbe Rumpf noch einmal**, wie ihn "Erneut versuchen" nach `ErrOffline`
     * schickt. Nichts Neues, kein Fehler, kein Doppelter.
     */
    const nochmal = await s.app.inject({
      method: "POST",
      url: "/api/scan/zuordnen",
      headers: { cookie: keks },
      payload: rumpf,
    });
    expect(nochmal.statusCode).toBe(200);
    expect(nochmal.json()).toEqual({ neu: 0, bereits: 1 });
  });

  it("weist ein Element ab, das zu einem anderen Exponat gehoert", async () => {
    const { s, keks } = await alsAdmin();
    const eins = await mitExponat(s, keks, "Eins");
    const zwei = await mitExponat(s, keks, "Zwei");
    const besucher = (
      await s.app.inject({
        method: "POST",
        url: "/api/besucher",
        headers: { cookie: keks },
        payload: { vorname: "Anna", nachname: "Ahrens" },
      })
    ).json<{ guid: string }>();

    const antwort = await s.app.inject({
      method: "POST",
      url: "/api/scan/zuordnen",
      headers: { cookie: keks },
      // Dokument von E02 am Exponat E01 zuordnen: das darf nicht gehen.
      payload: {
        guid: besucher.guid,
        exponatId: eins.exponatId,
        elemente: [{ art: "dokument", zielId: zwei.dokumentId }],
      },
    });
    expect(antwort.statusCode).toBe(404);
  });

  it("markiert bereits zugeordnete Elemente und zaehlt sie nicht als offen", async () => {
    const { s, keks } = await alsAdmin();
    const { exponatId, dokumentId, dateiId } = await mitExponat(s, keks, "Eins");
    await s.app.inject({
      method: "POST",
      url: `/api/exponate/${exponatId}/dokumente`,
      headers: { cookie: keks },
      payload: { dateiId, titel: "Zweites" },
    });
    const besucher = (
      await s.app.inject({
        method: "POST",
        url: "/api/besucher",
        headers: { cookie: keks },
        payload: { vorname: "Anna", nachname: "Ahrens" },
      })
    ).json<{ guid: string }>();

    await s.app.inject({
      method: "POST",
      url: "/api/scan/zuordnen",
      headers: { cookie: keks },
      payload: {
        guid: besucher.guid,
        exponatId,
        elemente: [{ art: "dokument", zielId: dokumentId }],
      },
    });

    const treffer = (
      await s.app.inject({
        url: `/api/scan/besucher/${besucher.guid}?exponat=${exponatId}`,
        headers: { cookie: keks },
      })
    ).json<{ dokumente: { id: string; bereitsZugeordnet: boolean }[]; offen: number }>();

    expect(treffer.dokumente.find((d) => d.id === dokumentId)?.bereitsZugeordnet).toBe(true);
    // Nur das zweite Dokument ist noch offen, also "Zuordnen (1)".
    expect(treffer.offen).toBe(1);
  });
});

describe("Rechte", () => {
  /** Legt einen Betreuer an und weist ihm ein Exponat zu. Liefert sein Cookie. */
  async function mitBetreuer(s: Pruefstand, keks: string, exponatId: string | null) {
    const nutzer = (
      await s.app.inject({
        method: "POST",
        url: "/api/nutzer",
        headers: { cookie: keks },
        payload: {
          name: "Kai",
          email: `kai-${String(Math.random()).slice(2)}@namur.de`,
          rolle: "betreuer",
        },
      })
    ).json<{ id: string; email: string; startpasswort: string }>();

    if (exponatId !== null) {
      await s.app.inject({
        method: "PUT",
        url: `/api/nutzer/${nutzer.id}/exponate`,
        headers: { cookie: keks },
        payload: { exponate: [exponatId] },
      });
    }
    return { nutzer, keks: await melde(s, nutzer.email, nutzer.startpasswort) };
  }

  it("zeigt einem Betreuer nur die eigenen Exponate", async () => {
    const { s, keks } = await alsAdmin();
    const eins = await mitExponat(s, keks, "Eins");
    await mitExponat(s, keks, "Zwei");
    const betreuer = await mitBetreuer(s, keks, eins.exponatId);

    const liste = (
      await s.app.inject({ url: "/api/exponate", headers: { cookie: betreuer.keks } })
    ).json<{ kennung: string }[]>();
    expect(liste).toHaveLength(1);
    expect(liste[0]?.kennung).toBe("E01");

    // Der Admin sieht beide.
    expect(
      (await s.app.inject({ url: "/api/exponate", headers: { cookie: keks } })).json<unknown[]>(),
    ).toHaveLength(2);
  });

  /**
   * **404 und nicht 403.** Ein 403 bestaetigte, dass es dieses Exponat gibt; das ist eine
   * Auskunft, die einem fremden Betreuer nicht zusteht.
   */
  it("antwortet einem Betreuer auf ein fremdes Exponat mit 404", async () => {
    const { s, keks } = await alsAdmin();
    await mitExponat(s, keks, "Eins");
    const fremd = await mitExponat(s, keks, "Zwei");
    const betreuer = await mitBetreuer(s, keks, null);

    const antwort = await s.app.inject({
      url: `/api/exponate/${fremd.exponatId}`,
      headers: { cookie: betreuer.keks },
    });
    expect(antwort.statusCode).toBe(404);
    expect(antwort.statusCode).not.toBe(403);
  });

  it("laesst einen Betreuer nicht an einem fremden Exponat scannen", async () => {
    const { s, keks } = await alsAdmin();
    const eigen = await mitExponat(s, keks, "Eins");
    const fremd = await mitExponat(s, keks, "Zwei");
    const betreuer = await mitBetreuer(s, keks, eigen.exponatId);
    const besucher = (
      await s.app.inject({
        method: "POST",
        url: "/api/besucher",
        headers: { cookie: keks },
        payload: { vorname: "Anna", nachname: "Ahrens" },
      })
    ).json<{ guid: string }>();

    const verwehrt = await s.app.inject({
      method: "POST",
      url: "/api/scan/zuordnen",
      headers: { cookie: betreuer.keks },
      payload: {
        guid: besucher.guid,
        exponatId: fremd.exponatId,
        elemente: [{ art: "dokument", zielId: fremd.dokumentId }],
      },
    });
    expect(verwehrt.statusCode).toBe(404);

    // Gegenrichtung: am eigenen Exponat geht es.
    const erlaubt = await s.app.inject({
      method: "POST",
      url: "/api/scan/zuordnen",
      headers: { cookie: betreuer.keks },
      payload: {
        guid: besucher.guid,
        exponatId: eigen.exponatId,
        elemente: [{ art: "dokument", zielId: eigen.dokumentId }],
      },
    });
    expect(erlaubt.statusCode).toBe(200);
  });

  it("haelt einen Betreuer von der Besucherliste fern", async () => {
    const { s, keks } = await alsAdmin();
    const eigen = await mitExponat(s, keks, "Eins");
    const betreuer = await mitBetreuer(s, keks, eigen.exponatId);

    expect(
      (await s.app.inject({ url: "/api/besucher", headers: { cookie: betreuer.keks } })).statusCode,
    ).toBe(403);
    expect(
      (await s.app.inject({ url: "/api/dashboard", headers: { cookie: betreuer.keks } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await s.app.inject({ url: "/api/konnektor/info", headers: { cookie: betreuer.keks } }))
        .statusCode,
    ).toBe(403);
  });

  it("laesst einen Betreuer keine Dokumente anlegen", async () => {
    const { s, keks } = await alsAdmin();
    const eigen = await mitExponat(s, keks, "Eins");
    const betreuer = await mitBetreuer(s, keks, eigen.exponatId);

    const antwort = await s.app.inject({
      method: "POST",
      url: `/api/exponate/${eigen.exponatId}/dokumente`,
      headers: { cookie: betreuer.keks },
      payload: { dateiId: eigen.dateiId, titel: "Darf nicht" },
    });
    expect(antwort.statusCode).toBe(403);
  });
});

describe("Dashboard", () => {
  it("nennt Besucher, Exponate und Personal", async () => {
    const { s, keks } = await alsAdmin();
    await mitExponat(s, keks, "Eins");
    await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { vorname: "Anna", nachname: "Ahrens" },
    });
    await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Kai", email: "kai-dash@namur.de", rolle: "betreuer" },
    });

    const d = (await s.app.inject({ url: "/api/dashboard", headers: { cookie: keks } })).json<{
      kennzahlen: Record<string, number>;
      jeExponat: unknown[];
      datenqualitaet?: unknown;
    }>();

    expect(d.kennzahlen["besucherGesamt"]).toBe(1);
    expect(d.kennzahlen["exponateGesamt"]).toBe(1);
    /*
     * **Personal ist Admin plus Betreuer**, also der Bootstrap-Admin und der eben
     * angelegte Betreuer.
     */
    expect(d.kennzahlen["personalGesamt"]).toBe(2);

    // Die Datenqualitaet ist entfallen und darf nicht als Rest mitkommen.
    expect(d.datenqualitaet).toBeUndefined();
    // Die Balken je Exponat bleiben, sie tragen die Zuordnungszahl weiterhin.
    expect(d.jeExponat).toHaveLength(1);
  });

  /**
   * Die zweite Kachelreihe.
   *
   * **Ansprechpartner zaehlt die angelegten Personen, nicht ihre Zuweisungen.** Deshalb
   * steht hier eine Person an **zwei** Exponaten: zaehlte die Kachel die Zuweisungen,
   * stuende dort 2 statt 1, und genau das soll der Fall festhalten.
   */
  it("nennt Dokumente, Links und Ansprechpartner", async () => {
    const { s, keks } = await alsAdmin();
    const eins = await mitExponat(s, keks, "Eins");
    const zwei = await mitExponat(s, keks, "Zwei");

    // Ein Dokument am ersten Exponat.
    await s.app.inject({
      method: "POST",
      url: `/api/exponate/${eins.exponatId}/dokumente`,
      headers: { cookie: keks },
      payload: { dateiId: eins.dateiId, titel: "Datenblatt" },
    });

    // Zwei Links, verteilt auf beide Exponate.
    for (const [id, titel] of [
      [eins.exponatId, "NAMUR"],
      [zwei.exponatId, "Neoception"],
    ]) {
      await s.app.inject({
        method: "POST",
        url: `/api/exponate/${id}/links`,
        headers: { cookie: keks },
        payload: { url: "https://www.namur.net/", titel },
      });
    }

    // **Eine** Person, an beiden Exponaten.
    const person = (
      await s.app.inject({
        method: "POST",
        url: "/api/ansprechpartner",
        headers: { cookie: keks },
        payload: { vorname: "Hendrik", nachname: "Sassenberg" },
      })
    ).json<{ id: string }>();
    for (const id of [eins.exponatId, zwei.exponatId]) {
      const zuweisung = await s.app.inject({
        method: "POST",
        url: `/api/exponate/${id}/ansprechpartner`,
        headers: { cookie: keks },
        payload: { ansprechpartnerId: person.id },
      });
      expect(zuweisung.statusCode, "Zuweisung").toBeLessThan(300);
    }

    const k = (await s.app.inject({ url: "/api/dashboard", headers: { cookie: keks } })).json<{
      kennzahlen: Record<string, number>;
    }>().kennzahlen;

    /*
     * Drei, nicht eins: `mitExponat` haengt an **jedes** Exponat bereits ein Dokument, dazu
     * kommt das oben angelegte. Die 1 war mein Irrtum ueber den Helfer, nicht der des Codes.
     */
    expect(k["dokumenteGesamt"]).toBe(3);
    expect(k["linksGesamt"]).toBe(2);
    expect(k["ansprechpartnerGesamt"]).toBe(1);
  });
});
