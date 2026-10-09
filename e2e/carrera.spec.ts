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
 * **Name und Bild fuer den Bildschirm an der Bahn.**
 *
 * Über die echte Route, ohne Anmeldung: genau so ruft die Software der Bahn auf. Geprüft
 * wird nicht nur, dass ein Feld `base64` da ist, sondern dass es sich zu einem Bild der
 * gemeldeten Größe dekodieren lässt.
 */
test("der Fahrer-Aufruf liefert Namen und ein vollständiges Bild", async ({ request }) => {
  const guid = `CAR-${String(Date.now()).slice(-8)}`;
  await besucherMitRunden(request, guid);

  const antwort = await request.get(`/carrera/besucher/${guid}`);
  expect(antwort.status()).toBe(200);
  const fahrer = await antwort.json();

  expect(fahrer.vorname).toBe("Renn");
  expect(fahrer.nachname).toBe("Fahrer");

  const roh = Buffer.from(fahrer.bild.base64, "base64");
  expect(roh.length, "Base64 passt nicht zur gemeldeten Größe").toBe(fahrer.bild.size);
  // JPEG-Kennbytes am Anfang, damit nicht irgendein Puffer durchgeht.
  expect(roh.subarray(0, 2).toString("hex")).toBe("ffd8");
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

/** Der vierte Endpunkt der Bahn steht im Block und läuft im Prüfstand. */
test("der Fahrer-Endpunkt steht auf der Seite API und antwortet", async ({ page, request }) => {
  const guid = `CAR-${String(Date.now()).slice(-8)}`;
  await besucherMitRunden(request, guid);

  await page.goto("/api");
  /*
   * **Am Anfang des Pfades verankert.** „/besucher/{guid}" steckt auch in
   * „/runden/besucher/{guid}"; ein Textvergleich träfe beide Einträge.
   */
  const eintrag = page.locator("li", { hasText: /GET\/besucher\/\{guid\}/ });
  await eintrag.locator("summary").click();
  await eintrag.getByLabel("GUID").fill(guid);
  await eintrag.getByRole("button", { name: "Senden" }).click();

  await expect(eintrag.getByText("HTTP 200")).toBeVisible();
  await expect(eintrag.locator("pre")).toContainText("Fahrer");
});

/**
 * Die Bestenliste.
 *
 * **Gegen die API geprüft, nicht gegen eine feste Zahl.** Wie viele Fahrer im Bestand
 * stehen, hängt davon ab, ob jemand die Testdaten eingespielt hat; eine erwartete 50 wäre
 * ein Kriterium, das bei richtigem Aufbau rot bleibt. Die Grenze selbst prüft der
 * Servertest.
 */
test("die Bestenliste zeigt Podest und Liste, passend zur API", async ({ page, request }) => {
  const zeiten = [
    ["POD-A", 4321],
    ["POD-B", 5432],
    ["POD-C", 6543],
  ] as const;

  for (const [stamm, dauer] of zeiten) {
    const guid = `${stamm}-${String(Date.now()).slice(-6)}`;
    const angelegt = await request.post("/api/besucher", {
      data: { guid, vorname: "Renn", nachname: stamm },
    });
    expect(angelegt.status()).toBe(201);
    merkeBesucher(guid);
    // Zwei Runden, die zweite schneller: so steht die beste Zeit auf dem Podest.
    const antwort = await request.post("/carrera/runden", {
      data: meldung(`${guid}-lap-1`, guid, 1, dauer + 900),
    });
    expect(antwort.status()).toBe(200);
    expect(
      (
        await request.post("/carrera/runden", { data: meldung(`${guid}-lap-2`, guid, 2, dauer) })
      ).status(),
    ).toBe(200);
  }

  const stand = await (await request.get("/api/carrera/bestenliste")).json();
  expect(stand.plaetze.length).toBeGreaterThanOrEqual(3);

  await page.goto("/carrera");
  await expect(page.getByRole("heading", { name: "Carrera" })).toBeVisible();

  const podest = page.getByRole("region", { name: "Podest" });
  const tabelle = page.getByRole("table");

  /*
   * Genau so viele Datenzeilen, wie die API Plätze meldet. **Ohne die Kopfzeile gezählt:**
   * sie ist bei 390 px ausgeblendet, und „plus eins" wäre dort ein Kriterium, das bei
   * richtigem Aufbau rot bleibt.
   */
  await expect(tabelle.locator("tbody").getByRole("row")).toHaveCount(stand.plaetze.length);

  // Platz 1 steht auf dem Podest **und** in der ersten Zeile, mit derselben Zeit.
  const erster = stand.plaetze[0];
  await expect(podest.getByText(erster.name, { exact: true })).toBeVisible();
  await expect(podest.getByText(erster.anzeige, { exact: true })).toBeVisible();
  // Ebenfalls im `tbody`: `nth(1)` wäre bei 390 px die **zweite** Datenzeile.
  const ersteZeile = tabelle.locator("tbody").getByRole("row").first();
  await expect(ersteZeile).toContainText(erster.name);
  await expect(ersteZeile).toContainText(erster.anzeige);

  /*
   * **Das Bild ist wirklich geladen.** Ein `<img>` mit 404 ist sichtbar und hat ein `src`;
   * nur `naturalWidth` unterscheidet das Bild von seinem Platzhalter.
   */
  const bild = podest.locator("img").first();
  await expect(bild).toBeVisible();
  expect(await bild.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

/** Ein Fahrer mit mehreren Runden steht genau einmal in der Liste. */
test("niemand steht zweimal in der Bestenliste", async ({ page, request }) => {
  const guid = `POD-D-${String(Date.now()).slice(-6)}`;
  const angelegt = await request.post("/api/besucher", {
    data: { guid, vorname: "Vielfahrer", nachname: "Doppelt" },
  });
  expect(angelegt.status()).toBe(201);
  merkeBesucher(guid);
  for (const [i, dauer] of [8100, 4100, 6100].entries()) {
    expect(
      (
        await request.post("/carrera/runden", {
          data: meldung(`${guid}-l${String(i)}`, guid, i + 1, dauer),
        })
      ).status(),
    ).toBe(200);
  }

  await page.goto("/carrera");
  const tabelle = page.getByRole("table");
  await expect(tabelle.getByRole("row", { name: new RegExp("Vielfahrer") })).toHaveCount(1);
  // Und mit der schnellsten seiner drei Zeiten, nicht der ersten oder letzten.
  await expect(tabelle.getByRole("row", { name: new RegExp("Vielfahrer") })).toContainText(
    "4,100 s",
  );
});
