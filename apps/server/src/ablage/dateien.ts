import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { ReadStream } from "node:fs";

/**
 * Dateien auf dem Volume, Metadaten in der Datenbank.
 *
 * Der AXON Connector entscheidet je Datei zwischen Datenbank und Dateisystem, mit einer
 * Groessenschwelle. Hier gibt es die Schwelle nicht: der Bestand sind Datenblaetter und
 * Fotos, keine Tabellen mit tausenden Vorschaubildern, und eine Schwelle, die niemand
 * nachmisst, ist nur eine Fallunterscheidung mehr.
 */
export class Dateiablage {
  constructor(private readonly wurzel: string) {}

  /**
   * Legt den Inhalt ab und liefert den **relativen** Pfad samt Pruefsumme.
   *
   * Der Pfad wird aus einer frischen UUID gebildet, nicht aus dem Namen des Nutzers: ein
   * Originalname kann `../` enthalten, kann auf Windows reservierte Namen tragen (`CON`,
   * `PRN`) und ist nicht eindeutig. Der Originalname steht in der Datenbank, wo er nichts
   * anrichtet.
   *
   * Die beiden fuehrenden Zeichen der UUID werden zu einem Unterordner. Ein flaches
   * Verzeichnis mit einigen tausend Dateien ist auf keinem Dateisystem ein Problem, beim
   * Durchsehen von Hand aber unbrauchbar.
   */
  async lege(inhalt: Buffer): Promise<{ pfad: string; sha256: string; groesse: number }> {
    const id = randomUUID();
    const pfad = join(id.slice(0, 2), id);
    const ziel = this.absolut(pfad);
    await mkdir(dirname(ziel), { recursive: true });
    await writeFile(ziel, inhalt);
    return {
      pfad,
      sha256: createHash("sha256").update(inhalt).digest("hex"),
      groesse: inhalt.byteLength,
    };
  }

  /**
   * Oeffnet eine abgelegte Datei zum Ausliefern.
   *
   * Ein Strom statt `readFile`: eine 50-MB-Zeichnung muss nicht vollstaendig in den
   * Speicher, bevor das erste Byte den Server verlaesst.
   */
  lies(pfad: string): ReadStream {
    return createReadStream(this.absolut(pfad));
  }

  /**
   * Entfernt eine Datei. Fehlt sie bereits, ist das kein Fehler.
   *
   * Geloescht wird **nach** der Datenbanktransaktion. Andersherum bliebe bei einem Abbruch
   * ein Datensatz ohne Datei stehen, und der faellt erst beim Abrufen auf. Eine Datei ohne
   * Datensatz belegt dagegen nur Platz.
   */
  async loesche(pfad: string): Promise<void> {
    await rm(this.absolut(pfad), { force: true });
  }

  /**
   * Loest einen relativen Pfad gegen die Wurzel auf und prueft, dass er darin bleibt.
   *
   * Die Pfade stammen aus der eigenen Datenbank und sind damit vertrauenswuerdig. Die
   * Pruefung steht trotzdem hier: sie kostet nichts, und sie haelt, wenn spaeter einmal
   * ein Pfad aus einer Anfrage hierher findet.
   */
  private absolut(pfad: string): string {
    const voll = resolve(this.wurzel, pfad);
    const wurzel = resolve(this.wurzel);
    if (voll !== wurzel && !voll.startsWith(wurzel + sep)) {
      throw new Error(`Pfad liegt ausserhalb der Ablage: ${pfad}`);
    }
    return voll;
  }
}
