import { decode, encode } from "jpeg-js";

/**
 * Der Siegerrahmen um ein Avatarbild.
 *
 * Die ersten drei der Carrera-Bestenliste bekommen ihr Bild mit einem Rand in Gold, Silber
 * oder Bronze. Gezeichnet wird **beim Abruf**, nicht beim Speichern: die Reihenfolge aendert
 * sich waehrend der Messe, und ein einmal gerahmtes Bild in der Ablage waere nach der
 * naechsten schnellen Runde falsch, ohne dass es jemand merkt.
 *
 * **Reines JavaScript, kein natives Modul.** `sharp` und `canvas` muessten aus dem Buendel
 * heraus und im Container uebersetzt werden; dafuer ist ein Schmuckrahmen der falsche
 * Anlass. `jpeg-js` wird mitgebuendelt wie jede andere Abhaengigkeit.
 */

export interface Farbe {
  r: number;
  g: number;
  b: number;
}

/**
 * Gold, Silber, Bronze, nach Rang.
 *
 * **Dieselben drei Farben stehen in der Oberflaeche**, im Podest der Seite Carrera
 * (`apps/web/src/seiten/Carrera.tsx`). Ein gemeinsames Paket fuer drei Werte waere mehr
 * Geruest als Nutzen; wer hier etwas aendert, aendert es dort mit.
 */
export const RANGFARBEN: Record<1 | 2 | 3, Farbe> = {
  1: { r: 0xc9, g: 0xa2, b: 0x27 },
  2: { r: 0x9a, g: 0xa0, b: 0xa6 },
  3: { r: 0xb0, g: 0x6a, b: 0x3b },
};

/**
 * Wie breit der Rand ist, als Anteil der **kuerzeren** Kante.
 *
 * 6 % sind bei 512 px rund 31 px: deutlich genug, um auf einem Messebildschirm aufzufallen,
 * und schmal genug, dass vom Gesicht nichts verlorengeht.
 */
const ANTEIL = 0.06;

/** Guete beim erneuten Kodieren. Das Bild ist 512 px gross, mehr braucht es nicht. */
const GUETE = 85;

/**
 * Zeichnet den Rand in das Bild und gibt es als JPEG zurueck.
 *
 * **Gibt `null` zurueck**, wenn die Datei kein lesbares JPEG ist. Dann geht das Bild
 * unveraendert hinaus; der Aufrufer protokolliert das. Zu werfen waere falsch: ein Besucher
 * ohne Rahmen ist besser als eine Antwort, die ganz ausfaellt.
 */
export function zeichneRahmen(jpeg: Buffer, farbe: Farbe): Buffer | null {
  let bild;
  try {
    bild = decode(jpeg, { useTArray: true });
  } catch {
    return null;
  }

  const { width: breite, height: hoehe, data } = bild;
  if (breite === 0 || hoehe === 0) return null;

  const rand = Math.max(2, Math.round(Math.min(breite, hoehe) * ANTEIL));

  /*
   * Zeilenweise statt Punkt fuer Punkt ueber das ganze Bild: die Mitte wird gar nicht erst
   * angefasst, und das ist bei 512 px der weitaus groesste Teil.
   */
  for (let y = 0; y < hoehe; y++) {
    const imBand = y < rand || y >= hoehe - rand;
    for (let x = 0; x < breite; x++) {
      if (!imBand && x >= rand && x < breite - rand) {
        // Innen: ueberspringen, und zwar gleich bis zum rechten Rand.
        x = breite - rand - 1;
        continue;
      }
      const i = (y * breite + x) * 4;
      data[i] = farbe.r;
      data[i + 1] = farbe.g;
      data[i + 2] = farbe.b;
      data[i + 3] = 255;
    }
  }

  return Buffer.from(encode({ data, width: breite, height: hoehe }, GUETE).data);
}
