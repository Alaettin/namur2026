import { expect, test } from "@playwright/test";
import { merkeBesucher, raeumeBesucherAuf } from "./exponate.js";

/**
 * Der Alias, seit dem 19.10.2026: in der Besuchermaske ja, bei den Ansprechpartnern nein.
 *
 * Das Tablet prüft `kiosk.spec.ts`.
 */

test.afterEach(async ({ request }) => {
  await raeumeBesucherAuf(request);
});

test("ein Alias lässt sich setzen und geht als Visitor_Alias hinaus", async ({ page, request }) => {
  const guid = `ALI-${String(Date.now()).slice(-8)}`;

  await page.goto("/besucher/neu");
  // Der Alias steht in der Gruppe Person, neben den Namen.
  await page
    .getByRole("group", { name: "Person" })
    .getByLabel("Alias", { exact: true })
    .fill("Anni");
  await page.getByLabel("Vorname").fill("Anna");
  await page.getByLabel("Nachname").fill("Ahrens");
  await page.getByLabel(/GUID/).fill(guid);
  await page.getByRole("button", { name: "Speichern" }).click();
  merkeBesucher(guid);

  await expect(page).toHaveURL(new RegExp(guid));

  const gespeichert = await (await request.get(`/api/besucher/${guid}`)).json();
  expect(gespeichert.alias).toBe("Anni");

  // So, wie Axon es bekommt: ohne Anmeldung, als eigene Eigenschaft.
  const werte = await (
    await request.post(`/connector/product/${guid}/values`, { data: {} })
  ).json();
  const alias = werte.find((w: { propertyId: string }) => w.propertyId === "Visitor_Alias");
  expect(alias?.value).toBe("Anni");
});

test("die Maske der Ansprechpartner hat kein Alias-Feld", async ({ page }) => {
  await page.goto("/ansprechpartner");
  await page.getByRole("button", { name: "Ansprechpartner anlegen" }).click();
  const formular = page.getByRole("dialog");
  // Gegenprobe im selben Formular: die übrigen Felder sind da, die Suche greift also.
  await expect(formular.getByLabel("Nachname")).toBeVisible();
  await expect(formular.getByLabel("Alias", { exact: true })).toHaveCount(0);
});
