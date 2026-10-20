import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Ein Betreuer kann sich abmelden, seit dem 20.10.2026.
 *
 * Bis dahin ging das nicht: der Scan läuft ohne Rahmen, und ein Betreuer mit genau einem
 * Exponat wurde aus der Exponatliste bei jedem Einhängen zurück in den Scan geleitet. Eine
 * Schleife ohne Ausgang.
 *
 * Dieser Fall braucht eine **eigene Anmeldung** als Betreuer, deshalb ohne abgelegte
 * Sitzung; die Verwaltungsaufrufe laufen über einen eigenen Admin-Kontext.
 */

test.use({ storageState: { cookies: [], origins: [] } });

/** Ein festes Konto, wie beim Tablet; es bleibt über die Läufe stehen. */
const EMAIL = "betreuer-abnahme@namur.de";
const PASSWORT = "betreuer-abnahme-2026";

let admin: APIRequestContext;
let exponatId = "";

test.beforeEach(async ({ playwright }, info) => {
  admin = await playwright.request.newContext({
    baseURL: info.project.use.baseURL,
    storageState: "e2e/.sitzung.json",
  });

  const exponat = await (
    await admin.post("/api/exponate", {
      data: { name: `Abmelden ${String(Date.now()).slice(-5)}` },
    })
  ).json();
  exponatId = exponat.id as string;
  await admin.post(`/api/exponate/${exponatId}/links`, {
    data: { url: "https://www.namur.net/", titel: "NAMUR" },
  });

  const alle = (await (await admin.get("/api/nutzer")).json()) as { id: string; email: string }[];
  let id = alle.find((n) => n.email === EMAIL)?.id;
  if (id === undefined) {
    const angelegt = await admin.post("/api/nutzer", {
      data: { name: "Betreuer Abnahme", email: EMAIL, rolle: "betreuer" },
    });
    expect(angelegt.status()).toBe(201);
    id = ((await angelegt.json()) as { id: string }).id;
  }
  expect(
    (await admin.post(`/api/nutzer/${id}/passwort`, { data: { passwort: PASSWORT } })).status(),
  ).toBe(200);
  // **Genau ein Exponat**, sonst gibt es keine Weiterleitung in den Scan.
  expect(
    (await admin.put(`/api/nutzer/${id}/exponate`, { data: { exponate: [exponatId] } })).status(),
  ).toBe(200);
});

test.afterEach(async () => {
  await admin.delete(`/api/exponate/${exponatId}`);
  await admin.dispose();
});

async function melde(page: Page) {
  await page.goto("/anmeldung");
  await page.getByLabel("E-Mail").fill(EMAIL);
  await page.getByLabel("Passwort").fill(PASSWORT);
  await page.getByRole("button", { name: "Anmelden" }).click();
  // Mit genau einem Exponat direkt im Scan.
  await expect(page).toHaveURL(new RegExp(`/exponate/${exponatId}/scan$`));
}

test("ein Betreuer meldet sich aus dem Scan ab", async ({ page }) => {
  await melde(page);

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  expect((await page.request.get("/api/auth/ich")).status()).toBe(401);
});

test("Scannen beenden führt in die Liste und nicht zurück in den Scan", async ({ page }) => {
  await melde(page);

  await page.getByRole("button", { name: "Scannen beenden" }).click();
  await expect(page).toHaveURL(/\/exponate$/);
  // Kurz warten wäre Raten; stattdessen prüfen, dass die Liste steht und der Scan nicht kommt.
  await expect(page.getByRole("heading", { name: "Exponate" })).toBeVisible();
  await expect(page).not.toHaveURL(/\/scan$/);
  // Und dort gibt es das Abmelden des Rahmens (am Handy im Menü).
  // Am Desktop offen in der Kopfzeile; am Handy ist der Knopf ausgeblendet und steht im Menü.
  const offen = page.getByRole("button", { name: "Abmelden" });
  if (await offen.isVisible()) return;
  await page.getByRole("button", { name: "Menü" }).click();
  await expect(page.getByRole("menuitem", { name: "Abmelden" })).toBeVisible();
});
