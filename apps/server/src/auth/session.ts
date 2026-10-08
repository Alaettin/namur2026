import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServerEnv } from "../env.js";

/**
 * Sitzung als signiertes httpOnly-Cookie. Der Inhalt ist die Nutzerkennung plus
 * Ablaufzeitpunkt, die Signatur kommt von `@fastify/cookie` mit `SESSION_SECRET`.
 *
 * Rolle und Name stehen **nicht** im Cookie. Sie kaemen sonst aus einem Papier, das bis zu
 * zwoelf Stunden alt sein kann: ein zum Betreuer herabgestufter Admin behielte seine
 * Rechte bis zum Ablauf. Der Nutzer wird deshalb bei jeder Anfrage nachgeschlagen, siehe
 * `plugin.ts`.
 */

export const SESSION_COOKIE = "namur_hv_sitzung";

export interface SessionPayload {
  /** Die Id in `app_nutzer`. */
  readonly sub: string;
  /** Ablauf in Millisekunden seit 1970. */
  readonly exp: number;
}

/**
 * Setzt das Sitzungscookie.
 *
 * `secure` haengt an der **tatsaechlichen Verbindung**, nicht an `NODE_ENV`. Wird die
 * Kennzeichnung aus der Umgebung abgeleitet, verwirft der Browser das Cookie, sobald
 * jemand lokal einmal `NODE_ENV=production` setzt: die Anmeldung meldet Erfolg, die
 * naechste Anfrage ist nicht angemeldet, und der Fehler zeigt sich beim Lesen, obwohl er
 * beim Setzen liegt.
 *
 * Hinter dem Rand von Sliplane endet TLS vor dem Container. `req.protocol` wertet mit
 * `trustProxy` das `X-Forwarded-Proto` aus und meldet dort richtig `https`.
 */
export function issueSession(
  req: FastifyRequest,
  reply: FastifyReply,
  payload: SessionPayload,
  env: ServerEnv,
): void {
  const value = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  void reply.setCookie(SESSION_COOKIE, value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: req.protocol === "https",
    signed: true,
    maxAge: Math.floor(env.sessionTtlMs / 1000),
  });
}

/**
 * Loescht das Sitzungscookie.
 *
 * Pfad und Kennzeichnungen muessen zum Setzen passen, sonst schreibt der Browser ein
 * zweites Cookie, statt das vorhandene zu entfernen, und der Nutzer bleibt angemeldet.
 */
export function clearSession(req: FastifyRequest, reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: req.protocol === "https",
  });
}

export function readSession(req: FastifyRequest): SessionPayload | null {
  const raw = req.cookies[SESSION_COOKIE];
  if (raw === undefined) return null;

  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || unsigned.value === null) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(unsigned.value, "base64url").toString("utf8"),
    ) as Partial<SessionPayload>;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= Date.now()) return null;
    return { sub: payload.sub, exp: payload.exp };
  } catch {
    return null;
  }
}
