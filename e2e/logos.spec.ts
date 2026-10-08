import { expect, test } from "@playwright/test";
import { pruefeLogoreihe } from "./logos.js";

/**
 * Die drei Logos in der Kopfzeile der App.
 *
 * Die Anmeldeseite prüft `anmeldung.spec.ts`: sie laeuft als eigenes Projekt **ohne**
 * abgelegte Sitzung, denn mit Sitzung leitet `/anmeldung` auf `/` um.
 */

test("die Kopfzeile zeigt alle drei Logos in der richtigen Folge", async ({ page }) => {
  await page.goto("/exponate");
  await expect(page.getByRole("heading", { name: "Exponate" })).toBeVisible();
  await pruefeLogoreihe(page, "der Kopfzeile");
});

/**
 * Die Umschaltung zwischen den beiden Kopfzeilenfassungen liegt bei `lg`, nicht bei `sm`:
 * dazwischen liefe das mittig gesetzte NAMUR in die rechte Gruppe aus Name und „Abmelden".
 * Geprüft wird deshalb ausdrücklich eine Breite **in** diesem Bereich, die sonst kein
 * Projekt ansteuert.
 */
test("die Kopfzeile trägt die Logos in jeder Breite genau einmal", async ({ page }) => {
  await page.goto("/exponate");
  await expect(page.getByRole("heading", { name: "Exponate" })).toBeVisible();

  for (const groesse of [
    { width: 1440, height: 900 },
    { width: 820, height: 1180 }, // zwischen sm und lg, der kritische Bereich
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(groesse);
    await pruefeLogoreihe(page, `${String(groesse.width)} px`);
  }
});
