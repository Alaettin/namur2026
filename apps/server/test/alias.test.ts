import { afterEach, describe, expect, it } from "vitest";
import { FELDER_BESUCHER } from "../src/modell/modell.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Der Alias eines Besuchers, seit dem 19.10.2026.
 *
 * **Anders als der Titel mit eigener propertyId** `Visitor_Alias`, und **nur am Besucher**.
 * Die Feldliste der Personen traegt auch die Ansprechpartner; diese Datei haelt fest, dass
 * dort kein `{K}_Contact{NN}_Alias` entsteht.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

interface Eigenschaft {
  id: string;
  name: string;
  type: number;
}

interface Wert {
  propertyId: string;
  value?: unknown;
  valueLanguage?: string;
}

async function alsAdmin() {
  stand = await starte(ADMIN);
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

async function legeBesucher(s: Pruefstand, keks: string, payload: Record<string, unknown>) {
  const antwort = await s.app.inject({
    method: "POST",
    url: "/api/besucher",
    headers: { cookie: keks },
    payload,
  });
  expect(antwort.statusCode).toBe(201);
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

function alias(alle: Wert[]): Wert | undefined {
  return alle.find((w) => w.propertyId === "Visitor_Alias");
}

describe("Visitor_Alias im Modell", () => {
  /**
   * Mit einem Exponat samt Ansprechpartner-Plaetzen, sonst gaebe es gar keine
   * `_Contact`-Eigenschaften und die Pruefung darauf ginge leer durch.
   */
  it("steht beim Besucher, nicht bei den Ansprechpartnern", async () => {
    const { s, keks } = await alsAdmin();
    await s.app.inject({
      method: "POST",
      url: "/api/exponate",
      headers: { cookie: keks },
      payload: { name: "Aliasprobe" },
    });

    const felder = (await s.app.inject({ url: "/connector/model" })).json<Eigenschaft[]>();
    const ids = felder.map((f) => f.id);

    expect(felder.find((f) => f.id === "Visitor_Alias")).toMatchObject({ type: 0 });
    expect(
      ids.filter((i) => /_Contact\d+_Alias$/.test(i)),
      "Alias am Ansprechpartner",
    ).toEqual([]);
    // Gegenprobe im selben Fall: Ansprechpartner-Plaetze gibt es, die Suche greift also.
    expect(ids.filter((i) => /_Contact\d+_FirstName$/.test(i)).length).toBeGreaterThan(0);

    expect(felder.filter((f) => f.id.startsWith("Visitor_"))).toHaveLength(FELDER_BESUCHER);
  });
});

describe("Visitor_Alias in values", () => {
  it("liefert den Alias als Text mit Sprache", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucher(s, keks, {
      guid: "ALIAS-0001",
      vorname: "Anna",
      nachname: "Ahrens",
      alias: "Anni",
    });

    expect(alias(await werte(s, "ALIAS-0001"))).toMatchObject({
      value: "Anni",
      valueLanguage: "de",
    });
  });

  it("laesst einen leeren Alias aus", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucher(s, keks, { guid: "ALIAS-0002", vorname: "Bernd", nachname: "Brandt" });
    await legeBesucher(s, keks, {
      guid: "ALIAS-0003",
      vorname: "Clara",
      nachname: "Groth",
      alias: "   ",
    });

    expect(alias(await werte(s, "ALIAS-0002"))).toBeUndefined();
    expect(alias(await werte(s, "ALIAS-0003"))).toBeUndefined();
  });

  it("folgt einer Aenderung durch den Admin", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucher(s, keks, { guid: "ALIAS-0004", vorname: "Dirk", nachname: "Jansen" });

    const antwort = await s.app.inject({
      method: "PATCH",
      url: "/api/besucher/ALIAS-0004",
      headers: { cookie: keks },
      payload: { alias: " DJ " },
    });
    expect(antwort.statusCode).toBe(200);
    expect(antwort.json<{ alias: string }>().alias).toBe("DJ");
    expect(alias(await werte(s, "ALIAS-0004"))?.value).toBe("DJ");
  });
});

describe("Alias am Tablet", () => {
  it("laesst sich lesen und aendern", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucher(s, keks, { guid: "ALIAS-0010", vorname: "Eva", nachname: "Klein" });

    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Tablet", email: "tablet@namur.de", rolle: "kiosk" },
    });
    const kiosk = await melde(
      s,
      "tablet@namur.de",
      angelegt.json<{ startpasswort: string }>().startpasswort,
    );

    const geaendert = await s.app.inject({
      method: "PATCH",
      url: "/api/kiosk/besucher/ALIAS-0010",
      headers: { cookie: kiosk },
      payload: { alias: "Evi" },
    });
    expect(geaendert.statusCode).toBe(200);
    expect(geaendert.json<{ alias: string }>().alias).toBe("Evi");

    const gelesen = await s.app.inject({
      url: "/api/kiosk/besucher/ALIAS-0010",
      headers: { cookie: kiosk },
    });
    expect(gelesen.json<{ alias: string }>().alias).toBe("Evi");
  });
});

// --- CSV --------------------------------------------------------------------------------

function multipart(datei: Buffer, felder: Record<string, string>) {
  const grenze = "----namuralias";
  const stuecke: Buffer[] = [];
  for (const [name, wert] of Object.entries(felder)) {
    stuecke.push(
      Buffer.from(
        `--${grenze}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${wert}\r\n`,
        "utf8",
      ),
    );
  }
  stuecke.push(
    Buffer.from(
      `--${grenze}\r\nContent-Disposition: form-data; name="datei"; filename="besucher.csv"\r\n` +
        "Content-Type: text/csv\r\n\r\n",
      "utf8",
    ),
    datei,
    Buffer.from(`\r\n--${grenze}--\r\n`, "utf8"),
  );
  return { body: Buffer.concat(stuecke), grenze };
}

async function importiere(s: Pruefstand, keks: string, csv: string) {
  const { body, grenze } = multipart(Buffer.from(csv, "utf8"), { modus: "ergaenzen" });
  const antwort = await s.app.inject({
    method: "POST",
    url: "/api/besucher/import/uebernehmen",
    headers: { cookie: keks, "content-type": `multipart/form-data; boundary=${grenze}` },
    payload: body,
  });
  expect(antwort.statusCode).toBe(200);
}

async function besucher(s: Pruefstand, keks: string, guid: string) {
  const antwort = await s.app.inject({ url: `/api/besucher/${guid}`, headers: { cookie: keks } });
  return antwort.json<{ titel: string | null; alias: string | null; firma: string | null }>();
}

describe("Alias und Titel im CSV-Import", () => {
  /**
   * **Deckt auch den Titel.** Bis zum 19.10.2026 bot der Import die Spalte an und schrieb sie
   * nie; dieselbe Luecke haette den Alias getroffen.
   */
  it("uebernimmt beide Spalten", async () => {
    const { s, keks } = await alsAdmin();
    await importiere(
      s,
      keks,
      "guid;titel;vorname;nachname;spitzname\nCSV-A1;Dr.;Anna;Ahrens;Anni\n",
    );

    expect(await besucher(s, keks, "CSV-A1")).toMatchObject({ titel: "Dr.", alias: "Anni" });
    expect(alias(await werte(s, "CSV-A1"))?.value).toBe("Anni");
  });

  /**
   * Titel und Alias traegt der Besucher oft selbst am Tablet ein. Eine Liste aus dem
   * Anmeldewerkzeug ohne diese Spalten darf sie beim erneuten Import nicht loeschen.
   */
  it("laesst beide stehen, wenn die Datei sie nicht mitbringt", async () => {
    const { s, keks } = await alsAdmin();
    await importiere(s, keks, "guid;titel;vorname;nachname;alias\nCSV-A2;Dr.;Bernd;Brandt;BB\n");
    await importiere(s, keks, "guid;vorname;nachname;firma\nCSV-A2;Bernd;Brandt;Nordwerk\n");

    expect(await besucher(s, keks, "CSV-A2")).toMatchObject({
      titel: "Dr.",
      alias: "BB",
      firma: "Nordwerk",
    });
  });
});
