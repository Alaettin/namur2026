import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";

/**
 * Der Fehlerkoerper der oeffentlichen API, nach dem Schema `Result` aus
 * `connector-1.0.0.json`.
 *
 * Die Spec nennt ihn **optional** ("providing meaningful messages and codes is
 * recommended"). Hier ist er **verbindlich**: eine Fehlersuche laeuft ueber zwei Haeuser,
 * und die Frage "was genau kam bei euch an" ist ohne `code` und `correlationId` nicht
 * beantwortbar. Genau das ist der Unterschied zum Vorgaenger, der `{"error": "..."}`
 * schickt und einen 500er verschluckt.
 *
 * Das Schema kennt genau ein Feld, `messages`. Kein `success`, kein `httpStatus`, kein
 * Code auf oberster Ebene.
 */

export type Schwere = "Info" | "Warning" | "Error" | "Exception";

export interface Message {
  messageType: Schwere;
  text: string;
  /** Maschinenlesbar, hoechstens 32 Zeichen laut Spec. */
  code?: string;
  /** Hoechstens 128 Zeichen laut Spec. Verbindet Protokolleintrag und Antwort. */
  correlationId?: string;
  timestamp?: string;
}

export interface Result {
  messages: Message[];
}

/**
 * Ein Fehler der oeffentlichen API.
 *
 * Getrennt von `AppError` aus `errors.ts`: der gilt fuer die Verwaltung und antwortet mit
 * `{code, message}`, dieser hier antwortet mit `Result`. Zwei Vertraege, zwei Formen, und
 * sie duerfen nicht ineinanderlaufen.
 */
export class ApiFehler extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly schwere: Schwere = "Error",
  ) {
    super(message);
    this.name = "ApiFehler";
  }
}

/**
 * Fehlende oder falsche Basic-Zugangsdaten.
 *
 * Ein Grund fuer beide Faelle: ob der Benutzername stimmt und nur das Passwort nicht,
 * geht die Gegenseite nichts an.
 */
export const nichtAngemeldet = () =>
  new ApiFehler(401, "unauthorized", "Missing or invalid credentials.");

export const itemUnbekannt = (itemId: string) =>
  new ApiFehler(404, "item-not-found", `No entity with itemId "${itemId}".`);

export const zuVieleFelder = (grenze: number) =>
  new ApiFehler(
    400,
    "too-many-properties",
    `At most ${String(grenze)} propertyIds are accepted per request.`,
  );

/** Erzeugt die Kennung, die Antwort und Protokolleintrag verbindet. */
export function neueKorrelation(): string {
  return randomUUID();
}

export function sendeResult(
  reply: FastifyReply,
  fehler: ApiFehler,
  correlationId: string,
): FastifyReply {
  const koerper: Result = {
    messages: [
      {
        messageType: fehler.schwere,
        text: fehler.message,
        code: fehler.code.slice(0, 32),
        correlationId: correlationId.slice(0, 128),
        timestamp: new Date().toISOString(),
      },
    ],
  };
  return reply.code(fehler.statusCode).type("application/json").send(koerper);
}
