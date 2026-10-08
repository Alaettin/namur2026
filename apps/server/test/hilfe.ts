import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer, type GebauterServer } from "../src/app.js";
import { readEnv, type ServerEnv } from "../src/env.js";
import { SCHLUESSEL_ANMELDUNG, setzeSchalter } from "../src/services/einstellungen.js";

/**
 * Ein Server je Test, auf einem eigenen Ordner.
 *
 * `__APP_VERSION__` ersetzt in Tests niemand, deshalb hier gesetzt.
 */
(globalThis as Record<string, unknown>)["__APP_VERSION__"] ??= "test";

export const MIGRATIONEN = fileURLToPath(new URL("../drizzle", import.meta.url));

/** 32 Zeichen, die Untergrenze. Kein echtes Geheimnis, nur ein gueltiges. */
export const TEST_SECRET = "0123456789abcdef0123456789abcdef";

export interface Pruefstand extends GebauterServer {
  readonly env: ServerEnv;
  /** Raeumt Server **und** Ordner weg. */
  readonly ende: () => Promise<void>;
}

export async function starte(zusatz: Record<string, string | undefined> = {}): Promise<Pruefstand> {
  const ordner = mkdtempSync(join(tmpdir(), "namur-test-"));
  const env = readEnv({
    DATA_DIR: ordner,
    SESSION_SECRET: TEST_SECRET,
    LOG_LEVEL: "silent",
    ...zusatz,
  } as NodeJS.ProcessEnv);

  const server = await buildServer(env, MIGRATIONEN);
  return {
    ...server,
    env,
    /*
     * **Der Pruefstand raeumt selbst auf**, und zwar beides: der Ordner haelt eine
     * SQLite-Datei, und ein stehengebliebener Rueckstand verfaelscht still den naechsten
     * Lauf. `force` schluckt den Fall, dass der Ordner schon weg ist.
     */
    ende: async () => {
      await server.close();
      rmSync(ordner, { recursive: true, force: true });
    },
  };
}

/** Meldet sich an und gibt die Cookie-Kopfzeile fuer weitere Aufrufe zurueck. */
export async function melde(stand: Pruefstand, email: string, passwort: string): Promise<string> {
  const antwort = await stand.app.inject({
    method: "POST",
    url: "/api/auth/anmelden",
    payload: { email, passwort },
  });
  if (antwort.statusCode !== 200) {
    throw new Error(`Anmeldung fehlgeschlagen: ${String(antwort.statusCode)} ${antwort.body}`);
  }
  const keks = antwort.cookies.find((c) => c.name === "namur_hv_sitzung");
  if (keks === undefined) throw new Error("kein Sitzungscookie in der Antwort");
  return `namur_hv_sitzung=${keks.value}`;
}

/**
 * Legt den Schalter um, ob die Konnektor-API eine Anmeldung verlangt.
 *
 * **Seit dem 08.10.2026 steht er per Vorgabe auf aus**, die Schnittstelle ist also ohne
 * Zugangsdaten erreichbar. Jeder Test, der die Anmeldung selbst prueft, muss ihn deshalb
 * zuerst einschalten; sonst prueft er, dass etwas durchkommt, was ohnehin durchkommt.
 */
export function verlangeAnmeldung(stand: Pruefstand, an: boolean): void {
  setzeSchalter(stand.ctx.db, SCHLUESSEL_ANMELDUNG, an);
}
