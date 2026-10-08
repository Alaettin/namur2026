import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { ServerEnv } from "../env.js";
import { nichtAngemeldet } from "./ergebnis.js";

/**
 * Basic-Authentifizierung fuer die Konnektor-API.
 *
 * Entscheidung vom 07.10.2026: Basic statt eines Schluessels im Pfad, wie ihn der AXON
 * Connector benutzt. Der funktioniert nachweislich, steht aber in Protokollen und
 * Browserverlaeufen. Axon 1.2 authentifiziert sich laut Wissensbank per Basic oder OAuth2
 * Client Credentials, eingetragen in `ExternalAuthServers`.
 *
 * Von Hand statt mit `@fastify/basic-auth`: es sind zwanzig Zeilen, und die Antwort muss
 * den `Result`-Koerper tragen, nicht die Form der Bibliothek.
 */

/**
 * Vergleicht zwei Zeichenketten in gleichbleibender Zeit.
 *
 * `timingSafeEqual` verlangt gleich lange Puffer und wirft sonst. Die Laenge allein
 * verraet wenig, der Inhalt aber viel: deshalb erst die Laenge pruefen und **trotzdem**
 * vergleichen, damit der Zeitbedarf nicht davon abhaengt, an welcher Stelle der erste
 * Unterschied steht.
 */
function gleich(a: string, b: string): boolean {
  const pufferA = Buffer.from(a, "utf8");
  const pufferB = Buffer.from(b, "utf8");
  if (pufferA.length !== pufferB.length) {
    // Gegen sich selbst vergleichen, damit auch dieser Zweig Zeit verbraucht.
    timingSafeEqual(pufferA, pufferA);
    return false;
  }
  return timingSafeEqual(pufferA, pufferB);
}

/**
 * Prueft den `Authorization`-Kopf. Wirft `ApiFehler` mit 401, wenn etwas nicht stimmt.
 *
 * Sind keine Zugangsdaten konfiguriert, ist die API **geschlossen**, nicht offen: eine
 * vergessene Umgebungsvariable darf nicht dazu fuehren, dass die Besucherdaten aller
 * Teilnehmer ohne Anmeldung abrufbar sind.
 */
export function pruefeBasic(req: FastifyRequest, env: ServerEnv): void {
  if (env.connectorBasic === null) throw nichtAngemeldet();

  const kopf = req.headers.authorization;
  if (typeof kopf !== "string" || !kopf.toLowerCase().startsWith("basic ")) {
    throw nichtAngemeldet();
  }

  const roh = Buffer.from(kopf.slice(6).trim(), "base64").toString("utf8");
  /*
   * Am **ersten** Doppelpunkt trennen, nicht an jedem: ein Passwort darf Doppelpunkte
   * enthalten, ein Benutzername laut RFC 7617 nicht.
   */
  const trenner = roh.indexOf(":");
  if (trenner < 0) throw nichtAngemeldet();

  const benutzer = roh.slice(0, trenner);
  const passwort = roh.slice(trenner + 1);

  /*
   * **Beide** Haelften werden immer geprueft, ohne vorzeitigen Ausstieg. Ein `&&` wuerde
   * das Passwort nicht mehr vergleichen, sobald der Benutzername falsch ist, und der
   * Zeitunterschied verriete, wann der Benutzername stimmt.
   */
  const benutzerStimmt = gleich(benutzer, env.connectorBasic.user);
  const passwortStimmt = gleich(passwort, env.connectorBasic.passwort);
  if (!benutzerStimmt || !passwortStimmt) throw nichtAngemeldet();
}
