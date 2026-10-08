import { expect, test } from "@playwright/test";
import { legeExponatAn, raeumeExponateAuf } from "./exponate.js";

test.afterEach(async ({ request }) => {
  await raeumeExponateAuf(request);
});

/**
 * Die Nacharbeiten vom 08.10.2026: zweite Kachelreihe, Datei-Auswähler, entfernte Texte und
 * der abschaltbare Konnektor-Zugang.
 */

test("das Dashboard zeigt sechs Kacheln", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  /*
   * **In der benannten Gruppe suchen, nicht auf der ganzen Seite.** "Besucher" und
   * "Exponate" stehen auch als Reiter in der Hauptnavigation; ohne die Eingrenzung trifft
   * der Selektor zwei Elemente und meldet einen Fehler, den es nicht gibt.
   */
  const kacheln = page.getByRole("region", { name: "Kennzahlen" });
  for (const text of [
    "Besucher",
    "Exponate",
    "Personal",
    "Dokumente",
    "Links",
    "Ansprechpartner",
  ]) {
    await expect(kacheln.getByText(text, { exact: true }), text).toBeVisible();
  }
});

test("die vier erklärenden Absätze sind nirgends mehr zu finden", async ({ page, request }) => {
  const stellen: [string, RegExp][] = [
    ["/exponate", /Die Kennung \(E01/],
    ["/ansprechpartner", /Diese Personen stehen an den Exponaten/],
    ["/api", /Axon Core holt die Besucherdaten/],
  ];
  for (const [pfad, muster] of stellen) {
    await page.goto(pfad);
    await expect(page.getByText(muster), pfad).toHaveCount(0);
  }

  /*
   * Der vierte steht in der Exponatbearbeitung. Das Exponat wird **angelegt und direkt
   * angesteuert**, nicht über die Liste angeklickt: deren Aktionsspalte liegt bei 390 px
   * hinter dem waagerechten Scrollbereich, und der Link heißt "Bearbeiten", nicht wie die
   * Kennung.
   */
  const exponat = await legeExponatAn(request, `Absatzprobe ${String(Date.now()).slice(-5)}`);
  await page.goto(`/exponate/${exponat.id}`);
  await expect(page.getByRole("button", { name: "Ansprechpartner hinzufügen" })).toBeVisible();
  await expect(page.getByText(/Ausgewählt wird aus den Stammdaten/)).toHaveCount(0);
});

/**
 * Der Schalter für den Konnektor-Zugang.
 *
 * **Der Fall stellt die Vorgabe am Ende wieder her.** Er ändert echten Serverzustand; bliebe
 * der Schalter an, liefe der nächste Lauf gegen eine andere Ausgangslage und die Prüfung der
 * Vorgabe wäre wertlos.
 */
test("der Konnektor-Zugang steht auf aus und warnt, eingeschaltet nicht mehr", async ({
  page,
  request,
}) => {
  await page.goto("/api");

  const warnung = page.getByText(/Die Schnittstelle ist ohne Anmeldung erreichbar/);
  await expect(warnung).toBeVisible();
  const schalter = page.getByRole("button", { name: "Einschalten" });
  await expect(schalter).toBeVisible();

  try {
    await schalter.click();
    await expect(warnung).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ausschalten" })).toBeVisible();
    // Jetzt steht das Verfahren da, das vorher nicht galt.
    // `exact`, sonst trifft es auch den Erklärsatz über dem Schalter.
    await expect(page.getByText("Basic-Authentifizierung", { exact: true })).toBeVisible();
  } finally {
    await request.patch("/api/konnektor/zugang", { data: { anmeldungVerlangt: false } });
  }

  await page.reload();
  await expect(page.getByText(/Die Schnittstelle ist ohne Anmeldung erreichbar/)).toBeVisible();
});

test("Exponate, Ansprechpartner und Nutzer blättern zu zehn", async ({ page }) => {
  for (const pfad of ["/exponate", "/ansprechpartner", "/nutzer"]) {
    await page.goto(pfad);
    await expect(page.getByRole("table"), pfad).toBeVisible();

    const zeilen = await page.getByRole("row").count();
    /*
     * Kopfzeile plus höchstens zehn Datenzeilen. Mehr hieße, dass der Ausschnitt nicht
     * greift; weniger ist in Ordnung, dann gibt es schlicht nicht mehr Einträge.
     */
    expect(zeilen, `${pfad}: ${String(zeilen)} Zeilen`).toBeLessThanOrEqual(11);
  }
});

/**
 * Der Prüfstand auf der Seite API.
 *
 * **Geprüft wird am Inhalt der Antwort**, nicht daran, dass ein Kasten erscheint: ein leerer
 * Block wäre sonst grün, genau wie ein `<img>` ohne geladenes Bild sichtbar ist.
 */
test("ein Endpunkt lässt sich auf der Seite ausprobieren", async ({ page }) => {
  await page.goto("/api");

  // Die Beschreibungsspalte ist weg, es bleiben Methode und Pfad.
  await expect(page.getByText("Fassung der Spezifikation und der App.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Endpunkte AXON Connector" })).toBeVisible();
  // Der erklärende Satz ist entfallen, und /connector steht nicht mehr an jedem Pfad.
  await expect(page.getByText(/Aufklappen, Werte eintragen/)).toHaveCount(0);
  await expect(page.getByText("/connector/versions")).toHaveCount(0);

  const zeile = page.locator("details", { hasText: "/versions" });
  await zeile.locator("summary").click();
  await zeile.getByRole("button", { name: "Senden" }).click();

  await expect(zeile.getByText("HTTP 200")).toBeVisible();
  // Der Rumpf trägt die Fassung der Spezifikation, nicht nur irgendetwas.
  await expect(zeile.locator("pre")).toContainText('"version": "1.0.0"');
});

test("der Prüfstand nennt einen Fehler der Route, statt ihn zu verstecken", async ({ page }) => {
  await page.goto("/api");
  const zeile = page.locator("details", { hasText: "/product/{guid}/hierarchy" });
  await zeile.locator("summary").click();
  await zeile.getByLabel("GUID").fill("GIBT-ES-NICHT");
  await zeile.getByRole("button", { name: "Senden" }).click();

  await expect(zeile.getByText("HTTP 404")).toBeVisible();
});

test("die entfernten Blöcke sind nirgends mehr zu finden", async ({ page }) => {
  await page.goto("/api");
  for (const text of ["Datenmodell", "Beispielaufruf", "Letzte Aufrufe", "Modell als CSV"]) {
    await expect(page.getByText(text), text).toHaveCount(0);
  }
  await expect(page.getByText(/Jeder, der die Basis-Adresse kennt/)).toHaveCount(0);
  // Die Endpunktliste bleibt, sie ist der Zweck der Seite.
  await expect(page.getByText("/product/{guid}/values")).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("Letzte Zuordnungen")).toHaveCount(0);
  // Die Balken je Exponat bleiben.
  await expect(page.getByText("Zuordnungen je Exponat")).toBeVisible();
});
