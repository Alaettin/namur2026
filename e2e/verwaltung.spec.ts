import { expect, test } from "@playwright/test";
import { merkeBesucher, raeumeBesucherAuf } from "./exponate.js";

test.afterEach(async ({ request }) => {
  await raeumeBesucherAuf(request);
});

/**
 * Die Verwaltungsoberflaeche, gegen den gebauten Dienst.
 *
 * Die Sitzung kommt aus der Einrichtung; **hier meldet sich niemand an**, sonst sperrt die
 * Anmeldegrenze die Abnahme selbst aus.
 */

test("die Kopfzeile nennt den Namen genau einmal", async ({ page }) => {
  await page.goto("/");
  const kopf = page.locator("header");
  await expect(kopf.getByText("NAMUR HV 2026")).toHaveCount(1);
  await expect(page.getByText("Event Manager")).toHaveCount(0);
});

test("Dashboard, Besucher und Exponate laden", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  await page.goto("/besucher");
  await expect(page.getByRole("heading", { name: "Besucher" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();

  await page.goto("/exponate");
  await expect(page.getByRole("heading", { name: "Exponate" })).toBeVisible();
});

test("die Suche grenzt die Besucherliste ein", async ({ page }) => {
  await page.goto("/besucher");
  await expect(page.getByRole("table")).toBeVisible();
  const vorher = await page.getByRole("row").count();

  await page.getByLabel("Suchen").fill("NHV2026-001");
  // Die Eingabe wirkt verzoegert auf die Adresse, deshalb auf die Zeilenzahl warten.
  await expect(async () => {
    expect(await page.getByRole("row").count()).toBeLessThan(vorher);
  }).toPass({ timeout: 4000 });
});

test("die Seite API zeigt kein Passwort und nicht die falsche Schnittstelle", async ({ page }) => {
  await page.goto("/api");
  await expect(page.getByRole("heading", { name: "API", exact: true })).toBeVisible();
  await expect(page.getByText("geheim-fuer-axon-lokal")).toHaveCount(0);
  await expect(page.getByText("Keycloak")).toHaveCount(0);
  await expect(page.getByText("/identification")).toHaveCount(0);
  // Dafuer die richtigen Endpunkte.
  await expect(page.getByText("/product/{guid}/values")).toBeVisible();
});

test("der Entwicklermodus ist aus und blendet die Knoepfe aus", async ({ page }) => {
  await page.goto("/einstellungen");
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Alles zurücksetzen" })).toHaveCount(0);
  await page.getByRole("button", { name: "Einschalten" }).click();
  await expect(page.getByRole("button", { name: "Alles zurücksetzen" })).toBeVisible();
});

test("der Reset-Knopf bleibt gesperrt, bis das Wort genau stimmt", async ({ page }) => {
  await page.goto("/einstellungen");
  await page.getByRole("button", { name: "Einschalten" }).click();
  await page.getByRole("button", { name: "Alles zurücksetzen" }).click();

  const bestaetigen = page.getByRole("button", { name: "Endgültig löschen" });
  await expect(bestaetigen).toBeDisabled();

  // Die Rueckfrage nennt Zahlen, nicht nur "Sind Sie sicher?".
  await expect(page.getByRole("dialog")).toContainText(/Besucher/);

  const eingabe = page.getByLabel(/Zum Bestätigen/);
  await eingabe.fill("zuruecksetzen");
  await expect(bestaetigen, "Kleinschreibung darf nicht genuegen").toBeDisabled();

  await eingabe.fill("ZURUECKSETZEN");
  await expect(bestaetigen).toBeEnabled();

  // Abbrechen: dieser Test darf den Bestand nicht loeschen.
  await page.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("der Seitenkoerper scrollt nicht waagerecht", async ({ page }) => {
  for (const pfad of ["/", "/besucher", "/exponate", "/nutzer", "/api", "/einstellungen"]) {
    await page.goto(pfad);
    await expect(page.locator("main")).toBeVisible();

    /*
     * **Gemessen wird, ob sich der Viewport verschieben laesst**, nicht
     * `documentElement.scrollWidth`.
     *
     * Letzteres meldet die Breite des breitesten Nachfahren auch dann, wenn ein
     * Zwischencontainer sie sauber wegscrollt: bei 390 px stand dort 800, waehrend
     * `body.scrollWidth` korrekt 390 war und nichts scrollte. Ein Kriterium, das bei
     * richtigem Aufbau rot bleibt, taugt nicht; es wird sonst so lange am Code gedreht,
     * bis die Messung passt.
     */
    const verschiebung = await page.evaluate(() => {
      window.scrollTo(9999, 0);
      const x = window.scrollX;
      window.scrollTo(0, 0);
      return x;
    });
    expect(verschiebung, `Seite laesst sich auf ${pfad} waagerecht schieben`).toBe(0);

    // Zusaetzlich der Koerper selbst, der von einem Scroll-Container richtig abgeschirmt wird.
    const ueberstand = await page.evaluate(
      () => document.body.scrollWidth - document.body.clientWidth,
    );
    expect(ueberstand, `Ueberstand des Koerpers auf ${pfad}`).toBeLessThanOrEqual(0);
  }
});

test("keine Fehler in der Browserkonsole", async ({ page }) => {
  /*
   * **Ein Verstoss gegen die eigene CSP taucht nur hier auf.** Im Netzwerkreiter fehlt so
   * ein Aufruf ganz, und die Seite sieht lediglich unvollstaendig aus.
   */
  const meldungen: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") meldungen.push(m.text());
  });
  page.on("pageerror", (f) => meldungen.push(f.message));

  for (const pfad of ["/", "/besucher", "/exponate", "/api", "/einstellungen"]) {
    await page.goto(pfad);
    await expect(page.locator("main")).toBeVisible();
  }
  expect(meldungen, meldungen.join("\n")).toHaveLength(0);
});

test("der Kopierknopf meldet Erfolg", async ({ page, context }) => {
  /*
   * Die Zwischenablage braucht eine Berechtigung. Sie wird hier erteilt, damit der
   * **Erfolgsfall** geprüft wird; der Fehlerfall steht im Test darunter.
   */
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  const guid = `COPY-${String(Date.now()).slice(-8)}`;
  await page.request.post("/api/besucher", {
    data: { guid, vorname: "Kopier", nachname: "Probe" },
  });
  merkeBesucher(guid);

  await page.goto(`/besucher/${guid}`);
  await expect(page.getByRole("heading", { name: "Pass" })).toBeVisible();

  // Vorher steht dort nichts.
  await expect(page.getByText("Kopiert")).toHaveCount(0);

  await page.getByRole("button", { name: "In die Zwischenablage kopieren" }).first().click();
  await expect(page.getByText("Kopiert")).toBeVisible();

  // Und der Wert liegt wirklich in der Zwischenablage.
  const inhalt = await page.evaluate(() => navigator.clipboard.readText());
  expect(inhalt).toBe(guid);

  // Nach rund 1,5 Sekunden verschwindet die Meldung wieder.
  await expect(page.getByText("Kopiert")).toHaveCount(0, { timeout: 4000 });
});

/**
 * **Die Gegenrichtung.** Scheitert das Kopieren, darf kein Haken erscheinen, sondern der
 * Hinweis zum Markieren. Eine Rückmeldung, die auch bei Misserfolg kommt, ist schlimmer als
 * keine.
 */
test("schlägt das Kopieren fehl, erscheint kein Erfolg", async ({ page }) => {
  const guid = `FAIL-${String(Date.now()).slice(-8)}`;
  await page.request.post("/api/besucher", {
    data: { guid, vorname: "Ohne", nachname: "Ablage" },
  });
  merkeBesucher(guid);

  // Die Zwischenablage so ersetzen, dass sie ablehnt, wie ohne HTTPS.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("nicht erlaubt")) },
    });
  });

  await page.goto(`/besucher/${guid}`);
  await page.getByRole("button", { name: "In die Zwischenablage kopieren" }).first().click();

  await expect(page.getByText(/Kopieren geht hier nicht/)).toBeVisible();
  await expect(page.getByText("Kopiert", { exact: true })).toHaveCount(0);
});

/**
 * Die Seitenumschaltung zeigte vorher immer die Seiten 1 bis 7, auch auf Seite 20.
 *
 * Mit den alten Testdaten (zwei Seiten) fiel das nicht auf. Geprüft wird deshalb mit dem
 * vollen Saatbestand, der 28 Seiten ergibt.
 */
test("die Seitenumschaltung wandert mit der aktuellen Seite", async ({ page }) => {
  await page.goto("/besucher?seite=20");
  await expect(page.getByRole("table")).toBeVisible();

  const leiste = page.getByRole("navigation", { name: "Seiten" });
  await expect(leiste).toBeVisible();

  // Die aktuelle Seite ist dabei und markiert.
  await expect(leiste.getByRole("button", { name: "20", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Seite 1 steht hier nicht mehr, das Fenster ist weitergewandert.
  await expect(leiste.getByRole("button", { name: "1", exact: true })).toHaveCount(0);
  // Und es sind fünf Zahlen plus zwei Pfeile.
  await expect(leiste.getByRole("button")).toHaveCount(7);
});
