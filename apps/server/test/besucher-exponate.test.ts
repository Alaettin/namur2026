import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { appNutzer, zuordnungen } from "../src/db/schema.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Das Besucherdetail nach Exponaten, seit dem 19.10.2026: die Sicht je Exponat und das
 * Setzen des Sollzustands mit den Kaestchen.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

interface Sicht {
  id: string;
  kennung: string;
  besucht: boolean;
  dokumente: { id: string; zugeordnet: boolean }[];
  links: { id: string; zugeordnet: boolean }[];
  kontakte: { name: string }[];
}

async function aufbau() {
  stand = await starte(ADMIN);
  const s = stand;
  const keks = await melde(s, "admin@namur.de", "startpasswort-123");
  const ruf = async <T>(method: "GET" | "POST" | "PUT", url: string, payload?: object) => {
    const a = await s.app.inject({ method, url, headers: { cookie: keks }, payload });
    return { status: a.statusCode, json: (a.body === "" ? null : a.json()) as T };
  };

  const exponat = async (name: string, links: number) => {
    const e = (await ruf<{ id: string; kennung: string }>("POST", "/api/exponate", { name })).json;
    const ids: string[] = [];
    for (let i = 1; i <= links; i++) {
      ids.push(
        (
          await ruf<{ id: string }>("POST", `/api/exponate/${e.id}/links`, {
            url: "https://www.namur.net/",
            titel: `${name} ${String(i)}`,
          })
        ).json.id,
      );
    }
    return { ...e, links: ids };
  };

  const e1 = await exponat("Erstes", 2);
  const e2 = await exponat("Zweites", 1);
  const person = (
    await ruf<{ id: string }>("POST", "/api/ansprechpartner", { vorname: "Ines", nachname: "Ap" })
  ).json;
  await ruf("POST", `/api/exponate/${e1.id}/ansprechpartner`, { ansprechpartnerId: person.id });
  await ruf("POST", "/api/besucher", { guid: "BE-1", vorname: "Gast", nachname: "Eins" });

  const sicht = async () => (await ruf<Sicht[]>("GET", "/api/besucher/BE-1/exponate")).json;
  const setze = (exponatId: string, links: string[]) =>
    ruf<{ neu: number; entfernt: number }>("PUT", `/api/besucher/BE-1/zuordnungen/${exponatId}`, {
      elemente: links.map((zielId) => ({ art: "link", zielId })),
    });

  return { s, ruf, e1, e2, sicht, setze };
}

async function werte(s: Pruefstand): Promise<string[]> {
  const a = await s.app.inject({
    method: "POST",
    url: "/connector/product/BE-1/values",
    payload: {},
  });
  return a.json<{ propertyId: string }[]>().map((w) => w.propertyId);
}

describe("Besucherdetail nach Exponaten", () => {
  it("zeigt alle Exponate, auch unbesuchte, mit ihren Inhalten und Ansprechpartnern", async () => {
    const { e1, sicht } = await aufbau();
    const liste = await sicht();

    expect(liste.map((e) => e.besucht)).toEqual([false, false]);
    expect(liste[0]?.links).toHaveLength(2);
    expect(liste.find((e) => e.id === e1.id)?.kontakte.map((c) => c.name)).toEqual(["Ines Ap"]);
  });

  it("setzt ein Exponat ganz, teilweise und wieder leer", async () => {
    const { s, e1, sicht, setze } = await aufbau();

    expect((await setze(e1.id, e1.links)).json).toEqual({ neu: 2, entfernt: 0 });
    let ich = (await sicht()).find((e) => e.id === e1.id);
    expect(ich?.besucht).toBe(true);
    expect(ich?.links.every((l) => l.zugeordnet)).toBe(true);
    expect(await werte(s)).toContain(`${e1.kennung}_Contact01_LastName`);

    expect((await setze(e1.id, [e1.links[0]!])).json).toEqual({ neu: 0, entfernt: 1 });
    ich = (await sicht()).find((e) => e.id === e1.id);
    expect(ich?.links.map((l) => l.zugeordnet)).toEqual([true, false]);

    expect((await setze(e1.id, [])).json).toEqual({ neu: 0, entfernt: 1 });
    expect((await sicht()).find((e) => e.id === e1.id)?.besucht).toBe(false);
    expect((await werte(s)).filter((p) => p.startsWith(e1.kennung))).toEqual([]);
  });

  it("laesst andere Exponate unberuehrt", async () => {
    const { e1, e2, sicht, setze } = await aufbau();
    await setze(e1.id, e1.links);
    await setze(e2.id, e2.links);
    await setze(e1.id, []);

    const liste = await sicht();
    expect(liste.find((e) => e.id === e2.id)?.besucht).toBe(true);
  });

  /** Eine alte Ansprechpartner-Zeile zaehlt als besucht und geht beim Abwaehlen mit weg. */
  it("nimmt beim Abwaehlen auch eine alte kontakt-Zeile mit", async () => {
    const { s, e1, sicht, setze } = await aufbau();
    const nutzer = s.ctx.db.select({ id: appNutzer.id }).from(appNutzer).get();
    s.ctx.db
      .insert(zuordnungen)
      .values({
        id: randomUUID(),
        besucherGuid: "BE-1",
        exponatId: e1.id,
        art: "kontakt",
        zielId: "alt",
        appNutzerId: nutzer!.id,
      })
      .run();
    expect((await sicht()).find((e) => e.id === e1.id)?.besucht).toBe(true);

    expect((await setze(e1.id, [])).json).toEqual({ neu: 0, entfernt: 1 });
    expect((await sicht()).find((e) => e.id === e1.id)?.besucht).toBe(false);
  });

  it("weist ein Element eines fremden Exponats ab", async () => {
    const { e1, e2, setze } = await aufbau();
    expect((await setze(e1.id, e2.links)).status).toBe(404);
  });

  it("verdoppelt nichts, wenn ein Element zweimal kommt", async () => {
    const { e1, setze } = await aufbau();
    const doppelt = await setze(e1.id, [e1.links[0]!, e1.links[0]!]);
    expect(doppelt.status).toBe(200);
    expect(doppelt.json).toEqual({ neu: 1, entfernt: 0 });
  });

  it("ist ohne Admin nicht erreichbar", async () => {
    const { s, e1 } = await aufbau();
    const ohne = await s.app.inject({
      method: "PUT",
      url: `/api/besucher/BE-1/zuordnungen/${e1.id}`,
      payload: { elemente: [] },
    });
    expect(ohne.statusCode).toBe(401);
  });
});
