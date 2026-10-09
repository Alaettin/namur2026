import { expect, test } from "@playwright/test";
import { merkeBesucher, raeumeBesucherAuf, seiteMitEintrag } from "./exponate.js";

/**
 * Titel, gruppierte Stammdaten und die Avatarverwaltung, aus der Verwaltungssicht.
 *
 * Das Tablet prüft `kiosk.spec.ts`, es läuft in einem eigenen Projekt mit eigener Sitzung.
 */

test.afterEach(async ({ request }) => {
  await raeumeBesucherAuf(request);
});

test("die Stammdaten stehen in Gruppen", async ({ page }) => {
  await page.goto("/besucher/neu");
  /*
   * Ueber die Rolle, nicht ueber den Text: "Firma" ist Gruppe **und** Feld, ein
   * Textvergleich traefe beides. Das `fieldset` mit `legend` ist eine `group`.
   */
  for (const gruppe of ["Person", "Firma", "Anschrift", "Kontakt"]) {
    await expect(page.getByRole("group", { name: gruppe })).toBeVisible();
  }
  // Und der Titel steht in der Gruppe Person, nicht bei der Firma.
  await expect(page.getByLabel("Titel", { exact: true })).toBeVisible();
});

test("ein Titel lässt sich setzen und geht am Vornamen hinaus", async ({ page, request }) => {
  const guid = `TIT-${String(Date.now()).slice(-8)}`;

  await page.goto("/besucher/neu");
  await page.getByLabel("Titel", { exact: true }).fill("Dr.");
  await page.getByLabel("Vorname").fill("Anna");
  await page.getByLabel("Nachname").fill("Ahrens");
  await page.getByLabel(/GUID/).fill(guid);
  await page.getByRole("button", { name: "Speichern" }).click();
  merkeBesucher(guid);

  await expect(page).toHaveURL(new RegExp(guid));

  // Am Server nachgesehen, nicht am Bildschirm.
  const gespeichert = await (await request.get(`/api/besucher/${guid}`)).json();
  expect(gespeichert.titel).toBe("Dr.");
  expect(gespeichert.vorname).toBe("Anna");

  /*
   * **Und so, wie Axon es bekommt.** Ohne Anmeldung, wie der Viewer: der Titel steht am
   * Vornamen, und eine eigene Eigenschaft gibt es nicht.
   */
  const werte = await (
    await request.post(`/connector/product/${guid}/values`, { data: {} })
  ).json();
  const vorname = werte.find((w: { propertyId: string }) => w.propertyId === "Visitor_FirstName");
  expect(JSON.stringify(vorname)).toContain("Dr. Anna");
  expect(
    werte.filter((w: { propertyId: string }) => /title/i.test(w.propertyId)),
    "neue Eigenschaft im Modell",
  ).toEqual([]);
});

/** Der Abschnitt ist zu, bis jemand ihn aufklappt. */
test("der Avatar-Abschnitt ist eingeklappt", async ({ page }) => {
  await page.goto("/einstellungen");
  const titel = page.getByRole("heading", { name: "Avatare", exact: true });
  await expect(titel).toBeVisible();

  // Zugeklappt: die Bilder sind im DOM, aber nicht sichtbar.
  await expect(page.getByRole("button", { name: /Avatar 1 entfernen/ })).toBeHidden();

  await titel.click();
  await expect(page.getByRole("button", { name: /Avatar 1 entfernen/ })).toBeVisible();
});

/**
 * **Das Standardbild steht in der Reihe, hat aber keine Knöpfe.**
 *
 * Geprüft werden beide Seiten: es ist da, und es ist nicht bedienbar. Nur eines von beiden
 * ließe offen, ob es versehentlich wie ein Galerieeintrag behandelt wird.
 */
test("das Standardbild ist sichtbar, aber nicht löschbar und nicht verschiebbar", async ({
  page,
}) => {
  await page.goto("/einstellungen");
  await page.getByRole("heading", { name: "Avatare", exact: true }).click();

  await expect(page.getByRole("img", { name: "Standardbild" })).toBeVisible();
  await expect(page.getByText("Standard", { exact: true })).toBeVisible();

  /*
   * Die Zählung der Knöpfe folgt der Galerie, nicht der Anzeige: stünde das Standardbild
   * mit in der Liste, gäbe es einen Knopf mehr als Galerieeinträge.
   */
  const anzahl = (await (await page.request.get("/api/avatare")).json()).avatare.length;
  await expect(page.getByRole("button", { name: /entfernen$/ })).toHaveCount(anzahl);

  // Und der erste Pfeil gehört zum ersten **Galeriebild**, nicht zum Standard.
  await expect(page.getByRole("button", { name: "Avatar 1 nach vorn" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: `Avatar ${String(anzahl)} nach hinten` }),
  ).toBeDisabled();
});

test("Löschen fragt nach, und Abbrechen ändert nichts", async ({ page, request }) => {
  await page.goto("/einstellungen");
  await page.getByRole("heading", { name: "Avatare", exact: true }).click();

  const vorher = (await (await request.get("/api/avatare")).json()).avatare.length;

  await page.getByRole("button", { name: "Avatar 1 entfernen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Abbrechen" }).click();

  // **Am Server nachgesehen**, nicht am Bildschirm: der zeigt auch einen Entwurf.
  const nachher = (await (await request.get("/api/avatare")).json()).avatare.length;
  expect(nachher, "Abbrechen hat gelöscht").toBe(vorher);
});

test("Avatare lassen sich sortieren und wirklich entfernen", async ({ page, request }) => {
  await page.goto("/einstellungen");
  await page.getByRole("heading", { name: "Avatare", exact: true }).click();

  const vorher = (await (await request.get("/api/avatare")).json()).avatare as {
    dateiId: string;
  }[];
  expect(vorher.length).toBeGreaterThan(2);

  // Das zweite nach vorn: danach steht es an erster Stelle.
  await page.getByRole("button", { name: "Avatar 2 nach vorn" }).click();
  await expect
    .poll(async () => (await (await request.get("/api/avatare")).json()).avatare[0].dateiId)
    .toBe(vorher[1]?.dateiId);

  // Und eines entfernen, diesmal bestätigt.
  await page.getByRole("button", { name: "Avatar 1 entfernen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Entfernen" }).click();
  await expect
    .poll(async () => (await (await request.get("/api/avatare")).json()).avatare.length)
    .toBe(vorher.length - 1);

  /*
   * Aufräumen: zurücksetzen würde den ganzen Bestand löschen, deshalb das entfernte Bild
   * wieder hochladen. Ein 1x1-JPEG genügt, geprüft wird die Zahl.
   */
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64",
  );
  const zurueck = await request.post("/api/avatare", {
    multipart: { datei: { name: "ersatz.jpg", mimeType: "image/jpeg", buffer: jpeg } },
  });
  expect(zurueck.status()).toBe(201);
});

test("ein zu grosses Bild wird abgewiesen", async ({ request }) => {
  const zuGross = Buffer.alloc(400 * 1024, 0x41);
  const antwort = await request.post("/api/avatare", {
    multipart: { datei: { name: "riesig.jpg", mimeType: "image/jpeg", buffer: zuGross } },
  });
  expect(antwort.status()).toBe(400);
  expect((await antwort.json()).code).toBe("datei-zu-gross");
});

/**
 * **Die Grenze für die gewählte Datei, und die Meldung dazu.**
 *
 * Nicht nur, dass abgewiesen wird: bei einer Grenze von 1 MB rundete die alte Meldung eine
 * 1,4-MB-Datei auf „1 MB" und sagte damit „1 MB ist zu groß, höchstens 1 MB". Geprüft wird
 * deshalb, dass die genannte Größe über der Grenze liegt.
 */
test("eine Datei über 1 MB wird mit einer lesbaren Meldung abgewiesen", async ({ page }) => {
  await page.goto("/einstellungen");
  await page.getByRole("heading", { name: "Avatare", exact: true }).click();

  await expect(page.getByText("Höchstens 1,0 MB je Datei")).toBeVisible();

  // 1,4 MB: knapp über der Grenze, genau der Fall, den das Runden verdorben hat.
  await page.setInputFiles('input[type="file"]', {
    name: "zu-gross.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(Math.round(1.4 * 1024 * 1024), 0x41),
  });

  const meldung = page.getByRole("alert");
  await expect(meldung).toContainText("1,4 MB");
  await expect(meldung).toContainText("Höchstens 1,0 MB");
});

/** Der Anzeigename ist neu, der gespeicherte Wert nicht. Beide Hälften. */
test("die Rolle heißt Terminal, gespeichert wird weiterhin kiosk", async ({ page, request }) => {
  await page.goto("/nutzer");
  const auswahl = page.getByLabel("Rolle");
  await expect(auswahl).toBeVisible();
  await expect(auswahl.getByRole("option", { name: "Terminal" })).toHaveCount(1);
  await expect(auswahl.getByRole("option", { name: /Tablet/i })).toHaveCount(0);

  /*
   * Und der Wert dahinter: das Abnahmekonto des Terminals läuft seit gestern mit der Rolle
   * `kiosk`. Stünde dort etwas anderes, wäre der Wächter umgangen worden.
   */
  const nutzer = (await (await request.get("/api/nutzer")).json()) as {
    id: string;
    email: string;
    rolle: string;
  }[];
  const terminal = nutzer.find((n) => n.rolle === "kiosk");
  expect(terminal, "kein Konto mit der Rolle kiosk").toBeDefined();

  /*
   * Und der Vermerk in der Liste. Die Liste blaettert zu zehnt, das Konto steht also nicht
   * zwingend auf Seite eins; die Seite wird gerechnet statt geklickt.
   */
  const seite = await seiteMitEintrag(request, "/api/nutzer", terminal?.id ?? "");
  await page.goto(`/nutzer?seite=${String(seite)}`);
  /*
   * **In der Zeile dieses Kontos**, nicht irgendwo auf der Seite: so ist zugleich belegt,
   * dass der Vermerk am richtigen Nutzer hängt. Ohne `exact`, denn die Markierung rendert
   * einen Aufzählungspunkt vor dem Text.
   */
  const zeile = page.getByRole("row", { name: new RegExp(terminal?.email ?? "") });
  await expect(zeile.getByText("TERMINAL")).toBeVisible();

  /*
   * **Kein seitenweiter Gegencheck auf "TABLET".** `getByText` sucht ohne Ruecksicht auf
   * Gross- und Kleinschreibung, und das Abnahmekonto heisst "Tablet Abnahme"; die Suche
   * koennte hier nie null ergeben und waere ein Kriterium, das bei richtigem Aufbau rot
   * bleibt. Den alten Namen schliesst die Pruefung der Auswahlliste oben aus.
   */
});
