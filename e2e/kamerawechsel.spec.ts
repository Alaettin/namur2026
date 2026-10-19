import { expect, test } from "@playwright/test";
import { raeumeExponateAuf } from "./exponate.js";
import { geraet, kameraOptionen, oeffneKamera } from "./kamera.js";

/**
 * Der Knopf „Kamera wechseln“ im Kamerabild, seit dem 19.10.2026, mit zwei Kameras.
 *
 * Geprüft wird der Videostrom selbst: nach dem Klick kommt er von einem anderen Gerät, nach
 * dem zweiten wieder vom ersten. Ob eine echte Frontkamera auf dem Handy umschaltet, bleibt
 * dem Feldtest.
 */

test.use(kameraOptionen(2));

test.afterEach(async ({ request }) => {
  await raeumeExponateAuf(request);
});

test("der Knopf schaltet auf das andere Gerät und wieder zurück", async ({ page, request }) => {
  await oeffneKamera(page, request);
  const knopf = page.getByRole("button", { name: "Kamera wechseln" });
  await expect(knopf).toBeVisible();

  const erstes = await geraet(page);
  expect(erstes).toBeTruthy();

  await knopf.click();
  await expect.poll(() => geraet(page)).not.toBe(erstes);
  await expect(knopf).toBeEnabled();

  await knopf.click();
  await expect.poll(() => geraet(page)).toBe(erstes);
});
