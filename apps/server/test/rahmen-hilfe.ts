import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decode } from "jpeg-js";
import { PNG } from "pngjs";
import { PROJEKT_WURZEL } from "../src/env.js";
import { OVERLAY_DATEIEN, type Rang } from "../src/services/rahmen.js";

/**
 * Erkennt den Rahmen auf einem Bild **durch Vergleich mit den Overlays selbst**.
 *
 * Seit dem 20.10.2026 kommen die Rahmen aus den PNG-Vorlagen des Nutzers. Ein fester
 * Farbwert taugt nicht mehr als Kriterium: Gold traegt eine Krone, alle haben Verlaeufe.
 * Verglichen wird deshalb an Punkten, an denen **alle drei** Overlays fast deckend sind;
 * dort muss das Ergebnis dem Overlay seines Rangs gleichen, egal welches Foto darunter liegt.
 */

const ROH = new Map<Rang, PNG>();

export function overlay(rang: Rang): PNG {
  let png = ROH.get(rang);
  if (png === undefined) {
    png = PNG.sync.read(
      readFileSync(resolve(PROJEKT_WURZEL, "apps/server/assets/rahmen", OVERLAY_DATEIEN[rang])),
    );
    ROH.set(rang, png);
  }
  return png;
}

/** RGBA eines Bildes, PNG (gerahmt) oder JPEG (ungerahmt), an den Kennbytes erkannt. */
export function lies(bild: Buffer): { width: number; height: number; data: Uint8Array } {
  if (bild[0] === 0x89 && bild[1] === 0x50) {
    const png = PNG.sync.read(bild);
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
  }
  return decode(bild, { useTArray: true });
}

/** Punkte, an denen alle drei Overlays mindestens 245 von 255 Deckung haben. */
function deckendePunkte(): number[] {
  const g = overlay(1);
  const punkte: number[] = [];
  for (let i = 0; i < g.width * g.height; i += 97) {
    if ([1, 2, 3].every((r) => (overlay(r as Rang).data[i * 4 + 3] ?? 0) >= 245)) punkte.push(i);
  }
  return punkte;
}

/**
 * Mittlere Abweichung je Farbkanal vom Overlay des Rangs, an den deckenden Punkten.
 * Nur fuer Bilder in Overlaygroesse (512 px), so gross wie jeder Avatar.
 */
export function abweichung(datei: Buffer, rang: Rang): number {
  const bild = lies(datei);
  const o = overlay(rang);
  if (bild.width !== o.width || bild.height !== o.height) throw new Error("falsche Groesse");
  const punkte = deckendePunkte();
  let summe = 0;
  for (const i of punkte) {
    for (let k = 0; k < 3; k++) {
      summe += Math.abs((bild.data[i * 4 + k] ?? 0) - (o.data[i * 4 + k] ?? 0));
    }
  }
  return summe / (punkte.length * 3);
}

/**
 * Welchen Rang ein Bild traegt, oder `null` fuer keinen.
 *
 * **Ein ungerahmtes Bild kommt irgendeinem Overlay am naechsten**, das sagt fuer sich nichts.
 * Deshalb die Schranke: nur wer nah genug dran ist, traegt wirklich einen Rahmen.
 */
export function rangVonBild(datei: Buffer): Rang | null {
  let bester: Rang = 1;
  let kleinste = Infinity;
  for (const rang of [1, 2, 3] as const) {
    const d = abweichung(datei, rang);
    if (d < kleinste) {
      kleinste = d;
      bester = rang;
    }
  }
  return kleinste < 15 ? bester : null;
}
