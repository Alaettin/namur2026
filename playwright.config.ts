import { defineConfig, devices } from "@playwright/test";

/**
 * Abnahme gegen den **gebauten** Dienst, nicht gegen den Vite-Server.
 *
 * Nur dort gilt die Content-Security-Policy, und nur dort liefert derselbe Dienst
 * Oberflaeche und API aus. Ein Lauf gegen Vite wuerde genau die Fehler uebersehen, die erst
 * im Betrieb auffallen.
 *
 * Der Dienst wird **nicht** von hier gestartet: er braucht eine ausgefuellte `.env`, und
 * ein zweiter Start neben einem laufenden Prozess scheitert still an EADDRINUSE. Vorher
 * `pnpm build` und `node apps/server/dist/index.js`.
 */

/*
 * Die `.env` liefert die Zugangsdaten der Einrichtung. Fehlt sie, sagt die Einrichtung
 * selbst Bescheid; hier still zu bleiben ist richtig, weil ein Lauf gegen einen entfernten
 * Dienst seine Werte aus der echten Umgebung bekommt.
 */
try {
  process.loadEnvFile(".env");
} catch {
  // absichtlich still
}

const SITZUNG = "e2e/.sitzung.json";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://localhost:3220",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    /*
     * Die Einrichtung meldet sich **einmal** an. Jeder Test, der sich selbst anmeldet,
     * verbraucht einen der 10 Versuche je Viertelstunde; acht Tests in zwei
     * Geraeteprojekten sperren die Abnahme sonst selbst aus.
     */
    { name: "einrichtung", testMatch: /einrichtung\.setup\.ts/ },

    // Die Anmeldung selbst muss ohne abgelegte Sitzung geprueft werden.
    {
      name: "anmeldung",
      testMatch: /anmeldung\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },

    /*
     * **Die Anmeldung auch bei 390 px.** Sie ist der erste Bildschirm, den ein Betreuer am
     * Stand sieht, und lief bis zum 08.10.2026 nur in der breiten Form durch den
     * Pruefstand. Eine Seite, die nie in der Form geprueft wird, in der sie benutzt wird,
     * ist ungeprueft.
     */
    {
      name: "anmeldung-handy",
      testMatch: /anmeldung\.spec\.ts/,
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },

    {
      name: "desktop",
      testIgnore: [/anmeldung\.spec\.ts/, /einrichtung\.setup\.ts/],
      dependencies: ["einrichtung"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: SITZUNG,
      },
    },
    {
      name: "handy",
      testIgnore: [/anmeldung\.spec\.ts/, /einrichtung\.setup\.ts/],
      dependencies: ["einrichtung"],
      use: {
        // 390 px ist die Breite, die das Design-Paket fuer das Handy ansetzt.
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        storageState: SITZUNG,
      },
    },
  ],
});
