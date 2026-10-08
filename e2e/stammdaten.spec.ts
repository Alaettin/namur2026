import { expect, test } from "@playwright/test";
import {
  legeExponatAn,
  merkeAnsprechpartner,
  merkeBesucher,
  merkeExponat,
  raeumeAnsprechpartnerAuf,
  raeumeBesucherAuf,
  raeumeExponateAuf,
  seiteMitEintrag,
} from "./exponate.js";

/**
 * Ansprechpartner als Stammdaten, Besucherfoto, Betreuerzuweisung.
 *
 * Drei Dinge, die der Server konnte und die Oberfläche nicht anbot, plus der Umbau der
 * Ansprechpartner auf eigenständige Datensätze.
 *
 * **Zwei Fälle laufen nur am Desktop**, siehe die Begründung dort. Dass die Seiten am Handy
 * nicht überlaufen, prüft `verwaltung.spec.ts` für alle Routen.
 */

// Jeder Fall gibt seine Kennungen zurück, siehe die Begründung in `exponate.ts`.
test.afterEach(async ({ request }) => {
  await raeumeBesucherAuf(request);
  await raeumeExponateAuf(request);
  await raeumeAnsprechpartnerAuf(request);
});

/*
 * Nur am Desktop: die Aktionsspalte der Tabelle liegt bei 390 px hinter dem waagerechten
 * Scrollbereich, und ein Klick darauf ist dort nicht zuverlässig messbar. Die Verwaltung
 * ist laut Übergabe Desktop-Arbeit; am Handy läuft der Scan-Ablauf, und der hat eigene
 * Prüfungen.
 */
test.describe("am Desktop", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 900, "Tabellenbedienung, siehe oben");

  test("Ansprechpartner lassen sich anlegen und zwei Exponaten zuweisen", async ({
    page,
    request,
  }) => {
    const eins = await legeExponatAn(request, `Erstes ${String(Date.now()).slice(-5)}`);
    const zwei = await legeExponatAn(request, `Zweites ${String(Date.now()).slice(-5)}`);
    const name = `Teilt${String(Date.now()).slice(-6)}`;

    // Auf der eigenen Seite anlegen.
    await page.goto("/ansprechpartner");
    await page.getByRole("button", { name: "Ansprechpartner anlegen" }).click();
    const formular = page.getByRole("dialog");
    await formular.getByLabel("Vorname").fill("Hendrik");
    await formular.getByLabel("Nachname").fill(name);
    await formular.getByLabel("Firma").fill("NAMUR Geschäftsstelle");
    await formular.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByRole("cell", { name: `Hendrik ${name}` })).toBeVisible();

    // An beiden Exponaten auswählen.
    for (const e of [eins, zwei]) {
      await page.goto(`/exponate/${e.id}`);
      await page.getByRole("button", { name: "Ansprechpartner hinzufügen" }).click();
      const auswahl = page.getByRole("dialog");
      await auswahl.getByLabel("Ansprechpartner suchen").fill(name);
      await auswahl
        .getByRole("button", { name: /Zuweisen/ })
        .first()
        .click();
      await expect(page.getByText(`Hendrik ${name}`)).toBeVisible();
    }

    /*
     * **Eine Person, zwei Exponate.** Genau das ging vorher nicht: ein Ansprechpartner hing
     * an genau einem Exponat und musste für das zweite neu angelegt werden.
     */
    const person = (
      (await (await request.get("/api/ansprechpartner")).json()) as {
        id: string;
        nachname: string;
      }[]
    ).find((p) => p.nachname === name);
    expect(person, "angelegter Ansprechpartner nicht in der Liste").toBeDefined();
    merkeAnsprechpartner((person as { id: string }).id);

    const seite = await seiteMitEintrag(
      request,
      "/api/ansprechpartner",
      (person as { id: string }).id,
    );
    await page.goto(`/ansprechpartner?seite=${String(seite)}`);
    const zeile = page.getByRole("row", { name: new RegExp(name) });
    await expect(zeile.getByRole("cell", { name: "2", exact: true })).toBeVisible();
  });

  test("derselbe Ansprechpartner lässt sich nicht zweimal am selben Exponat auswählen", async ({
    page,
    request,
  }) => {
    const exponat = await legeExponatAn(request, `Einmal ${String(Date.now()).slice(-5)}`);
    const name = `Einmal${String(Date.now()).slice(-6)}`;
    const person = await (
      await request.post("/api/ansprechpartner", { data: { vorname: "Anna", nachname: name } })
    ).json();
    merkeAnsprechpartner(person.id as string);
    await request.post(`/api/exponate/${exponat.id}/ansprechpartner`, {
      data: { ansprechpartnerId: person.id },
    });

    await page.goto(`/exponate/${exponat.id}`);
    await page.getByRole("button", { name: "Ansprechpartner hinzufügen" }).click();
    const auswahl = page.getByRole("dialog");
    await auswahl.getByLabel("Ansprechpartner suchen").fill(name);

    // Wer schon zugewiesen ist, steht nicht mehr in der Auswahl.
    await expect(auswahl.getByText(`Anna ${name}`)).toHaveCount(0);
  });

  test("ein Besucher zeigt den Standard-Avatar, ohne dass sich etwas hochladen lässt", async ({
    page,
    request,
  }) => {
    const guid = `FOTO-${String(Date.now()).slice(-8)}`;
    await request.post("/api/besucher", {
      data: { guid, vorname: "Bildlos", nachname: "Probe" },
    });
    merkeBesucher(guid);

    await page.goto(`/besucher/${guid}`);
    await expect(page.getByRole("heading", { name: "Foto", exact: true })).toBeVisible();

    const bild = page.getByRole("img", { name: "Foto des Besuchers" });
    await expect(bild).toBeVisible();

    /*
     * **Geprüft wird, ob der Browser das Bild geladen hat, nicht ob ein `<img>` dasteht.**
     *
     * Genau daran ist dieser Fall am 08.10.2026 vorbeigelaufen: `toBeVisible` und ein
     * vorhandenes `src` stimmen auch bei einem Bild, das 404 liefert. Ein kaputtes `<img>`
     * hat eine Box und ein Attribut; nur `naturalWidth` bleibt bei 0. Der Fehler (das
     * Zurücksetzen nahm den Standard-Avatar mit) war damit für die Abnahme unsichtbar.
     */
    await expect
      .poll(async () => bild.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        message: "Das Bild wurde nicht geladen, vermutlich antwortet die Quelle mit 404",
      })
      .toBeGreaterThan(0);

    // Hochladen und Entfernen gibt es hier seit dem 08.10.2026 nicht mehr.
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Foto/ })).toHaveCount(0);
    await expect(page.getByText("kein Foto")).toHaveCount(0);
  });

  test("einem Betreuer lassen sich Exponate zuweisen", async ({ page, request }) => {
    const exponat = await legeExponatAn(request, `Betreut ${String(Date.now()).slice(-5)}`);
    const marke = String(Date.now()).slice(-8);
    const email = `betreuer-${marke}@namur.de`;
    // Eindeutiger Name: frühere Laeufe haben gleichnamige Betreuer hinterlassen, und `.first()`
    // traf dann einen von ihnen.
    const betreuerName = `Betreuer ${marke}`;
    const betreuer = await (
      await request.post("/api/nutzer", {
        data: { name: betreuerName, email, rolle: "betreuer" },
      })
    ).json();

    /*
     * **Auf die Seite, auf der er steht.** Die Nutzerliste blättert zu zehnt, und ein neuer
     * Name landet alphabetisch irgendwo. Vorher stand hier `/nutzer`, und sobald mehr als
     * zehn Nutzer im Bestand waren, war die Zeile schlicht nicht da.
     */
    const seite = await seiteMitEintrag(request, "/api/nutzer", betreuer.id as string);
    await page.goto(`/nutzer?seite=${String(seite)}`);
    const zeile = page.getByRole("row", { name: new RegExp(betreuerName) });
    // Vorher kein Exponat.
    await expect(zeile.getByRole("button", { name: /0 zuweisen/ })).toBeVisible();

    await zeile.getByRole("button", { name: /zuweisen/ }).click();
    const fenster = page.getByRole("dialog");
    await fenster.getByRole("checkbox").first().check();
    await fenster.getByRole("button", { name: "Speichern" }).click();

    // Danach mindestens eines.
    await expect(
      page
        .getByRole("row", { name: new RegExp(betreuerName) })
        .getByRole("button", { name: /[1-9]\d* zuweisen/ }),
    ).toBeVisible();
    expect(exponat.kennung).toMatch(/^E\d\d$/);
  });
});

test("die Kennung wird vergeben und ist nirgends eingebbar", async ({ page }) => {
  await page.goto("/exponate");
  await page.getByRole("button", { name: "Exponat anlegen" }).click();

  // Nur noch ein Namensfeld, kein Kennungsfeld.
  await expect(page.getByLabel("Kennung")).toHaveCount(0);
  await page.getByLabel("Name").fill(`Automatisch ${String(Date.now()).slice(-5)}`);
  await page.getByRole("button", { name: "Anlegen", exact: true }).click();

  // Auf der Detailseite steht die vergebene Kennung, aber kein Änderungsfeld.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/E\d\d/);
  /*
   * `exact`, und der Name des Exponats darf das Wort nicht enthalten: ohne beides trifft
   * der Selektor die eigene Überschrift und meldet einen Fehler, den es nicht gibt.
   */
  await expect(page.getByRole("heading", { name: "Kennung", exact: true })).toHaveCount(0);

  /*
   * Dieses Exponat ist über die Oberfläche entstanden, nicht über `legeExponatAn`. Ohne die
   * Nachmeldung bliebe es liegen und verbrauchte eine Kennung je Lauf und Geräteprojekt.
   */
  const id = /\/exponate\/([^/?#]+)/.exec(page.url())?.[1];
  expect(id, `Id nicht aus der Adresse lesbar: ${page.url()}`).toBeDefined();
  merkeExponat(id as string);
});
