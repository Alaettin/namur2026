import { afterEach, describe, expect, it } from "vitest";
import { melde, starte, type Pruefstand } from "./hilfe.js";
import { STANDARD_AVATAR_ID } from "../src/services/standardavatar.js";

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

async function alsAdmin() {
  stand = await starte(ADMIN);
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

/** Baut einen Multipart-Koerper mit Datei und optionalen Feldern. */
function multipart(
  datei: Buffer,
  felder: Record<string, string> = {},
): { body: Buffer; grenze: string } {
  const grenze = "----namurimport";
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

async function ruf(
  s: Pruefstand,
  keks: string,
  url: string,
  datei: Buffer,
  felder: Record<string, string> = {},
) {
  const { body, grenze } = multipart(datei, felder);
  return s.app.inject({
    method: "POST",
    url,
    headers: { cookie: keks, "content-type": `multipart/form-data; boundary=${grenze}` },
    payload: body,
  });
}

const GUT = Buffer.from(
  "guid;vorname;nachname;firma;email\n" +
    "NHV-001;Anna;Ahrens;Mueller AG;anna@example.invalid\n" +
    "NHV-002;Bernd;Brandt;Nordwerk;bernd@example.invalid\n",
  "utf8",
);

describe("CSV pruefen", () => {
  it("meldet Zeichensatz, Trennzeichen und die Zuordnung", async () => {
    const { s, keks } = await alsAdmin();
    const antwort = await ruf(s, keks, "/api/besucher/import/pruefen", GUT);
    expect(antwort.statusCode).toBe(200);
    const e = antwort.json<{
      zeichensatz: string;
      trennzeichen: string;
      zuordnung: (string | null)[];
      zeilenGesamt: number;
      uebernehmbar: number;
      neu: number;
    }>();
    expect(e.zeichensatz).toBe("utf-8");
    expect(e.trennzeichen).toBe(";");
    expect(e.zuordnung).toEqual(["guid", "vorname", "nachname", "firma", "email"]);
    expect(e.zeilenGesamt).toBe(2);
    expect(e.uebernehmbar).toBe(2);
    expect(e.neu).toBe(2);
  });

  it("aendert dabei nichts am Bestand", async () => {
    const { s, keks } = await alsAdmin();
    await ruf(s, keks, "/api/besucher/import/pruefen", GUT);
    const liste = await s.app.inject({ url: "/api/besucher", headers: { cookie: keks } });
    expect(liste.json<{ gesamt: number }>().gesamt).toBe(0);
  });

  it("nennt alle Beanstandungen vor der Uebernahme", async () => {
    const { s, keks } = await alsAdmin();
    const kaputt = Buffer.from(
      "guid;vorname;nachname;email\n" +
        "NHV-001;Anna;Ahrens;anna@example.invalid\n" +
        "NHV-001;Doppelt;Doppelt;d@example.invalid\n" +
        "NHV-003;;OhneVorname;c@example.invalid\n" +
        "NHV-004;Dirk;Dietrich;keine-mail\n",
      "utf8",
    );
    const e = (await ruf(s, keks, "/api/besucher/import/pruefen", kaputt)).json<{
      beanstandungen: { zeile: number; art: string }[];
      uebernehmbar: number;
      uebersprungen: number;
    }>();

    const arten = e.beanstandungen.map((b) => b.art);
    expect(arten).toContain("guid-doppelt");
    expect(arten).toContain("pflicht-fehlt");
    expect(arten).toContain("email-ungueltig");
    expect(e.uebernehmbar).toBe(1);
    expect(e.uebersprungen).toBe(3);
  });

  it("liest eine Windows-1252-Datei mit richtigen Umlauten", async () => {
    const { s, keks } = await alsAdmin();
    // "Grüße" und "Köln" in der Windows-Codepage.
    const bytes = Buffer.from([
      ...Buffer.from("guid;vorname;nachname;ort\nNHV-001;Jan;Gr", "ascii"),
      0xfc, // ü
      0xdf, // ß
      ...Buffer.from("e;K", "ascii"),
      0xf6, // ö
      ...Buffer.from("ln\n", "ascii"),
    ]);
    const e = (await ruf(s, keks, "/api/besucher/import/pruefen", bytes)).json<{
      zeichensatz: string;
      vorschau: { werte: Record<string, string> }[];
    }>();
    expect(e.zeichensatz).toBe("windows-1252");
    expect(e.vorschau[0]?.werte["nachname"]).toBe("Grüße");
    expect(e.vorschau[0]?.werte["ort"]).toBe("Köln");
  });

  it("nimmt eine geaenderte Spaltenzuordnung an", async () => {
    const { s, keks } = await alsAdmin();
    const eigen = Buffer.from("kennung;rufname;familie\nNHV-001;Anna;Ahrens\n", "utf8");
    const e = (
      await ruf(s, keks, "/api/besucher/import/pruefen", eigen, {
        zuordnung: JSON.stringify(["guid", "vorname", "nachname"]),
      })
    ).json<{ uebernehmbar: number; zuordnung: (string | null)[] }>();
    expect(e.zuordnung).toEqual(["guid", "vorname", "nachname"]);
    expect(e.uebernehmbar).toBe(1);
  });
});

describe("CSV uebernehmen", () => {
  /**
   * Seit dem 08.10.2026 traegt jeder neue Besucher den Standard-Avatar, auch der aus dem
   * Massenimport: beide Wege laufen durch `legeBesucherAn`.
   */
  it("gibt auch importierten Besuchern den Standard-Avatar", async () => {
    const { s, keks } = await alsAdmin();
    await ruf(s, keks, "/api/besucher/import/uebernehmen", GUT, { modus: "ergaenzen" });

    const geholt = await s.app.inject({ url: "/api/besucher/NHV-001", headers: { cookie: keks } });
    expect(geholt.json<{ avatarDateiId: string | null }>().avatarDateiId).toBe(STANDARD_AVATAR_ID);
  });

  it("legt neu an und aktualisiert beim zweiten Lauf", async () => {
    const { s, keks } = await alsAdmin();
    const erst = (
      await ruf(s, keks, "/api/besucher/import/uebernehmen", GUT, { modus: "ergaenzen" })
    ).json<{ neu: number; aktualisiert: number }>();
    expect(erst).toMatchObject({ neu: 2, aktualisiert: 0 });

    const geaendert = Buffer.from(
      "guid;vorname;nachname;firma;email\n" +
        "NHV-001;Anna;Ahrens;Neue Firma;anna@example.invalid\n" +
        "NHV-003;Clara;Clausen;Dritte;clara@example.invalid\n",
      "utf8",
    );
    const zweit = (
      await ruf(s, keks, "/api/besucher/import/uebernehmen", geaendert, { modus: "ergaenzen" })
    ).json<{ neu: number; aktualisiert: number }>();
    expect(zweit).toMatchObject({ neu: 1, aktualisiert: 1 });

    // Ergaenzen laesst NHV-002 stehen, und NHV-001 hat die neue Firma.
    const liste = await s.app.inject({ url: "/api/besucher", headers: { cookie: keks } });
    expect(liste.json<{ gesamt: number }>().gesamt).toBe(3);
    const eins = await s.app.inject({ url: "/api/besucher/NHV-001", headers: { cookie: keks } });
    expect(eins.json<{ firma: string }>().firma).toBe("Neue Firma");
  });

  it("entfernt beim Ersetzen die nicht enthaltenen Besucher samt Zuordnungen", async () => {
    const { s, keks } = await alsAdmin();
    await ruf(s, keks, "/api/besucher/import/uebernehmen", GUT, { modus: "ergaenzen" });

    const nurEiner = Buffer.from("guid;vorname;nachname\nNHV-001;Anna;Ahrens\n", "utf8");
    const e = (
      await ruf(s, keks, "/api/besucher/import/uebernehmen", nurEiner, { modus: "ersetzen" })
    ).json<{ entfernt: number }>();
    expect(e.entfernt).toBe(1);

    const liste = await s.app.inject({ url: "/api/besucher", headers: { cookie: keks } });
    expect(liste.json<{ gesamt: number }>().gesamt).toBe(1);
  });

  /** Die Gegenrichtung: Ergaenzen darf **nichts** entfernen. */
  it("entfernt beim Ergaenzen nichts", async () => {
    const { s, keks } = await alsAdmin();
    await ruf(s, keks, "/api/besucher/import/uebernehmen", GUT, { modus: "ergaenzen" });
    const nurEiner = Buffer.from("guid;vorname;nachname\nNHV-001;Anna;Ahrens\n", "utf8");
    const e = (
      await ruf(s, keks, "/api/besucher/import/uebernehmen", nurEiner, { modus: "ergaenzen" })
    ).json<{ entfernt: number }>();
    expect(e.entfernt).toBe(0);
    const liste = await s.app.inject({ url: "/api/besucher", headers: { cookie: keks } });
    expect(liste.json<{ gesamt: number }>().gesamt).toBe(2);
  });

  it("uebernimmt beanstandete Zeilen nicht und liefert sie als CSV zurueck", async () => {
    const { s, keks } = await alsAdmin();
    const gemischt = Buffer.from(
      "guid;vorname;nachname;email\n" +
        "NHV-001;Anna;Ahrens;anna@example.invalid\n" +
        "NHV-002;Bernd;Brandt;keine-mail\n",
      "utf8",
    );
    const e = (
      await ruf(s, keks, "/api/besucher/import/uebernehmen", gemischt, { modus: "ergaenzen" })
    ).json<{ neu: number; uebersprungen: number; uebersprungeneCsv: string }>();

    expect(e.neu).toBe(1);
    expect(e.uebersprungen).toBe(1);
    // Die uebersprungene Zeile steht mit ihrem Grund in der CSV.
    expect(e.uebersprungeneCsv).toContain("NHV-002");
    expect(e.uebersprungeneCsv).toContain("keine-mail");
    expect(e.uebersprungeneCsv).not.toContain("NHV-001");

    // Und sie ist wirklich nicht im Bestand.
    const fehlt = await s.app.inject({ url: "/api/besucher/NHV-002", headers: { cookie: keks } });
    expect(fehlt.statusCode).toBe(404);
  });

  it("erzeugt eine GUID, wenn die Spalte fehlt", async () => {
    const { s, keks } = await alsAdmin();
    const ohneGuid = Buffer.from("vorname;nachname\nAnna;Ahrens\n", "utf8");
    const e = (
      await ruf(s, keks, "/api/besucher/import/uebernehmen", ohneGuid, { modus: "ergaenzen" })
    ).json<{ neu: number }>();
    expect(e.neu).toBe(1);
  });

  it("verlangt einen Modus", async () => {
    const { s, keks } = await alsAdmin();
    const antwort = await ruf(s, keks, "/api/besucher/import/uebernehmen", GUT);
    expect(antwort.statusCode).toBe(400);
    expect(antwort.json<{ code: string }>().code).toBe("modus-fehlt");
  });

  it("weist Betreuer und Unangemeldete ab", async () => {
    const { s, keks } = await alsAdmin();
    const angelegt = await s.app.inject({
      method: "POST",
      url: "/api/nutzer",
      headers: { cookie: keks },
      payload: { name: "Kai", email: "kai@namur.de", rolle: "betreuer" },
    });
    const { startpasswort } = angelegt.json<{ startpasswort: string }>();
    const betreuer = await melde(s, "kai@namur.de", startpasswort);

    expect((await ruf(s, betreuer, "/api/besucher/import/pruefen", GUT)).statusCode).toBe(403);
    const { body, grenze } = multipart(GUT);
    const ohne = await s.app.inject({
      method: "POST",
      url: "/api/besucher/import/pruefen",
      headers: { "content-type": `multipart/form-data; boundary=${grenze}` },
      payload: body,
    });
    expect(ohne.statusCode).toBe(401);
  });
});
