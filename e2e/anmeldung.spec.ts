import { expect, test } from "@playwright/test";
import { pruefeLogoreihe } from "./logos.js";

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

/**
 * **Das Keyvisual deckt den Sichtbereich ab, auch jenseits des Entwurfs.**
 *
 * Bis zum 08.10.2026 hing es auf `w-[1700px]`. Damit sah es bis genau 1700 px richtig aus
 * und darüber hinaus falsch: auf einem 3440 px breiten Schirm blieben links und rechts je
 * rund 870 px grau stehen. Ein Hintergrund mit fester Pixelbreite meldet sich eben erst
 * jenseits dieser Breite, und niemand prüft von sich aus breiter als der Entwurf.
 *
 * Gemessen wird deshalb in **drei** Größen und am Kasten des Bildes, nicht am Augenschein:
 * deckt er den Sichtbereich an allen vier Seiten ab?
 */
test("das Keyvisual füllt den Sichtbereich in jeder Fenstergröße", async ({ page }) => {
  await page.goto("/anmeldung");
  // Das Schmuckbild ist das einzige, das aus dem Zugaenglichkeitsbaum genommen ist; das
  // Logo in der Maske traegt ein echtes `alt`.
  const bild = page.locator('img[aria-hidden="true"]');
  await expect(bild).toHaveCount(1);

  for (const groesse of [
    { width: 3440, height: 1440 }, // sehr breit, hier lag der gemeldete Fehler
    { width: 1440, height: 900 }, // der bisherige Normalfall
    { width: 390, height: 844 }, // das Telefon
  ]) {
    await page.setViewportSize(groesse);

    /*
     * Erst wenn das Bild wirklich geladen ist, stimmt sein Kasten. Ein `<img>` mit 404 hat
     * sonst die Breite 0 und bestünde die Prüfung nie, oder, schlimmer, bei anderer
     * Anordnung immer.
     */
    await expect
      .poll(() => bild.evaluate((e: HTMLImageElement) => e.naturalWidth))
      .toBeGreaterThan(0);

    const luecke = await bild.evaluate((e) => {
      const k = e.getBoundingClientRect();
      return {
        links: Math.round(k.left),
        oben: Math.round(k.top),
        rechts: Math.round(window.innerWidth - k.right),
        unten: Math.round(window.innerHeight - k.bottom),
      };
    });

    const wo = `${String(groesse.width)}x${String(groesse.height)}`;
    expect(luecke.links, `graue Fläche links bei ${wo}`).toBeLessThanOrEqual(0);
    expect(luecke.oben, `graue Fläche oben bei ${wo}`).toBeLessThanOrEqual(0);
    expect(luecke.rechts, `graue Fläche rechts bei ${wo}`).toBeLessThanOrEqual(0);
    expect(luecke.unten, `graue Fläche unten bei ${wo}`).toBeLessThanOrEqual(0);
  }
});

/** Entfernt am 08.10.2026; der Satz soll nicht unbemerkt zurückkommen. */
test("die Anmeldemaske nennt die Konferenz-Orga nicht mehr", async ({ page }) => {
  await page.goto("/anmeldung");
  await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
  await expect(page.getByText("Konferenz-Orga")).toHaveCount(0);
});

/** Die drei Logos auf der Anmeldekarte, siehe `logos.ts` zur Begründung des Helfers. */
test("die Anmeldung zeigt alle drei Logos in der richtigen Folge", async ({ page }) => {
  await page.goto("/anmeldung");
  await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
  await pruefeLogoreihe(page, "der Anmeldung");
});
