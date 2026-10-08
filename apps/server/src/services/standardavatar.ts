import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
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
 * **Eine Datei, viele Verweise.** `legeBesucherAn` traegt diese Id bei jedem neuen
 * Besucher ein, auch beim CSV-Import; `avatarFuer` ist zusaetzlich der Rueckfall, falls
 * `avatarDateiId` doch `null` ist. Beides fuehrt zum selben Bild.
 *
 * **Nachtrag 08.10.2026:** Hier stand, `avatarDateiId` bleibe `null`. Das stimmte bis zur
 * Entscheidung, jedem neuen Besucher den Standard ausdruecklich zuzuweisen. Fuer die
 * Auswahl am Tablet heisst das: "Standard" setzt **diese Id**, nicht `null`.
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

// --- Die Galerie zur Auswahl am Tablet ------------------------------------------------

/**
 * Wie viele Bilder in `apps/server/assets/avatare/` liegen.
 *
 * Fest eingetragen statt den Ordner zu lesen: gebuendelt liegt der Server in `dist/`, und
 * ein Verzeichnis zur Laufzeit zu durchsuchen macht die Zahl vom Ausrollen abhaengig. Eine
 * fehlende Datei faellt beim Start als Warnung auf, nicht als stille Luecke.
 */
const GALERIE_ANZAHL = 20;

/** Der Ordner mit den Bildern, am selben Anker wie der Standard-Avatar. */
const GALERIE_ORDNER = resolve(PROJEKT_WURZEL, "apps/server/assets/avatare");

/**
 * Die feste Id des n-ten Galeriebildes, nach dem Muster des Standard-Avatars.
 *
 * `…0a7a01` bis `…0a7a20`. Feste Ids, damit ein zweiter Start nichts doppelt anlegt und
 * ein gesetzter Avatar ein Ausrollen ueberlebt; wuerden sie gewuerfelt, zeigte jeder
 * Besucher nach dem naechsten Start ins Leere.
 */
export function galerieAvatarId(nummer: number): string {
  return `00000000-0000-4000-8000-0000000a7a${String(nummer).padStart(2, "0")}`;
}

/** Alle Ids der Galerie, in Anzeigereihenfolge. */
export function galerieIds(): string[] {
  return Array.from({ length: GALERIE_ANZAHL }, (_, i) => galerieAvatarId(i + 1));
}

/**
 * Legt die Galerie an, soweit sie fehlt. Wird beim Start aufgerufen.
 *
 * Dieselbe Haltung wie beim Standard-Avatar: vorhandene Zeilen bleiben unberuehrt, und
 * eine fehlende Bilddatei bricht den Start **nicht** ab. Ein Dienst, der wegen eines
 * Schmuckbildes nicht hochkommt, nimmt der Konferenz den Scan weg.
 */
export async function stelleGalerieSicher(
  db: Db,
  ablage: Dateiablage,
  warne: (text: string) => void,
): Promise<void> {
  for (let nummer = 1; nummer <= GALERIE_ANZAHL; nummer++) {
    const id = galerieAvatarId(nummer);
    const vorhanden = db.select({ id: dateien.id }).from(dateien).where(eq(dateien.id, id)).get();
    if (vorhanden !== undefined) continue;

    const name = `avatar-${String(nummer).padStart(2, "0")}.jpg`;
    let inhalt: Buffer;
    try {
      inhalt = await readFile(resolve(GALERIE_ORDNER, name));
    } catch {
      warne(`Avatarbild fehlt: ${name}. Es steht am Tablet nicht zur Auswahl.`);
      continue;
    }

    const { pfad, sha256, groesse } = await ablage.lege(inhalt);
    db.insert(dateien)
      .values({
        id,
        pfad,
        mimeType: "image/jpeg",
        groesse,
        originalName: name,
        sha256,
        angelegt: Date.now(),
      })
      .run();
  }
}

/**
 * Die Galerie, wie sie das Tablet braucht: nur die Ids, die es wirklich gibt.
 *
 * Gefiltert gegen den Bestand, nicht nur gerechnet: fehlte ein Bild beim Start, zeigte die
 * Auswahl sonst eine Kachel, die beim Anklicken ins Leere liefe.
 */
export function leseGalerie(db: Db): string[] {
  const vorhanden = new Set(
    db
      .select({ id: dateien.id })
      .from(dateien)
      .where(inArray(dateien.id, galerieIds()))
      .all()
      .map((d) => d.id),
  );
  return galerieIds().filter((id) => vorhanden.has(id));
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
