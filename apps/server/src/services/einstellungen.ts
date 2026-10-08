import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { einstellungen } from "../db/schema.js";

/**
 * Schalter, die im Betrieb umgelegt werden, aus der Tabelle `einstellungen`.
 *
 * **Nicht im localStorage wie der Entwicklermodus.** Der blendet nur Knoepfe ein, und die
 * Berechtigung dahinter prueft ohnehin der Server. Hier entscheidet der Wert selbst, ob
 * eine Anfrage durchkommt; ein Wert im Browser waere an dieser Stelle nur eine Behauptung.
 */

/** Ob die Konnektor-API eine Anmeldung verlangt. Vorgabe: **nein**, siehe unten. */
export const SCHLUESSEL_ANMELDUNG = "konnektor.anmeldungVerlangt";

/**
 * Liest einen Schalter. Fehlt der Schluessel, gilt `vorgabe`.
 *
 * Nur `"1"` zaehlt als an. Alles andere, auch ein verunglueckter Wert von Hand in der
 * Datenbank, faellt auf aus zurueck statt den Schalter zufaellig umzulegen.
 */
export function leseSchalter(db: Db, schluessel: string, vorgabe: boolean): boolean {
  const reihe = db
    .select({ wert: einstellungen.wert })
    .from(einstellungen)
    .where(eq(einstellungen.schluessel, schluessel))
    .get();
  if (reihe === undefined) return vorgabe;
  return reihe.wert === "1";
}

/** Setzt einen Schalter. Legt den Schluessel an, wenn es ihn noch nicht gibt. */
export function setzeSchalter(db: Db, schluessel: string, an: boolean): void {
  const wert = an ? "1" : "0";
  db.insert(einstellungen)
    .values({ schluessel, wert })
    .onConflictDoUpdate({
      target: einstellungen.schluessel,
      set: { wert, geaendert: Date.now() },
    })
    .run();
}

/**
 * Verlangt die Konnektor-API eine Anmeldung?
 *
 * **Vorgabe ist `false`, die Schnittstelle steht also offen.** Das ist eine ausdrueckliche
 * Entscheidung des Nutzers vom 08.10.2026 und kehrt die vom 07.10. um. Die Folge steht in
 * der Akte und in der Oberflaeche: ohne Anmeldung liefert `/connector/*` Namen,
 * Anschriften, E-Mail-Adressen und Fotos aller Teilnehmer an jeden Aufrufer, der die
 * Adresse kennt. Vor dem Rollout ist das bewusst zu setzen.
 */
export function anmeldungVerlangt(db: Db): boolean {
  return leseSchalter(db, SCHLUESSEL_ANMELDUNG, false);
}
