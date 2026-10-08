import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Das Selbstbedienungs-Tablet, angemeldet als Rolle `kiosk`.
 *
 * **Der Scanschritt bleibt hier aus.** Der Prüfstand hat keine Kamera, und ein gefälschtes
 * Videogerät liefert ein Testbild ohne QR-Code. Geprüft wird alles **nach** dem Scan, also
 * das, was ein Besucher danach tut, plus die Schranken der Rolle. Dass ein echter Pass vor
 * einer Tabletkamera erkannt wird, bleibt dem Feldtest.
 */

/** Ein Besucher für diesen Lauf, angelegt über ein Adminkonto. */
async function legeBesucher(request: APIRequestContext, guid: string): Promise<void> {
  const email = process.env["ADMIN_EMAIL"];
  const passwort = process.env["ADMIN_PASSWORT"];
  const admin = await request.post("/api/auth/anmelden", { data: { email, passwort } });
  expect(admin.status()).toBe(200);

  await request.post("/api/besucher", {
    data: { guid, vorname: "Tablet", nachname: "Probe", firma: "Alt GmbH" },
  });
}

/** Räumt den Besucher weg und meldet den Kontext wieder als Tablet an. */
async function raeumeAuf(request: APIRequestContext, guid: string): Promise<void> {
  await request.delete(`/api/besucher/${guid}`);
  await request.post("/api/auth/abmelden");
}

test("die Verwaltung bleibt unerreichbar und landet wieder beim Scan", async ({ page }) => {
  for (const pfad of ["/nutzer", "/besucher", "/", "/monitoring"]) {
    await page.goto(pfad);
    await expect(page, `${pfad} war erreichbar`).toHaveURL(/\/kiosk$/);
  }
  await expect(page.getByRole("heading", { name: "Pass scannen" })).toBeVisible();
});

/**
 * **Kein Eingabefeld für die GUID.** Die GUIDs sind fortlaufend; mit einem Feld könnte am
 * Tablet jeder die Daten eines beliebigen anderen Besuchers öffnen.
 */
test("auf dem Scanbildschirm lässt sich keine GUID eintippen", async ({ page }) => {
  await page.goto("/kiosk");
  await expect(page.getByRole("heading", { name: "Pass scannen" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /von Hand/i })).toHaveCount(0);
});

test("Stammdaten lassen sich ändern und das Abbrechen ändert nichts", async ({ page, request }) => {
  const guid = `TAB-${String(Date.now()).slice(-8)}`;
  await legeBesucher(request, guid);

  await page.goto(`/kiosk/${guid}/stammdaten`);
  const firma = page.getByLabel("Firma");
  await expect(firma).toHaveValue("Alt GmbH");

  // Erst abbrechen: danach muss der alte Wert stehen.
  await firma.fill("Verworfen GmbH");
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByRole("heading", { name: /^Hallo/ })).toBeVisible();

  const dazwischen = await (await request.get(`/api/besucher/${guid}`)).json();
  expect(dazwischen.firma, "Abbrechen hat gespeichert").toBe("Alt GmbH");

  // Jetzt wirklich speichern.
  await page.goto(`/kiosk/${guid}/stammdaten`);
  await page.getByLabel("Firma").fill("Neu GmbH");
  await page.getByLabel("Ort").fill("Mannheim");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("heading", { name: /^Hallo/ })).toBeVisible();

  // **Am Server nachgesehen**, nicht am Bildschirm: der zeigt auch den Entwurf.
  const nachher = await (await request.get(`/api/besucher/${guid}`)).json();
  expect(nachher.firma).toBe("Neu GmbH");
  expect(nachher.ort).toBe("Mannheim");
  expect(nachher.guid, "die GUID hat sich geändert").toBe(guid);

  await raeumeAuf(request, guid);
});

test("ein Bild lässt sich aussuchen und wieder auf Standard setzen", async ({ page, request }) => {
  const guid = `TAB-${String(Date.now()).slice(-8)}`;
  await legeBesucher(request, guid);
  const vorher = await (await request.get(`/api/besucher/${guid}`)).json();

  await page.goto(`/kiosk/${guid}/avatar`);
  const bilder = page.getByRole("button", { name: /Bild/ });
  await expect(bilder.first()).toBeVisible();

  // Das zweite Bild ist das erste der Galerie; das erste ist der Standard.
  await bilder.nth(1).click();
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("heading", { name: /^Hallo/ })).toBeVisible();

  const gewaehlt = await (await request.get(`/api/besucher/${guid}`)).json();
  expect(gewaehlt.avatarDateiId, "es wurde kein anderes Bild gesetzt").not.toBe(
    vorher.avatarDateiId,
  );

  // Und zurück auf Standard.
  await page.goto(`/kiosk/${guid}/avatar`);
  await page.getByRole("button", { name: "Standardbild" }).click();
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("heading", { name: /^Hallo/ })).toBeVisible();

  const zurueck = await (await request.get(`/api/besucher/${guid}`)).json();
  expect(zurueck.avatarDateiId).toBe(vorher.avatarDateiId);

  await raeumeAuf(request, guid);
});

/**
 * **Die Zeitsperre wird gemessen, nicht geglaubt.**
 *
 * Mit `page.clock` wird die Uhr vorgestellt statt gewartet; ein Test, der 90 Sekunden
 * stillsteht, wäre in der Prüfkette untragbar. Geprüft wird beides: dass die Warnung
 * erscheint und dass der Bildschirm danach wirklich zurückspringt.
 */
test("nach 90 Sekunden Untätigkeit springt der Bildschirm zurück zum Scan", async ({
  page,
  request,
}) => {
  const guid = `TAB-${String(Date.now()).slice(-8)}`;
  await legeBesucher(request, guid);

  await page.clock.install();
  await page.goto(`/kiosk/${guid}`);
  await expect(page.getByRole("heading", { name: /^Hallo/ })).toBeVisible();

  // 80 Sekunden: die Warnung steht, der Bildschirm noch.
  await page.clock.runFor(80_000);
  await expect(page.getByRole("status")).toContainText("Noch da?");
  await expect(page).toHaveURL(new RegExp(`/kiosk/${guid}$`));

  // Weitere 15: die Frist ist um.
  await page.clock.runFor(15_000);
  await expect(page).toHaveURL(/\/kiosk$/);
  await expect(page.getByRole("heading", { name: "Pass scannen" })).toBeVisible();

  await raeumeAuf(request, guid);
});

test("der Hinweis 'Ich bin noch da' hält den Bildschirm", async ({ page, request }) => {
  const guid = `TAB-${String(Date.now()).slice(-8)}`;
  await legeBesucher(request, guid);

  await page.clock.install();
  await page.goto(`/kiosk/${guid}`);
  await expect(page.getByRole("heading", { name: /^Hallo/ })).toBeVisible();

  await page.clock.runFor(80_000);
  await page.getByRole("button", { name: "Ich bin noch da" }).click();

  /*
   * Danach noch einmal 80 Sekunden: waere die Uhr nicht zurueckgesetzt, waere die Frist
   * laengst abgelaufen. Der Bildschirm muss stehen.
   */
  await page.clock.runFor(80_000);
  await expect(page).toHaveURL(new RegExp(`/kiosk/${guid}$`));

  await raeumeAuf(request, guid);
});
