import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, PROJEKT_WURZEL, readEnv } from "../src/env.js";
import { TEST_SECRET } from "./hilfe.js";

const basis = { SESSION_SECRET: TEST_SECRET } as NodeJS.ProcessEnv;

describe("readEnv", () => {
  it("bricht ab, wenn SESSION_SECRET fehlt", () => {
    expect(() => readEnv({} as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });

  it("bricht ab, wenn SESSION_SECRET zu kurz ist", () => {
    // Die Gegenprobe zur Untergrenze: 31 Zeichen, also genau eines zu wenig.
    expect(() => readEnv({ SESSION_SECRET: "a".repeat(31) } as NodeJS.ProcessEnv)).toThrow(
      /zu kurz/,
    );
  });

  it("nimmt genau 32 Zeichen an", () => {
    expect(
      readEnv({ SESSION_SECRET: "a".repeat(32) } as NodeJS.ProcessEnv).sessionSecret,
    ).toHaveLength(32);
  });

  it("bricht ab, wenn nur eine Haelfte des Admin-Paares gesetzt ist", () => {
    expect(() => readEnv({ ...basis, ADMIN_EMAIL: "a@b.de" })).toThrow(/gehoeren zusammen/);
    expect(() => readEnv({ ...basis, ADMIN_PASSWORT: "geheim" })).toThrow(/gehoeren zusammen/);
  });

  it("nimmt das Admin-Paar vollstaendig an und schreibt die E-Mail klein", () => {
    const env = readEnv({ ...basis, ADMIN_EMAIL: "Admin@Firma.DE", ADMIN_PASSWORT: "geheim" });
    expect(env.bootstrapAdmin).toEqual({ email: "admin@firma.de", passwort: "geheim" });
  });

  it("haengt genau einen Schraegstrich an die Viewer-Adresse", () => {
    const ohne = readEnv({ ...basis, VIEWER_BASE_URL: "https://v.example" });
    const mit = readEnv({ ...basis, VIEWER_BASE_URL: "https://v.example///" });
    expect(ohne.viewerBaseUrl).toBe("https://v.example/");
    expect(mit.viewerBaseUrl).toBe("https://v.example/");
  });

  it("laesst APP_NAME leer, solange er nicht gesetzt ist", () => {
    expect(readEnv(basis).appName).toBe("");
  });

  /**
   * Der Datenort darf nicht am Arbeitsverzeichnis haengen.
   *
   * `pnpm dev:server` startet in `apps/server`, `start.bat` in der Wurzel. Vorher zeigte
   * dasselbe `DATA_DIR=./data` auf zwei verschiedene Datenbanken; die zweite trug einen
   * aelteren Journaleintrag und der Start brach mit "table abrufe already exists" ab.
   */
  it("loest ein relatives DATA_DIR unabhaengig vom Arbeitsverzeichnis auf", () => {
    const quelle = { ...basis, DATA_DIR: "./data" };
    const vorher = process.cwd();
    const hier = readEnv(quelle).dbPfad;
    try {
      // Irgendein anderes Verzeichnis, das es sicher gibt: das Paketverzeichnis selbst.
      process.chdir(resolve(PROJEKT_WURZEL, "apps/server"));
      expect(readEnv(quelle).dbPfad).toBe(hier);
    } finally {
      process.chdir(vorher);
    }
    expect(hier).toBe(resolve(PROJEKT_WURZEL, "data/namur.db"));
  });

  it("laesst ein absolutes DATA_DIR unangetastet", () => {
    // Im Container steht dort `/data`, und das darf die Wurzel nicht davorschieben.
    const env = readEnv({ ...basis, DATA_DIR: resolve("/data") });
    expect(env.dataDir).toBe(resolve("/data"));
  });
});
