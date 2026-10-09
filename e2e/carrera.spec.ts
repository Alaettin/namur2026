import { expect, test, type APIRequestContext } from "@playwright/test";
import { merkeBesucher, raeumeBesucherAuf } from "./exponate.js";

/**
 * Die Rundenzeiten von der Carrera-Bahn, aus der Verwaltungssicht.
 *
 * Gemeldet wird hier **über die echte Schnittstelle**, nicht über einen Testhelfer: genau
 * den Weg geht die Software der Bahn, und eine Abnahme, die die Daten hintenherum anlegt,
 * belegt nichts über ihn.
 *
 * Ein gelöschter Besucher nimmt seine Runden mit (`onDelete: cascade`), das Aufräumen der
 * Besucher genügt also.
 */

test.afterEach(async ({ request }) => {
  await raeumeBesucherAuf(request);
});

/** Eine Meldung, wie die Bahn sie schickt. Die Feldnamen sind seine. */
function meldung(lapId: string, guid: string, nr: number, dauerMs: number) {
  return {
    lap_id: lapId,
    race_id: "fc7bd88d-eb8c-42c1-a722-e07377863972",
    event_id: "Hauptversammlung-2026",
    event_name: "Hauptversammlung 2026",
    identity_namespace: "PF-CA-1",
    participant_id: guid,
    pseudonym: "Racing Fox",
    is_anonymous: 0,
    lane_number: 3,
    target_lap_count: 3,
    installation_label: "Messestand 123",
    lap_number: nr,
    started_utc_ms: 1790858096000 + nr * 10000,
    local_date: "2026-11-25",
    local_utc_offset_minutes: 120,
    duration_ms: dauerMs,
  };
}

/** Legt einen Besucher an und meldet zwei Runden über `/carrera/runden`. */
async function besucherMitRunden(request: APIRequestContext, guid: string) {
  const angelegt = await request.post("/api/besucher", {
    data: { guid, vorname: "Renn", nachname: "Fahrer" },
  });
  expect(angelegt.status(), "Besucher anlegen").toBe(201);
  merkeBesucher(guid);

  for (const [i, dauer] of [5321, 4827].entries()) {
    const antwort = await request.post("/carrera/runden", {
      data: meldung(`${guid}-lap-${String(i + 1)}`, guid, i + 1, dauer),
    });
    expect(antwort.status(), `Runde ${String(i + 1)} melden`).toBe(200);
    expect((await antwort.json()).gespeichert).toBe(true);
  }
}

test("gemeldete Runden stehen im Besucherdetail, und Löschen entfernt sie", async ({
  page,
  request,
}) => {
  const guid = `CAR-${String(Date.now()).slice(-8)}`;
  await besucherMitRunden(request, guid);

  await page.goto(`/besucher/${guid}`);
  await expect(page.getByRole("heading", { name: "Runden (2)" })).toBeVisible();
  await expect(page.getByText("Runde 1 · 5,321 s · Spur 3")).toBeVisible();
  await expect(page.getByText("Runde 2 · 4,827 s · Spur 3")).toBeVisible();

  // Die beste ist die schnellere, nicht die letzte.
  await expect(page.getByText(/Beste Runde:/)).toContainText("4,827 s");

  /*
   * **Und wieder weg, über die Schnittstelle.** Der Partner nimmt eine Runde über die
   * `lap_id` zurück; geprüft wird am Bildschirm, nicht nur am Statuscode.
   */
  const weg = await request.delete(`/carrera/runden/${guid}-lap-1`);
  expect(weg.status()).toBe(204);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Runden (1)" })).toBeVisible();
  await expect(page.getByText("Runde 1 · 5,321 s · Spur 3")).toBeHidden();
  await expect(page.getByText("Runde 2 · 4,827 s · Spur 3")).toBeVisible();
});

/**
 * **Was Axon bekommt.** Ohne Anmeldung aufgerufen, wie der Viewer.
 *
 * Geprüft werden beide Hälften: die gefahrenen Runden stehen drin, und die 18 leeren Plätze
 * stehen **nicht** drin. Nur die erste Hälfte ließe offen, ob der Viewer achtzehn leere
 * Zeilen zeigt.
 */
test("die Runden gehen über die Konnektor-API hinaus", async ({ request }) => {
  const guid = `CAR-${String(Date.now()).slice(-8)}`;
  await besucherMitRunden(request, guid);

  const modell = await (await request.get("/connector/model")).json();
  const plaetze = modell.filter((f: { id: string }) => /^Visitor_Lap\d{2}$/.test(f.id));
  expect(plaetze, "die Plätze fehlen im Modell").toHaveLength(20);

  const werte = await (
    await request.post(`/connector/product/${guid}/values`, { data: {} })
  ).json();
  const runden = werte.filter((w: { propertyId: string }) =>
    /^Visitor_Lap\d{2}$/.test(w.propertyId),
  );
  expect(runden, "leere Plätze stehen in der Antwort").toHaveLength(2);
  expect(JSON.stringify(runden)).toContain("4,827 s");
});

test("die Seite API zeigt beide Blöcke, und der Prüfstand ruft die Bahn auf", async ({
  page,
  request,
}) => {
  const guid = `CAR-${String(Date.now()).slice(-8)}`;
  await besucherMitRunden(request, guid);

  await page.goto("/api");
  await expect(page.getByRole("heading", { name: "Endpunkte AXON Connector" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Endpunkte Carrera-Bahn" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Zugang Carrera-Bahn" })).toBeVisible();

  // Der Prüfstand des Lese-Endpunkts, mit der GUID des eben angelegten Besuchers.
  const lesen = page.locator("li", { hasText: "/runden/besucher/{guid}" });
  await lesen.locator("summary").click();
  await lesen.getByLabel("GUID").fill(guid);
  await lesen.getByRole("button", { name: "Senden" }).click();

  await expect(lesen.getByText("HTTP 200")).toBeVisible();
  await expect(lesen.locator("pre")).toContainText("4,827 s");
});

/**
 * **Beim Löschen steht dort eine `lap_id`, keine GUID.**
 *
 * Die Beschriftung ist nicht Kosmetik: wer hier die GUID einträgt, bekommt ein 204, das wie
 * Erfolg aussieht, und die Runde steht weiter da.
 */
test("das Feld des Löschendpunkts heißt lap_id und ist nicht vorbelegt", async ({ page }) => {
  await page.goto("/api");
  const loeschen = page.locator("li", { hasText: "/runden/{lap_id}" });
  await loeschen.locator("summary").click();

  await expect(loeschen.getByLabel("lap_id")).toBeVisible();
  await expect(loeschen.getByLabel("lap_id")).toHaveValue("");
  await expect(loeschen.getByLabel("GUID", { exact: true })).toHaveCount(0);
});
