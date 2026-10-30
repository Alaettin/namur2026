import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { appNutzer, zuordnungen } from "../src/db/schema.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Ansprechpartner kommen mit dem Exponat, seit dem 19.10.2026.
 *
 * Hat ein Besucher an einem Exponat irgendetwas bekommen, liefert der Konnektor **alle**
 * Ansprechpartner dieses Exponats. Steht derselbe Mensch an zwei Exponaten, geht er zweimal
 * hinaus, je unter seinem Platz an diesem Exponat.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

interface Wert {
  propertyId: string;
  value?: unknown;
}

async function alsAdmin() {
  stand = await starte(ADMIN);
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

type Aufruf = { method?: "GET" | "POST" | "DELETE"; url: string; payload?: object };

/** Ein angemeldeter Aufruf, der den Status prueft und den Rumpf liefert. */
function mit(s: Pruefstand, keks: string) {
  return async <T>({ method = "GET", url, payload }: Aufruf, status = 0): Promise<T> => {
    const antwort = await s.app.inject({ method, url, headers: { cookie: keks }, payload });
    if (status !== 0) expect(antwort.statusCode, `${method} ${url}`).toBe(status);
    else expect(antwort.statusCode, `${method} ${url}`).toBeLessThan(300);
    return (antwort.body === "" ? null : antwort.json()) as T;
  };
}

interface Aufbau {
  s: Pruefstand;
  ruf: ReturnType<typeof mit>;
  e1: { id: string; kennung: string; link: string };
  e2: { id: string; kennung: string; link: string };
  a1: string;
  b1: string;
}

/**
 * E1 mit A1 auf Platz 1. E2 mit B1, C1 und dann A1, also A1 dort auf Platz 3. Jedes
 * Exponat hat einen Link, damit sich ueberhaupt etwas zuordnen laesst.
 */
async function baueAuf(): Promise<Aufbau> {
  const { s, keks } = await alsAdmin();
  const ruf = mit(s, keks);

  const person = async (nachname: string) =>
    (
      await ruf<{ id: string }>({
        method: "POST",
        url: "/api/ansprechpartner",
        payload: { vorname: "Ap", nachname },
      })
    ).id;
  const a1 = await person("Eins");
  const b1 = await person("Zwei");
  const c1 = await person("Drei");

  const exponat = async (name: string, personen: string[]) => {
    const e = await ruf<{ id: string; kennung: string }>({
      method: "POST",
      url: "/api/exponate",
      payload: { name },
    });
    const link = await ruf<{ id: string }>({
      method: "POST",
      url: `/api/exponate/${e.id}/links`,
      payload: { url: "https://www.namur.net/", titel: name },
    });
    for (const p of personen) {
      await ruf({
        method: "POST",
        url: `/api/exponate/${e.id}/ansprechpartner`,
        payload: { ansprechpartnerId: p },
      });
    }
    return { ...e, link: link.id };
  };

  const e1 = await exponat("Erstes", [a1]);
  const e2 = await exponat("Zweites", [b1, c1, a1]);
  return { s, ruf, e1, e2, a1, b1 };
}

async function besucherMitLinks(a: Aufbau, guid: string, exponate: Aufbau["e1"][]) {
  await a.ruf({
    method: "POST",
    url: "/api/besucher",
    payload: { guid, vorname: "Gast", nachname: guid },
  });
  for (const e of exponate) {
    await a.ruf({
      method: "POST",
      url: "/api/scan/zuordnen",
      payload: { guid, exponatId: e.id, elemente: [{ art: "link", zielId: e.link }] },
    });
  }
}

async function werte(s: Pruefstand, guid: string): Promise<Wert[]> {
  const antwort = await s.app.inject({
    method: "POST",
    url: `/connector/product/${guid}/values`,
    payload: {},
  });
  expect(antwort.statusCode).toBe(200);
  // Nur was einen Wert traegt; Leeres kommt seit dem 30.10.2026 als `""` oder `null`.
  return antwort.json<Wert[]>().filter((w) => w.value !== null && w.value !== "");
}

function nachnamen(alle: Wert[]): Record<string, unknown> {
  return Object.fromEntries(
    alle
      .filter((w) => w.propertyId.endsWith("_LastName") && w.propertyId.includes("_Contact"))
      .map((w) => [w.propertyId, w.value]),
  );
}

describe("Ansprechpartner je Exponat im Konnektor", () => {
  it("liefert denselben Ansprechpartner an zwei Exponaten zweimal, je mit seinem Platz", async () => {
    const a = await baueAuf();
    await besucherMitLinks(a, "AP-BEIDE", [a.e1, a.e2]);

    expect(nachnamen(await werte(a.s, "AP-BEIDE"))).toEqual({
      [`${a.e1.kennung}_Contact01_LastName`]: "Eins",
      [`${a.e2.kennung}_Contact01_LastName`]: "Zwei",
      [`${a.e2.kennung}_Contact02_LastName`]: "Drei",
      [`${a.e2.kennung}_Contact03_LastName`]: "Eins",
    });
  });

  it("liefert nur die Ansprechpartner der Exponate, an denen der Besucher etwas bekam", async () => {
    const a = await baueAuf();
    await besucherMitLinks(a, "AP-NUR-E1", [a.e1]);

    expect(nachnamen(await werte(a.s, "AP-NUR-E1"))).toEqual({
      [`${a.e1.kennung}_Contact01_LastName`]: "Eins",
    });
  });

  it("nimmt einen Ansprechpartner nicht mehr als einzelne Zuordnung an", async () => {
    const a = await baueAuf();
    await a.ruf({
      method: "POST",
      url: "/api/besucher",
      payload: { guid: "AP-KONTAKT", vorname: "Gast", nachname: "Kontakt" },
    });
    const fehler = await a.ruf<{ code: string }>(
      {
        method: "POST",
        url: "/api/scan/zuordnen",
        payload: {
          guid: "AP-KONTAKT",
          exponatId: a.e1.id,
          elemente: [{ art: "kontakt", zielId: a.a1 }],
        },
      },
      400,
    );
    expect(JSON.stringify(fehler)).toContain("kontakt-automatisch");
  });

  it("zeigt Ansprechpartner im Scan ohne Haken und zaehlt sie nicht als offen", async () => {
    const a = await baueAuf();
    await a.ruf({
      method: "POST",
      url: "/api/besucher",
      payload: { guid: "AP-SCAN", vorname: "Gast", nachname: "Scan" },
    });
    const treffer = await a.ruf<{
      kontakte: { id: string; bereitsZugeordnet?: boolean }[];
      offen: number;
    }>({ url: `/api/scan/besucher/AP-SCAN?exponat=${a.e2.id}` });

    expect(treffer.kontakte).toHaveLength(3);
    expect(treffer.kontakte.every((c) => c.bereitsZugeordnet === undefined)).toBe(true);
    // Nur der eine Link ist offen.
    expect(treffer.offen).toBe(1);
  });

  it("sperrt den Scan an einem Exponat, das nur Ansprechpartner hat", async () => {
    const a = await baueAuf();
    const e = await a.ruf<{ id: string }>({
      method: "POST",
      url: "/api/exponate",
      payload: { name: "Nur Menschen" },
    });
    await a.ruf({
      method: "POST",
      url: `/api/exponate/${e.id}/ansprechpartner`,
      payload: { ansprechpartnerId: a.a1 },
    });

    expect((await a.ruf<{ scanbar: boolean }>({ url: `/api/exponate/${e.id}` })).scanbar).toBe(
      false,
    );
  });

  /**
   * **A1 an E1 aufheben laesst ihn an E2 stehen.** Bisher loeschte das ueber `zielId` auch
   * seine Zeilen an anderen Exponaten.
   */
  it("hebt eine Zuweisung nur an diesem Exponat auf und zaehlt dessen Besucher", async () => {
    const a = await baueAuf();
    await besucherMitLinks(a, "AP-AUFHEBEN", [a.e1, a.e2]);
    await besucherMitLinks(a, "AP-NUR-E2", [a.e2]);

    /*
     * **Eine Altzeile aus der Zeit vor dem 19.10.2026**: A1 an E2 einzeln zugeordnet. Das
     * Aufheben an E1 darf sie nicht treffen; ohne sie bliebe diese Pruefung leer, weil neue
     * Zuordnungen nie `kontakt` sind.
     */
    const nutzer = a.s.ctx.db.select({ id: appNutzer.id }).from(appNutzer).get();
    a.s.ctx.db
      .insert(zuordnungen)
      .values({
        id: randomUUID(),
        besucherGuid: "AP-NUR-E2",
        exponatId: a.e2.id,
        art: "kontakt",
        zielId: a.a1,
        appNutzerId: nutzer!.id,
      })
      .run();

    const { betroffene } = await a.ruf<{ betroffene: number }>({
      url: `/api/exponate/${a.e1.id}/inhalte/kontakt/${a.a1}/betroffene`,
    });
    expect(betroffene, "nur der Besucher von E1").toBe(1);

    await a.ruf({ method: "DELETE", url: `/api/exponate/${a.e1.id}/inhalte/kontakt/${a.a1}` }, 204);

    const danach = nachnamen(await werte(a.s, "AP-AUFHEBEN"));
    expect(danach).not.toHaveProperty(`${a.e1.kennung}_Contact01_LastName`);
    expect(danach[`${a.e2.kennung}_Contact03_LastName`]).toBe("Eins");
    expect(
      a.s.ctx.db
        .select()
        .from(zuordnungen)
        .all()
        .filter((z) => z.art === "kontakt"),
      "Altzeile an E2 geloescht",
    ).toHaveLength(1);
    // Der Link an E1 bleibt zugeordnet: der Besucher war dort.
    expect((await werte(a.s, "AP-AUFHEBEN")).map((w) => w.propertyId)).toContain(
      `${a.e1.kennung}_Link01_Url`,
    );
  });
});
