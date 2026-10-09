import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HOECHSTGROESSE } from "../src/services/avatare.js";
import { STANDARD_AVATAR_ID } from "../src/services/standardavatar.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Die Avatargalerie, seit dem 09.10.2026 verwaltbar.
 *
 * **Der wichtigste Fall ist der Neustart.** Bis zur Umstellung legte der Start jedes
 * fehlende Bild neu an; ein geloeschter Avatar waere beim naechsten Hochfahren
 * zurueckgekommen, und das faellt niemandem auf, bis er am Stand wieder in der Auswahl
 * steht.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
let ordner: string | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
  if (ordner !== null) rmSync(ordner, { recursive: true, force: true });
  ordner = null;
});

interface Zeile {
  dateiId: string;
  sortierung: number;
}

async function alsAdmin(zusatz: Record<string, string> = {}) {
  stand = await starte({ ...ADMIN, ...zusatz });
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

async function galerie(s: Pruefstand, keks: string): Promise<Zeile[]> {
  const antwort = await s.app.inject({ url: "/api/avatare", headers: { cookie: keks } });
  expect(antwort.statusCode).toBe(200);
  return antwort.json<{ avatare: Zeile[] }>().avatare;
}

/** Ein winziges, gueltiges JPEG. Der Inhalt spielt keine Rolle, nur Typ und Groesse. */
function bild(bytes = 64): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes)]);
}

/**
 * Baut einen Multipart-Koerper von Hand, wie `dateien.test.ts` auch.
 *
 * Der Typ steht bewusst **nicht** im Kopf: die Routen leiten ihn aus der Endung ab, und
 * genau das soll hier mitgeprueft werden.
 */
function multipart(dateiname: string, inhalt: Buffer): { body: Buffer; grenze: string } {
  const grenze = "----namuravatar";
  const kopf = Buffer.from(
    `--${grenze}\r\n` +
      `Content-Disposition: form-data; name="datei"; filename="${dateiname}"\r\n` +
      "Content-Type: application/octet-stream\r\n\r\n",
    "utf8",
  );
  const fuss = Buffer.from(`\r\n--${grenze}--\r\n`, "utf8");
  return { body: Buffer.concat([kopf, inhalt, fuss]), grenze };
}

async function ladeHoch(s: Pruefstand, keks: string, inhalt: Buffer, name = "neu.jpg") {
  const { body, grenze } = multipart(name, inhalt);
  return s.app.inject({
    method: "POST",
    url: "/api/avatare",
    headers: { cookie: keks, "content-type": `multipart/form-data; boundary=${grenze}` },
    payload: body,
  });
}

describe("Galerie verwalten", () => {
  it("liefert die Erstbefuellung in Reihenfolge", async () => {
    const { s, keks } = await alsAdmin();
    const alle = await galerie(s, keks);
    expect(alle).toHaveLength(20);
    expect(alle.map((a) => a.sortierung)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("haengt ein hochgeladenes Bild hinten an", async () => {
    const { s, keks } = await alsAdmin();
    const antwort = await ladeHoch(s, keks, bild());
    expect(antwort.statusCode).toBe(201);

    const alle = await galerie(s, keks);
    expect(alle).toHaveLength(21);
    expect(alle[20]?.dateiId).toBe(antwort.json<Zeile>().dateiId);
    expect(alle[20]?.sortierung).toBe(21);
  });

  it("weist ein zu grosses Bild und einen falschen Typ ab", async () => {
    const { s, keks } = await alsAdmin();

    const zuGross = await ladeHoch(s, keks, bild(HOECHSTGROESSE + 1));
    expect(zuGross.statusCode).toBe(400);
    expect(zuGross.json<{ code: string }>().code).toBe("datei-zu-gross");

    const falsch = await ladeHoch(s, keks, bild(), "verboten.pdf");
    expect(falsch.statusCode).toBe(400);
    expect(falsch.json<{ code: string }>().code).toBe("typ-ungeeignet");

    // Und nichts davon ist in der Galerie gelandet.
    expect(await galerie(s, keks)).toHaveLength(20);
  });

  /**
   * **Neu durchnummerieren, nicht verschieben.** Sonst entstehen Luecken, und die naechste
   * Einfuegung landet auf einer schon vergebenen Nummer.
   */
  it("vergibt beim Sortieren 1..n ohne Luecke", async () => {
    const { s, keks } = await alsAdmin();
    const vorher = await galerie(s, keks);
    const umgedreht = [...vorher].reverse().map((a) => a.dateiId);

    const antwort = await s.app.inject({
      method: "PATCH",
      url: "/api/avatare/reihenfolge",
      headers: { cookie: keks },
      payload: { ids: umgedreht },
    });
    expect(antwort.statusCode).toBe(200);

    const nachher = await galerie(s, keks);
    expect(nachher.map((a) => a.dateiId)).toEqual(umgedreht);
    expect(nachher.map((a) => a.sortierung)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("schliesst auch nach dem Loeschen die Luecke", async () => {
    const { s, keks } = await alsAdmin();
    const vorher = await galerie(s, keks);

    const weg = await s.app.inject({
      method: "DELETE",
      url: `/api/avatare/${vorher[4]?.dateiId ?? ""}`,
      headers: { cookie: keks },
    });
    expect(weg.statusCode).toBe(204);

    const nachher = await galerie(s, keks);
    expect(nachher).toHaveLength(19);
    expect(nachher.map((a) => a.sortierung)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
  });

  it("weist eine unvollstaendige Reihenfolge ab", async () => {
    const { s, keks } = await alsAdmin();
    const alle = await galerie(s, keks);

    const antwort = await s.app.inject({
      method: "PATCH",
      url: "/api/avatare/reihenfolge",
      headers: { cookie: keks },
      payload: { ids: alle.slice(0, 5).map((a) => a.dateiId) },
    });
    expect(antwort.statusCode).toBe(400);
  });

  /**
   * Ein Besucher, dessen Bild verschwindet, muss auf den Standard fallen und nicht ins
   * Leere zeigen. Das haengt an `on delete set null` plus dem Rueckfall in `avatarFuer`.
   */
  it("laesst einen Besucher auf den Standard zurueckfallen", async () => {
    const { s, keks } = await alsAdmin();
    const alle = await galerie(s, keks);
    const gewaehlt = alle[0]?.dateiId ?? "";

    await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid: "AVA-0001", vorname: "Probe", nachname: "Person" },
    });
    await s.app.inject({
      method: "PATCH",
      url: "/api/kiosk/besucher/AVA-0001/avatar",
      headers: { cookie: keks },
      payload: { avatarDateiId: gewaehlt },
    });

    await s.app.inject({
      method: "DELETE",
      url: `/api/avatare/${gewaehlt}`,
      headers: { cookie: keks },
    });

    const nachher = await s.app.inject({
      url: "/api/kiosk/besucher/AVA-0001",
      headers: { cookie: keks },
    });
    expect(nachher.json<{ avatarDateiId: string | null }>().avatarDateiId).toBeNull();

    // Und der Viewer bekommt trotzdem ein Bild, naemlich den Standard.
    const werte = await s.app.inject({
      method: "POST",
      url: "/connector/product/AVA-0001/values",
      payload: {},
    });
    const avatar = werte
      .json<{ propertyId: string }[]>()
      .find((w) => w.propertyId === "Visitor_Avatar");
    expect(avatar, "kein Avatar in den Werten").toBeDefined();
  });

  /**
   * **Beide Haelften.** Dass die Antwort das Standardbild nennt, belegt nicht, dass es
   * nicht zugleich in der Galerie steht; und umgekehrt. Die Verwaltung zeigt es, kann es
   * aber nicht loeschen oder verschieben, und genau diese Trennung haengt hier dran.
   */
  it("nennt das Standardbild getrennt von der Galerie", async () => {
    const { s, keks } = await alsAdmin();
    const antwort = await s.app.inject({ url: "/api/avatare", headers: { cookie: keks } });
    expect(antwort.statusCode).toBe(200);

    const { standard, avatare } = antwort.json<{ standard: string; avatare: Zeile[] }>();
    expect(standard).toBe(STANDARD_AVATAR_ID);
    expect(avatare.map((a) => a.dateiId), "Standardbild in der Galerie").not.toContain(standard);
  });

  it("kennt den Standard-Avatar nicht und loescht ihn nicht", async () => {
    const { s, keks } = await alsAdmin();
    expect((await galerie(s, keks)).map((a) => a.dateiId)).not.toContain(STANDARD_AVATAR_ID);

    const antwort = await s.app.inject({
      method: "DELETE",
      url: `/api/avatare/${STANDARD_AVATAR_ID}`,
      headers: { cookie: keks },
    });
    expect(antwort.statusCode).toBe(404);
  });
});

describe("Galerie und Neustart", () => {
  /**
   * **Die Pruefung, fuer die diese Runde gemacht wurde.** Vor der Umstellung legte der
   * Start jedes fehlende Bild neu an, und ein geloeschter Avatar kam zurueck.
   */
  it("bringt ein geloeschtes Bild nach einem Neustart nicht zurueck", async () => {
    ordner = mkdtempSync(join(tmpdir(), "namur-avatare-"));

    const erster = await starte({ ...ADMIN, DATA_DIR: ordner });
    const keks1 = await melde(erster, "admin@namur.de", "startpasswort-123");
    const alle = await galerie(erster, keks1);
    const weg = alle[3]?.dateiId ?? "";
    await erster.app.inject({
      method: "DELETE",
      url: `/api/avatare/${weg}`,
      headers: { cookie: keks1 },
    });
    expect(await galerie(erster, keks1)).toHaveLength(19);
    await erster.close();

    const zweiter = await starte({ ...ADMIN, DATA_DIR: ordner });
    stand = zweiter;
    const keks2 = await melde(zweiter, "admin@namur.de", "startpasswort-123");

    const nachher = await galerie(zweiter, keks2);
    expect(nachher, "der Start hat nachgelegt").toHaveLength(19);
    expect(nachher.map((a) => a.dateiId)).not.toContain(weg);
  });

  it("stellt die Galerie beim Zuruecksetzen wieder her", async () => {
    const { s, keks } = await alsAdmin();
    const alle = await galerie(s, keks);
    await s.app.inject({
      method: "DELETE",
      url: `/api/avatare/${alle[0]?.dateiId ?? ""}`,
      headers: { cookie: keks },
    });
    expect(await galerie(s, keks)).toHaveLength(19);

    const zurueck = await s.app.inject({
      method: "POST",
      url: "/api/entwickler/zuruecksetzen",
      headers: { cookie: keks },
      payload: { bestaetigung: "ZURUECKSETZEN" },
    });
    expect(zurueck.statusCode).toBe(200);

    expect(
      await galerie(s, keks),
      "Zuruecksetzen stellt den Auslieferungszustand her",
    ).toHaveLength(20);
  });
});

describe("Galerie: wer darf", () => {
  it("weist Betreuer und Tablet ab", async () => {
    const { s, keks } = await alsAdmin();

    for (const rolle of ["betreuer", "kiosk"]) {
      const angelegt = await s.app.inject({
        method: "POST",
        url: "/api/nutzer",
        headers: { cookie: keks },
        payload: { name: `Probe ${rolle}`, email: `${rolle}-ava@namur.de`, rolle },
      });
      const { startpasswort } = angelegt.json<{ startpasswort: string }>();
      const fremd = await melde(s, `${rolle}-ava@namur.de`, startpasswort);

      // Jede Route einzeln: eine Stichprobe belegt die anderen nicht.
      const versuche = [
        () => s.app.inject({ url: "/api/avatare", headers: { cookie: fremd } }),
        () => ladeHochAls(s, fremd),
        () =>
          s.app.inject({
            method: "DELETE",
            url: "/api/avatare/egal",
            headers: { cookie: fremd },
          }),
        () =>
          s.app.inject({
            method: "PATCH",
            url: "/api/avatare/reihenfolge",
            headers: { cookie: fremd },
            payload: { ids: [] },
          }),
      ];
      for (const [i, lauf] of versuche.entries()) {
        expect((await lauf()).statusCode, `${rolle}, Route ${String(i)}`).toBe(403);
      }
    }
  });
});

function ladeHochAls(s: Pruefstand, keks: string) {
  return ladeHoch(s, keks, bild());
}
