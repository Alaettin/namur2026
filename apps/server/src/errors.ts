import type { FastifyError, FastifyInstance } from "fastify";

/**
 * Fehler mit Statuscode, maschinenlesbarer Kennung und englischer Meldung.
 *
 * **Die Kennung ist das Uebersetzbare, nicht die Meldung.** Die Oberflaeche schaltet auf
 * `code` und zeigt ihren eigenen deutschen Satz. Die Meldung hier ist fuer Protokolle und
 * fuer direkte Nutzer der Schnittstelle; sie ist englisch, weil die
 * Konnektor-Spezifikation 1.0.0 englisch ist und dieser Server sie ab Auftrag 2 bedient.
 *
 * Daraus folgt: **je Grund ein eigener Code.** Ein Sammelcode fuer acht Gruende laesst
 * sich nicht uebersetzen.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(400, code, message, details);
export const unauthorized = (message = "Not signed in.") =>
  new AppError(401, "nicht-angemeldet", message);
/**
 * Falsche Zugangsdaten sind etwas anderes als eine fehlende Sitzung, auch wenn beides 401
 * ist. Mit demselben Code stuende auf der Anmeldemaske "Nicht angemeldet", was der Nutzer
 * ohnehin weiss.
 *
 * **Eine Meldung fuer beide Haelften.** Ob die E-Mail unbekannt ist oder das Passwort
 * falsch, bleibt ununterscheidbar; sonst waere diese Maske eine Auskunft darueber, wer
 * hier ein Konto hat.
 */
export const anmeldungFalsch = () =>
  new AppError(401, "anmeldung-falsch", "Email or password is wrong.");
export const forbidden = (code: string, message: string) => new AppError(403, code, message);
export const notFound = (code: string, message: string) => new AppError(404, code, message);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError(409, code, message, details);
/**
 * Ein Kontingent ist kein Fehler des Aufrufers, sondern eine Grenze. Eigener Code, damit
 * die Oberflaeche sagen kann, **welcher** Wert erschoepft ist und was zu tun waere: etwa
 * dass die zehn Dokumentenplaetze eines Exponats belegt sind.
 */
export const kontingentErschoepft = (message: string, details?: Record<string, unknown>) =>
  new AppError(409, "kontingent-erschoepft", message, details);

/**
 * @param spaFallback Liefert ein unbekannter GET-Pfad die Anwendung aus? Nur wahr, wenn
 * ein gebautes Frontend vorliegt. Der 404-Handler bleibt trotzdem hier und nicht in
 * `routes/statisch.ts`: Fastify erlaubt genau einen je Instanz, und zwei Stellen, die ihn
 * setzen wollen, enden in "Not found handler already set".
 */
export function registerErrorHandler(app: FastifyInstance, spaFallback = false): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      request.log.info({ code: error.code, statusCode: error.statusCode }, error.message);
      void reply
        .code(error.statusCode)
        .send({ code: error.code, message: error.message, ...(error.details ?? {}) });
      return;
    }

    // Fastify meldet zu grosse Uploads und kaputtes JSON selbst, das bleibt so.
    const statusCode = error.statusCode ?? 500;
    if (statusCode < 500) {
      void reply
        .code(statusCode)
        .send({ code: error.code ?? "ungueltige-anfrage", message: error.message });
      return;
    }

    request.log.error(error);
    void reply.code(500).send({ code: "serverfehler", message: "Unexpected server error." });
  });

  app.setNotFoundHandler((request, reply) => {
    /*
     * Die API antwortet **niemals** mit HTML, auch nicht auf einen Tippfehler im Pfad: ein
     * Klient scheitert sonst an einem "<" statt an einer lesbaren Meldung. Deshalb greift
     * der Rueckfall nur bei einem GET ausserhalb von /api/ und /connector/, das HTML will.
     *
     * `/connector/` ist die oeffentliche Konnektor-API. Sie gibt es in Auftrag 1 noch
     * nicht, der Ausschluss steht trotzdem schon hier: sie wird von Axon gerufen, und eine
     * Maschine darf niemals eine Anwendung ausgeliefert bekommen.
     */
    const gehoertZurAnwendung =
      spaFallback &&
      request.method === "GET" &&
      !request.url.startsWith("/api/") &&
      !request.url.startsWith("/connector/") &&
      (request.headers.accept ?? "").includes("text/html");

    if (gehoertZurAnwendung) {
      void reply.header("cache-control", "no-cache").sendFile("index.html");
      return;
    }
    void reply.code(404).send({ code: "route-unbekannt", message: "Unknown route." });
  });
}
