import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROJEKT_WURZEL } from "../src/env.js";
import { galerieIds, STANDARD_AVATAR_ID } from "../src/services/standardavatar.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Der Standard-Avatar als Rueckfall.
 *
 * Seit dem 08.10.2026 laedt niemand mehr ein Foto hoch. `avatarDateiId` ist deshalb bei
 * allen `null`, und ohne den Rueckfall erschiene im Viewer gar kein Bild.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };
const BASIC = { CONNECTOR_BASIC_USER: "axon", CONNECTOR_BASIC_PASSWORT: "geheim-fuer-axon" };
const KOPF = { authorization: `Basic ${Buffer.from("axon:geheim-fuer-axon").toString("base64")}` };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

interface Eigenschaft {
  propertyId: string;
  value: string;
  mimeType?: string;
  needsResolve?: boolean;
}

/** Legt einen Besucher an und holt seine Werte ueber die Konnektor-API. */
async function werteVon(s: Pruefstand, keks: string, guid: string): Promise<Eigenschaft[]> {
  await s.app.inject({
    method: "POST",
    url: "/api/besucher",
    headers: { cookie: keks },
    payload: { guid, vorname: "Ohne", nachname: "Bild" },
  });
  const antwort = await s.app.inject({
    method: "POST",
    url: `/connector/product/${guid}/values`,
    headers: KOPF,
    payload: {},
  });
  expect(antwort.statusCode).toBe(200);
  // Die Antwort ist ein **flaches Array**, kein Objekt mit `properties`.
  return antwort.json<Eigenschaft[]>();
}

describe("Standard-Avatar", () => {
  it("wird beim Start einmal angelegt und beim zweiten Start nicht noch einmal", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    const keks = await melde(stand, "admin@namur.de", "startpasswort-123");

    const erste = await stand.app.inject({
      url: "/api/standard-avatar",
      headers: { cookie: keks },
    });
    expect(erste.statusCode).toBe(200);
    expect(erste.headers["content-type"]).toBe("image/jpeg");

    /*
     * Zweiter Start auf **demselben** Datenordner. Ohne die Pruefung in
     * `stelleStandardAvatarSicher` laege danach eine zweite Datei in der Ablage, und bei
     * jedem Neustart eine weitere.
     */
    const ordner = stand.env.dataDir;
    await stand.close();
    const zweiter = await starte({ ...ADMIN, ...BASIC, DATA_DIR: ordner });
    const keks2 = await melde(zweiter, "admin@namur.de", "startpasswort-123");
    const bestand = await zweiter.app.inject({
      url: "/api/entwickler/bestand",
      headers: { cookie: keks2 },
    });
    stand = zweiter;
    /*
     * Genau die angelegten Dateien: der Standard-Avatar plus die Galerie, **keine
     * Dubletten**. Darum geht es hier; dass es einmal 1 war, war nur der damalige Stand.
     */
    expect(bestand.json<{ dateien: number }>().dateien).toBe(1 + galerieIds().length);
  });

  it("erscheint in den Werten, obwohl der Besucher kein eigenes Bild hat", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    const keks = await melde(stand, "admin@namur.de", "startpasswort-123");
    const werte = await werteVon(stand, keks, "AVATAR-0001");

    const avatar = werte.find((w) => w.propertyId === "Visitor_Avatar");
    expect(avatar, "Visitor_Avatar fehlt in den Werten").toBeDefined();
    expect(avatar?.mimeType).toBe("image/jpeg");
    // Bilder gehen By Value, niemals ueber ein Ticket.
    expect(avatar?.needsResolve).toBe(false);

    // Der Inhalt ist nachweislich die ausgelieferte Datei, nicht irgendein Bild.
    const datei = await readFile(resolve(PROJEKT_WURZEL, "apps/server/assets/standard-avatar.jpg"));
    expect(avatar?.value).toBe(datei.toString("base64"));
  });

  /**
   * **Die Gegenrichtung.** Ohne sie belegte der Fall oben nur, dass irgendein Bild kommt,
   * nicht dass ein eigenes Bild weiterhin gewinnt. Daran haengt die spaeter geplante
   * Funktion zum Aendern des Avatars.
   */
  it("weicht einem eigenen Bild des Besuchers", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    const keks = await melde(stand, "admin@namur.de", "startpasswort-123");
    const guid = "AVATAR-0002";
    await stand.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid, vorname: "Mit", nachname: "Bild" },
    });

    const grenze = "----namur";
    const eigenes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const koerper = Buffer.concat([
      Buffer.from(
        `--${grenze}\r\nContent-Disposition: form-data; name="datei"; filename="eigen.png"\r\n` +
          "Content-Type: application/octet-stream\r\n\r\n",
        "utf8",
      ),
      eigenes,
      Buffer.from(`\r\n--${grenze}--\r\n`, "utf8"),
    ]);
    const datei = (
      await stand.app.inject({
        method: "POST",
        url: "/api/dateien",
        headers: { cookie: keks, "content-type": `multipart/form-data; boundary=${grenze}` },
        payload: koerper,
      })
    ).json<{ id: string }>();

    await stand.app.inject({
      method: "PATCH",
      url: `/api/besucher/${guid}`,
      headers: { cookie: keks },
      payload: { avatarDateiId: datei.id },
    });

    const antwort = await stand.app.inject({
      method: "POST",
      url: `/connector/product/${guid}/values`,
      headers: KOPF,
      payload: {},
    });
    const avatar = antwort.json<Eigenschaft[]>().find((w) => w.propertyId === "Visitor_Avatar");
    expect(avatar?.value).toBe(eigenes.toString("base64"));
    expect(avatar?.mimeType).toBe("image/png");
  });

  it("laesst sich nicht ueber die Datei-Route loeschen", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    const keks = await melde(stand, "admin@namur.de", "startpasswort-123");

    const antwort = await stand.app.inject({
      method: "DELETE",
      url: `/api/dateien/${STANDARD_AVATAR_ID}`,
      headers: { cookie: keks },
    });
    expect(antwort.statusCode).toBe(403);
    expect(antwort.json<{ code: string }>().code).toBe("standard-avatar-geschuetzt");

    // Und er ist danach noch da.
    expect(
      (await stand.app.inject({ url: "/api/standard-avatar", headers: { cookie: keks } }))
        .statusCode,
    ).toBe(200);
  });

  /**
   * **Der gemeldete Fehler vom 08.10.2026.**
   *
   * `setzeZurueck` leert `dateien` vollstaendig, und angelegt wurde der Standard-Avatar nur
   * beim **Start**. Nach einem Zuruecksetzen war er bis zum naechsten Neustart weg:
   * `/api/standard-avatar` antwortete 404, und jeder Besucher erschien ohne Bild.
   */
  it("ist nach dem Zuruecksetzen wieder da", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    const keks = await melde(stand, "admin@namur.de", "startpasswort-123");

    const zurueck = await stand.app.inject({
      method: "POST",
      url: "/api/entwickler/zuruecksetzen",
      headers: { cookie: keks },
      payload: { bestaetigung: "ZURUECKSETZEN" },
    });
    expect(zurueck.statusCode, zurueck.body).toBe(200);

    const bild = await stand.app.inject({ url: "/api/standard-avatar", headers: { cookie: keks } });
    expect(bild.statusCode, "nach dem Zuruecksetzen fehlt der Standard-Avatar").toBe(200);
    expect(bild.headers["content-type"]).toBe("image/jpeg");

    // Und ein danach angelegter Besucher traegt ihn auch.
    const neu = await stand.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid: "NACH-RESET", vorname: "Nach", nachname: "Reset" },
    });
    expect(neu.json<{ avatarDateiId: string | null }>().avatarDateiId).toBe(STANDARD_AVATAR_ID);
  });

  it("wird jedem neu angelegten Besucher zugewiesen", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    const keks = await melde(stand, "admin@namur.de", "startpasswort-123");

    const einzeln = await stand.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid: "EINZELN-1", vorname: "Einzeln", nachname: "Probe" },
    });
    expect(einzeln.json<{ avatarDateiId: string | null }>().avatarDateiId).toBe(STANDARD_AVATAR_ID);
    // Der Weg ueber den CSV-Import steht in `import.test.ts`, dort liegt der Multipart-Helfer.
  });

  it("die Aussaat legt keine Avatardateien mehr an", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    const keks = await melde(stand, "admin@namur.de", "startpasswort-123");
    await stand.app.inject({ method: "POST", url: "/api/aussaat", headers: { cookie: keks } });

    const bestand = await stand.app.inject({
      url: "/api/entwickler/bestand",
      headers: { cookie: keks },
    });
    const { besucher, dateien } = bestand.json<{ besucher: number; dateien: number }>();
    expect(besucher).toBe(700);
    /*
     * Vorher legte die Aussaat je zweitem Besucher eine Avatardatei an, also 350 Stueck.
     * Uebrig bleiben die Vorschaubilder der Exponate plus der eine Standard-Avatar; auf
     * keinen Fall darf die Zahl in der Groessenordnung der Besucher liegen.
     */
    expect(dateien).toBeLessThan(100);
  });
});
