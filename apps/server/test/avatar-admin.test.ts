import { afterEach, describe, expect, it } from "vitest";
import { STANDARD_AVATAR_ID } from "../src/services/standardavatar.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Den Avatar aus der Verwaltung waehlen, seit dem 20.10.2026.
 *
 * Wie am Tablet **nur Standard oder Galerie**. Dieselbe Pruefung greift seitdem auch beim
 * allgemeinen Anlegen und Aendern; vorher liess sich dort jede Datei-Id eintragen.
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
  const keks = await melde(s, "admin@namur.de", "startpasswort-123");
  const ruf = (method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
    s.app.inject({ method, url, headers: { cookie: keks }, payload });

  await ruf("POST", "/api/besucher", { guid: "AVA-ADM", vorname: "Ava", nachname: "Admin" });
  const galerie = (await ruf("GET", "/api/avatare")).json<{ avatare: { dateiId: string }[] }>();
  const bild = galerie.avatare[1]?.dateiId;
  expect(bild, "Galerie im Pruefstand leer").toBeDefined();

  // Eine Datei, die **kein** Galeriebild ist.
  const grenze = "----namuravatar";
  const pdf = await s.app.inject({
    method: "POST",
    url: "/api/dateien",
    headers: { cookie: keks, "content-type": `multipart/form-data; boundary=${grenze}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${grenze}\r\nContent-Disposition: form-data; name="datei"; filename="blatt.pdf"\r\n` +
          "Content-Type: application/pdf\r\n\r\n",
      ),
      Buffer.from("%PDF-1.4\n%%EOF\n"),
      Buffer.from(`\r\n--${grenze}--\r\n`),
    ]),
  });
  const fremd = pdf.json<{ id: string }>().id;

  return { s, ruf, bild: bild!, fremd };
}

async function avatarInWerten(s: Pruefstand): Promise<string | undefined> {
  const w = (
    await s.app.inject({ method: "POST", url: "/connector/product/AVA-ADM/values", payload: {} })
  ).json<{ propertyId: string; value: string }[]>();
  return w.find((x) => x.propertyId === "Visitor_Avatar")?.value;
}

describe("Avatar aus der Verwaltung", () => {
  it("setzt ein Galeriebild, und values liefert genau dieses", async () => {
    const { s, ruf, bild } = await aufbau();
    const vorher = await avatarInWerten(s);

    const a = await ruf("PATCH", "/api/besucher/AVA-ADM/avatar", { avatarDateiId: bild });
    expect(a.statusCode).toBe(200);
    expect(a.json<{ avatarDateiId: string }>().avatarDateiId).toBe(bild);

    const datei = await ruf("GET", `/api/dateien/${bild}`);
    expect(await avatarInWerten(s)).toBe(datei.rawPayload.toString("base64"));
    expect(await avatarInWerten(s)).not.toBe(vorher);
  });

  it("setzt mit null den Standard", async () => {
    const { ruf, bild } = await aufbau();
    await ruf("PATCH", "/api/besucher/AVA-ADM/avatar", { avatarDateiId: bild });
    const a = await ruf("PATCH", "/api/besucher/AVA-ADM/avatar", { avatarDateiId: null });
    expect(a.json<{ avatarDateiId: string }>().avatarDateiId).toBe(STANDARD_AVATAR_ID);
  });

  it("weist eine Datei ab, die kein Galeriebild ist", async () => {
    const { ruf, fremd } = await aufbau();
    const a = await ruf("PATCH", "/api/besucher/AVA-ADM/avatar", { avatarDateiId: fremd });
    expect(a.statusCode).toBe(400);
    expect(a.json<{ code: string }>().code).toBe("avatar-unbekannt");
  });

  /** Die Luecke vor dem 20.10.2026: das allgemeine Aendern und Anlegen pruefte nicht. */
  it("prueft auch beim allgemeinen Aendern und Anlegen", async () => {
    const { ruf, fremd, bild } = await aufbau();

    const aendern = await ruf("PATCH", "/api/besucher/AVA-ADM", { avatarDateiId: fremd });
    expect(aendern.statusCode).toBe(400);
    const anlegen = await ruf("POST", "/api/besucher", {
      guid: "AVA-NEU",
      vorname: "Neu",
      nachname: "Fremd",
      avatarDateiId: fremd,
    });
    expect(anlegen.statusCode).toBe(400);

    // Ein Galeriebild geht dort weiterhin, und ohne Feld bleibt alles wie es war.
    expect((await ruf("PATCH", "/api/besucher/AVA-ADM", { avatarDateiId: bild })).statusCode).toBe(
      200,
    );
    const ohne = await ruf("PATCH", "/api/besucher/AVA-ADM", { firma: "Nur Firma" });
    expect(ohne.json<{ avatarDateiId: string }>().avatarDateiId).toBe(bild);
  });

  it("ist ohne Anmeldung nicht erreichbar", async () => {
    const { s } = await aufbau();
    const a = await s.app.inject({
      method: "PATCH",
      url: "/api/besucher/AVA-ADM/avatar",
      payload: { avatarDateiId: null },
    });
    expect(a.statusCode).toBe(401);
  });
});
