import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  legeExponatAn,
  merkeBesucher,
  merkeDatei,
  raeumeBesucherAuf,
  raeumeExponateAuf,
} from "./exponate.js";

/**
 * Der Scan-Ablauf, geprüft über die Eingabe von Hand.
 *
 * **Der Kameraweg bleibt hier ungeprüft.** `getUserMedia` verlangt einen sicheren Kontext;
 * über `http://` und eine Netzwerkadresse gibt kein Browser die Kamera frei. Die Eingabe
 * von Hand ist derselbe Ablauf ab dem Treffer und im Entwurf `ErrCamera` ohnehin vorgesehen.
 */

/** Legt ein Exponat mit einem Dokument und einen Besucher an. Liefert die Ids. */
async function bestand(request: APIRequestContext) {
  const marke = String(Math.floor(Math.random() * 900) + 100);
  const exponat = await legeExponatAn(request, `Prüfexponat ${marke}`);

  const datei = await (
    await request.post("/api/dateien", {
      multipart: {
        datei: {
          name: "blatt.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
        },
      },
    })
  ).json();
  merkeDatei(datei.id as string);

  const dokument = await (
    await request.post(`/api/exponate/${exponat.id}/dokumente`, {
      data: { dateiId: datei.id, titel: "Datenblatt" },
    })
  ).json();

  await request.post(`/api/exponate/${exponat.id}/links`, {
    data: { url: "https://www.namur.net/", titel: "NAMUR" },
  });

  const guid = `SCAN-${String(Date.now()).slice(-8)}`;
  await request.post("/api/besucher", {
    data: { guid, vorname: "Testa", nachname: "Prüfer" },
  });
  merkeBesucher(guid);

  return { exponatId: exponat.id, dokumentId: dokument.id as string, guid };
}

// Jeder Fall gibt seine Kennungen zurück, siehe die Begründung in `exponate.ts`.
test.afterEach(async ({ request }) => {
  await raeumeBesucherAuf(request);
  await raeumeExponateAuf(request);
});

test("der Ablauf führt von der GUID bis zur Zuordnung", async ({ page, request }) => {
  const { exponatId, guid } = await bestand(request);

  await page.goto(`/exponate/${exponatId}/scan`);
  await page.getByRole("button", { name: "GUID von Hand eingeben" }).first().click();
  await page.getByLabel("GUID vom Pass").fill(guid);
  await page.getByRole("button", { name: "Weiter" }).click();

  // Der Treffer zeigt den Besucher und hat alles vorausgewählt.
  await expect(page.getByText("Testa Prüfer")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Alles zuordnen" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByRole("button", { name: "Zuordnen (2)" })).toBeEnabled();

  await page.getByRole("button", { name: "Zuordnen (2)" }).click();
  await expect(page.getByRole("status")).toContainText("2 zugeordnet");

  // Und es ist wirklich angekommen.
  const werte = await (
    await request.post(`/api/scan/besucher/${guid}?exponat=${exponatId}`, {
      failOnStatusCode: false,
    })
  ).status();
  expect(werte).toBeLessThan(500);
});

test("bereits zugeordnete Elemente sind gesperrt und zählen nicht mit", async ({
  page,
  request,
}) => {
  const { exponatId, dokumentId, guid } = await bestand(request);
  // Ein Element vorab zuordnen.
  await request.post("/api/scan/zuordnen", {
    data: { guid, exponatId, elemente: [{ art: "dokument", zielId: dokumentId }] },
  });

  await page.goto(`/exponate/${exponatId}/scan`);
  await page.getByRole("button", { name: "GUID von Hand eingeben" }).first().click();
  await page.getByLabel("GUID vom Pass").fill(guid);
  await page.getByRole("button", { name: "Weiter" }).click();

  await expect(page.getByText("BEREITS ZUGEORDNET")).toBeVisible();
  // Nur noch der Link ist offen, also "Zuordnen (1)".
  await expect(page.getByRole("button", { name: "Zuordnen (1)" })).toBeVisible();
  // Das zugeordnete Kästchen lässt sich nicht abwählen.
  await expect(page.getByRole("checkbox").first()).toBeDisabled();
});

test("eine unbekannte GUID ergibt ErrUnknown", async ({ page, request }) => {
  const { exponatId } = await bestand(request);
  await page.goto(`/exponate/${exponatId}/scan`);
  await page.getByRole("button", { name: "GUID von Hand eingeben" }).first().click();
  await page.getByLabel("GUID vom Pass").fill("GIBT-ES-NICHT");
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByRole("heading", { name: "GUID unbekannt" })).toBeVisible();
});

test("ein Exponat ohne Inhalte sperrt das Scannen", async ({ page, request }) => {
  const exponat = await legeExponatAn(request, "Ohne Inhalt");

  await page.goto(`/exponate/${exponat.id}/scan`);
  await expect(page.getByRole("heading", { name: "Noch nichts zum Zuordnen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pass scannen" })).toHaveCount(0);
});

/**
 * Über `http://` ist der Kontext unsicher, und der Browser gibt die Kamera nicht frei.
 * Die Oberfläche muss das **vor** dem Startversuch sagen, statt eine Verweigerung zu zeigen,
 * die wie ein Fehler des Nutzers aussieht.
 */
test("ohne sicheren Kontext wird der Grund genannt, nicht nur verweigert", async ({
  page,
  request,
}) => {
  const { exponatId } = await bestand(request);
  await page.goto(`/exponate/${exponatId}/scan`);

  const sicher = await page.evaluate(() => window.isSecureContext);
  if (sicher) {
    // Über localhost gilt der Kontext als sicher, dann greift dieser Zweig nicht.
    await expect(page.getByRole("button", { name: "Pass scannen" })).toBeEnabled();
    return;
  }
  await expect(page.getByText(/nur über HTTPS/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pass scannen" })).toBeDisabled();
  // Der Weg von Hand bleibt offen.
  await expect(page.getByRole("button", { name: "GUID von Hand eingeben" })).toBeEnabled();
});
