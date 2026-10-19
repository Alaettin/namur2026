import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Sicherung und Wiederherstellung, seit dem 19.10.2026.
 *
 * Der Kern: exportieren, den Bestand veraendern, einspielen, und alles steht wie vorher,
 * **einschliesslich der Dateien bis aufs Byte** und der App-Nutzer.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let staende: Pruefstand[] = [];
afterEach(async () => {
  for (const s of staende) await s.ende();
  staende = [];
});

async function neuerStand() {
  const s = await starte(ADMIN);
  staende.push(s);
  return { s, keks: await melde(s, "admin@namur.de", "startpasswort-123") };
}

function multipart(datei: Uint8Array): { body: Buffer; grenze: string } {
  const grenze = "----namursicherung";
  return {
    grenze,
    body: Buffer.concat([
      Buffer.from(
        `--${grenze}\r\nContent-Disposition: form-data; name="datei"; filename="s.zip"\r\n` +
          "Content-Type: application/zip\r\n\r\n",
      ),
      Buffer.from(datei),
      Buffer.from(`\r\n--${grenze}--\r\n`),
    ]),
  };
}

async function sende(s: Pruefstand, keks: string, url: string, zip: Uint8Array) {
  const { body, grenze } = multipart(zip);
  return s.app.inject({
    method: "POST",
    url,
    headers: { cookie: keks, "content-type": `multipart/form-data; boundary=${grenze}` },
    payload: body,
  });
}

async function exportiere(s: Pruefstand, keks: string): Promise<Uint8Array> {
  const a = await s.app.inject({ url: "/api/sicherung", headers: { cookie: keks } });
  expect(a.statusCode).toBe(200);
  expect(a.headers["content-type"]).toBe("application/zip");
  return new Uint8Array(a.rawPayload);
}

const PDF = Buffer.from("%PDF-1.4\nInhalt, der genau so zurueckkommen muss\n%%EOF\n");

/** Ein Bestand mit Besucher, Exponat, Dokument samt Datei, Zuordnung und Betreuer. */
async function befuelle(s: Pruefstand, keks: string) {
  const ruf = async <T>(method: "POST" | "GET", url: string, payload?: object) =>
    (await s.app.inject({ method, url, headers: { cookie: keks }, payload })).json<T>();

  const { body, grenze } = (() => {
    const g = "----namurdatei";
    return {
      grenze: g,
      body: Buffer.concat([
        Buffer.from(
          `--${g}\r\nContent-Disposition: form-data; name="datei"; filename="blatt.pdf"\r\n` +
            "Content-Type: application/pdf\r\n\r\n",
        ),
        PDF,
        Buffer.from(`\r\n--${g}--\r\n`),
      ]),
    };
  })();
  const datei = (
    await s.app.inject({
      method: "POST",
      url: "/api/dateien",
      headers: { cookie: keks, "content-type": `multipart/form-data; boundary=${grenze}` },
      payload: body,
    })
  ).json<{ id: string }>();

  const e = await ruf<{ id: string }>("POST", "/api/exponate", { name: "Gesichert" });
  const dok = await ruf<{ id: string }>("POST", `/api/exponate/${e.id}/dokumente`, {
    dateiId: datei.id,
    titel: "Datenblatt",
  });
  await ruf("POST", "/api/besucher", {
    guid: "SI-1",
    vorname: "Anna",
    nachname: "Ahrens",
    alias: "Anni",
  });
  await ruf("POST", "/api/scan/zuordnen", {
    guid: "SI-1",
    exponatId: e.id,
    elemente: [{ art: "dokument", zielId: dok.id }],
  });
  return { dateiId: datei.id, exponatId: e.id };
}

async function bestand(s: Pruefstand, keks: string) {
  return (await s.app.inject({ url: "/api/entwickler/bestand", headers: { cookie: keks } })).json<
    Record<string, number>
  >();
}

describe("Sicherung", () => {
  it("enthaelt Datenbank, Beschreibung und jede Datei", async () => {
    const { s, keks } = await neuerStand();
    await befuelle(s, keks);
    const eintraege = unzipSync(await exportiere(s, keks));

    expect(Object.keys(eintraege)).toContain("namur.db");
    const info = JSON.parse(new TextDecoder().decode(eintraege["sicherung.json"])) as {
      kennung: string;
      bestand: { besucher: number };
      dateien: number;
    };
    expect(info.kennung).toBe("namur-hv-2026");
    expect(info.bestand.besucher).toBe(1);
    const dateien = Object.keys(eintraege).filter((n) => n.startsWith("dateien/"));
    expect(dateien.length).toBe(info.dateien);
    expect(dateien.every((n) => !n.includes("\\"))).toBe(true);
  });

  it("stellt nach Aenderungen alles wieder her, auch Dateien und Nutzer", async () => {
    const { s, keks } = await neuerStand();
    const { dateiId } = await befuelle(s, keks);
    const vorher = await bestand(s, keks);
    const zip = await exportiere(s, keks);

    // Den Bestand umbauen: Besucher weg, neuer Nutzer dazu, ein weiterer Besucher.
    await s.app.inject({ method: "DELETE", url: "/api/besucher/SI-1", headers: { cookie: keks } });
    await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Spaeter", email: "spaeter@namur.de", rolle: "betreuer" },
    });
    await s.app.inject({
      method: "POST",
      url: "/api/besucher",
      headers: { cookie: keks },
      payload: { guid: "SI-NEU", vorname: "Neu", nachname: "Dazu" },
    });

    const geprueft = await sende(s, keks, "/api/sicherung/pruefen", zip);
    expect(geprueft.statusCode).toBe(200);
    expect(
      geprueft.json<{ sicherung: { bestand: { besucher: number } } }>().sicherung.bestand.besucher,
    ).toBe(1);

    const eingespielt = await sende(s, keks, "/api/sicherung", zip);
    expect(eingespielt.statusCode, eingespielt.body).toBe(200);

    expect(await bestand(s, keks)).toEqual(vorher);
    const b = (await s.app.inject({ url: "/api/besucher/SI-1", headers: { cookie: keks } })).json<{
      alias: string;
    }>();
    expect(b.alias).toBe("Anni");
    expect(
      (await s.app.inject({ url: "/api/besucher/SI-NEU", headers: { cookie: keks } })).statusCode,
    ).toBe(404);

    const nutzer = (await s.app.inject({ url: "/api/nutzer", headers: { cookie: keks } })).json<
      { email: string }[]
    >();
    expect(nutzer.map((n) => n.email)).not.toContain("spaeter@namur.de");

    const datei = await s.app.inject({ url: `/api/dateien/${dateiId}`, headers: { cookie: keks } });
    expect(datei.statusCode).toBe(200);
    expect(Buffer.compare(datei.rawPayload, PDF)).toBe(0);
  });

  /** Der eigentliche Zweck: von einer Instanz in eine andere, leere. */
  it("spielt in eine frische Instanz ein und laesst dort keine fremden Dateien liegen", async () => {
    const quelle = await neuerStand();
    const { dateiId } = await befuelle(quelle.s, quelle.keks);
    const zip = await exportiere(quelle.s, quelle.keks);

    const ziel = await neuerStand();
    const eingespielt = await sende(ziel.s, ziel.keks, "/api/sicherung", zip);
    expect(eingespielt.statusCode, eingespielt.body).toBe(200);

    /*
     * **Danach ist der Importierende abgemeldet**: sein Konto gibt es im eingespielten
     * Bestand nicht, dort steht der Admin der Quelle mit eigener Id. So vereinbart; die
     * Oberflaeche laedt nach dem Einspielen neu und landet bei der Anmeldung.
     */
    expect(
      (await ziel.s.app.inject({ url: "/api/besucher", headers: { cookie: ziel.keks } }))
        .statusCode,
    ).toBe(401);
    const keks = await melde(ziel.s, "admin@namur.de", "startpasswort-123");

    const datei = await ziel.s.app.inject({
      url: `/api/dateien/${dateiId}`,
      headers: { cookie: keks },
    });
    expect(datei.statusCode, datei.body.slice(0, 300)).toBe(200);
    expect(Buffer.compare(datei.rawPayload, PDF)).toBe(0);
    // Was nur die Zielinstanz hatte (Standard-Avatar und Galerie mit eigenen Ids), ist weg
    // oder wieder genannt: jede Datei der Ablage gehoert zu einem Datensatz.
    const genannt = ziel.s.ctx.sqlite.prepare("select pfad from dateien").all() as {
      pfad: string;
    }[];
    expect((await ziel.s.ctx.ablage.alle()).sort()).toEqual(
      genannt.map((g) => g.pfad.replaceAll("\\", "/")).sort(),
    );
  });

  it("weist ein ZIP ab, dessen Eintrag die Ablage verlaesst, und aendert nichts", async () => {
    const { s, keks } = await neuerStand();
    await befuelle(s, keks);
    const vorher = await bestand(s, keks);
    const echt = unzipSync(await exportiere(s, keks));
    const boese = zipSync({ ...echt, "dateien/../../boese.txt": strToU8("x") });

    const a = await sende(s, keks, "/api/sicherung", boese);
    expect(a.statusCode).toBe(400);
    expect(a.json<{ code: string }>().code).toBe("sicherung-pfad");
    expect(await bestand(s, keks)).toEqual(vorher);
  });

  it("weist eine Sicherung einer neueren Fassung ab", async () => {
    const { s, keks } = await neuerStand();
    const echt = unzipSync(await exportiere(s, keks));
    // Eine Migration mehr, als diese Fassung kennt.
    const { writeFileSync, readFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const Database = (await import("better-sqlite3")).default;
    const tmp = join(tmpdir(), `namur-neuer-${String(Date.now())}.db`);
    writeFileSync(tmp, echt["namur.db"]!);
    const d = new Database(tmp);
    d.prepare(
      "insert into __drizzle_migrations (hash, created_at) values ('zukunft', 99999999999999)",
    ).run();
    d.close();
    const neuer = zipSync({ ...echt, "namur.db": readFileSync(tmp) });
    rmSync(tmp, { force: true });

    const a = await sende(s, keks, "/api/sicherung", neuer);
    expect(a.statusCode).toBe(409);
    expect(a.json<{ code: string }>().code).toBe("sicherung-zu-neu");
  });

  it("weist eine kaputte Datenbank ab und aendert nichts", async () => {
    const { s, keks } = await neuerStand();
    await befuelle(s, keks);
    const vorher = await bestand(s, keks);
    const echt = unzipSync(await exportiere(s, keks));
    const kaputt = zipSync({ ...echt, "namur.db": strToU8("keine Datenbank") });

    const a = await sende(s, keks, "/api/sicherung", kaputt);
    expect(a.statusCode, a.body).toBe(400);
    expect(await bestand(s, keks)).toEqual(vorher);
  });

  /** Ein Datensatz, der auf nichts zeigt, darf nicht hereinkommen; alles faellt zurueck. */
  it("rollt bei haengenden Verweisen zurueck", async () => {
    const { s, keks } = await neuerStand();
    await befuelle(s, keks);
    const vorher = await bestand(s, keks);
    const echt = unzipSync(await exportiere(s, keks));

    const { writeFileSync, readFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const Database = (await import("better-sqlite3")).default;
    const tmp = join(tmpdir(), `namur-haengend-${String(Date.now())}.db`);
    writeFileSync(tmp, echt["namur.db"]!);
    const d = new Database(tmp);
    d.pragma("foreign_keys = OFF");
    d.prepare("update zuordnungen set besucher_guid = 'GIBT-ES-NICHT'").run();
    d.close();
    const haengend = zipSync({ ...echt, "namur.db": readFileSync(tmp) });
    rmSync(tmp, { force: true });

    const a = await sende(s, keks, "/api/sicherung", haengend);
    expect(a.statusCode).toBe(400);
    expect(a.json<{ code: string }>().code).toBe("sicherung-inkonsistent");
    expect(await bestand(s, keks)).toEqual(vorher);
  });

  it("ist ohne Anmeldung nicht erreichbar", async () => {
    const { s } = await neuerStand();
    expect((await s.app.inject({ url: "/api/sicherung" })).statusCode).toBe(401);
  });
});
