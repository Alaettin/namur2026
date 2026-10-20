import type { InjectOptions } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { exponatBetreuer, zuordnungen } from "../src/db/schema.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Nutzer loeschen, seit dem 20.10.2026.
 *
 * Die Kernzusage: **was ein Betreuer vergeben hat, bleibt beim Besucher.** Vorher
 * verhinderte die Pflichtspalte `zuordnungen.app_nutzer_id` jedes Loeschen eines solchen
 * Betreuers; jetzt wird sie `NULL`.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

async function aufbau() {
  stand = await starte(ADMIN);
  const s = stand;
  const admin = await melde(s, "admin@namur.de", "startpasswort-123");
  const ruf = async <T>(keks: string, opt: InjectOptions, status: number): Promise<T> => {
    const antwort = await s.app.inject({ ...opt, headers: { cookie: keks } });
    expect(antwort.statusCode, `${String(opt.method)} ${String(opt.url)}: ${antwort.body}`).toBe(
      status,
    );
    return (antwort.body === "" ? undefined : antwort.json()) as T;
  };

  const exponat = await ruf<{ id: string }>(
    admin,
    { method: "POST", url: "/api/exponate", payload: { name: "Ventil" } },
    201,
  );
  const link = await ruf<{ id: string }>(
    admin,
    {
      method: "POST",
      url: `/api/exponate/${exponat.id}/links`,
      payload: { url: "https://www.namur.net/loeschen", titel: "Bleibt" },
    },
    201,
  );
  const neu = async (name: string, rolle: string) =>
    ruf<{ id: string; email: string; startpasswort: string }>(
      admin,
      {
        method: "POST",
        url: "/api/nutzer",
        payload: { name, email: `${name}@namur.de`, rolle, exponate: [exponat.id] },
      },
      201,
    );
  return { s, admin, ruf, exponat, link, neu };
}

describe("Nutzer loeschen", () => {
  it("entfernt einen Betreuer, laesst aber stehen, was er vergeben hat", async () => {
    const { s, admin, ruf, exponat, link, neu } = await aufbau();
    const betreuer = await neu("betreuer", "betreuer");
    const bk = await melde(s, betreuer.email, betreuer.startpasswort);

    await ruf(
      admin,
      {
        method: "POST",
        url: "/api/besucher",
        payload: { guid: "LOE-1", vorname: "G", nachname: "H" },
      },
      201,
    );
    await ruf(
      bk,
      {
        method: "POST",
        url: "/api/scan/zuordnen",
        payload: {
          guid: "LOE-1",
          exponatId: exponat.id,
          elemente: [{ art: "link", zielId: link.id }],
        },
      },
      200,
    );

    await ruf(admin, { method: "DELETE", url: `/api/nutzer/${betreuer.id}` }, 204);

    // Weg aus der Liste, seine Exponat-Zuweisung per Kaskade auch.
    const liste = await ruf<{ id: string }[]>(admin, { method: "GET", url: "/api/nutzer" }, 200);
    expect(liste.map((n) => n.id)).not.toContain(betreuer.id);
    expect(s.ctx.db.select().from(exponatBetreuer).all()).toEqual([]);

    // Die Zuordnung steht noch, nur ohne Urheber.
    const reihen = s.ctx.db.select().from(zuordnungen).all();
    expect(reihen).toHaveLength(1);
    expect(reihen[0]?.appNutzerId).toBeNull();

    // Und der Besucher bekommt den Link im Konnektor weiter.
    const werte = (
      await s.app.inject({ method: "POST", url: "/connector/product/LOE-1/values", payload: {} })
    ).json<{ value: string }[]>();
    expect(werte.map((w) => w.value)).toContain("https://www.namur.net/loeschen");

    // Seine Sitzung endet bei der naechsten Anfrage.
    await ruf(bk, { method: "GET", url: "/api/auth/ich" }, 401);
  });

  it("verbietet, sich selbst zu loeschen", async () => {
    const { s, admin, ruf } = await aufbau();
    const ich = await ruf<{ id: string }>(admin, { method: "GET", url: "/api/auth/ich" }, 200);
    await ruf(admin, { method: "DELETE", url: `/api/nutzer/${ich.id}` }, 409);
    await ruf(admin, { method: "GET", url: "/api/auth/ich" }, 200);
    expect(s.ctx.db.select().from(zuordnungen).all()).toEqual([]);
  });

  it("laesst einen Admin einen anderen Admin loeschen", async () => {
    const { s, admin, ruf, neu } = await aufbau();
    const zweiter = await neu("zweiter", "admin");
    await ruf(admin, { method: "DELETE", url: `/api/nutzer/${zweiter.id}` }, 204);
    await expect(melde(s, zweiter.email, zweiter.startpasswort)).rejects.toThrow();
  });

  it("antwortet 404 fuer Unbekannte und 403 fuer Betreuer", async () => {
    const { s, admin, ruf, neu } = await aufbau();
    await ruf(admin, { method: "DELETE", url: "/api/nutzer/gibt-es-nicht" }, 404);

    const betreuer = await neu("betreuer", "betreuer");
    const anderer = await neu("anderer", "betreuer");
    const bk = await melde(s, betreuer.email, betreuer.startpasswort);
    await ruf(bk, { method: "DELETE", url: `/api/nutzer/${anderer.id}` }, 403);
    const liste = await ruf<{ id: string }[]>(admin, { method: "GET", url: "/api/nutzer" }, 200);
    expect(liste.map((n) => n.id)).toContain(anderer.id);
  });
});
