import { describe, expect, it, afterEach } from "vitest";
import { istInlineBild, mimeAusName } from "../src/services/mime.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

/** Ein Multipart-Koerper von Hand, damit der Test ohne weitere Bibliothek auskommt. */
function multipart(dateiname: string, inhalt: Buffer): { body: Buffer; grenze: string } {
  const grenze = "----namurtest";
  const kopf = Buffer.from(
    `--${grenze}\r\n` +
      `Content-Disposition: form-data; name="datei"; filename="${dateiname}"\r\n` +
      "Content-Type: application/octet-stream\r\n\r\n",
    "utf8",
  );
  const fuss = Buffer.from(`\r\n--${grenze}--\r\n`, "utf8");
  return { body: Buffer.concat([kopf, inhalt, fuss]), grenze };
}

describe("MIME aus der Endung", () => {
  it("leitet den Typ aus der Endung ab, nicht aus dem Kopf", () => {
    expect(mimeAusName("Datenblatt.pdf")).toBe("application/pdf");
    expect(mimeAusName("foto.JPG")).toBe("image/jpeg");
    expect(mimeAusName("ohne-endung")).toBe("application/octet-stream");
  });

  /*
   * **Beide Richtungen.** Eine Regel, von der nur eine Haelfte geprueft ist, belegt die
   * andere nicht: `image/vnd.dwg` ist bei IANA unter `image/` registriert, ist aber eine
   * CAD-Zeichnung. Ein Praefixvergleich laege bei der ersten Zeile richtig und bei der
   * zweiten falsch.
   */
  it("haelt CAD-Zeichnungen von den Inline-Bildern fern", () => {
    expect(istInlineBild("image/png")).toBe(true);
    expect(istInlineBild("image/jpeg")).toBe(true);
    expect(istInlineBild(mimeAusName("zeichnung.dwg"))).toBe(false);
    expect(istInlineBild(mimeAusName("zeichnung.dxf"))).toBe(false);
    expect(istInlineBild("application/pdf")).toBe(false);
  });
});

describe("Dateiablage", () => {
  it("nimmt eine Datei an und liefert sie unveraendert zurueck", async () => {
    stand = await starte(ADMIN);
    const keks = await melde(stand, "admin@namur.de", "startpasswort-123");

    const inhalt = Buffer.from("%PDF-1.4 Testinhalt mit Umlaut: Grueße", "utf8");
    const { body, grenze } = multipart("Datenblatt (DE).pdf", inhalt);
    const hoch = await stand.app.inject({
      method: "POST",
      url: "/api/dateien",
      headers: { cookie: keks, "content-type": `multipart/form-data; boundary=${grenze}` },
      payload: body,
    });
    expect(hoch.statusCode).toBe(201);
    const meta = hoch.json<{ id: string; mimeType: string; groesse: number }>();
    expect(meta.mimeType).toBe("application/pdf");
    expect(meta.groesse).toBe(inhalt.byteLength);

    const runter = await stand.app.inject({
      url: `/api/dateien/${meta.id}`,
      headers: { cookie: keks },
    });
    expect(runter.statusCode).toBe(200);
    /*
     * Byte fuer Byte, nicht nur der Anfang. Ein Kopfvergleich belegt den Anfang; dass eine
     * Datei vollstaendig ist, steht an ihrem Ende.
     */
    expect(Buffer.from(runter.rawPayload).equals(inhalt)).toBe(true);
  });

  it("liefert Dateien nicht an Unangemeldete", async () => {
    stand = await starte(ADMIN);
    const keks = await melde(stand, "admin@namur.de", "startpasswort-123");
    const { body, grenze } = multipart("bild.png", Buffer.from("nicht wirklich png"));
    const hoch = await stand.app.inject({
      method: "POST",
      url: "/api/dateien",
      headers: { cookie: keks, "content-type": `multipart/form-data; boundary=${grenze}` },
      payload: body,
    });
    const { id } = hoch.json<{ id: string }>();

    expect((await stand.app.inject({ url: `/api/dateien/${id}` })).statusCode).toBe(401);
    expect((await stand.app.inject({ method: "POST", url: "/api/dateien" })).statusCode).toBe(401);
  });

  it("meldet eine unbekannte Datei als 404, nicht als HTML", async () => {
    stand = await starte(ADMIN);
    const keks = await melde(stand, "admin@namur.de", "startpasswort-123");
    const antwort = await stand.app.inject({
      url: "/api/dateien/gibt-es-nicht",
      headers: { cookie: keks },
    });
    expect(antwort.statusCode).toBe(404);
    expect(antwort.json<{ code: string }>().code).toBe("datei-unbekannt");
  });
});

describe("Gesundheitspruefung", () => {
  it("antwortet anonym und fragt die Datenbank wirklich", async () => {
    stand = await starte(ADMIN);
    const antwort = await stand.app.inject({ url: "/api/health" });
    expect(antwort.statusCode).toBe(200);
    expect(antwort.json()).toMatchObject({ status: "ok", db: "ok" });
  });

  it("antwortet auf einen unbekannten API-Pfad mit JSON, nicht mit HTML", async () => {
    stand = await starte(ADMIN);
    const antwort = await stand.app.inject({
      url: "/api/gibt-es-nicht",
      headers: { accept: "text/html" },
    });
    expect(antwort.statusCode).toBe(404);
    expect(antwort.json<{ code: string }>().code).toBe("route-unbekannt");
  });
});
