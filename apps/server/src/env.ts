import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Die Projektwurzel, an **dieser Datei** verankert statt am Arbeitsverzeichnis.
 *
 * `pnpm dev:server` startet im Paketverzeichnis, `start.bat` in der Wurzel. Ein relatives
 * `DATA_DIR` meinte dadurch zwei verschiedene Datenbanken, und die zweite sah aus wie eine
 * fehlgeschlagene Migration: Drizzle fand dort einen aelteren Journaleintrag und legte
 * Tabellen ein zweites Mal an.
 *
 * Gebaut liegt alles in `apps/server/dist/index.js`, also auf derselben Tiefe wie
 * `apps/server/src/env.ts`. Beide Wege kommen hier auf dieselbe Wurzel.
 */
export const PROJEKT_WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Konfiguration aus der Umgebung, einmal gelesen und geprueft.
 *
 * Fehlt ein Pflichtwert, bricht der **Start** ab, nicht der erste Anmeldeversuch. Ein
 * Server, der mit leerem SESSION_SECRET laeuft, signiert Sitzungen mit nichts und faellt
 * erst auf, wenn jemand das Cookie faelscht.
 */

export interface ServerEnv {
  readonly port: number;
  readonly host: string;
  readonly logLevel: string;
  readonly production: boolean;
  /** Wurzel fuer die Datenbank und die Dateiablage. */
  readonly dataDir: string;
  /** Die eine SQLite-Datei. */
  readonly dbPfad: string;
  /** Ordner der hochgeladenen Dateien. */
  readonly dateienDir: string;
  readonly sessionSecret: string;
  readonly sessionTtlMs: number;
  readonly maxUploadBytes: number;
  /**
   * Bootstrap des ersten Admins. Beide zusammen oder keiner.
   *
   * Greift nur, solange **kein** Admin existiert. Danach wird nichts getan, auch nicht
   * das Passwort zurueckgesetzt: sonst holte ein Neustart ein weggeworfenes Startpasswort
   * zurueck.
   */
  readonly bootstrapAdmin: { readonly email: string; readonly passwort: string } | null;
  /**
   * Zugang fuer Axon zur Konnektor-API. Erst in Auftrag 2 benutzt, hier schon gelesen,
   * damit eine unvollstaendige Umgebung beim Start auffaellt und nicht bei der ersten
   * Abfrage aus Axon.
   */
  readonly connectorBasic: { readonly user: string; readonly passwort: string } | null;
  /** Zugang der Carrera-Bahn. Wirkt nur, wenn der Schalter in den Einstellungen an ist. */
  readonly carreraBasic: { readonly user: string; readonly passwort: string } | null;
  /**
   * Die oeffentliche Basis-Adresse ohne abschliessenden Schraegstrich, oder `null`.
   *
   * Sie schlaegt den `Host`-Kopf, denn der kommt vom Klienten und ist damit Nutzerdaten.
   */
  readonly publicBaseUrl: string | null;
  /** Basis des Viewers, mit abschliessendem Schraegstrich. Die GUID wird angehaengt. */
  readonly viewerBaseUrl: string;
  /**
   * Angezeigter Name der App.
   *
   * Leer ist der gewollte Vorgabewert: der Name steht noch nicht fest, und "Event Manager"
   * aus dem Design-Paket ist bei Neoception ein anderes Produkt. Die Oberflaeche zeigt dann
   * nur "NAMUR HV 2026".
   */
  readonly appName: string;
}

export class ConfigError extends Error {}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new ConfigError(
      `${name} fehlt. Ohne diesen Wert startet der Server nicht, siehe .env.example.`,
    );
  }
  return value;
}

function number(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} muss eine positive Zahl sein, gelesen wurde "${value}".`);
  }
  return parsed;
}

/**
 * Liest ein Paar, das nur vollstaendig oder gar nicht gesetzt sein darf.
 *
 * Die Haelfte davon ist der gefaehrliche Fall: ein gesetztes ADMIN_EMAIL ohne Passwort
 * sieht nach eingerichtetem Bootstrap aus, legt aber nie einen Admin an, und das faellt
 * erst auf, wenn sich niemand anmelden kann.
 */
function paar(
  nameA: string,
  nameB: string,
  a: string | undefined,
  b: string | undefined,
): { a: string; b: string } | null {
  const hatA = a !== undefined && a.trim() !== "";
  const hatB = b !== undefined && b.trim() !== "";
  if (!hatA && !hatB) return null;
  if (!hatA || !hatB) {
    throw new ConfigError(
      `${nameA} und ${nameB} gehoeren zusammen. Gesetzt ist nur ${hatA ? nameA : nameB}.`,
    );
  }
  return { a: a as string, b: b as string };
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  // Ein absoluter Wert bleibt absolut (im Container `/data`), ein relativer haengt an der
  // Wurzel. `resolve` erledigt beides, die Basis faellt beim absoluten Pfad weg.
  const dataDir = resolve(PROJEKT_WURZEL, source["DATA_DIR"] ?? "./data");
  const ttlHours = number("SESSION_TTL_HOURS", source["SESSION_TTL_HOURS"], 12);
  const maxUploadMb = number("MAX_UPLOAD_MB", source["MAX_UPLOAD_MB"], 50);

  /*
   * Ein kurzes Geheimnis ist kein Geheimnis. Der Wert signiert jedes Sitzungscookie; wer
   * ihn erraet, meldet sich selbst an. 32 Zeichen sind die Untergrenze, und ein
   * `SESSION_SECRET=test` soll den Start abbrechen statt jahrelang offen zu stehen.
   */
  const sessionSecret = required("SESSION_SECRET", source["SESSION_SECRET"]);
  if (sessionSecret.length < 32) {
    throw new ConfigError(
      `SESSION_SECRET ist mit ${String(sessionSecret.length)} Zeichen zu kurz, ` +
        "mindestens 32 sind noetig.",
    );
  }

  const admin = paar(
    "ADMIN_EMAIL",
    "ADMIN_PASSWORT",
    source["ADMIN_EMAIL"],
    source["ADMIN_PASSWORT"],
  );
  const basic = paar(
    "CONNECTOR_BASIC_USER",
    "CONNECTOR_BASIC_PASSWORT",
    source["CONNECTOR_BASIC_USER"],
    source["CONNECTOR_BASIC_PASSWORT"],
  );
  const carrera = paar(
    "CARRERA_BASIC_USER",
    "CARRERA_BASIC_PASSWORT",
    source["CARRERA_BASIC_USER"],
    source["CARRERA_BASIC_PASSWORT"],
  );

  return {
    port: number("PORT", source["PORT"], 3220),
    host: source["HOST"] ?? "0.0.0.0",
    logLevel: source["LOG_LEVEL"] ?? "info",
    production: source["NODE_ENV"] === "production",
    dataDir,
    dbPfad: resolve(dataDir, "namur.db"),
    dateienDir: resolve(dataDir, "dateien"),
    sessionSecret,
    sessionTtlMs: ttlHours * 60 * 60 * 1000,
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    bootstrapAdmin:
      admin === null ? null : { email: admin.a.trim().toLowerCase(), passwort: admin.b },
    connectorBasic: basic === null ? null : { user: basic.a, passwort: basic.b },
    carreraBasic: carrera === null ? null : { user: carrera.a, passwort: carrera.b },
    publicBaseUrl: (() => {
      const roh = source["PUBLIC_BASE_URL"]?.trim();
      return roh === undefined || roh === "" ? null : roh.replace(/\/+$/, "");
    })(),
    // Mit genau einem abschliessenden Schraegstrich, egal wie er gesetzt wurde: der Scan
    // vergleicht den QR-Inhalt gegen diesen Praefix, und ein fehlender Schraegstrich
    // liesse `.../abc` auf `.../abcdef` passen.
    viewerBaseUrl: (source["VIEWER_BASE_URL"] ?? "https://viewer-namur2026.aas.neoception.dev/")
      .trim()
      .replace(/\/*$/, "/"),
    appName: source["APP_NAME"]?.trim() ?? "",
  };
}
