import { afterAll, afterEach, describe, expect, it } from "vitest";
import { melde, starte, verlangeAnmeldung, type Pruefstand } from "./hilfe.js";
import { arrayValidatorFuer, fehlendeSpec, specVorhanden, validatorFuer } from "./vertrag.js";

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };
const BASIC = { CONNECTOR_BASIC_USER: "axon", CONNECTOR_BASIC_PASSWORT: "geheim-fuer-axon" };
const KOPF = { authorization: `Basic ${Buffer.from("axon:geheim-fuer-axon").toString("base64")}` };

/**
 * Wie viele Vertragstests uebersprungen wurden.
 *
 * **Ein uebersprungener Vertragstest darf nicht unbemerkt bleiben.** Fehlt die Spec-Datei,
 * laeuft der Rest gruen durch und sieht aus wie ein gepruefter Vertrag. Deshalb die Zahl am
 * Ende sichtbar ausgeben.
 */
let uebersprungen = 0;

afterAll(() => {
  if (uebersprungen > 0) {
    console.warn(
      `\n!!! ${String(uebersprungen)} Vertragstests UEBERSPRUNGEN: ${fehlendeSpec()}\n` +
        "    Der Vertrag mit Axon ist damit NICHT geprueft.\n",
    );
  }
});

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

/** Ein Pruefstand mit Saatdaten. Liefert Cookie und die GUID eines Besuchers mit Inhalten. */
async function mitSaat(): Promise<{ s: Pruefstand; keks: string; guid: string }> {
  stand = await starte({ ...ADMIN, ...BASIC });
  const keks = await melde(stand, "admin@namur.de", "startpasswort-123");
  const saat = await stand.app.inject({
    method: "POST",
    url: "/api/aussaat",
    headers: { cookie: keks },
  });
  if (saat.statusCode !== 200) throw new Error(`Aussaat fehlgeschlagen: ${saat.body}`);
  // NHV2026-001 ist der erste Besucher und hat laut Aussaat Zuordnungen (i % 3 === 0).
  return { s: stand, keks, guid: "NHV2026-0001" };
}

describe("Konnektor-API: Zugang", () => {
  it("laesst /health anonym durch", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    const antwort = await stand.app.inject({ url: "/connector/health" });
    expect(antwort.statusCode).toBe(200);
  });

  it("weist alle anderen Endpunkte ohne Basic ab, wenn die Anmeldung verlangt ist", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    verlangeAnmeldung(stand, true);
    for (const url of ["/connector/versions", "/connector/model", "/connector/product/ids"]) {
      const antwort = await stand.app.inject({ url });
      expect(antwort.statusCode, url).toBe(401);
      // Nach RFC 7235 gehoert dieser Kopf an jede 401.
      expect(antwort.headers["www-authenticate"]).toContain("Basic");
      // Der Fehlerkoerper ist `Result`, nicht `{code, message}`.
      expect(antwort.json<{ messages: unknown[] }>().messages).toHaveLength(1);
    }
  });

  it("weist falsche Zugangsdaten ab", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    verlangeAnmeldung(stand, true);
    const falsch = `Basic ${Buffer.from("axon:stimmt-nicht").toString("base64")}`;
    const antwort = await stand.app.inject({
      url: "/connector/versions",
      headers: { authorization: falsch },
    });
    expect(antwort.statusCode).toBe(401);
  });

  /**
   * **Die Gegenrichtung.** Ohne sie belegte der Test oben nur, dass irgendetwas sperrt,
   * nicht dass die richtigen Zugangsdaten durchkommen.
   */
  it("laesst die richtigen Zugangsdaten durch", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    verlangeAnmeldung(stand, true);
    const antwort = await stand.app.inject({ url: "/connector/versions", headers: KOPF });
    expect(antwort.statusCode).toBe(200);
  });

  /**
   * Sind keine Zugangsdaten gesetzt, ist die API **geschlossen**, nicht offen. Eine
   * vergessene Umgebungsvariable darf die Besucherdaten nicht freigeben.
   */
  it("ist bei verlangter Anmeldung ohne konfigurierte Zugangsdaten geschlossen", async () => {
    stand = await starte(ADMIN);
    verlangeAnmeldung(stand, true);
    expect((await stand.app.inject({ url: "/connector/versions", headers: KOPF })).statusCode).toBe(
      401,
    );
    // /health bleibt erreichbar, sonst meldete der Dienst sich selbst als krank.
    expect((await stand.app.inject({ url: "/connector/health" })).statusCode).toBe(200);
  });

  it("nennt bei falscher Schreibweise die richtige", async () => {
    stand = await starte({ ...ADMIN, ...BASIC });
    const antwort = await stand.app.inject({ url: "/connector/Product/ids", headers: KOPF });
    expect(antwort.statusCode).toBe(404);
    expect(JSON.stringify(antwort.json())).toContain("lower-case");
  });
});

describe("Konnektor-API: die neun Endpunkte", () => {
  it("liefert /versions mit Semver", async () => {
    const { s } = await mitSaat();
    const antwort = await s.app.inject({ url: "/connector/versions", headers: KOPF });
    const koerper = antwort.json<{ spec: { version: string }; application: { version: string } }>();
    expect(koerper.spec.version).toBe("1.0.0");
    expect(koerper.application.version).toMatch(/^\d+\.\d+\.\d+|test/);
  });

  it("liefert alle GUIDs", async () => {
    const { s, guid } = await mitSaat();
    const ids = (await s.app.inject({ url: "/connector/product/ids", headers: KOPF })).json<
      string[]
    >();
    expect(ids).toHaveLength(700);
    expect(ids).toContain(guid);
  });

  it("liefert eine Hierarchieebene und 404 bei unbekannter GUID", async () => {
    const { s, guid } = await mitSaat();
    const gut = await s.app.inject({ url: `/connector/product/${guid}/hierarchy`, headers: KOPF });
    expect(gut.statusCode).toBe(200);
    expect(gut.json<{ level: number }[]>()[0]?.level).toBe(1);

    const schlecht = await s.app.inject({
      url: "/connector/product/gibt-es-nicht/hierarchy",
      headers: KOPF,
    });
    expect(schlecht.statusCode).toBe(404);
  });

  /**
   * Die **Namen** der Hierarchie.
   *
   * Bis zum 08.10.2026 pruefte sie kein Test: nur die Ebenennummer und das Schema. Die
   * Namen liessen sich also aendern, ohne dass etwas rot wurde, und genau das soll hier
   * nicht mehr gehen.
   */
  it("nennt die Ebene Asset und jeden Knoten Besucher", async () => {
    const { s } = await mitSaat();
    const hole = async (pfad: string) =>
      (await s.app.inject({ url: `/connector/${pfad}`, headers: KOPF })).json<
        { level: number; name: string }[]
      >();

    const ebenen = await hole("product/hierarchy/levels");
    expect(ebenen).toHaveLength(1);
    expect(ebenen[0]).toMatchObject({ level: 1, name: "Asset" });

    /*
     * **Zwei verschiedene GUIDs.** Mit einer waere nur belegt, dass irgendein Besucher
     * "Besucher" meldet, nicht dass es fuer alle gilt.
     */
    for (const g of ["NHV2026-0001", "NHV2026-0002"]) {
      const pfad = await hole(`product/${g}/hierarchy`);
      expect(pfad, g).toHaveLength(1);
      expect(pfad[0], g).toMatchObject({ level: 1, name: "Besucher" });
    }

    /*
     * Der Baum beschreibt denselben Knoten. Gegeneinander geprueft statt gegen eine
     * abgeschriebene Zeichenkette: so faellt auch auf, wenn nur eine Seite geaendert wird.
     */
    const baum = await hole("product/hierarchies");
    const einzeln = await hole("product/NHV2026-0001/hierarchy");
    expect(baum[0]?.name).toBe(einzeln[0]?.name);
  });

  it("baut das Modell aus den angelegten Exponaten", async () => {
    const { s } = await mitSaat();
    const felder = (await s.app.inject({ url: "/connector/model", headers: KOPF })).json<
      Record<string, unknown>[]
    >();
    // 11 Besucherfelder plus 10 Exponate zu je 102.
    expect(felder).toHaveLength(11 + 10 * 102);

    // Alle Plaetze bis zur Obergrenze, auch leere: Platz 10 gibt es, obwohl die Aussaat
    // nur zwei Dokumente anlegt. Sonst muesste nach jedem Upload neu gemappt werden.
    expect(felder.map((f) => f["id"])).toContain("E01_Doc10_Title");
    expect(felder.map((f) => f["id"])).toContain("E01_Contact05_Website");

    /*
     * **Ansprechpartner tragen kein Foto mehr.** Bliebe der Datenpunkt im Modell, mappte
     * ihn jemand in Axon, und `values` lieferte nie etwas dafuer.
     */
    expect(
      felder.filter(
        (f) => String(f["id"]).includes("_Contact") && String(f["id"]).endsWith("_Image"),
      ),
    ).toHaveLength(0);

    const avatar = felder.find((f) => f["id"] === "Visitor_Avatar");
    expect(avatar?.["type"]).toBe(1);
    expect(felder.find((f) => f["id"] === "Visitor_FirstName")?.["type"]).toBe(0);
    /*
     * **Genau drei Felder, nicht mehr.** Seit dem 08.10.2026 liefert das Modell weder
     * `description` noch `filters` noch `semanticIds`; die Spezifikation verlangt keines
     * davon (`required: []`). Geprueft wird die Abwesenheit, sonst bliebe das Entfernen
     * ungeprueft und kaeme bei der naechsten Aenderung unbemerkt zurueck.
     */
    for (const f of felder) {
      expect(Object.keys(f).sort(), String(f["id"])).toEqual(["id", "name", "type"]);
    }
  });
});

describe("Konnektor-API: Werte", () => {
  it("liefert Stammdaten und die zugeordneten Inhalte", async () => {
    const { s, guid } = await mitSaat();
    const antwort = await s.app.inject({
      method: "POST",
      url: `/connector/product/${guid}/values`,
      headers: KOPF,
      payload: {},
    });
    expect(antwort.statusCode).toBe(200);
    const werte = antwort.json<{ propertyId: string; value: string; needsResolve?: boolean }[]>();
    const ids = werte.map((w) => w.propertyId);

    expect(ids).toContain("Visitor_FirstName");
    expect(ids).toContain("Visitor_Avatar");
    // Die Aussaat ordnet diesem Besucher Inhalte von E01 zu.
    expect(ids).toContain("E01_Name");
    expect(ids).toContain("E01_Doc01_Title");
  });

  /**
   * **Die wichtigste Zusage:** ein Exponat ohne Zuordnung liefert nichts.
   *
   * Niemand soll etwas bekommen, das der Betreuer ihm nicht gegeben hat.
   */
  it("laesst Exponate ohne Zuordnung vollstaendig aus", async () => {
    const { s, guid } = await mitSaat();
    const werte = (
      await s.app.inject({
        method: "POST",
        url: `/connector/product/${guid}/values`,
        headers: KOPF,
        payload: {},
      })
    ).json<{ propertyId: string }[]>();
    const ids = werte.map((w) => w.propertyId);

    // E02 bis E06 hat dieser Besucher nicht.
    for (const kennung of ["E02", "E03", "E04", "E05", "E06"]) {
      expect(
        ids.filter((id) => id.startsWith(`${kennung}_`)),
        kennung,
      ).toHaveLength(0);
    }
  });

  it("liefert einem Besucher ohne jede Zuordnung nur seine Stammdaten", async () => {
    const { s } = await mitSaat();
    // NHV2026-002 bekommt in der Aussaat keine Zuordnungen (i % 3 !== 0).
    const werte = (
      await s.app.inject({
        method: "POST",
        url: "/connector/product/NHV2026-0002/values",
        headers: KOPF,
        payload: {},
      })
    ).json<{ propertyId: string }[]>();
    expect(werte.every((w) => w.propertyId.startsWith("Visitor_"))).toBe(true);
  });

  /**
   * **Die Dokumentregel, beide Richtungen in einem Test.**
   *
   * Bild geht By Value und niemals ueber den Ticketweg, Nicht-Bild geht By Ticket und
   * niemals By Value. Im AXON Connector war bis zum 08.09.2026 nur die erste Haelfte
   * geprueft, und weil sie geprueft war, sah die Regel geprueft aus.
   */
  it("schickt Bilder als Wert und Nicht-Bilder als Ticket", async () => {
    const { s, guid } = await mitSaat();
    const werte = (
      await s.app.inject({
        method: "POST",
        url: `/connector/product/${guid}/values`,
        headers: KOPF,
        payload: {},
      })
    ).json<{ propertyId: string; value: string; mimeType?: string; needsResolve?: boolean }[]>();

    const pdf = werte.find((w) => w.mimeType === "application/pdf");
    const png = werte.find((w) => w.mimeType === "image/png");
    expect(pdf, "ein PDF muss dabei sein").toBeDefined();
    expect(png, "ein Bild muss dabei sein").toBeDefined();

    // Nicht-Bild: Ticket, und der Ticketwert ist die propertyId selbst.
    expect(pdf?.needsResolve).toBe(true);
    expect(pdf?.value).toBe(pdf?.propertyId);

    // Bild: Wert, also Base64 und kein Ticket.
    expect(png?.needsResolve).toBe(false);
    expect(png?.value).not.toBe(png?.propertyId);
    expect(png?.value.length).toBeGreaterThan(20);
  });

  it("schreibt Dateinamen auf das Muster der Spec um", async () => {
    const { s, guid } = await mitSaat();
    const werte = (
      await s.app.inject({
        method: "POST",
        url: `/connector/product/${guid}/values`,
        headers: KOPF,
        payload: {},
      })
    ).json<{ filename?: string; mimeType?: string }[]>();
    const pdf = werte.find((w) => w.mimeType === "application/pdf");
    // Aus "Datenblatt E01 (DE).pdf" wird "Datenblatt-E01-DE.pdf".
    expect(pdf?.filename).toBe("Datenblatt-E01-DE.pdf");
    expect(pdf?.filename).toMatch(/^[A-Za-z0-9_-]+\.?[A-Za-z0-9_-]+$/);
  });

  it("loest das Ticket mit denselben Begleitwerten auf", async () => {
    const { s, guid } = await mitSaat();
    const werte = (
      await s.app.inject({
        method: "POST",
        url: `/connector/product/${guid}/values`,
        headers: KOPF,
        payload: {},
      })
    ).json<
      {
        propertyId: string;
        value: string;
        filename?: string;
        mimeType?: string;
        needsResolve?: boolean;
      }[]
    >();
    const ticket = werte.find((w) => w.needsResolve === true);
    expect(ticket).toBeDefined();

    const doks = (
      await s.app.inject({
        method: "POST",
        url: `/connector/product/${guid}/documents`,
        headers: KOPF,
        payload: { propertyIds: [ticket?.value] },
      })
    ).json<
      {
        propertyId: string;
        value: string;
        filename?: string;
        mimeType?: string;
        needsResolve?: boolean;
      }[]
    >();

    expect(doks).toHaveLength(1);
    const gelöst = doks[0];
    // Begleitwerte identisch, needsResolve jetzt false, und der Inhalt ist da.
    expect(gelöst?.filename).toBe(ticket?.filename);
    expect(gelöst?.mimeType).toBe(ticket?.mimeType);
    expect(gelöst?.needsResolve).toBe(false);
    expect(gelöst?.value).not.toBe(ticket?.value);
    expect(Buffer.from(gelöst?.value ?? "", "base64").toString("utf8")).toContain("%PDF");
  });

  it("nimmt null und leere Arrays an", async () => {
    const { s, guid } = await mitSaat();
    for (const payload of [
      {},
      { propertiesWithLanguage: null, propertiesWithoutLanguage: null },
      { propertiesWithLanguage: { propertyIds: [], languages: [] } },
      { propertiesWithLanguage: { propertyIds: null, languages: null } },
    ]) {
      const antwort = await s.app.inject({
        method: "POST",
        url: `/connector/product/${guid}/values`,
        headers: KOPF,
        payload,
      });
      expect(antwort.statusCode, JSON.stringify(payload)).toBe(200);
    }
  });

  it("liefert Texte mit de, auch wenn de nicht in der Vorzugsliste steht", async () => {
    const { s, guid } = await mitSaat();
    const werte = (
      await s.app.inject({
        method: "POST",
        url: `/connector/product/${guid}/values`,
        headers: KOPF,
        payload: {
          propertiesWithLanguage: { propertyIds: ["Visitor_FirstName"], languages: ["en"] },
        },
      })
    ).json<{ propertyId: string; valueLanguage?: string }[]>();
    expect(werte).toHaveLength(1);
    // Rueckfall statt Auslassen: der Viewer soll nie leer bleiben.
    expect(werte[0]?.valueLanguage).toBe("de");
  });

  it("laesst bei propertiesWithoutLanguage das Sprachkennzeichen weg", async () => {
    const { s, guid } = await mitSaat();
    const werte = (
      await s.app.inject({
        method: "POST",
        url: `/connector/product/${guid}/values`,
        headers: KOPF,
        payload: { propertiesWithoutLanguage: { propertyIds: ["Visitor_FirstName"] } },
      })
    ).json<{ valueLanguage?: string }[]>();
    expect(werte[0]?.valueLanguage).toBeUndefined();
  });
});

describe("Konnektor-API: Vertrag gegen connector-1.0.0.json", () => {
  it("validiert /model gegen DataModelProperty", async () => {
    if (!specVorhanden) {
      uebersprungen++;
      return;
    }
    const { s } = await mitSaat();
    const felder = (await s.app.inject({ url: "/connector/model", headers: KOPF })).json();
    const pruefe = arrayValidatorFuer("DataModelProperty");
    /*
     * `PropertyType` ist der bekannte Widerspruch: die OpenAPI fuehrt ein
     * Zeichenketten-Enum, der Guide und der laufende Excel Connector senden Zahlen. Wir
     * senden Zahlen. Der Vertragstest prueft deshalb alles **ausser** diesem einen Feld
     * gegen die unveraenderte Datei, und die Abweichung steht hier als Code statt als
     * Behauptung.
     */
    const ohneTyp = (felder as Record<string, unknown>[]).map(({ type, ...rest }) => {
      expect(typeof type).toBe("number");
      return rest;
    });
    const gueltig = pruefe(ohneTyp);
    expect(pruefe.errors ?? [], JSON.stringify(pruefe.errors)).toHaveLength(0);
    expect(gueltig).toBe(true);
  });

  it("validiert /values gegen ProductProperty", async () => {
    if (!specVorhanden) {
      uebersprungen++;
      return;
    }
    const { s, guid } = await mitSaat();
    const werte = (
      await s.app.inject({
        method: "POST",
        url: `/connector/product/${guid}/values`,
        headers: KOPF,
        payload: {},
      })
    ).json();
    const pruefe = arrayValidatorFuer("ProductProperty");
    const gueltig = pruefe(werte);
    expect(pruefe.errors ?? [], JSON.stringify(pruefe.errors)).toHaveLength(0);
    expect(gueltig).toBe(true);
  });

  it("validiert die Hierarchieebenen und den Fehlerkoerper", async () => {
    if (!specVorhanden) {
      uebersprungen += 1;
      return;
    }
    const { s } = await mitSaat();

    const ebenen = (
      await s.app.inject({ url: "/connector/product/hierarchy/levels", headers: KOPF })
    ).json();
    const pruefeEbenen = arrayValidatorFuer("ProductHierarchyLevel");
    expect(pruefeEbenen(ebenen), JSON.stringify(pruefeEbenen.errors)).toBe(true);

    const fehler = (await s.app.inject({ url: "/connector/versions" })).json();
    const pruefeResult = validatorFuer("Result");
    expect(pruefeResult(fehler), JSON.stringify(pruefeResult.errors)).toBe(true);
  });
});
