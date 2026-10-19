import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { legeExponatAn, merkeBesucher, raeumeBesucherAuf, raeumeExponateAuf } from "./exponate.js";

/**
 * Besucherdetail nach Exponaten, Sicherung und Auswertung, seit dem 19.10.2026.
 *
 * **Der Import spielt die eben heruntergeladene Sicherung wieder ein.** So prüft er den
 * ganzen Weg durch die Oberfläche, ohne den Bestand der Instanz zu verändern: vorher und
 * nachher müssen dieselben Zahlen stehen.
 */

test.afterEach(async ({ request }) => {
  await raeumeBesucherAuf(request);
  await raeumeExponateAuf(request);
});

test("im Besucherdetail lässt sich ein Exponat ganz und einzeln zuweisen", async ({
  page,
  request,
}) => {
  const exponat = await legeExponatAn(request, `Kästchen ${String(Date.now()).slice(-5)}`);
  for (const titel of ["Erster Link", "Zweiter Link"]) {
    await request.post(`/api/exponate/${exponat.id}/links`, {
      data: { url: "https://www.namur.net/", titel },
    });
  }
  const guid = `BXD-${String(Date.now()).slice(-8)}`;
  await request.post("/api/besucher", { data: { guid, vorname: "Kai", nachname: "Kasten" } });
  merkeBesucher(guid);

  await page.goto(`/besucher/${guid}`);
  const ganz = page.getByRole("checkbox", { name: new RegExp(`${exponat.kennung} .* besucht`) });
  await expect(ganz).not.toBeChecked();
  await ganz.click();
  await expect(ganz).toBeChecked();

  const zugeordnet = async () =>
    (
      (await (await request.get(`/api/besucher/${guid}/exponate`)).json()) as {
        id: string;
        links: { titel: string; zugeordnet: boolean }[];
      }[]
    ).find((e) => e.id === exponat.id)?.links;
  expect((await zugeordnet())?.every((l) => l.zugeordnet)).toBe(true);

  // Einen Link einzeln abwählen: das Exponat steht danach auf "teilweise".
  await page.getByRole("checkbox", { name: /Zweiter Link/ }).click();
  await expect(page.getByRole("checkbox", { name: /Zweiter Link/ })).not.toBeChecked();
  expect((await zugeordnet())?.map((l) => l.zugeordnet)).toEqual([true, false]);
  expect(await ganz.evaluate((e) => (e as HTMLInputElement).indeterminate)).toBe(true);
});

test("die Auswertung kommt als CSV mit BOM und einer Spalte je Exponat", async ({ page }) => {
  await page.goto("/einstellungen");
  const laden = page.waitForEvent("download");
  await page.getByRole("button", { name: "Besuche als CSV" }).click();
  const datei = await laden;
  expect(datei.suggestedFilename()).toMatch(/^namur-hv-2026-besuche-\d{4}-\d{2}-\d{2}\.csv$/);
  const inhalt = readFileSync(await datei.path(), "utf8");
  expect(inhalt.startsWith("\uFEFFGUID;Titel;Vorname;Nachname;Alias;")).toBe(true);
});

test("Sicherung herunterladen und wieder einspielen lässt den Bestand stehen", async ({
  page,
  request,
}) => {
  const vorher = await (await request.get("/api/entwickler/bestand")).json();

  await page.goto("/einstellungen");
  const laden = page.waitForEvent("download");
  await page.getByRole("link", { name: "Sicherung herunterladen" }).click();
  const zip = await laden;
  expect(zip.suggestedFilename()).toMatch(/^namur-hv-2026-sicherung-.*\.zip$/);
  const pfad = await zip.path();
  const roh = readFileSync(pfad);
  // Lokaler Dateikopf einer ZIP-Datei, und der Datenbankeintrag steht darin.
  expect(roh.subarray(0, 4).toString("hex")).toBe("504b0304");
  expect(roh.includes(Buffer.from("namur.db"))).toBe(true);

  await page.getByLabel("Sicherung einspielen …").setInputFiles(pfad);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Sicherung einspielen?")).toBeVisible();
  await expect(dialog.getByRole("cell", { name: "Besucher" })).toBeVisible();

  const knopf = dialog.getByRole("button", { name: "Bestand ersetzen" });
  await expect(knopf).toBeDisabled();
  await dialog.getByLabel("Zum Bestätigen EINSPIELEN eintippen").fill("EINSPIELEN");
  await knopf.click();

  // Nach dem Neuladen wieder auf den Einstellungen, angemeldet: dasselbe Konto ist drin.
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  expect(await (await request.get("/api/entwickler/bestand")).json()).toEqual(vorher);
});
