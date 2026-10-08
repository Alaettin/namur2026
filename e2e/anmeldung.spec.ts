import { expect, test } from "@playwright/test";

/**
 * Die Anmeldung selbst, **ohne** abgelegte Sitzung.
 *
 * Bewusst sparsam: jeder Fehlversuch verbraucht einen der 10 je Viertelstunde, und die
 * Grenze gilt je E-Mail. Deshalb eine nicht vergebene Adresse fuer den Fehlerfall, damit
 * das Kontingent des Admins fuer die Einrichtung frei bleibt.
 */

test("die Anmeldung laesst sich direkt aufrufen", async ({ page }) => {
  /*
   * Ein direkter Aufruf aus einem Lesezeichen muss genauso gehen wie der Weg ueber `/`.
   * Im AXON Connector hing die Anmeldemaske am Waechter der geschuetzten Routen und zeigte
   * beim direkten Einstieg eine leere Karte samt "Schnittstelle antwortet nicht".
   */
  await page.goto("/anmeldung");
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  await expect(page.getByText("NAMUR HV 2026").first()).toBeVisible();
  // "Event Manager" ist bei Neoception ein anderes Produkt.
  await expect(page.getByText("Event Manager")).toHaveCount(0);
});

test("eine geschuetzte Route fuehrt zur Anmeldung", async ({ page }) => {
  await page.goto("/einstellungen");
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
});

test("falsche Zugangsdaten nennen nur einen Grund", async ({ page }) => {
  await page.goto("/anmeldung");
  await page.getByLabel("E-Mail").fill("niemand@namur.invalid");
  await page.getByLabel("Passwort").fill("falsch");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("alert")).toHaveText(/E-Mail oder Passwort ist nicht korrekt/);
});
