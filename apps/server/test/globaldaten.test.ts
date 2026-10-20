import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Globale Daten, seit dem 20.10.2026: Datenpunkte, die der Konnektor **jedem** Besucher gleich
 * ausliefert. propertyIds `Global01`, `Global02`, ..., ohne Wiederverwendung.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

interface Global {
  id: string;
  propertyId: string;
  art: string;
}

interface Wert {
  propertyId: string;
  value: string;
  needsResolve?: boolean;
  mimeType?: string;
}

/** Ein 1x1-PNG, gueltig genug fuer den Bildweg. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\nglobal\n%%EOF\n");

async function aufbau() {
  stand = await starte(ADMIN);
  const s = stand;
  const keks = await melde(s, "admin@namur.de", "startpasswort-123");
  const ruf = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
    s.app.inject({ method, url, headers: { cookie: keks }, payload });

  const hochladen = async (name: string, inhalt: Buffer) => {
    const g = "----namurglobal";
    const a = await s.app.inject({
      method: "POST",
      url: "/api/dateien",
      headers: { cookie: keks, "content-type": `multipart/form-data; boundary=${g}` },
      payload: Buffer.concat([
        Buffer.from(
          `--${g}\r\nContent-Disposition: form-data; name="datei"; filename="${name}"\r\n` +
            "Content-Type: application/octet-stream\r\n\r\n",
        ),
        inhalt,
        Buffer.from(`\r\n--${g}--\r\n`),
      ]),
    });
    return a.json<{ id: string }>().id;
  };

  const lege = async (name: string, art: "text" | "datei") => {
    const a = await ruf("POST", "/api/globale-daten", { name, art });
    expect(a.statusCode, a.body).toBe(201);
    return a.json<Global>();
  };

  // Zwei Besucher, einer davon ganz ohne Zuordnung: auch er bekommt alles.
  await ruf("POST", "/api/besucher", { guid: "GL-1", vorname: "Gina", nachname: "Global" });
  await ruf("POST", "/api/besucher", { guid: "GL-2", vorname: "Gero", nachname: "Global" });

  return { s, keks, ruf, lege, hochladen };
}

async function werte(s: Pruefstand, guid: string): Promise<Wert[]> {
  const a = await s.app.inject({
    method: "POST",
    url: `/connector/product/${guid}/values`,
    payload: {},
  });
  expect(a.statusCode).toBe(200);
  return a.json<Wert[]>();
}

describe("Globale Daten anlegen", () => {
  it("vergibt Global01, Global02 und nach dem Loeschen keine alte Nummer wieder", async () => {
    const { ruf, lege } = await aufbau();
    const eins = await lege("Programm", "text");
    const zwei = await lege("Logo", "datei");
    expect([eins.propertyId, zwei.propertyId]).toEqual(["Global01", "Global02"]);

    // Den hoechsten loeschen: das Maximum der Tabelle faellt auf 1, vergeben wird trotzdem 3.
    expect((await ruf("DELETE", `/api/globale-daten/${zwei.id}`)).statusCode).toBe(204);
    expect((await lege("Neu", "text")).propertyId).toBe("Global03");
  });

  it("steht im Modell mit dem richtigen Typ", async () => {
    const { s, lege } = await aufbau();
    await lege("Programm", "text");
    await lege("Logo", "datei");
    const modell = (await s.app.inject({ url: "/connector/model" })).json<
      { id: string; name: string; type: number }[]
    >();
    expect(modell.find((m) => m.id === "Global01")).toEqual({
      id: "Global01",
      name: "Programm",
      type: 0,
    });
    expect(modell.find((m) => m.id === "Global02")).toEqual({
      id: "Global02",
      name: "Logo",
      type: 1,
    });
  });

  it("weist eine unbekannte Art und einen leeren Namen ab", async () => {
    const { ruf } = await aufbau();
    expect((await ruf("POST", "/api/globale-daten", { name: "X", art: "zahl" })).statusCode).toBe(
      400,
    );
    expect((await ruf("POST", "/api/globale-daten", { name: " ", art: "text" })).statusCode).toBe(
      400,
    );
  });

  it("ist ohne Anmeldung nicht erreichbar", async () => {
    const { s } = await aufbau();
    expect((await s.app.inject({ url: "/api/globale-daten" })).statusCode).toBe(401);
  });
});

describe("Globale Daten im Konnektor", () => {
  it("liefert Text, Bild als Wert und PDF als Ticket an jeden Besucher", async () => {
    const { s, ruf, lege, hochladen } = await aufbau();
    const text = await lege("Programm", "text");
    const bild = await lege("Logo", "datei");
    const pdf = await lege("Hallenplan", "datei");
    await lege("Leer", "text");

    await ruf("PATCH", `/api/globale-daten/${text.id}`, { text: "Beginn 9 Uhr" });
    await ruf("PATCH", `/api/globale-daten/${bild.id}`, {
      dateiId: await hochladen("logo.png", PNG),
    });
    await ruf("PATCH", `/api/globale-daten/${pdf.id}`, {
      dateiId: await hochladen("plan.pdf", PDF),
    });

    for (const guid of ["GL-1", "GL-2"]) {
      const w = await werte(s, guid);
      const g = (id: string) => w.find((x) => x.propertyId === id);
      expect(g("Global01")?.value).toBe("Beginn 9 Uhr");
      expect(g("Global02")).toMatchObject({ value: PNG.toString("base64"), needsResolve: false });
      expect(g("Global03")).toMatchObject({ value: "Global03", needsResolve: true });
      expect(g("Global04"), "leerer Datenpunkt ausgeliefert").toBeUndefined();
    }

    // Das Ticket loest sich ein.
    const doc = await s.app.inject({
      method: "POST",
      url: "/connector/product/GL-2/documents",
      payload: { propertyIds: ["Global03"] },
    });
    const eingeloest = doc.json<Wert[]>();
    expect(eingeloest[0]).toMatchObject({ needsResolve: false, value: PDF.toString("base64") });
  });

  it("nimmt Text nur bei Text und Datei nur bei Datei an", async () => {
    const { ruf, lege } = await aufbau();
    const text = await lege("Programm", "text");
    const datei = await lege("Logo", "datei");
    expect(
      (await ruf("PATCH", `/api/globale-daten/${text.id}`, { dateiId: null })).statusCode,
    ).toBe(400);
    expect((await ruf("PATCH", `/api/globale-daten/${datei.id}`, { text: "x" })).statusCode).toBe(
      400,
    );
  });

  it("entfernt beim Loeschen Wert und Datei", async () => {
    const { s, ruf, lege, hochladen } = await aufbau();
    const bild = await lege("Logo", "datei");
    const dateiId = await hochladen("logo.png", PNG);
    await ruf("PATCH", `/api/globale-daten/${bild.id}`, { dateiId });

    await ruf("DELETE", `/api/globale-daten/${bild.id}`);
    expect((await werte(s, "GL-1")).find((x) => x.propertyId === "Global01")).toBeUndefined();
    expect((await ruf("GET", `/api/dateien/${dateiId}`)).statusCode).toBe(404);
  });

  /** Die Datei-Id kommt von aussen; haengt sie auch an einem Exponat, bleibt sie dort. */
  it("loescht keine Datei, die noch an einem Exponat haengt", async () => {
    const { ruf, lege, hochladen } = await aufbau();
    const dateiId = await hochladen("blatt.pdf", PDF);
    const e = (await ruf("POST", "/api/exponate", { name: "Mit Blatt" })).json<{ id: string }>();
    await ruf("POST", `/api/exponate/${e.id}/dokumente`, { dateiId, titel: "Blatt" });

    const g = await lege("Auch Blatt", "datei");
    await ruf("PATCH", `/api/globale-daten/${g.id}`, { dateiId });
    // Das Loeschen gelingt sauber, statt an der Datei zu scheitern.
    expect((await ruf("DELETE", `/api/globale-daten/${g.id}`)).statusCode).toBe(204);
    expect((await ruf("GET", `/api/dateien/${dateiId}`)).statusCode).toBe(200);
  });
});

describe("Globale Daten in Sicherung und Zuruecksetzen", () => {
  /**
   * **Sicherung mit Zaehler.** Vor dem Export wird `Global03` angelegt und wieder geloescht:
   * in der Tabelle stehen dann nur 01 und 02, der Zaehler steht auf 3. Kommt nach dem
   * Einspielen `Global04`, ist der Zaehler mitgesichert; ohne ihn kaeme wieder 03.
   */
  it("sichert Datenpunkte, Datei und Nummernzaehler und spielt sie wieder ein", async () => {
    const { s, keks, ruf, lege, hochladen } = await aufbau();
    const text = await lege("Programm", "text");
    const bild = await lege("Logo", "datei");
    await ruf("PATCH", `/api/globale-daten/${text.id}`, { text: "Beginn 9 Uhr" });
    await ruf("PATCH", `/api/globale-daten/${bild.id}`, {
      dateiId: await hochladen("logo.png", PNG),
    });
    const weg = await lege("Weg", "text");
    await ruf("DELETE", `/api/globale-daten/${weg.id}`);

    const zip = new Uint8Array((await ruf("GET", "/api/sicherung")).rawPayload);

    // Den Bestand umbauen: beide weg, ein anderer dazu.
    await ruf("DELETE", `/api/globale-daten/${text.id}`);
    await ruf("DELETE", `/api/globale-daten/${bild.id}`);
    await lege("Spaeter", "text");

    const g = "----namurglobalsicherung";
    const eingespielt = await s.app.inject({
      method: "POST",
      url: "/api/sicherung",
      headers: {
        cookie: keks,
        "content-type": `multipart/form-data; boundary=${g}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${g}\r\nContent-Disposition: form-data; name="datei"; filename="s.zip"\r\n` +
            "Content-Type: application/zip\r\n\r\n",
        ),
        Buffer.from(zip),
        Buffer.from(`\r\n--${g}--\r\n`),
      ]),
    });
    expect(eingespielt.statusCode, eingespielt.body).toBe(200);
    expect(eingespielt.json<{ bestand: { globaleDaten: number } }>().bestand.globaleDaten).toBe(2);

    const liste = (await ruf("GET", "/api/globale-daten")).json<Global[]>();
    expect(liste.map((x) => x.propertyId)).toEqual(["Global01", "Global02"]);
    const w = await werte(s, "GL-1");
    expect(w.find((x) => x.propertyId === "Global01")?.value).toBe("Beginn 9 Uhr");
    expect(w.find((x) => x.propertyId === "Global02")?.value).toBe(PNG.toString("base64"));

    expect((await lege("Neu", "text")).propertyId).toBe("Global04");
  });

  it("raeumt beim Zuruecksetzen alles weg, vergibt danach aber keine alte Nummer", async () => {
    const { s, ruf, lege, hochladen } = await aufbau();
    await lege("Programm", "text");
    const bild = await lege("Logo", "datei");
    await ruf("PATCH", `/api/globale-daten/${bild.id}`, {
      dateiId: await hochladen("logo.png", PNG),
    });

    const zurueck = await ruf("POST", "/api/entwickler/zuruecksetzen", {
      bestaetigung: "ZURUECKSETZEN",
    });
    expect(zurueck.statusCode, zurueck.body).toBe(200);
    expect(zurueck.json<{ geloescht: { globaleDaten: number } }>().geloescht.globaleDaten).toBe(2);

    expect((await ruf("GET", "/api/globale-daten")).json<Global[]>()).toEqual([]);
    const modell = (await s.app.inject({ url: "/connector/model" })).json<{ id: string }[]>();
    expect(modell.filter((m) => m.id.startsWith("Global"))).toEqual([]);
    expect((await lege("Neu", "text")).propertyId).toBe("Global03");
  });
});
