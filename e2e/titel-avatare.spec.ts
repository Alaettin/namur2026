import { expect, test } from "@playwright/test";
import { merkeBesucher, raeumeBesucherAuf } from "./exponate.js";

/**
 * Titel, gruppierte Stammdaten und die Avatarverwaltung, aus der Verwaltungssicht.
 *
 * Das Tablet prüft `kiosk.spec.ts`, es läuft in einem eigenen Projekt mit eigener Sitzung.
 */

test.afterEach(async ({ request }) => {
  await raeumeBesucherAuf(request);
});

test("die Stammdaten stehen in Gruppen", async ({ page }) => {
  await page.goto("/besucher/neu");
  /*
   * Ueber die Rolle, nicht ueber den Text: "Firma" ist Gruppe **und** Feld, ein
   * Textvergleich traefe beides. Das `fieldset` mit `legend` ist eine `group`.
   */
  for (const gruppe of ["Person", "Firma", "Anschrift", "Kontakt"]) {
    await expect(page.getByRole("group", { name: gruppe })).toBeVisible();
  }
  // Und der Titel steht in der Gruppe Person, nicht bei der Firma.
  await expect(page.getByLabel("Titel", { exact: true })).toBeVisible();
});

test("ein Titel lässt sich setzen und geht am Vornamen hinaus", async ({ page, request }) => {
  const guid = `TIT-${String(Date.now()).slice(-8)}`;

  await page.goto("/besucher/neu");
  await page.getByLabel("Titel", { exact: true }).fill("Dr.");
  await page.getByLabel("Vorname").fill("Anna");
  await page.getByLabel("Nachname").fill("Ahrens");
  await page.getByLabel(/GUID/).fill(guid);
  await page.getByRole("button", { name: "Speichern" }).click();
  merkeBesucher(guid);

  await expect(page).toHaveURL(new RegExp(guid));

  // Am Server nachgesehen, nicht am Bildschirm.
  const gespeichert = await (await request.get(`/api/besucher/${guid}`)).json();
  expect(gespeichert.titel).toBe("Dr.");
  expect(gespeichert.vorname).toBe("Anna");

  /*
   * **Und so, wie Axon es bekommt.** Ohne Anmeldung, wie der Viewer: der Titel steht am
   * Vornamen, und eine eigene Eigenschaft gibt es nicht.
   */
  const werte = await (
    await request.post(`/connector/product/${guid}/values`, { data: {} })
  ).json();
  const vorname = werte.find((w: { propertyId: string }) => w.propertyId === "Visitor_FirstName");
  expect(JSON.stringify(vorname)).toContain("Dr. Anna");
  expect(
    werte.filter((w: { propertyId: string }) => /title/i.test(w.propertyId)),
    "neue Eigenschaft im Modell",
  ).toEqual([]);
});

test("Avatare lassen sich sortieren und entfernen", async ({ page, request }) => {
  await page.goto("/einstellungen");
  await expect(page.getByRole("heading", { name: "Avatare für das Tablet" })).toBeVisible();

  const vorher = (await (await request.get("/api/avatare")).json()).avatare as {
    dateiId: string;
  }[];
  expect(vorher.length).toBeGreaterThan(2);

  // Das zweite nach vorn: danach steht es an erster Stelle.
  await page.getByRole("button", { name: "Avatar 2 nach vorn" }).click();
  await expect
    .poll(async () => (await (await request.get("/api/avatare")).json()).avatare[0].dateiId)
    .toBe(vorher[1]?.dateiId);

  // Und eines entfernen: die Zahl fällt um genau eins.
  await page.getByRole("button", { name: "Avatar 1 entfernen" }).click();
  await expect
    .poll(async () => (await (await request.get("/api/avatare")).json()).avatare.length)
    .toBe(vorher.length - 1);

  /*
   * Aufräumen: zurücksetzen würde den ganzen Bestand löschen, deshalb das entfernte Bild
   * wieder hochladen. Ein 1x1-JPEG genügt, geprüft wird die Zahl.
   */
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  );
  const zurueck = await request.post("/api/avatare", {
    multipart: { datei: { name: "ersatz.jpg", mimeType: "image/jpeg", buffer: jpeg } },
  });
  expect(zurueck.status()).toBe(201);
});

test("ein zu grosses Bild wird abgewiesen", async ({ request }) => {
  const zuGross = Buffer.alloc(400 * 1024, 0x41);
  const antwort = await request.post("/api/avatare", {
    multipart: { datei: { name: "riesig.jpg", mimeType: "image/jpeg", buffer: zuGross } },
  });
  expect(antwort.status()).toBe(400);
  expect((await antwort.json()).code).toBe("datei-zu-gross");
});
