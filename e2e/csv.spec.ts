import { expect, test } from "@playwright/test";
import { merkeBesucher, raeumeBesucherAuf } from "./exponate.js";

/*
 * Der Import legt Besucher an, und die blieben bisher liegen: nach zwei Tagen standen 87
 * Pruefbesucher neben den 700 der Aussaat. Die GUIDs stehen in der erzeugten Datei, deshalb
 * lassen sie sich hier vorab anmelden.
 */
test.afterEach(async ({ request }) => {
  await raeumeBesucherAuf(request);
});

/**
 * Der CSV-Import über die Oberfläche.
 *
 * Die Datei wird als Windows-1252 gebaut, so wie Excel sie auf einem deutschen Rechner
 * speichert: genau dort fallen Umlaute aus, wenn die Erkennung fehlt.
 */

const a = (text: string) => Buffer.from(text, "ascii");
const UE = 0xfc;
const SZ = 0xdf;
const OE = 0xf6;

function datei(kennung: string): Buffer {
  return Buffer.concat([
    a("guid;Vorname;Nachname;Unternehmen;E-Mail;Stadt\n"),
    a(`${kennung}-1;Anna;Gr`),
    Buffer.from([UE, SZ]),
    a("e;M"),
    Buffer.from([UE]),
    a("ller AG;anna@example.invalid;K"),
    Buffer.from([OE]),
    a("ln\n"),
    a(`${kennung}-2;Bernd;Brandt;"Nord, Ost GmbH";bernd@example.invalid;Bremen\n`),
    // Kaputte E-Mail: muss beanstandet und uebersprungen werden.
    a(`${kennung}-3;Eva;Ebert;Q;keine-mail;V\n`),
  ]);
}

test("führt durch alle drei Schritte und überspringt die beanstandete Zeile", async ({ page }) => {
  const kennung = `CSV${String(Date.now()).slice(-6)}`;
  // Die Datei enthaelt genau diese beiden GUIDs, siehe `datei()`.
  merkeBesucher(`${kennung}-1`);
  merkeBesucher(`${kennung}-2`);
  await page.goto("/besucher/import");
  await expect(page.getByRole("heading", { name: "Besucher importieren" })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "besucher.csv",
    mimeType: "text/csv",
    buffer: datei(kennung),
  });

  // Schritt 2: Zeichensatz erkannt, Umlaute heil, eine Beanstandung.
  await expect(page.getByRole("heading", { name: "Beanstandungen" })).toBeVisible();
  await expect(page.getByText(/Windows-1252/)).toBeVisible();

  /*
   * **Gezielt im Beanstandungsblock**, nicht irgendwo auf der Seite: derselbe Text steht
   * auch in der Statusspalte der Vorschau, und ein offener `getByText` trifft dann zwei
   * Elemente. Dieselbe Falle wie beim Konnektornamen, der auf der Karte zweimal vorkommt.
   */
  const block = page.locator("section", {
    has: page.getByRole("heading", { name: "Beanstandungen" }),
  });
  await expect(block.getByText("E-Mail ungültig")).toBeVisible();

  // Die Umlaute stehen richtig in der Vorschau.
  await expect(page.getByRole("cell", { name: "Anna Grüße" })).toBeVisible();
  // Das Feld mit dem Komma wurde zusammengehalten.
  await expect(page.getByRole("cell", { name: "Nord, Ost GmbH" })).toBeVisible();

  // Schritt 3
  await page.getByRole("button", { name: "Ergänzen" }).click();
  await expect(page.getByRole("heading", { name: "Import abgeschlossen" })).toBeVisible();
  await expect(page.getByText("Neu angelegt")).toBeVisible();

  // Und der Besucher ist wirklich da, mit richtigen Umlauten.
  await page.goto(`/besucher?suche=${kennung}-1`);
  await expect(page.getByRole("cell", { name: "Anna Grüße" })).toBeVisible();
});

test("Ersetzen verlangt ein getipptes Wort", async ({ page }) => {
  const kennung = `ERS${String(Date.now()).slice(-6)}`;
  await page.goto("/besucher/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "besucher.csv",
    mimeType: "text/csv",
    buffer: datei(kennung),
  });
  await expect(page.getByRole("heading", { name: "Beanstandungen" })).toBeVisible();

  await page.getByRole("button", { name: "Ersetzen" }).click();
  const bestaetigen = page.getByRole("button", { name: "Ersetzen", exact: true }).last();
  await expect(page.getByRole("dialog")).toContainText(/gelöscht/);

  const eingabe = page.getByLabel(/Zum Bestätigen/);
  await eingabe.fill("ersetzen");
  await expect(bestaetigen, "Kleinschreibung darf nicht genuegen").toBeDisabled();
  await eingabe.fill("ERSETZEN");
  await expect(bestaetigen).toBeEnabled();

  // Abbrechen: dieser Test darf den Bestand nicht leeren.
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
