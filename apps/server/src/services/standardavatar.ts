import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import type { Dateiablage } from "../ablage/dateien.js";
import type { Db } from "../db/client.js";
import { dateien } from "../db/schema.js";
import { PROJEKT_WURZEL } from "../env.js";

/**
 * Der Avatar, den **jeder** Besucher bekommt, solange ihm keiner eigener zugewiesen ist.
 *
 * Entscheidung vom 08.10.2026: In der Besuchermaske wird nichts mehr hochgeladen. Vorher
 * konnte man je Besucher ein Foto setzen, und weil Entfernen und Ersetzen die Datei nur
 * abhingen statt sie zu loeschen, lagen 43 Waisen im Bestand.
 *
 * **Rueckfall statt Eintrag bei jedem Besucher.** `avatarDateiId` bleibt `null` und
 * `sammleWerte` faellt auf diese Id zurueck. So gibt es eine Datei und eine Zeile statt 759
 * gleicher Verweise, ein neuer Besucher braucht keinen Extraschritt, und die spaeter
 * geplante Funktion zum Aendern setzt einfach `avatarDateiId` je Besucher; `null` bedeutet
 * dann wieder "Standard".
 */

/**
 * Feste Id, damit der Rueckfall sie kennt, ohne zu suchen.
 *
 * Sie ist eine gueltige UUID, weil alle anderen Dateien `randomUUID` tragen und eine
 * Sonderform hier nur auffiele, ohne etwas zu nuetzen. Die fuehrenden Nullen machen sie von
 * Hand erkennbar.
 */
export const STANDARD_AVATAR_ID = "00000000-0000-4000-8000-000000000a7a";

/**
 * Der Ablageort im Repo, an der **Projektwurzel** verankert.
 *
 * Nicht ueber `import.meta.url` relativ zu dieser Datei: gebuendelt liegt alles in
 * `apps/server/dist/index.js`, also eine Ebene anders als `src/services/`, und derselbe
 * relative Pfad zeigte dann woanders hin. `PROJEKT_WURZEL` stimmt in beiden Faellen.
 */
const QUELLE = resolve(PROJEKT_WURZEL, "apps/server/assets/standard-avatar.jpg");

/**
 * Legt den Standard-Avatar an, falls er fehlt. Wird beim Start aufgerufen.
 *
 * Ist die Zeile da, geschieht **nichts**: ein zweiter Start darf weder eine zweite Datei
 * ablegen noch die bestehende ueberschreiben.
 *
 * Fehlt die Bilddatei im Repo, bricht der Start **nicht** ab. Der Avatar ist Beiwerk; ein
 * Dienst, der deswegen nicht hochkommt, nimmt der Konferenz die Scan-Funktion weg. Statt
 * dessen eine Warnung, und `sammleWerte` laesst den Avatar dann aus.
 */
export async function stelleStandardAvatarSicher(
  db: Db,
  ablage: Dateiablage,
  warne: (text: string) => void,
): Promise<void> {
  const vorhanden = db
    .select({ id: dateien.id })
    .from(dateien)
    .where(eq(dateien.id, STANDARD_AVATAR_ID))
    .get();
  if (vorhanden !== undefined) return;

  let inhalt: Buffer;
  try {
    inhalt = await readFile(QUELLE);
  } catch {
    warne(
      `Standard-Avatar nicht gefunden: ${QUELLE}. Besucher ohne eigenes Bild erscheinen im ` +
        "Viewer ohne Avatar.",
    );
    return;
  }

  const { pfad, sha256, groesse } = await ablage.lege(inhalt);
  db.insert(dateien)
    .values({
      id: STANDARD_AVATAR_ID,
      pfad,
      mimeType: "image/jpeg",
      groesse,
      originalName: "standard-avatar.jpg",
      sha256,
      angelegt: Date.now(),
    })
    .run();
}

/**
 * Die Datei, die fuer diesen Besucher gilt.
 *
 * Gibt `null`, wenn es weder einen eigenen noch den Standard gibt; dann faellt der Avatar
 * aus der Antwort, statt auf eine Id zu zeigen, die es nicht gibt.
 */
export function avatarFuer(db: Db, eigene: string | null): string | null {
  if (eigene !== null) return eigene;
  const standard = db
    .select({ id: dateien.id })
    .from(dateien)
    .where(eq(dateien.id, STANDARD_AVATAR_ID))
    .get();
  return standard?.id ?? null;
}
