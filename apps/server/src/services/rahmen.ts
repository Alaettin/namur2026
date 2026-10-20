import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decode } from "jpeg-js";
import { PNG } from "pngjs";
import { PROJEKT_WURZEL } from "../env.js";

/**
 * Der Siegerrahmen um ein Avatarbild.
 *
 * Die ersten drei der Carrera-Bestenliste bekommen ihr Bild mit einem Rahmen in Gold, Silber
 * oder Bronze. Gelegt wird **beim Abruf**, nicht beim Speichern: die Reihenfolge aendert sich
 * waehrend der Messe, und ein einmal gerahmtes Bild in der Ablage waere nach der naechsten
 * schnellen Runde falsch, ohne dass es jemand merkt.
 *
 * **Seit dem 20.10.2026 aus den Overlays des Nutzers** (`assets/rahmen/*.png`). Vorher wurde
 * ein Metallband samt Medaille mit Ziffer selbst gezeichnet. Die 1254-px-Vorlagen sind auf
 * die deckende Aussenkante des Rahmens (samt Krone) zugeschnitten und auf 512 px gebracht,
 * so gross wie jeder Avatar: in den Vorlagen begann der Rahmen erst 30 bis 66 px vom Rand,
 * und dort schaute das Foto heraus.
 *
 * **Ausgabe PNG, nicht JPEG.** Ausserhalb der Rahmenlinie (runde Ecken, neben der Krone) ist
 * das Bild durchsichtig, so hat es der Nutzer am 20.10.2026 entschieden; weiss gefuellt
 * passte es nur auf hellen Hintergrund. JPEG kennt keinen Alphakanal.
 *
 * **Reines JavaScript, kein natives Modul.** `jpeg-js` und `pngjs` werden mitgebuendelt; `sharp`
 * oder `canvas` muessten aus dem Buendel heraus und im Container uebersetzt werden.
 */

export type Rang = 1 | 2 | 3;

export const OVERLAY_DATEIEN: Record<Rang, string> = {
  1: "gold.png",
  2: "silber.png",
  3: "bronze.png",
};

interface Overlay {
  breite: number;
  hoehe: number;
  /** RGBA, Zeile fuer Zeile. */
  daten: Uint8Array;
  /** 1, wo der Punkt ausserhalb der Rahmenlinie liegt; siehe `aussenmaske`. */
  aussen: Uint8Array;
}

/** Ab welcher Deckung ein Overlaypunkt als Rahmen zaehlt und die Flutfuellung aufhaelt. */
const RAHMEN_AB = 128;

/**
 * Geladene und auf Groesse gebrachte Overlays, je Rang und Bildgroesse.
 *
 * Einmal gelesen, dann im Speicher: ein PNG je Abruf zu dekodieren kostete mehr als das ganze
 * Uebereinanderlegen. `null` merkt sich eine fehlende Datei, damit sie nicht bei jedem Abruf
 * erneut gesucht wird.
 */
const vorrat = new Map<string, Overlay | null>();

function lade(rang: Rang): Overlay | null {
  const schluessel = `${String(rang)}:roh`;
  if (vorrat.has(schluessel)) return vorrat.get(schluessel) ?? null;
  let ergebnis: Overlay | null = null;
  try {
    const png = PNG.sync.read(
      readFileSync(resolve(PROJEKT_WURZEL, "apps/server/assets/rahmen", OVERLAY_DATEIEN[rang])),
    );
    const daten = new Uint8Array(png.data);
    ergebnis = {
      breite: png.width,
      hoehe: png.height,
      daten,
      aussen: aussenmaske(daten, png.width, png.height),
    };
  } catch {
    // Fehlt das Overlay, geht das Bild ungerahmt hinaus; siehe `zeichneRahmen`.
  }
  vorrat.set(schluessel, ergebnis);
  return ergebnis;
}

/**
 * Welche Punkte ausserhalb der Rahmenlinie liegen: Flutfuellung vom Bildrand ueber alles,
 * was weniger als halb deckt. Die Bildflaeche innen ist ebenso durchsichtig, aber vom Rahmen
 * umschlossen, und wird deshalb nicht erreicht.
 */
function aussenmaske(daten: Uint8Array, breite: number, hoehe: number): Uint8Array {
  const aussen = new Uint8Array(breite * hoehe);
  const stapel: number[] = [];
  const nimm = (x: number, y: number) => {
    const i = y * breite + x;
    if (aussen[i] === 1 || (daten[i * 4 + 3] ?? 0) >= RAHMEN_AB) return;
    aussen[i] = 1;
    stapel.push(i);
  };
  for (let x = 0; x < breite; x++) {
    nimm(x, 0);
    nimm(x, hoehe - 1);
  }
  for (let y = 0; y < hoehe; y++) {
    nimm(0, y);
    nimm(breite - 1, y);
  }
  for (let i = stapel.pop(); i !== undefined; i = stapel.pop()) {
    const x = i % breite;
    const y = (i - x) / breite;
    if (x > 0) nimm(x - 1, y);
    if (x < breite - 1) nimm(x + 1, y);
    if (y > 0) nimm(x, y - 1);
    if (y < hoehe - 1) nimm(x, y + 1);
  }
  return aussen;
}

/** Das Overlay in der Groesse des Bildes, bilinear skaliert, falls noetig. */
function inGroesse(rang: Rang, breite: number, hoehe: number): Overlay | null {
  const roh = lade(rang);
  if (roh === null) return null;
  if (roh.breite === breite && roh.hoehe === hoehe) return roh;

  const schluessel = `${String(rang)}:${String(breite)}x${String(hoehe)}`;
  const fertig = vorrat.get(schluessel);
  if (fertig !== undefined) return fertig;

  const daten = new Uint8Array(breite * hoehe * 4);
  const sx = roh.breite / breite;
  const sy = roh.hoehe / hoehe;
  for (let y = 0; y < hoehe; y++) {
    const qy = Math.min(roh.hoehe - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(qy);
    const y1 = Math.min(roh.hoehe - 1, y0 + 1);
    const fy = qy - y0;
    for (let x = 0; x < breite; x++) {
      const qx = Math.min(roh.breite - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(qx);
      const x1 = Math.min(roh.breite - 1, x0 + 1);
      const fx = qx - x0;
      for (let k = 0; k < 4; k++) {
        const a = roh.daten[(y0 * roh.breite + x0) * 4 + k] ?? 0;
        const b = roh.daten[(y0 * roh.breite + x1) * 4 + k] ?? 0;
        const c = roh.daten[(y1 * roh.breite + x0) * 4 + k] ?? 0;
        const d = roh.daten[(y1 * roh.breite + x1) * 4 + k] ?? 0;
        daten[(y * breite + x) * 4 + k] = Math.round(
          (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy,
        );
      }
    }
  }
  const ergebnis = { breite, hoehe, daten, aussen: aussenmaske(daten, breite, hoehe) };
  vorrat.set(schluessel, ergebnis);
  return ergebnis;
}

/**
 * Legt das Overlay des Rangs auf das Bild und gibt es als PNG zurueck.
 *
 * **Gibt `null` zurueck**, wenn die Datei kein lesbares JPEG ist oder das Overlay fehlt. Dann
 * geht das Bild unveraendert hinaus. Zu werfen waere falsch: ein Besucher ohne Rahmen ist
 * besser als eine Antwort, die ganz ausfaellt.
 *
 * Innen liegt das Overlay ueber dem Foto, durch seine durchsichtigen Stellen sieht man es.
 * Aussen bleibt nur das Overlay selbst, mit seiner eigenen Deckung: die weiche Kante der
 * Rahmenlinie und sonst nichts.
 */
export function zeichneRahmen(
  jpeg: Buffer,
  rang: Rang,
): { inhalt: Buffer; mimeType: "image/png" } | null {
  let bild;
  try {
    bild = decode(jpeg, { useTArray: true });
  } catch {
    return null;
  }
  const { width: breite, height: hoehe, data } = bild;
  if (breite === 0 || hoehe === 0) return null;

  const overlay = inGroesse(rang, breite, hoehe);
  if (overlay === null) return null;

  const o = overlay.daten;
  for (let i = 0; i < data.length; i += 4) {
    if (overlay.aussen[i / 4] === 1) {
      data[i] = o[i] ?? 0;
      data[i + 1] = o[i + 1] ?? 0;
      data[i + 2] = o[i + 2] ?? 0;
      data[i + 3] = o[i + 3] ?? 0;
      continue;
    }
    const alpha = (o[i + 3] ?? 0) / 255;
    data[i] = Math.round((data[i] ?? 0) * (1 - alpha) + (o[i] ?? 0) * alpha);
    data[i + 1] = Math.round((data[i + 1] ?? 0) * (1 - alpha) + (o[i + 1] ?? 0) * alpha);
    data[i + 2] = Math.round((data[i + 2] ?? 0) * (1 - alpha) + (o[i + 2] ?? 0) * alpha);
    data[i + 3] = 255;
  }

  const png = new PNG({ width: breite, height: hoehe });
  png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return { inhalt: PNG.sync.write(png), mimeType: "image/png" };
}
