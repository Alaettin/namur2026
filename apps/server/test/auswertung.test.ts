import { afterEach, describe, expect, it } from "vitest";
import { csvFeld } from "../src/services/auswertung.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Die Auswertung als CSV, seit dem 19.10.2026: eine Zeile je Besucher, alle Stammdaten,
 * eine Spalte je Exponat mit `x`, wenn er dort etwas bekommen hat.
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
  const ruf = async <T>(method: "GET" | "POST", url: string, payload?: object) =>
    (await s.app.inject({ method, url, headers: { cookie: keks }, payload })).json<T>();

  const exponat = async (name: string) => {
    const e = await ruf<{ id: string; kennung: string }>("POST", "/api/exponate", { name });
    const link = await ruf<{ id: string }>("POST", `/api/exponate/${e.id}/links`, {
      url: "https://www.namur.net/",
      titel: name,
    });
    return { ...e, link: link.id };
  };
  const e1 = await exponat("Pumpe");
  const e2 = await exponat("Ventil");

  const besucher = async (
    guid: string,
    felder: object,
    exponate: { id: string; link: string }[],
  ) => {
    await ruf("POST", "/api/besucher", { guid, ...felder });
    for (const e of exponate) {
      await ruf("POST", "/api/scan/zuordnen", {
        guid,
        exponatId: e.id,
        elemente: [{ art: "link", zielId: e.link }],
      });
    }
  };
  await besucher("AW-1", { vorname: "Anna", nachname: "Ährens", firma: "Müller; Söhne" }, [e1, e2]);
  await besucher("AW-2", { vorname: "Bernd", nachname: "Brandt", firma: "=1+1" }, [e2]);
  await besucher("AW-3", { vorname: "Clara", nachname: "Christ" }, []);

  const csv = (await ruf<{ dateiname: string; inhalt: string }>("GET", "/api/auswertung")).inhalt;
  return { csv, e1, e2 };
}

/** Zerlegt die CSV ohne Anfuehrungszeichen-Logik; die Testwerte brauchen nur einfache. */
function zeilen(csv: string): string[] {
  return csv
    .replace(/^\uFEFF/, "")
    .split("\r\n")
    .filter((z) => z !== "");
}

describe("Auswertung", () => {
  it("hat BOM, alle Stammdaten und eine Spalte je Exponat", async () => {
    const { csv, e1, e2 } = await aufbau();
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(zeilen(csv)[0]).toBe(
      "GUID;Titel;Vorname;Nachname;Alias;Firma;Position;E-Mail;Straße;PLZ;Ort;Land;Website;" +
        `${e1.kennung} Pumpe;${e2.kennung} Ventil`,
    );
  });

  it("setzt x genau an den besuchten Exponaten, auch fuer Besucher ohne Besuch", async () => {
    const { csv } = await aufbau();
    const z = zeilen(csv);
    // Nach Nachname: Ährens, Brandt, Christ.
    expect(z).toHaveLength(4);
    expect(z[1]?.startsWith("AW-1;")).toBe(true);
    expect(z[1]?.endsWith(";x;x")).toBe(true);
    expect(z[2]?.endsWith(";;x")).toBe(true);
    expect(z[3]?.endsWith(";;")).toBe(true);
  });

  it("schuetzt Trennzeichen und entschaerft Formeln", async () => {
    const { csv } = await aufbau();
    expect(csv).toContain('"Müller; Söhne"');
    expect(csv).toContain(";'=1+1;");
  });
});

describe("csvFeld", () => {
  it("verdoppelt Anfuehrungszeichen und entschaerft alle Formelanfaenge", () => {
    expect(csvFeld('Sagt "Hallo"')).toBe('"Sagt ""Hallo"""');
    expect(csvFeld(null)).toBe("");
    for (const anfang of ["=", "+", "-", "@"]) expect(csvFeld(`${anfang}A1`)).toBe(`'${anfang}A1`);
  });
});
