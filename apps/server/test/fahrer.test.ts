import { afterEach, describe, expect, it } from "vitest";
import { SCHLUESSEL_CARRERA, setzeSchalter } from "../src/services/einstellungen.js";
import { STANDARD_AVATAR_ID } from "../src/services/standardavatar.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Name und Bild eines Fahrers, fuer den Bildschirm an der Carrera-Bahn.
 *
 * Die Bahn kennt nach dem Scan nur die GUID. Der Aufruf liefert beides in einem Stueck, das
 * Bild eingebettet: `/api/dateien/:id` haengt an einer Sitzung, die sie nicht hat.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };
const BASIC = { CARRERA_BASIC_USER: "bahn", CARRERA_BASIC_PASSWORT: "geheim-fuer-die-bahn" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

interface Fahrer {
  guid: string;
  titel: string | null;
  vorname: string;
  nachname: string;
  bild: { mimeType: string; size: number; base64: string } | null;
}

async function alsAdmin(zusatz: Record<string, string> = {}) {
  stand = await starte({ ...ADMIN, ...zusatz });
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

async function legeAn(s: Pruefstand, keks: string, rumpf: Record<string, unknown>): Promise<void> {
  const antwort = await s.app.inject({
    method: "POST",
    url: "/api/besucher",
    headers: { cookie: keks },
    payload: rumpf,
  });
  expect(antwort.statusCode, JSON.stringify(antwort.json())).toBe(201);
}

function frage(s: Pruefstand, guid: string, kopf: Record<string, string> = {}) {
  return s.app.inject({ url: `/carrera/besucher/${guid}`, headers: kopf });
}

/** Die Id des Avatars, den die Galerie an erster Stelle fuehrt. */
async function ersterGalerieavatar(s: Pruefstand, keks: string): Promise<string> {
  const antwort = await s.app.inject({ url: "/api/avatare", headers: { cookie: keks } });
  const erste = antwort.json<{ avatare: { dateiId: string }[] }>().avatare[0];
  expect(erste, "die Galerie ist leer").toBeDefined();
  return erste?.dateiId ?? "";
}

describe("Fahrerdaten", () => {
  it("liefert Titel, Namen und das Bild des Besuchers", async () => {
    const { s, keks } = await alsAdmin();
    const avatar = await ersterGalerieavatar(s, keks);
    await legeAn(s, keks, {
      guid: "FAHRER-0001",
      titel: "Dr.",
      vorname: "Anna",
      nachname: "Ahrens",
      avatarDateiId: avatar,
    });

    const antwort = await frage(s, "FAHRER-0001");
    expect(antwort.statusCode).toBe(200);
    const fahrer = antwort.json<Fahrer>();

    expect(fahrer).toMatchObject({
      guid: "FAHRER-0001",
      titel: "Dr.",
      vorname: "Anna",
      nachname: "Ahrens",
    });

    /*
     * **Das Base64 muss vollstaendig sein, nicht nur anfangen.** `Buffer.from(x, "base64")`
     * schneidet bei einem kaputten Ende still ab; auf den Kopf zu pruefen belegt deshalb
     * nichts ueber die Vollstaendigkeit. Geprueft wird gegen die gemeldete Groesse.
     */
    expect(fahrer.bild).not.toBeNull();
    expect(fahrer.bild?.mimeType).toBe("image/jpeg");
    const roh = Buffer.from(fahrer.bild?.base64 ?? "", "base64");
    expect(roh.length, "Base64 passt nicht zur gemeldeten Groesse").toBe(fahrer.bild?.size);
    expect(roh.length).toBeGreaterThan(0);
  });

  /**
   * **Ohne eigenen Avatar kommt das Standardbild**, nicht `null`.
   *
   * Der Rueckfall liegt in `avatarFuer`. Haette die Route ihre eigene Pruefung auf
   * `person.avatarDateiId`, bliebe der Bildschirm an der Bahn fuer jeden leer, der sich nie
   * ein Bild ausgesucht hat.
   */
  it("faellt auf das Standardbild zurueck", async () => {
    const { s, keks } = await alsAdmin();
    await legeAn(s, keks, { guid: "FAHRER-0002", vorname: "Ohne", nachname: "Bild" });

    // Den Bezug loesen, wie es nach dem Loeschen eines Galeriebildes passiert.
    const geloest = await s.app.inject({
      method: "PATCH",
      url: "/api/besucher/FAHRER-0002",
      headers: { cookie: keks },
      payload: { avatarDateiId: null },
    });
    expect(geloest.statusCode).toBe(200);

    const fahrer = (await frage(s, "FAHRER-0002")).json<Fahrer>();
    expect(fahrer.bild, "kein Rueckfall auf das Standardbild").not.toBeNull();

    // Und es ist wirklich das Standardbild, nicht irgendeines aus der Galerie.
    const standard = await s.app.inject({
      url: `/api/dateien/${STANDARD_AVATAR_ID}`,
      headers: { cookie: keks },
    });
    expect(standard.statusCode).toBe(200);
    expect(fahrer.bild?.size).toBe(standard.rawPayload.length);
  });

  it("laesst titel null, wenn keiner gesetzt ist", async () => {
    const { s, keks } = await alsAdmin();
    await legeAn(s, keks, { guid: "FAHRER-0003", vorname: "Kein", nachname: "Titel" });
    const fahrer = (await frage(s, "FAHRER-0003")).json<Fahrer>();
    // Nicht "null" und nicht "": die Gegenseite setzt den Titel vor den Vornamen.
    expect(fahrer.titel).toBeNull();
  });

  it("antwortet auf eine unbekannte GUID mit 404", async () => {
    const { s } = await alsAdmin();
    const antwort = await frage(s, "GIBT-ES-NICHT");
    expect(antwort.statusCode).toBe(404);
    expect(antwort.json<{ code: string }>().code).toBe("besucher-unbekannt");
  });
});

describe("Der Zugang gilt auch fuer die Fahrerdaten", () => {
  /** Ausgeschaltet ist die Vorgabe, und das ist die wichtigere Haelfte. */
  it("geht ohne Zugangsdaten, solange der Schalter aus ist", async () => {
    const { s, keks } = await alsAdmin(BASIC);
    await legeAn(s, keks, { guid: "FAHRER-0010", vorname: "Offen", nachname: "Erreichbar" });
    expect((await frage(s, "FAHRER-0010")).statusCode).toBe(200);
  });

  it("verlangt sie, sobald der Schalter an ist", async () => {
    const { s, keks } = await alsAdmin(BASIC);
    await legeAn(s, keks, { guid: "FAHRER-0011", vorname: "Zu", nachname: "Geschlossen" });
    setzeSchalter(s.ctx.db, SCHLUESSEL_CARRERA, true);

    expect((await frage(s, "FAHRER-0011")).statusCode).toBe(401);

    const kopf = `Basic ${Buffer.from("bahn:geheim-fuer-die-bahn", "utf8").toString("base64")}`;
    expect((await frage(s, "FAHRER-0011", { authorization: kopf })).statusCode).toBe(200);
  });
});
