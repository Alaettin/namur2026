import { afterEach, describe, expect, it } from "vitest";
import { dateien } from "../src/db/schema.js";
import { galerieAvatarId, STANDARD_AVATAR_ID } from "../src/services/standardavatar.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Das Selbstbedienungs-Tablet.
 *
 * **Der Kern dieser Pruefungen ist nicht, was die Rolle kann, sondern was sie nicht kann.**
 * Das Geraet steht unbeaufsichtigt im Publikum; jede Route, die es zusaetzlich erreicht,
 * ist eine Route zu viel.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

interface Konten {
  s: Pruefstand;
  admin: string;
  kiosk: string;
  betreuer: string;
}

async function konten(): Promise<Konten> {
  stand = await starte(ADMIN);
  const s = stand;
  const admin = await melde(s, "admin@namur.de", "startpasswort-123");

  async function lege(rolle: string, email: string): Promise<string> {
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: admin },
      payload: { name: `Probe ${rolle}`, email, rolle },
    });
    expect(angelegt.statusCode, `${rolle} liess sich nicht anlegen`).toBe(201);
    const { startpasswort } = angelegt.json<{ startpasswort: string }>();
    return melde(s, email, startpasswort);
  }

  return {
    s,
    admin,
    kiosk: await lege("kiosk", "tablet@namur.de"),
    betreuer: await lege("betreuer", "betreuer-kiosk@namur.de"),
  };
}

async function legeBesucher(s: Pruefstand, keks: string, guid: string) {
  await s.app.inject({
    method: "POST",
    url: "/api/besucher",
    headers: { cookie: keks },
    payload: { guid, vorname: "Kiosk", nachname: "Probe", firma: "Alt GmbH" },
  });
}

describe("Kiosk: was die Rolle nicht darf", () => {
  /**
   * **Jede Route einzeln.** Eine Stichprobe belegt die anderen nicht, und genau hier faellt
   * eine kuenftige Route auf, die aus Versehen nur `verlangeAnmeldung` traegt.
   */
  it("kommt an keine Verwaltungsroute", async () => {
    const { s, kiosk } = await konten();
    const keks = { cookie: kiosk };

    const versuche = [
      { was: "Besucherliste", lauf: () => s.app.inject({ url: "/api/besucher", headers: keks }) },
      { was: "Nutzerliste", lauf: () => s.app.inject({ url: "/api/nutzer", headers: keks }) },
      { was: "Dashboard", lauf: () => s.app.inject({ url: "/api/dashboard", headers: keks }) },
      { was: "Monitoring", lauf: () => s.app.inject({ url: "/api/monitoring", headers: keks }) },
      {
        was: "Exponat anlegen",
        lauf: () =>
          s.app.inject({
            method: "POST" as const,
            url: "/api/exponate",
            headers: keks,
            payload: { name: "Verboten" },
          }),
      },
      {
        was: "Datei hochladen",
        lauf: () =>
          s.app.inject({
            method: "POST" as const,
            url: "/api/dateien",
            headers: keks,
            payload: {},
          }),
      },
      {
        was: "Besucher anlegen",
        lauf: () =>
          s.app.inject({
            method: "POST" as const,
            url: "/api/besucher",
            headers: keks,
            payload: { guid: "SCHLEICH-1", vorname: "A", nachname: "B" },
          }),
      },
    ];

    for (const v of versuche) {
      expect((await v.lauf()).statusCode, `${v.was} war erreichbar`).toBe(403);
    }
  });

  /** Die Rolle ist **eng**, nicht nur anders: auch ein Betreuer bleibt draussen. */
  it("laesst einen Betreuer nicht an die Kiosk-Routen", async () => {
    const { s, admin, betreuer } = await konten();
    await legeBesucher(s, admin, "KIOSK-0001");

    const lesen = await s.app.inject({
      url: "/api/kiosk/besucher/KIOSK-0001",
      headers: { cookie: betreuer },
    });
    expect(lesen.statusCode).toBe(403);

    const avatare = await s.app.inject({
      url: "/api/kiosk/avatare",
      headers: { cookie: betreuer },
    });
    expect(avatare.statusCode).toBe(403);
  });

  it("verlangt ueberhaupt eine Anmeldung", async () => {
    const { s, admin } = await konten();
    await legeBesucher(s, admin, "KIOSK-0002");
    const antwort = await s.app.inject({ url: "/api/kiosk/besucher/KIOSK-0002" });
    expect(antwort.statusCode).toBe(401);
  });
});

describe("Kiosk: Stammdaten", () => {
  it("aendert die Felder", async () => {
    const { s, admin, kiosk } = await konten();
    await legeBesucher(s, admin, "KIOSK-0010");

    const antwort = await s.app.inject({
      method: "PATCH",
      url: "/api/kiosk/besucher/KIOSK-0010",
      headers: { cookie: kiosk },
      payload: { firma: "Neu GmbH", ort: "Mannheim" },
    });
    expect(antwort.statusCode).toBe(200);
    expect(antwort.json<{ firma: string; ort: string }>()).toMatchObject({
      firma: "Neu GmbH",
      ort: "Mannheim",
    });
  });

  /**
   * **Die GUID bleibt, auch wenn eine mitgeschickt wird.** Sie ist die `itemId` fuer Axon;
   * liesse sie sich am Tablet aendern, zeigte der Pass eines Besuchers ins Leere.
   */
  it("laesst die GUID unberuehrt", async () => {
    const { s, admin, kiosk } = await konten();
    await legeBesucher(s, admin, "KIOSK-0011");

    const antwort = await s.app.inject({
      method: "PATCH",
      url: "/api/kiosk/besucher/KIOSK-0011",
      headers: { cookie: kiosk },
      payload: { guid: "ENTFUEHRT", vorname: "Neu" },
    });
    expect(antwort.statusCode).toBe(200);
    expect(antwort.json<{ guid: string }>().guid).toBe("KIOSK-0011");

    // Und der alte Schluessel traegt den neuen Wert, es wurde also nichts nebenher angelegt.
    const nachher = await s.app.inject({
      url: "/api/kiosk/besucher/KIOSK-0011",
      headers: { cookie: kiosk },
    });
    expect(nachher.json<{ vorname: string }>().vorname).toBe("Neu");
    expect(
      (await s.app.inject({ url: "/api/kiosk/besucher/ENTFUEHRT", headers: { cookie: kiosk } }))
        .statusCode,
    ).toBe(404);
  });

  it("weist einen leeren Namen ab", async () => {
    const { s, admin, kiosk } = await konten();
    await legeBesucher(s, admin, "KIOSK-0012");
    const antwort = await s.app.inject({
      method: "PATCH",
      url: "/api/kiosk/besucher/KIOSK-0012",
      headers: { cookie: kiosk },
      payload: { nachname: "   " },
    });
    expect(antwort.statusCode).toBe(400);
  });

  /** Der Weg ueber die Stammdaten darf nicht am Galerie-Filter vorbeifuehren. */
  it("setzt ueber die Stammdatenroute keinen Avatar", async () => {
    const { s, admin, kiosk } = await konten();
    await legeBesucher(s, admin, "KIOSK-0013");

    await s.app.inject({
      method: "PATCH",
      url: "/api/kiosk/besucher/KIOSK-0013",
      headers: { cookie: kiosk },
      payload: { avatarDateiId: galerieAvatarId(1), firma: "Egal" },
    });

    // Unveraendert: jeder neue Besucher traegt den Standard, und der steht noch da.
    const nachher = await s.app.inject({
      url: "/api/kiosk/besucher/KIOSK-0013",
      headers: { cookie: kiosk },
    });
    expect(nachher.json<{ avatarDateiId: string | null }>().avatarDateiId).toBe(STANDARD_AVATAR_ID);
  });
});

describe("Kiosk: Avatar", () => {
  it("bietet die Galerie an", async () => {
    const { s, kiosk } = await konten();
    const antwort = await s.app.inject({ url: "/api/kiosk/avatare", headers: { cookie: kiosk } });
    expect(antwort.statusCode).toBe(200);
    const { avatare } = antwort.json<{ avatare: string[] }>();
    expect(avatare.length).toBeGreaterThan(0);
    expect(avatare[0]).toBe(galerieAvatarId(1));
  });

  it("setzt einen Avatar aus der Galerie und wieder zurueck auf Standard", async () => {
    const { s, admin, kiosk } = await konten();
    await legeBesucher(s, admin, "KIOSK-0020");

    const gewaehlt = galerieAvatarId(3);
    const gesetzt = await s.app.inject({
      method: "PATCH",
      url: "/api/kiosk/besucher/KIOSK-0020/avatar",
      headers: { cookie: kiosk },
      payload: { avatarDateiId: gewaehlt },
    });
    expect(gesetzt.statusCode).toBe(200);
    expect(gesetzt.json<{ avatarDateiId: string | null }>().avatarDateiId).toBe(gewaehlt);

    /*
     * `null` im Rumpf heisst "Standard", und gespeichert wird dessen **echte Id**: so
     * steht dort derselbe Wert wie bei einem frisch angelegten Besucher und nicht eine
     * zweite Schreibweise fuer denselben Zustand.
     */
    const zurueck = await s.app.inject({
      method: "PATCH",
      url: "/api/kiosk/besucher/KIOSK-0020/avatar",
      headers: { cookie: kiosk },
      payload: { avatarDateiId: null },
    });
    expect(zurueck.statusCode).toBe(200);
    expect(zurueck.json<{ avatarDateiId: string | null }>().avatarDateiId).toBe(STANDARD_AVATAR_ID);
  });

  /**
   * **Die eigentliche Pruefung.** Ohne den Galerie-Filter koennte das Tablet den Avatar auf
   * eine beliebige Datei zeigen lassen, etwa auf ein PDF von einem Exponat, und das ginge
   * als Base64 in jede `values`-Antwort der Konnektor-API hinaus.
   */
  it("weist eine Datei ab, die nicht zur Galerie gehoert", async () => {
    const { s, admin, kiosk } = await konten();
    await legeBesucher(s, admin, "KIOSK-0021");

    /*
     * Eine echte, vorhandene Datei, die **nicht** zur Auswahl gehoert. Eine erfundene
     * Id abzuweisen bewiese wenig; der gefaehrliche Fall ist die Datei, die es
     * wirklich gibt, etwa ein Dokument an einem Exponat.
     */
    const fremd = "11111111-1111-4111-8111-111111111111";
    s.ctx.db
      .insert(dateien)
      .values({
        id: fremd,
        pfad: "ab/cd/fremd",
        mimeType: "application/pdf",
        groesse: 10,
        originalName: "geheim.pdf",
        sha256: "a".repeat(64),
        angelegt: Date.now(),
      })
      .run();

    const antwort = await s.app.inject({
      method: "PATCH",
      url: "/api/kiosk/besucher/KIOSK-0021/avatar",
      headers: { cookie: kiosk },
      payload: { avatarDateiId: fremd },
    });
    expect(antwort.statusCode).toBe(400);
    expect(antwort.json<{ code: string }>().code).toBe("avatar-unbekannt");

    const nachher = await s.app.inject({
      url: "/api/kiosk/besucher/KIOSK-0021",
      headers: { cookie: kiosk },
    });
    expect(nachher.json<{ avatarDateiId: string | null }>().avatarDateiId).toBe(STANDARD_AVATAR_ID);
  });
});
