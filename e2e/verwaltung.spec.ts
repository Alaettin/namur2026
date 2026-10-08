import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  merkeAnsprechpartner,
  merkeBesucher,
  raeumeAnsprechpartnerAuf,
  raeumeBesucherAuf,
} from "./exponate.js";

test.afterEach(async ({ request }) => {
  await raeumeBesucherAuf(request);
  await raeumeAnsprechpartnerAuf(request);
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
  for (const pfad of [
    "/",
    "/besucher",
    "/besucher/import",
    "/exponate",
    "/ansprechpartner",
    "/nutzer",
    "/api",
    "/einstellungen",
  ]) {
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

/**
 * Die Navigation hat zwei Formen, und **beide** werden geprüft.
 *
 * Wird nur die Handy-Form geprüft, belegt ein grüner Lauf nicht, dass die Reiterzeile am
 * Desktop noch da ist, und umgekehrt. Eine Regel mit zwei Richtungen braucht zwei Fälle,
 * sonst beweist die eine Hälfte die andere mit.
 */
test.describe("Navigation", () => {
  test("am Handy führen die drei Striche auf eine andere Seite", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) >= 900, "gilt nur für die schmale Form");
    await page.goto("/");

    // Die Reiterzeile ist weg, sonst stünde die Navigation doppelt da.
    await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeHidden();

    await page.getByRole("button", { name: "Menü" }).click();
    await page.getByRole("menuitem", { name: "Exponate" }).click();

    await expect(page).toHaveURL(/\/exponate$/);
    await expect(page.getByRole("heading", { name: "Exponate" })).toBeVisible();
  });

  test("am Desktop bleibt die Reiterzeile und es gibt kein Menü", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 900, "gilt nur für die breite Form");
    await page.goto("/");

    await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Menü" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible();
  });
});

/**
 * **Liegt an der Stelle des Knopfes auch der Knopf?**
 *
 * `toBeVisible` hat genau diese Frage hier schon einmal nicht beantwortet: ein Element kann
 * sichtbar sein und trotzdem hinter einer Überlagerung liegen, und ein Bild des Fehllaufs
 * zeigt dann zwei Knöpfe, die niemand treffen kann. Gemessen wird deshalb mit
 * `elementFromPoint` auf der Mitte des Knopfes, ob der Treffer der Knopf selbst ist oder
 * etwas in ihm.
 */
async function liegtFrei(page: Page, knopf: Locator) {
  const kasten = await knopf.boundingBox();
  expect(kasten, "der Knopf hat keine Fläche").not.toBeNull();
  if (kasten === null) return false;

  return page.evaluate(
    ({ x, y }) => {
      const getroffen = document.elementFromPoint(x, y);
      if (getroffen === null) return false;
      const ziel = getroffen.closest("button, a");
      return ziel !== null;
    },
    { x: kasten.x + kasten.width / 2, y: kasten.y + kasten.height / 2 },
  );
}

test.describe("am Handy bedienbar", () => {
  test.beforeEach(({ viewport }) => {
    test.skip((viewport?.width ?? 0) >= 900, "gilt nur für die schmale Form");
  });

  /**
   * Die Listen erscheinen als Karten. Vorher lag die Aktionsspalte hinter dem waagerechten
   * Scrollbereich der Tabelle, war also nur erreichbar, wenn man ahnte, dass dort etwas ist.
   */
  test("der Aktionsknopf einer Liste liegt frei", async ({ page }) => {
    await page.goto("/nutzer");
    await expect(page.getByRole("table")).toBeVisible();

    // Der Tabellenkopf ist in der Kartenansicht weg; die Beschriftung steht je Zelle.
    await expect(page.getByRole("columnheader", { name: "E-Mail" })).toBeHidden();

    const knopf = page.getByRole("button", { name: "Passwort" }).first();
    await expect(knopf).toBeVisible();
    expect(await liegtFrei(page, knopf), "etwas liegt über dem Knopf").toBe(true);
  });

  /**
   * Dasselbe im Fenster: dort war der Klick bis zum 08.10.2026 nicht zuverlässig.
   *
   * Genommen wird eine **Rückfrage**, nicht irgendein Fenster: nur sie hat die Knopfzeile,
   * die am Handy unten klebt. Der Zurücksetzen-Dialog aus den Einstellungen taugt dafür
   * nicht, der hängt am Entwicklermodus und ist im Normalbetrieb gar nicht da.
   */
  test("die Knöpfe im Fenster liegen frei", async ({ page, request }) => {
    const marke = String(Date.now()).slice(-6);
    const angelegt = await (
      await request.post("/api/ansprechpartner", {
        data: { vorname: "Fenster", nachname: `Probe${marke}` },
      })
    ).json();
    merkeAnsprechpartner(angelegt.id as string);

    await page.goto("/ansprechpartner");
    const zeile = page.getByRole("row", { name: new RegExp(`Probe${marke}`) });
    await zeile.getByRole("button", { name: "Löschen" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    for (const name of ["Abbrechen", "Löschen"]) {
      const knopf = dialog.getByRole("button", { name, exact: true });
      await expect(knopf).toBeVisible();
      expect(await liegtFrei(page, knopf), `etwas liegt über "${name}"`).toBe(true);
    }

    // Abbrechen: dieser Fall darf den Bestand nicht anfassen.
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
