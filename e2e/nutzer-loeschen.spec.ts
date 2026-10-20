import { expect, test, type APIRequestContext } from "@playwright/test";
import { seiteMitEintrag } from "./exponate.js";

/**
 * Nutzer löschen, seit dem 20.10.2026: immer erst nach Rückfrage, nie die eigene Zeile.
 */

const angelegt: string[] = [];

test.afterEach(async ({ request }) => {
  while (angelegt.length > 0) {
    const id = angelegt.pop();
    if (id !== undefined) await request.delete(`/api/nutzer/${id}`);
  }
});

async function neuerBetreuer(request: APIRequestContext) {
  const marke = `${String(Date.now()).slice(-6)}${String(Math.random()).slice(2, 5)}`;
  const name = `Loeschling ${marke}`;
  const antwort = await request.post("/api/nutzer", {
    data: { name, email: `loeschling-${marke}@namur.de`, rolle: "betreuer" },
  });
  expect(antwort.status()).toBe(201);
  const { id } = (await antwort.json()) as { id: string };
  angelegt.push(id);
  return { id, name };
}

async function ids(request: APIRequestContext): Promise<string[]> {
  return ((await (await request.get("/api/nutzer")).json()) as { id: string }[]).map((n) => n.id);
}

test("Löschen fragt nach; Abbrechen lässt den Nutzer stehen, Bestätigen entfernt ihn", async ({
  page,
  request,
}) => {
  const { id, name } = await neuerBetreuer(request);
  await page.goto(`/nutzer?seite=${String(await seiteMitEintrag(request, "/api/nutzer", id))}`);
  const zeile = page.getByRole("row", { name: new RegExp(name) });

  // Abbrechen
  await zeile.getByRole("button", { name: "Löschen" }).click();
  const fenster = page.getByRole("dialog");
  await expect(fenster.getByRole("heading", { name: "Nutzer löschen?" })).toBeVisible();
  await expect(fenster).toContainText(name);
  await fenster.getByRole("button", { name: "Abbrechen" }).click();
  await expect(fenster).toBeHidden();
  await expect(zeile).toBeVisible();
  expect(await ids(request)).toContain(id);

  // Bestätigen
  await zeile.getByRole("button", { name: "Löschen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Löschen" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toHaveCount(0);
  expect(await ids(request)).not.toContain(id);
});

test("die eigene Zeile hat keinen Löschen-Knopf", async ({ page, request }) => {
  const ich = (await (await request.get("/api/auth/ich")).json()) as { id: string; name: string };
  await page.goto(`/nutzer?seite=${String(await seiteMitEintrag(request, "/api/nutzer", ich.id))}`);
  // Über die E-Mail-Zelle, der Name kann mehrfach vorkommen.
  const alle = (await (await request.get("/api/nutzer")).json()) as { id: string; email: string }[];
  const email = alle.find((n) => n.id === ich.id)?.email ?? "";
  const zeile = page.getByRole("row").filter({ hasText: email });
  await expect(zeile.getByRole("button", { name: "Passwort" })).toBeVisible();
  await expect(zeile.getByRole("button", { name: "Löschen" })).toHaveCount(0);
});
