import { afterEach, describe, expect, it } from "vitest";
import { SCHLUESSEL_CARRERA, setzeSchalter } from "../src/services/einstellungen.js";
import { MAX_RUNDEN } from "../src/services/runden.js";
import { melde, starte, type Pruefstand } from "./hilfe.js";

/**
 * Rundenzeiten von der Carrera-Bahn.
 *
 * Der Partner meldet nach jeder gefahrenen Runde. Die Pruefungen hier drehen sich um die
 * Grenzen: was abgewiesen wird, was nur ignoriert wird, und was davon ein Fehler ist.
 *
 * **Anonym und unbekannt sind verschiedene Dinge.** Laut der Mail des Entwicklers sind
 * anonyme Runden vorgesehen; eine unbekannte GUID dagegen heisst, dass die Zuordnung
 * klemmt. Beantwortete man beides gleich, merkte niemand den zweiten Fall.
 */

const ADMIN = { ADMIN_EMAIL: "admin@namur.de", ADMIN_PASSWORT: "startpasswort-123" };
const BASIC = { CARRERA_BASIC_USER: "bahn", CARRERA_BASIC_PASSWORT: "geheim-fuer-die-bahn" };

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

interface Aufnahme {
  gespeichert: boolean;
  grund: string;
  platz: number | null;
}

async function alsAdmin(zusatz: Record<string, string> = {}) {
  stand = await starte({ ...ADMIN, ...zusatz });
  return { s: stand, keks: await melde(stand, "admin@namur.de", "startpasswort-123") };
}

async function legeBesucher(s: Pruefstand, keks: string, guid: string) {
  await s.app.inject({
    method: "POST",
    url: "/api/besucher",
    headers: { cookie: keks },
    payload: { guid, vorname: "Renn", nachname: "Fahrer" },
  });
}

/** Eine Meldung, wie sie die Bahn schickt. Die Feldnamen sind seine, nicht unsere. */
function meldung(nr: number, guid: string | null, zusatz: Record<string, unknown> = {}) {
  return {
    lap_id: `lap-${String(nr).padStart(3, "0")}`,
    race_id: "fc7bd88d-eb8c-42c1-a722-e07377863972",
    event_id: "Hauptversammlung-2026",
    event_name: "Hauptversammlung 2026",
    identity_namespace: "PF-CA-1",
    participant_id: guid,
    pseudonym: "Racing Fox",
    is_anonymous: guid === null ? 1 : 0,
    lane_number: 3,
    target_lap_count: 3,
    installation_label: "Messestand 123",
    lap_number: nr,
    started_utc_ms: 1790858096000 + nr,
    local_date: "2026-11-25",
    local_utc_offset_minutes: 120,
    duration_ms: 4827 + nr,
    ...zusatz,
  };
}

function melde_(
  s: Pruefstand,
  koerper: Record<string, unknown>,
  kopf: Record<string, string> = {},
) {
  return s.app.inject({ method: "POST", url: "/carrera/runden", headers: kopf, payload: koerper });
}

async function anzahl(s: Pruefstand, guid: string): Promise<number> {
  const antwort = await s.app.inject({ url: `/carrera/runden/besucher/${guid}` });
  return antwort.json<{ anzahl: number }>().anzahl;
}

describe("Runden melden", () => {
  it("nimmt eine Runde auf und vergibt Platz 1", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucher(s, keks, "RENN-0001");

    const antwort = await melde_(s, meldung(1, "RENN-0001"));
    expect(antwort.statusCode).toBe(200);
    expect(antwort.json<Aufnahme>()).toMatchObject({ gespeichert: true, platz: 1 });
    expect(await anzahl(s, "RENN-0001")).toBe(1);
  });

  /**
   * **Die Grenze.** 20 je Besucher, weil das Konnektor-Modell 20 feste Plaetze hat; einen
   * 21. gaebe es dort nicht.
   */
  it("weist die 21. Runde mit 409 ab und laesst die 20 stehen", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucher(s, keks, "RENN-0002");

    for (let i = 1; i <= MAX_RUNDEN; i++) {
      expect((await melde_(s, meldung(i, "RENN-0002"))).statusCode, `Runde ${String(i)}`).toBe(200);
    }

    const zuviel = await melde_(s, meldung(MAX_RUNDEN + 1, "RENN-0002"));
    expect(zuviel.statusCode).toBe(409);
    expect(zuviel.json<{ code: string }>().code).toBe("kontingent-erschoepft");

    // Und der Bestand ist unberuehrt: die Grenze darf nichts wegwerfen.
    expect(await anzahl(s, "RENN-0002")).toBe(MAX_RUNDEN);
  });

  /**
   * Nach dem Loeschen wird der **freigewordene** Platz vergeben, nicht Platz 21. Sonst
   * waere die Grenze nach zwanzig Loeschvorgaengen erreicht, ohne dass zwanzig Runden da
   * sind.
   */
  it("gibt einen geloeschten Platz wieder frei", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucher(s, keks, "RENN-0003");

    for (let i = 1; i <= MAX_RUNDEN; i++) await melde_(s, meldung(i, "RENN-0003"));

    const weg = await s.app.inject({ method: "DELETE", url: "/carrera/runden/lap-007" });
    expect(weg.statusCode).toBe(204);

    const neu = await melde_(s, meldung(99, "RENN-0003"));
    expect(neu.statusCode).toBe(200);
    expect(neu.json<Aufnahme>().platz, "nicht der freigewordene Platz").toBe(7);
  });

  it("legt dieselbe lap_id nur einmal an", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucher(s, keks, "RENN-0004");

    await melde_(s, meldung(1, "RENN-0004"));
    const zweite = await melde_(s, meldung(1, "RENN-0004", { duration_ms: 3999 }));
    expect(zweite.statusCode).toBe(200);
    expect(zweite.json<Aufnahme>().platz, "neuer Platz statt Aktualisierung").toBe(1);
    expect(await anzahl(s, "RENN-0004")).toBe(1);
  });

  it("entfernt eine Runde, die als geloescht gemeldet wird", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucher(s, keks, "RENN-0005");

    await melde_(s, meldung(1, "RENN-0005"));
    const weg = await melde_(
      s,
      meldung(1, "RENN-0005", {
        deleted_utc_ms: 1790858099000,
        deletion_reason: "operator_deleted_latest_race",
      }),
    );
    expect(weg.statusCode).toBe(200);
    expect(weg.json<Aufnahme>()).toMatchObject({ gespeichert: false, grund: "geloescht" });
    expect(await anzahl(s, "RENN-0005")).toBe(0);
  });
});

describe("Anonym und unbekannt sind verschiedene Dinge", () => {
  it("nimmt eine anonyme Runde mit 200 entgegen und speichert nichts", async () => {
    const { s } = await alsAdmin();
    const antwort = await melde_(s, meldung(1, null));
    expect(antwort.statusCode, "anonyme Runde ist kein Fehler").toBe(200);
    expect(antwort.json<Aufnahme>()).toMatchObject({ gespeichert: false, grund: "anonym" });
  });

  it("antwortet auf eine unbekannte GUID mit 404", async () => {
    const { s } = await alsAdmin();
    const antwort = await melde_(s, meldung(1, "GIBT-ES-NICHT"));
    expect(antwort.statusCode).toBe(404);
    expect(antwort.json<{ code: string }>().code).toBe("besucher-unbekannt");
  });

  it("weist eine Meldung ohne Rundenzeit ab", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucher(s, keks, "RENN-0006");
    const antwort = await melde_(s, meldung(1, "RENN-0006", { duration_ms: null }));
    expect(antwort.statusCode).toBe(400);
  });
});

describe("Der Zugang ist abschaltbar", () => {
  /** **Die wichtigere Haelfte**: ausgeschaltet ist die Vorgabe, und dann geht es ohne. */
  it("laesst ohne Zugangsdaten durch, solange der Schalter aus ist", async () => {
    const { s, keks } = await alsAdmin(BASIC);
    await legeBesucher(s, keks, "RENN-0010");
    expect((await melde_(s, meldung(1, "RENN-0010"))).statusCode).toBe(200);
  });

  it("verlangt sie, sobald der Schalter an ist", async () => {
    const { s, keks } = await alsAdmin(BASIC);
    await legeBesucher(s, keks, "RENN-0011");
    setzeSchalter(s.ctx.db, SCHLUESSEL_CARRERA, true);

    expect((await melde_(s, meldung(1, "RENN-0011"))).statusCode).toBe(401);

    const kopf = `Basic ${Buffer.from("bahn:geheim-fuer-die-bahn", "utf8").toString("base64")}`;
    const mit = await melde_(s, meldung(1, "RENN-0011"), { authorization: kopf });
    expect(mit.statusCode).toBe(200);
  });

  it("schliesst auch das Loeschen ein", async () => {
    const { s, keks } = await alsAdmin(BASIC);
    await legeBesucher(s, keks, "RENN-0012");
    await melde_(s, meldung(1, "RENN-0012"));
    setzeSchalter(s.ctx.db, SCHLUESSEL_CARRERA, true);

    const ohne = await s.app.inject({ method: "DELETE", url: "/carrera/runden/lap-001" });
    expect(ohne.statusCode, "Loeschen ohne Zugangsdaten").toBe(401);
    expect(await anzahl_mitKopf(s), "trotz 401 geloescht").toBe(1);
  });
});

/** Die Zahl abfragen, wenn der Schalter an ist. */
async function anzahl_mitKopf(s: Pruefstand): Promise<number> {
  const kopf = `Basic ${Buffer.from("bahn:geheim-fuer-die-bahn", "utf8").toString("base64")}`;
  const antwort = await s.app.inject({
    url: "/carrera/runden/besucher/RENN-0012",
    headers: { authorization: kopf },
  });
  return antwort.json<{ anzahl: number }>().anzahl;
}

describe("Runden im Konnektor", () => {
  it("steht mit allen 20 Plaetzen im Modell, auch ohne gefahrene Runde", async () => {
    const { s } = await alsAdmin();
    const felder = (await s.app.inject({ url: "/connector/model" })).json<{ id: string }[]>();
    const plaetze = felder.filter((f) => /^Visitor_Lap\d{2}$/.test(f.id));
    expect(plaetze).toHaveLength(MAX_RUNDEN);
    expect(plaetze.map((f) => f.id)).toContain("Visitor_Lap01");
    expect(plaetze.map((f) => f.id)).toContain("Visitor_Lap20");
  });

  it("liefert nur gefahrene Runden als Wert, nicht die leeren Plaetze", async () => {
    const { s, keks } = await alsAdmin();
    await legeBesucher(s, keks, "RENN-0020");
    await melde_(s, meldung(1, "RENN-0020"));
    await melde_(s, meldung(2, "RENN-0020"));

    const werte = (
      await s.app.inject({
        method: "POST",
        url: "/connector/product/RENN-0020/values",
        payload: {},
      })
    ).json<{ propertyId: string; value?: unknown }[]>();

    const runden = werte.filter((w) => /^Visitor_Lap\d{2}$/.test(w.propertyId));
    expect(runden, "leere Plaetze stehen in der Antwort").toHaveLength(2);
    expect(JSON.stringify(runden)).toContain("Runde 1");
    expect(JSON.stringify(runden)).toContain("Spur 3");
    // Die Zeit lesbar, mit Komma: 4828 ms -> "4,828 s".
    expect(JSON.stringify(runden)).toContain("4,828 s");
  });
});
