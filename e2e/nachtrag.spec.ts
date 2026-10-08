import { expect, test } from "@playwright/test";
import {
  legeExponatAn,
  merkeAnsprechpartner,
  merkeExponat,
  raeumeAnsprechpartnerAuf,
  raeumeExponateAuf,
} from "./exponate.js";

/**
 * Die Runde vom 08.10.2026, Abendteil: Löschen, Vorlage, Monitoring, Scrollbalken.
 */

test.afterEach(async ({ request }) => {
  await raeumeExponateAuf(request);
  await raeumeAnsprechpartnerAuf(request);
});

test("ein Exponat lässt sich löschen, aber erst nach der Kennung", async ({ page, request }) => {
  const exponat = await legeExponatAn(request, `Löschprobe ${String(Date.now()).slice(-5)}`);
  merkeExponat(exponat.id);

  await page.goto(`/exponate/${exponat.id}`);
  await page.getByRole("button", { name: "Exponat löschen" }).click();

  const dialog = page.getByRole("dialog");
  const bestaetigen = dialog.getByRole("button", { name: "Endgültig löschen" });

  // **Gesperrt, bis das Wort stimmt.** Sonst wäre das Tippwort nur Zierde.
  await expect(bestaetigen).toBeDisabled();
  await dialog.getByRole("textbox").fill(exponat.kennung);
  await expect(bestaetigen).toBeEnabled();
  await bestaetigen.click();

  // Danach ist es fort, und die Oberfläche steht wieder auf der Liste.
  await expect(page).toHaveURL(/\/exponate$/);
  const nachher = await request.get(`/api/exponate/${exponat.id}`);
  expect(nachher.status()).toBe(404);
});

test("die CSV-Vorlage lässt sich herunterladen und trägt die Kopfzeile", async ({ page }) => {
  await page.goto("/besucher/import");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Vorlage herunterladen" }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const strom = await download.createReadStream();
  const stuecke: Buffer[] = [];
  for await (const s of strom) stuecke.push(Buffer.from(s as Buffer));
  const text = Buffer.concat(stuecke).toString("utf8");

  // Geprüft wird der Inhalt, nicht bloß dass eine Datei kam.
  expect(text.charCodeAt(0), "ohne BOM zeigt Excel Umlaute falsch").toBe(0xfeff);
  expect(text).toContain("guid;vorname;nachname");
});

/** Der Browser setzt den Text neben ein sichtbares Dateifeld; er darf nirgends stehen. */
test("nirgends steht 'Keine Datei ausgewählt'", async ({ page }) => {
  for (const pfad of ["/besucher/import", "/exponate"]) {
    await page.goto(pfad);
    await expect(page.getByText(/Keine Datei ausgewählt/i)).toHaveCount(0);
  }
});

/**
 * **Im Fenster scrollt die Liste, nicht das Fenster.**
 *
 * Vorher war beides scrollbar, ineinander verschachtelt: die Liste auf `max-h-[50dvh]` und
 * das Fenster auf `max-h-[90dvh]`. Sichtbare Folge war eine Liste, die mitten in einer
 * Zeile abbrach und die Fensterhöhe nicht ausschöpfte.
 *
 * **Die Zahl der laufenden Bereiche allein taugt als Kriterium nicht**: sie war in beiden
 * Fassungen 1, weil das Fenster je nach Inhalt gar nicht überlief. Geprüft wird deshalb
 * zusätzlich, dass das Fenster selbst **nicht scrollbar angelegt** ist; genau das war die
 * Ursache, und genau daran scheitert die Gegenprobe.
 */
test("im Auswahlfenster scrollt genau ein Element", async ({ page, request, viewport }) => {
  const exponat = await legeExponatAn(request, `Scrollprobe ${String(Date.now()).slice(-5)}`);
  merkeExponat(exponat.id);

  /*
   * **Erst genug Einträge, damit überhaupt etwas scrollt.** Mit drei Ansprechpartnern
   * läuft nichts über, und "höchstens ein Scrollbereich" wäre trivial erfüllt: der Fall
   * ginge auch mit dem alten, kaputten Aufbau durch und bewiese nichts.
   */
  const marke = String(Date.now()).slice(-6);
  for (let i = 0; i < 30; i++) {
    const angelegt = await (
      await request.post("/api/ansprechpartner", {
        data: { vorname: "Scroll", nachname: `Probe${marke}-${String(i).padStart(2, "0")}` },
      })
    ).json();
    merkeAnsprechpartner(angelegt.id as string);
  }

  await page.goto(`/exponate/${exponat.id}`);
  await page.getByRole("button", { name: "Ansprechpartner hinzufügen" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Ansprechpartner suchen")).toBeVisible();

  const befund = await dialog.evaluate((wurzel) => {
    const scrollbar = (e: Element) => {
      const o = getComputedStyle(e).overflowY;
      return o === "auto" || o === "scroll";
    };
    const alle = [wurzel, ...wurzel.querySelectorAll("*")];
    return {
      // Laeuft wirklich etwas? Sonst misst der Fall nichts.
      laufend: alle.filter((e) => scrollbar(e) && e.scrollHeight > e.clientHeight).length,
      // Ist das Fenster selbst scrollbar angelegt? Das war die Ursache.
      fensterScrollbar: scrollbar(wurzel),
    };
  });

  const wo = `${String(viewport?.width ?? 0)} px`;
  expect(befund.laufend, `${wo}: es soll genau ein Bereich laufen`).toBe(1);
  expect(befund.fensterScrollbar, `${wo}: das Fenster selbst darf nicht scrollen`).toBe(false);
});

test("das Monitoring zeigt einen Abruf über die Konnektor-API", async ({ page, request }) => {
  const guid = `MON-${String(Date.now()).slice(-8)}`;
  await request.post("/api/besucher", {
    data: { guid, vorname: "Monitor", nachname: "Probe" },
  });

  // Ohne Anmeldung, genau wie Axon es täte.
  const antwort = await request.get(`/connector/product/${guid}/hierarchy`);
  expect(antwort.status()).toBe(200);

  await page.goto("/monitoring");
  await expect(page.getByRole("heading", { name: "Monitoring" })).toBeVisible();
  await expect(page.getByText(guid)).toBeVisible();

  await request.delete(`/api/besucher/${guid}`);
});
