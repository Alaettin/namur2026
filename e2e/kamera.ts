import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { legeExponatAn } from "./exponate.js";

/**
 * Hilfen für die Kamerafälle.
 *
 * Chromium täuscht mit `--use-fake-device-for-media-stream` Kameras vor, mit
 * `device-count=N` auch mehrere. Die Startoptionen gelten je Datei, deshalb eine Datei je
 * Gerätezahl. Über `localhost` gilt der Kontext als sicher.
 */
export function kameraOptionen(anzahl: number) {
  return {
    permissions: ["camera"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        `--use-fake-device-for-media-stream=device-count=${String(anzahl)}`,
      ],
    },
  };
}

/** Legt ein scanbares Exponat an, öffnet den Scan und wartet, bis ein Bild läuft. */
export async function oeffneKamera(page: Page, request: APIRequestContext): Promise<void> {
  const exponat = await legeExponatAn(request, `Kamera ${String(Date.now()).slice(-5)}`);
  await request.post(`/api/exponate/${exponat.id}/links`, {
    data: { url: "https://www.namur.net/", titel: "NAMUR" },
  });
  await page.goto(`/exponate/${exponat.id}/scan`);
  await page.getByRole("button", { name: "Pass scannen" }).first().click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0))
    .toBeGreaterThan(0);
}

/** Von welchem Gerät der laufende Videostrom kommt. */
export function geraet(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const strom = document.querySelector("video")?.srcObject;
    return strom instanceof MediaStream
      ? strom.getVideoTracks()[0]?.getSettings().deviceId
      : undefined;
  });
}
