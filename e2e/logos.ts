import { expect, type Page } from "@playwright/test";

/**
 * Prüft die Reihe aus drei Logos: AXON links, NAMUR mittig, Pepperl+Fuchs rechts.
 *
 * Als eigener Helfer, weil die Reihe an zwei Stellen steht, die in **verschiedenen**
 * Playwright-Projekten laufen: die Anmeldung ohne abgelegte Sitzung, die Kopfzeile mit.
 */

const LOGOS = ["Neoception AXON", "NAMUR", "Pepperl+Fuchs"] as const;

export async function pruefeLogoreihe(page: Page, wo: string): Promise<void> {
  const kaesten: { name: string; x: number }[] = [];

  for (const name of LOGOS) {
    const bild = page.getByRole("img", { name, exact: true });

    /*
     * **Genau einmal sichtbar.** Die Kopfzeile trägt zwei Fassungen der Reihe, eine für
     * schmale und eine für breite Fenster. Wären beide gleichzeitig sichtbar, stünde jedes
     * Logo doppelt da, und eine reine Positionsprüfung würde das nicht melden.
     */
    const sichtbar = bild.locator("visible=true");
    await expect(sichtbar, `${name} nicht genau einmal sichtbar auf ${wo}`).toHaveCount(1);

    /*
     * Und es muss **geladen** sein. Ein `<img>` mit 404 ist sichtbar und hat ein `src`; das
     * hat in diesem Projekt schon einmal einen echten Fehler verdeckt.
     */
    await expect
      .poll(() => sichtbar.evaluate((e: HTMLImageElement) => e.naturalWidth), {
        message: `${name} ist nicht geladen auf ${wo}`,
      })
      .toBeGreaterThan(0);

    const kasten = await sichtbar.boundingBox();
    expect(kasten, `${name} hat keine Fläche auf ${wo}`).not.toBeNull();
    if (kasten !== null) kaesten.push({ name, x: kasten.x });
  }

  // Die Reihenfolge ist der eigentliche Auftrag, nicht bloss "drei Bilder vorhanden".
  expect(kaesten[0]?.x, `AXON steht nicht links von NAMUR auf ${wo}`).toBeLessThan(
    kaesten[1]?.x ?? 0,
  );
  expect(kaesten[1]?.x, `NAMUR steht nicht links von Pepperl auf ${wo}`).toBeLessThan(
    kaesten[2]?.x ?? 0,
  );
}
