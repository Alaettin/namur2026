import { expect, test as setup } from "@playwright/test";

/**
 * Meldet sich **einmal** an und legt die Sitzung ab.
 *
 * Ohne das sperrt die eigene Abnahme sich selbst aus: die Anmeldegrenze laesst 10 Versuche
 * je Viertelstunde und E-Mail zu, und acht Tests in zwei Geraeteprojekten kommen darueber.
 * Gemessen am 07.10.2026: der Desktop-Lauf war gruen, der Handy-Lauf scheiterte vollstaendig
 * an 429, und das sah nach einem Fehler der Oberflaeche aus.
 *
 * Die Tests der Anmeldung selbst laufen bewusst **ohne** diese Sitzung, siehe das Projekt
 * `anmeldung` in der Konfiguration.
 */

export const SITZUNG = "e2e/.sitzung.json";

/*
 * Die Zugangsdaten kommen aus der `.env`, die `playwright.config.ts` einliest.
 *
 * Fest eingetragen laufen sie auseinander, sobald jemand das Passwort aendert: am
 * 08.10.2026 stand hier `start-geheim-123`, waehrend der Admin laengst ein anderes hatte,
 * und damit waere die ganze Abnahme an der Anmeldung gescheitert. Dieselbe Quelle versorgt
 * den Bootstrap des ersten Admins, also stimmen beide auch bei einer frischen Datenbank.
 */
const EMAIL = process.env["ADMIN_EMAIL"];
const PASSWORT = process.env["ADMIN_PASSWORT"];

setup("anmelden und Sitzung ablegen", async ({ page }) => {
  if (EMAIL === undefined || PASSWORT === undefined) {
    throw new Error(
      "ADMIN_EMAIL und ADMIN_PASSWORT fehlen. Die Abnahme liest sie aus der .env im " +
        "Wurzelverzeichnis; ohne sie ist nicht entscheidbar, womit sie sich anmelden soll.",
    );
  }

  await page.goto("/anmeldung");
  await page.getByLabel("E-Mail").fill(EMAIL);
  await page.getByLabel("Passwort").fill(PASSWORT);
  await page.getByRole("button", { name: "Anmelden" }).click();

  const fehler = page.getByRole("alert");
  if (await fehler.isVisible().catch(() => false)) {
    throw new Error(
      `Anmeldung fehlgeschlagen: "${await fehler.innerText()}". ` +
        "Bei 'Zu viele Versuche' ist die Anmeldegrenze erschoepft; sie haelt den Zaehler im " +
        "Speicher, ein Neustart des Dienstes setzt sie zurueck.",
    );
  }

  await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible();
  await page.context().storageState({ path: SITZUNG });
});
