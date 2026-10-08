import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  legeExponatAn,
  merkeAnsprechpartner,
  merkeDatei,
  raeumeAnsprechpartnerAuf,
  raeumeExponateAuf,
} from "./exponate.js";

/**
 * Die Exponatbearbeitung: Links und Ansprechpartner anlegen, Inhalte ansehen.
 *
 * Das war die Lücke: der Server konnte beides von Anfang an, die Oberfläche zeigte sie nur
 * an und bot kein Formular.
 */

/** Legt ein leeres Exponat an und liefert seine Id. */
async function exponat(request: APIRequestContext): Promise<string> {
  const marke = String(Math.floor(Math.random() * 900) + 100);
  return (await legeExponatAn(request, `Prüfexponat ${marke}`)).id;
}

// Jeder Fall gibt seine Kennungen zurück, siehe die Begründung in `exponate.ts`.
test.afterEach(async ({ request }) => {
  await raeumeExponateAuf(request);
  await raeumeAnsprechpartnerAuf(request);
});

test("ein Link lässt sich anlegen und öffnen", async ({ page, request }) => {
  const id = await exponat(request);
  await page.goto(`/exponate/${id}`);

  await page.getByLabel("Titel", { exact: true }).fill("NAMUR");
  await page.getByLabel("Adresse").fill("https://www.namur.net/");
  await page.getByRole("button", { name: "Link hinzufügen" }).click();

  // Er steht in der Liste, mit Adresse als Unterzeile.
  await expect(page.getByText("https://www.namur.net/")).toBeVisible();
  await expect(page.getByText("Links (1 von 10)")).toBeVisible();

  /*
   * Das Symbol ist ein echter Link auf die Adresse, **kein** `window.open`: der öffnet
   * unter iOS keinen Tab.
   */
  const oeffnen = page.getByRole("link", { name: "Link in neuem Tab öffnen" });
  await expect(oeffnen).toHaveAttribute("href", "https://www.namur.net/");
  await expect(oeffnen).toHaveAttribute("target", "_blank");
});

/**
 * Die Detailansicht eines zugewiesenen Ansprechpartners.
 *
 * **Angelegt wird hier nicht mehr:** seit dem 08.10.2026 sind Ansprechpartner Stammdaten
 * unter `/ansprechpartner`, am Exponat wird nur ausgewählt. Diesen Weg prüft
 * `stammdaten.spec.ts`.
 */
test("ein zugewiesener Ansprechpartner lässt sich im Detail ansehen", async ({ page, request }) => {
  const id = await exponat(request);
  const person = await (
    await request.post("/api/ansprechpartner", {
      data: {
        vorname: "Miriam",
        nachname: "Osterkamp",
        firma: "Novaplast AG",
        position: "Betriebsingenieurin",
      },
    })
  ).json();
  merkeAnsprechpartner(person.id as string);
  await request.post(`/api/exponate/${id}/ansprechpartner`, {
    data: { ansprechpartnerId: person.id },
  });

  await page.goto(`/exponate/${id}`);
  await expect(page.getByText("Ansprechpartner (1 von 5)")).toBeVisible();
  await expect(page.getByText("Miriam Osterkamp")).toBeVisible();

  await page.getByRole("button", { name: "Ansprechpartner ansehen" }).click();
  const schau = page.getByRole("dialog");
  await expect(schau.getByRole("heading", { name: "Miriam Osterkamp" })).toBeVisible();
  await expect(schau.getByText("Novaplast AG")).toBeVisible();
  await expect(schau.getByText("Betriebsingenieurin")).toBeVisible();
  // Kein Foto mehr: Ansprechpartner tragen keines.
  await expect(schau.getByRole("img")).toHaveCount(0);
});

test("ein Bild öffnet sich im Fenster, ein PDF als Link in den Tab", async ({ page, request }) => {
  const id = await exponat(request);

  // Ein Bild und ein PDF über die API einhängen, das spart den Dateidialog.
  for (const [name, typ, inhalt] of [
    [
      "vorschau.png",
      "image/png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    ],
    ["blatt.pdf", "application/pdf", Buffer.from("%PDF-1.4\n%%EOF\n")],
  ] as const) {
    const datei = await (
      await request.post("/api/dateien", {
        multipart: { datei: { name, mimeType: typ, buffer: inhalt } },
      })
    ).json();
    merkeDatei(datei.id as string);
    await request.post(`/api/exponate/${id}/dokumente`, {
      data: { dateiId: datei.id, titel: name.replace(/\.[^.]+$/, "") },
    });
  }

  await page.goto(`/exponate/${id}`);
  await expect(page.getByText("Dokumente (2 von 10)")).toBeVisible();

  // Das PDF bekommt einen Link in den neuen Tab.
  const pdfLink = page.getByRole("link", { name: "In neuem Tab öffnen" });
  await expect(pdfLink).toHaveAttribute("target", "_blank");
  await expect(pdfLink).toHaveAttribute("href", /\/api\/dateien\//);

  // Das Bild bekommt ein Auge und erscheint groß im Fenster.
  await page.getByRole("button", { name: "Bild ansehen" }).click();
  const schau = page.getByRole("dialog");
  await expect(schau.getByRole("heading", { name: "vorschau" })).toBeVisible();
  await expect(schau.getByRole("img", { name: "vorschau" })).toBeVisible();
});

test("der Hinweis zum Abholweg ist entfernt", async ({ page, request }) => {
  const id = await exponat(request);
  await page.goto(`/exponate/${id}`);
  await expect(page.getByText(/Abholweg/)).toHaveCount(0);
  await expect(page.getByText(/Datenblatt-DE/)).toHaveCount(0);
});
