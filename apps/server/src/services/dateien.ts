import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { dateien } from "../db/schema.js";
import type { Dateiablage } from "../ablage/dateien.js";
import { notFound } from "../errors.js";
import { mimeAusName } from "./mime.js";

export interface DateiMeta {
  readonly id: string;
  readonly mimeType: string;
  readonly groesse: number;
  readonly originalName: string;
  readonly sha256: string;
  readonly angelegt: number;
}

export async function speichereDatei(
  db: Db,
  ablage: Dateiablage,
  originalName: string,
  inhalt: Buffer,
): Promise<DateiMeta> {
  const { pfad, sha256, groesse } = await ablage.lege(inhalt);
  const reihe = {
    id: randomUUID(),
    pfad,
    // Aus der Endung, nicht aus dem Kopf des Browsers, siehe `mimeAusName`.
    mimeType: mimeAusName(originalName),
    groesse,
    originalName,
    sha256,
    angelegt: Date.now(),
  };
  db.insert(dateien).values(reihe).run();
  const { pfad: _pfad, ...meta } = reihe;
  return meta;
}

export function findeDatei(db: Db, id: string): typeof dateien.$inferSelect {
  const reihe = db.select().from(dateien).where(eq(dateien.id, id)).get();
  if (reihe === undefined) throw notFound("datei-unbekannt", "Unknown file.");
  return reihe;
}

/**
 * Loescht Datensatz und Datei, **in dieser Reihenfolge**.
 *
 * Erst die Datenbank, dann das Dateisystem. Andersherum bliebe bei einem Abbruch ein
 * Datensatz stehen, der auf nichts zeigt, und der faellt erst auf, wenn jemand ihn abruft.
 * Eine Datei ohne Datensatz belegt dagegen nur Platz und stoert niemanden.
 *
 * Fremdschluessel mit `set null` sorgen dafuer, dass ein Besucher sein Avatar verliert und
 * nicht seinen Datensatz. Haengt die Datei an einem Exponatdokument (dort ohne `set null`,
 * weil ein Dokument ohne Datei sinnlos waere), weist SQLite das Loeschen zurueck; die
 * Oberflaeche loescht in dem Fall das Dokument, nicht die Datei.
 */
export async function loescheDatei(db: Db, ablage: Dateiablage, id: string): Promise<void> {
  const reihe = findeDatei(db, id);
  db.delete(dateien).where(eq(dateien.id, id)).run();
  await ablage.loesche(reihe.pfad);
}

/**
 * Liest eine abgelegte Datei vollstaendig in den Speicher.
 *
 * **Gibt `null` statt zu werfen**, wenn sie auf der Platte fehlt: ein fehlendes Foto darf
 * nicht dazu fuehren, dass eine ganze Antwort mit 500 abbricht und der Besucher im Viewer
 * ueberhaupt nichts sieht. Wer die Unterscheidung braucht, prueft auf `null`.
 *
 * Nur fuer Dateien, die als Ganzes in eine Antwort gehen, also Bilder und Dokumente der
 * Konnektor-API. Zum Ausliefern an den Browser bleibt der Strom aus `ablage.lies` richtig.
 */
export async function leseInhalt(ablage: Dateiablage, pfad: string): Promise<Buffer | null> {
  try {
    const stuecke: Buffer[] = [];
    for await (const stueck of ablage.lies(pfad)) stuecke.push(stueck as Buffer);
    return Buffer.concat(stuecke);
  } catch {
    return null;
  }
}
