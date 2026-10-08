import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/**
 * Passwoerter mit argon2id.
 *
 * Die Parameter entsprechen der OWASP-Empfehlung fuer argon2id (19 MiB, 2 Durchgaenge).
 * Sie stehen hier ausgeschrieben, damit eine spaetere Aenderung der Bibliothek nicht still
 * die Haerte aendert.
 *
 * `algorithm: 2` ist `Algorithm.Argon2id`. Der Aufzaehlungstyp wird **nicht** importiert:
 * `@node-rs/argon2` deklariert ihn als `const enum`, und ein solcher laesst sich unter
 * `verbatimModuleSyntax` nicht einlesen (TS2748). Der Zahlwert steht in `index.d.ts` der
 * Bibliothek und ist zugleich deren Vorgabe; er wird trotzdem gesetzt, damit ein
 * Fassungswechsel die Wahl nicht unbemerkt verschiebt.
 *
 * Der Salzwert steckt im Ergebnis, es gibt kein zweites Feld in der Datenbank.
 */
const PARAMETER = {
  algorithm: 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashePasswort(klartext: string): Promise<string> {
  return hash(klartext, PARAMETER);
}

/**
 * Prueft ein Passwort gegen seinen Hash.
 *
 * Ein kaputter oder fremder Hash gibt `false` statt zu werfen: beim Pruefen ist jeder
 * Fehlschlag derselbe Fall, und eine Ausnahme wuerde hier als 500 herausgehen und damit
 * verraten, dass dieses Konto etwas Besonderes hat.
 */
export async function pruefePasswort(hashWert: string, klartext: string): Promise<boolean> {
  try {
    return await verify(hashWert, klartext, PARAMETER);
  } catch {
    return false;
  }
}

/**
 * Ein gueltiger Hash auf einen Zufallswert, den niemand kennt.
 *
 * Gebraucht beim Anmelden gegen eine **unbekannte** E-Mail: ohne Pruefung braeuchte dieser
 * Fall Mikrosekunden, mit Pruefung einige Dutzend Millisekunden, und der Unterschied ist
 * von aussen messbar. Er verriete, welche E-Mails hier ein Konto haben.
 *
 * Erzeugt statt eingetragen: ein von Hand hineingeschriebener Hash kann ungueltig sein,
 * `verify` braeche dann sofort am Zerlegen ab, die Zeiten waeren doch verschieden, und die
 * Massnahme saehe nur so aus, als wirkte sie. Einmal je Prozess, beim ersten Bedarf.
 */
let blindHash: Promise<string> | null = null;

export async function pruefeInsLeere(klartext: string): Promise<boolean> {
  blindHash ??= hashePasswort(randomBytes(32).toString("base64url"));
  return pruefePasswort(await blindHash, klartext);
}

/**
 * Ein Startpasswort, das genau einmal angezeigt wird.
 *
 * base64url aus 12 Zufallsbytes, also 16 Zeichen ohne `+`, `/` und `=`. Die drei fehlen
 * absichtlich: das Passwort wird vorgelesen, abgeschrieben und in Chats weitergegeben, und
 * genau dort gehen sie verloren.
 */
export function erzeugeStartpasswort(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * E-Mails werden klein geschrieben gespeichert und verglichen.
 *
 * Ohne das legt `Anna@firma.de` ein zweites Konto neben `anna@firma.de` an, und die
 * Eindeutigkeit der Spalte haelt genau nicht das, wofuer sie da ist. Der Vergleich muss
 * deshalb an **jeder** Stelle ueber diese Funktion laufen.
 */
export function normalisiereEmail(email: string): string {
  return email.trim().toLowerCase();
}
