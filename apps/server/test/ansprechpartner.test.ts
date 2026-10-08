import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };
const BASIC = { CONNECTOR_BASIC_USER: "axon", CONNECTOR_BASIC_PASSWORT: "geheim-fuer-axon" };
const KOPF = { authorization: `Basic ${Buffer.from("axon:geheim-fuer-axon").toString("base64")}` };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

async function alsAdmin() {
  stand = await starte({ ...ADMIN, ...BASIC });
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

async function legeExponatAn(s: Pruefstand, keks: string, name: string) {
  return (
    await s.app.inject({
      method: "POST",
      url: "/api/exponate",
      headers: { cookie: keks },
      payload: { name },
    })
  ).json<{ id: string; kennung: string }>();
}

async function legePersonAn(s: Pruefstand, keks: string, vorname: string, nachname: string) {
  return (
    await s.app.inject({
      method: "POST",
      url: "/api/ansprechpartner",
      headers: { cookie: keks },
      payload: { vorname, nachname, firma: "Neoception GmbH", email: "p@example.invalid" },
    })
  ).json<{ id: string }>();
}

describe("Ansprechpartner als Stammdaten", () => {
  it("legt an, listet und ändert", async () => {
    const { s, keks } = await alsAdmin();
    const person = await legePersonAn(s, keks, "Miriam", "Osterkamp");

    const liste = (
      await s.app.inject({ url: "/api/ansprechpartner", headers: { cookie: keks } })
    ).json<{ id: string; vorname: string; exponate: string[] }[]>();
    expect(liste).toHaveLength(1);
    expect(liste[0]?.exponate).toEqual([]);

    const geaendert = await s.app.inject({
      method: "PATCH",
      url: `/api/ansprechpartner/${person.id}`,
      headers: { cookie: keks },
      payload: { position: "Betriebsingenieurin" },
    });
    expect(geaendert.json<{ position: string; vorname: string }>()).toMatchObject({
      position: "Betriebsingenieurin",
      // Nicht genannte Felder bleiben stehen.
      vorname: "Miriam",
    });
  });

  /**
   * **Der Grund für den ganzen Umbau.** Vorher hing ein Ansprechpartner an genau einem
   * Exponat und musste für das zweite ein zweites Mal angelegt werden.
   */
  it("steht an mehreren Exponaten, je mit eigenem Platz", async () => {
    const { s, keks } = await alsAdmin();
    const eins = await legeExponatAn(s, keks, "Erstes");
    const zwei = await legeExponatAn(s, keks, "Zweites");
    const person = await legePersonAn(s, keks, "Hendrik", "Sassenberg");
    const andere = await legePersonAn(s, keks, "Anna", "Ahrens");

    // An E02 steht zuerst jemand anderes, damit die Plätze auseinanderlaufen.
    await s.app.inject({
      method: "POST",
      url: `/api/exponate/${zwei.id}/ansprechpartner`,
      headers: { cookie: keks },
      payload: { ansprechpartnerId: andere.id },
    });

    const anEins = await s.app.inject({
      method: "POST",
      url: `/api/exponate/${eins.id}/ansprechpartner`,
      headers: { cookie: keks },
      payload: { ansprechpartnerId: person.id },
    });
    const anZwei = await s.app.inject({
      method: "POST",
      url: `/api/exponate/${zwei.id}/ansprechpartner`,
      headers: { cookie: keks },
      payload: { ansprechpartnerId: person.id },
    });

    expect(anEins.json<{ platz: number }>().platz).toBe(1);
    // Am zweiten Exponat Platz 2, weil dort schon jemand auf 1 steht.
    expect(anZwei.json<{ platz: number }>().platz).toBe(2);

    // Und die Person weiß von beiden Exponaten.
    const detail = (
      await s.app.inject({ url: `/api/ansprechpartner/${person.id}`, headers: { cookie: keks } })
    ).json<{ exponate: string[] }>();
    expect(detail.exponate).toHaveLength(2);
  });

  it("weist dieselbe Person nicht zweimal demselben Exponat zu", async () => {
    const { s, keks } = await alsAdmin();
    const exponat = await legeExponatAn(s, keks, "Erstes");
    const person = await legePersonAn(s, keks, "Miriam", "Osterkamp");

    const zuweisen = () =>
      s.app.inject({
        method: "POST",
        url: `/api/exponate/${exponat.id}/ansprechpartner`,
        headers: { cookie: keks },
        payload: { ansprechpartnerId: person.id },
      });

    expect((await zuweisen()).statusCode).toBe(201);
    const zweimal = await zuweisen();
    expect(zweimal.statusCode).toBe(409);
    expect(zweimal.json<{ code: string }>().code).toBe("schon-zugewiesen");
  });

  it("sperrt die Zuweisung, wenn alle fuenf Plaetze belegt sind", async () => {
    const { s, keks } = await alsAdmin();
    const exponat = await legeExponatAn(s, keks, "Voll");

    for (let i = 1; i <= 5; i++) {
      const p = await legePersonAn(s, keks, `Vorname${String(i)}`, `Nachname${String(i)}`);
      const antwort = await s.app.inject({
        method: "POST",
        url: `/api/exponate/${exponat.id}/ansprechpartner`,
        headers: { cookie: keks },
        payload: { ansprechpartnerId: p.id },
      });
      expect(antwort.statusCode, `Platz ${String(i)}`).toBe(201);
    }

    const sechster = await legePersonAn(s, keks, "Einer", "ZuViel");
    const zuviel = await s.app.inject({
      method: "POST",
      url: `/api/exponate/${exponat.id}/ansprechpartner`,
      headers: { cookie: keks },
      payload: { ansprechpartnerId: sechster.id },
    });
    expect(zuviel.statusCode).toBe(409);
    expect(zuviel.json<{ code: string }>().code).toBe("kontingent-erschoepft");
  });

  /**
   * Die Zuweisung aufzuheben darf die **Person nicht löschen**: sie hängt womöglich noch
   * an anderen Exponaten.
   */
  it("hebt die Zuweisung auf, ohne die Person zu loeschen", async () => {
    const { s, keks } = await alsAdmin();
    const eins = await legeExponatAn(s, keks, "Erstes");
    const zwei = await legeExponatAn(s, keks, "Zweites");
    const person = await legePersonAn(s, keks, "Hendrik", "Sassenberg");

    for (const e of [eins, zwei]) {
      await s.app.inject({
        method: "POST",
        url: `/api/exponate/${e.id}/ansprechpartner`,
        headers: { cookie: keks },
        payload: { ansprechpartnerId: person.id },
      });
    }

    await s.app.inject({
      method: "DELETE",
      url: `/api/exponate/${eins.id}/inhalte/kontakt/${person.id}`,
      headers: { cookie: keks },
    });

    const detail = (
      await s.app.inject({ url: `/api/ansprechpartner/${person.id}`, headers: { cookie: keks } })
    ).json<{ exponate: string[] }>();
    // Noch am zweiten Exponat, und die Person gibt es weiterhin.
    expect(detail.exponate).toEqual([zwei.id]);
  });

  it("weist Betreuer und Unangemeldete ab", async () => {
    const { s, keks } = await alsAdmin();
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Kai", email: "kai-ap@namur.de", rolle: "betreuer" },
    });
    const { startpasswort } = angelegt.json<{ startpasswort: string }>();
    const betreuer = await melde(s, "kai-ap@namur.de", startpasswort);

    expect(
      (await s.app.inject({ url: "/api/ansprechpartner", headers: { cookie: betreuer } }))
        .statusCode,
    ).toBe(403);
    expect((await s.app.inject({ url: "/api/ansprechpartner" })).statusCode).toBe(401);
  });
});

describe("Ansprechpartner in der Konnektor-API", () => {
  it("erscheint bei beiden Exponaten mit dem jeweils richtigen Platz", async () => {
    const { s, keks } = await alsAdmin();
    await s.app.inject({ method: "POST", url: "/api/aussaat", headers: { cookie: keks } });

    /*
     * Die Aussaat weist denselben Menschen allen zehn Exponaten zu, je nach Belegung auf
     * einem anderen Platz. Ein Besucher mit Zuordnungen an einem Exponat muss ihn dort
     * unter der richtigen propertyId bekommen.
     */
    const exponate = (await s.app.inject({ url: "/api/exponate", headers: { cookie: keks } })).json<
      { id: string; kennung: string }[]
    >();
    const erstes = exponate[0];
    expect(erstes).toBeDefined();

    const inhalte = (
      await s.app.inject({ url: `/api/exponate/${erstes!.id}`, headers: { cookie: keks } })
    ).json<{ kontakte: { id: string; platz: number; vorname: string }[] }>();

    // Zwei Ansprechpartner je Exponat: der eigene und der gemeinsame.
    expect(inhalte.kontakte).toHaveLength(2);
    const gemeinsam = inhalte.kontakte.find((c) => c.vorname === "Hendrik");
    expect(gemeinsam).toBeDefined();

    // Einem Besucher zuordnen und in values nachsehen.
    const besucher = (
      await s.app.inject({
        method: "POST",
        url: "/api/besucher",
        headers: { cookie: keks },
        payload: { guid: "AP-TEST-1", vorname: "Testa", nachname: "Pruefer" },
      })
    ).json<{ guid: string }>();

    await s.app.inject({
      method: "POST",
      url: "/api/scan/zuordnen",
      headers: { cookie: keks },
      payload: {
        guid: besucher.guid,
        exponatId: erstes!.id,
        elemente: [{ art: "kontakt", zielId: gemeinsam!.id }],
      },
    });

    const werte = (
      await s.app.inject({
        method: "POST",
        url: `/connector/product/${besucher.guid}/values`,
        headers: KOPF,
        payload: {},
      })
    ).json<{ propertyId: string; value: string }[]>();

    const nr = String(gemeinsam!.platz).padStart(2, "0");
    const vorname = werte.find((w) => w.propertyId === `${erstes!.kennung}_Contact${nr}_FirstName`);
    expect(vorname?.value).toBe("Hendrik");

    // Kein Foto mehr, auch nicht als leerer Wert.
    expect(werte.filter((w) => w.propertyId.endsWith("_Image"))).toHaveLength(0);
  });
});
