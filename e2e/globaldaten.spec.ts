import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { merkeBesucher, raeumeBesucherAuf } from "./exponate.js";

/**
 * Der Bereich „Globale Daten“, seit dem 20.10.2026: anlegen, füllen, im Konnektor sehen,
 * löschen. Jeder Fall räumt seine Datenpunkte selbst weg.
 */

/** Ein 1x1-PNG, gültig genug für Vorschau und Bildweg. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

interface Global {
  id: string;
  name: string;
  propertyId: string;
}

const angelegt: string[] = [];

test.afterEach(async ({ request }) => {
  await raeumeBesucherAuf(request);
  while (angelegt.length > 0) {
    const id = angelegt.pop();
    if (id !== undefined) await request.delete(`/api/globale-daten/${id}`);
  }
});

/** Legt über die Oberfläche an, wartet auf die Karte und gibt den Eintrag zurück. */
async function lege(page: Page, request: APIRequestContext, name: string, art: "Text" | "Datei") {
  await page.getByLabel("Name").fill(name);
  await page.getByRole("radio", { name: art }).check();
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: name })).toBeVisible();
  const alle = (await (await request.get("/api/globale-daten")).json()) as Global[];
  const e = alle.find((x) => x.name === name);
  expect(e, `${name} nicht angelegt`).toBeDefined();
  angelegt.push(e!.id);
  return e!;
}

test("Text und Bild anlegen, im Konnektor sehen, wieder löschen", async ({ page, request }) => {
  const marke = String(Date.now()).slice(-6);
  const guid = `GLB-${marke}`;
  await request.post("/api/besucher", { data: { guid, vorname: "Gabi", nachname: "Global" } });
  merkeBesucher(guid);

  // Über die Navigation hin; am Handy steht der Reiter im Menü.
  await page.goto("/besucher");
  const reiter = page.getByRole("link", { name: "Globale Daten" });
  if (await reiter.isVisible()) await reiter.click();
  else {
    await page.getByRole("button", { name: "Menü" }).click();
    await page.getByRole("menuitem", { name: "Globale Daten" }).click();
  }
  await expect(page.getByRole("heading", { name: "Globale Daten", level: 1 })).toBeVisible();

  // Text
  const text = await lege(page, request, `Programm ${marke}`, "Text");
  const feld = page.getByLabel(`Text für ${text.propertyId}`);
  await feld.fill("Beginn 9 Uhr");
  const textKarte = page.getByRole("listitem").filter({ hasText: text.name });
  await textKarte.getByRole("button", { name: "Speichern" }).click();
  await expect(textKarte.getByRole("status").filter({ hasText: "Gespeichert" })).toBeVisible();

  // Bild
  const bild = await lege(page, request, `Logo ${marke}`, "Datei");
  const bildKarte = page.getByRole("listitem").filter({ hasText: bild.name });
  await bildKarte.getByLabel("Datei hochladen").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  const vorschau = bildKarte.getByRole("img", { name: `Vorschau ${bild.propertyId}` });
  await expect(vorschau).toBeVisible();
  await expect
    .poll(() => vorschau.evaluate((b) => (b as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  // Im Konnektor, für einen Besucher ohne jede Zuordnung.
  const werte = (await (
    await request.post(`/connector/product/${guid}/values`, { data: {} })
  ).json()) as { propertyId: string; value: string }[];
  expect(werte.find((w) => w.propertyId === text.propertyId)?.value).toBe("Beginn 9 Uhr");
  expect(werte.find((w) => w.propertyId === bild.propertyId)?.value).toBe(PNG.toString("base64"));

  // Löschen über die Oberfläche.
  await bildKarte.getByRole("button", { name: "Löschen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Löschen" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: bild.name })).toHaveCount(0);
});
