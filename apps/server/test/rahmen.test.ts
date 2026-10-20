import { encode } from "jpeg-js";
import type * as Fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zeichneRahmen } from "../src/services/rahmen.js";
import { abweichung, lies, overlay, rangVonBild } from "./rahmen-hilfe.js";

/**
 * Der Siegerrahmen auf dem Avatarbild, seit dem 20.10.2026 aus den Overlays des Nutzers
 * (`assets/rahmen/{gold,silber,bronze}.png`), als PNG: ausserhalb der Rahmenlinie
 * durchsichtig, innen das Foto.
 */

/** Ein einfarbiges JPEG, an dem sich jede Veraenderung ablesen laesst. */
function testbild(kante: number, r: number, g: number, b: number): Buffer {
  const data = new Uint8Array(kante * kante * 4);
  for (let i = 0; i < kante * kante; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return Buffer.from(encode({ data, width: kante, height: kante }, 100).data);
}

/** RGBA an einem Punkt. */
function punkt(datei: Buffer, x: number, y: number): number[] {
  const bild = lies(datei);
  const i = (y * bild.width + x) * 4;
  return [bild.data[i] ?? 0, bild.data[i + 1] ?? 0, bild.data[i + 2] ?? 0, bild.data[i + 3] ?? 0];
}

/** Groesste Abweichung von einer Erwartung, ueber die Kanaele, die sie nennt. */
function weg(p: number[], soll: number[]): number {
  return Math.max(...soll.map((v, k) => Math.abs((p[k] ?? 0) - v)));
}

/** Rahmen fuer ein 512-px-Foto in Blau, das sonst nirgends vorkommt. */
function gerahmt(rang: 1 | 2 | 3): { inhalt: Buffer; mimeType: string } {
  const ergebnis = zeichneRahmen(testbild(512, 30, 140, 220), rang);
  if (ergebnis === null) throw new Error("kein Rahmen");
  return ergebnis;
}

/**
 * Ob ein Punkt samt Umgebung (8 px) im Overlay voll durchsichtig ist. Direkt neben der
 * Rahmenkante verschmiert die JPEG-Kodierung des Fotos die Farben; das ist kein Uebermalen.
 */
function frei(o: Uint8Array, i: number): boolean {
  const x = i % 512;
  const y = Math.floor(i / 512);
  for (let dy = -8; dy <= 8; dy++) {
    for (let dx = -8; dx <= 8; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= 512 || ny >= 512) continue;
      if ((o[(ny * 512 + nx) * 4 + 3] ?? 255) !== 0) return false;
    }
  }
  return true;
}

afterEach(() => {
  vi.doUnmock("node:fs");
  vi.resetModules();
});

describe("Siegerrahmen", () => {
  it("legt das Overlay des Rangs auf, auf hellem wie auf dunklem Foto", () => {
    for (const farbe of [250, 20]) {
      const original = testbild(512, farbe, farbe, farbe);
      for (const rang of [1, 2, 3] as const) {
        const ergebnis = zeichneRahmen(original, rang);
        expect(ergebnis).not.toBeNull();
        if (ergebnis === null) return;
        expect(ergebnis.mimeType).toBe("image/png");
        expect(ergebnis.inhalt.subarray(1, 4).toString("latin1")).toBe("PNG");
        const r = String(rang);
        expect(rangVonBild(ergebnis.inhalt), `Rang ${r} auf ${String(farbe)}`).toBe(rang);
      }
      // Ungerahmt erkennt die Hilfe keinen Rang; sonst bewiese das Obige nichts.
      expect(rangVonBild(original)).toBeNull();
    }
  });

  /**
   * **Innen, wo das Overlay durchsichtig ist, bleibt das Foto.** Geprueft an allen
   * durchsichtigen Punkten, die im Ergebnis deckend sind, also innen liegen; die Mindestzahl
   * stellt sicher, dass es diese Innenflaeche ueberhaupt gibt.
   */
  it("laesst das Foto innen unberuehrt", () => {
    for (const rang of [1, 2, 3] as const) {
      const nachher = lies(gerahmt(rang).inhalt).data;
      const o = overlay(rang).data;
      let geprueft = 0;
      let groessteAbweichung = 0;
      for (let i = 0; i < 512 * 512; i += 53) {
        if (!frei(o, i) || nachher[i * 4 + 3] !== 255) continue;
        geprueft++;
        groessteAbweichung = Math.max(
          groessteAbweichung,
          weg(
            [nachher[i * 4] ?? 0, nachher[i * 4 + 1] ?? 0, nachher[i * 4 + 2] ?? 0],
            [30, 140, 220],
          ),
        );
      }
      expect(geprueft, "zu wenig Foto innen").toBeGreaterThan(500);
      expect(groessteAbweichung, `Rang ${String(rang)}: Foto uebermalt`).toBeLessThan(8);
      // Und die Bildmitte im Besonderen, deckend.
      expect(weg(punkt(gerahmt(rang).inhalt, 256, 256), [30, 140, 220, 255])).toBeLessThan(8);
    }
  });

  /**
   * **Aussen ist durchsichtig.** Die Ecken ausserhalb der runden Rahmenlinie und der Streifen
   * ueber der Oberkante neben der Krone zeigen kein Foto mehr; das war die Rueckmeldung des
   * Nutzers am 20.10.2026.
   */
  it("macht den Bereich ausserhalb der Rahmenlinie durchsichtig", () => {
    for (const rang of [1, 2, 3] as const) {
      const inhalt = gerahmt(rang).inhalt;
      const ecken: [number, number][] = [
        [0, 0],
        [3, 3],
        [0, 511],
        [511, 511],
        [150, 4],
      ];
      for (const [x, y] of ecken) {
        const wo = `Rang ${String(rang)} bei ${String(x)},${String(y)}`;
        // Hoechstens ein Hauch Glanz aus dem Overlay, kein Foto.
        expect(punkt(inhalt, x, y)[3], wo).toBeLessThanOrEqual(8);
      }
      const daten = lies(inhalt).data;
      let durchsichtig = 0;
      for (let i = 3; i < daten.length; i += 4) if (daten[i] === 0) durchsichtig++;
      expect(durchsichtig, "kaum Aussenbereich").toBeGreaterThan(2000);
    }
  });

  /**
   * **Der Rahmen sitzt buendig.** Auf halber Hoehe bzw. Breite deckt er wenige Pixel nach
   * der Bildkante; vorher begann er 15 bis 30 px weiter innen. Oben liegt die Krone ueber
   * der Linie, dort darf es etwas mehr sein.
   */
  it("setzt die Rahmenlinie an die Bildkante", () => {
    for (const rang of [1, 2, 3] as const) {
      const bild = lies(gerahmt(rang).inhalt);
      const alpha = (x: number, y: number) => bild.data[(y * 512 + x) * 4 + 3] ?? 0;
      const strahl = (f: (i: number) => [number, number]) => {
        for (let i = 0; i < 60; i++) {
          const [x, y] = f(i);
          if (alpha(x, y) >= 200) return i;
        }
        return 99;
      };
      const r = String(rang);
      expect(
        strahl((i) => [i, 256]),
        `Rang ${r} links`,
      ).toBeLessThan(8);
      expect(
        strahl((i) => [511 - i, 256]),
        `Rang ${r} rechts`,
      ).toBeLessThan(8);
      expect(
        strahl((i) => [256, 511 - i]),
        `Rang ${r} unten`,
      ).toBeLessThan(8);
      expect(
        strahl((i) => [150, i]),
        `Rang ${r} oben`,
      ).toBeLessThan(24);
    }
  });

  /** Ein Bild in anderer Groesse bekommt das Overlay passend skaliert, nicht beschnitten. */
  it("skaliert das Overlay auf andere Bildgroessen", () => {
    const ergebnis = zeichneRahmen(testbild(200, 250, 250, 250), 1);
    expect(ergebnis).not.toBeNull();
    if (ergebnis === null) return;
    const bild = lies(ergebnis.inhalt);
    expect([bild.width, bild.height]).toEqual([200, 200]);
    // Mitte frei, Ecke durchsichtig, Rahmen dort, wo er im Overlay auch liegt.
    expect(weg(punkt(ergebnis.inhalt, 100, 100), [250, 250, 250, 255])).toBeLessThan(8);
    expect(punkt(ergebnis.inhalt, 0, 0)[3]).toBe(0);
    // In der linken Rahmenlinie auf halber Hoehe: deckend, und nicht mehr das weisse Foto.
    const o = overlay(1);
    let x512 = 0;
    while ((o.data[(256 * o.width + x512) * 4 + 3] ?? 0) < 250) x512++;
    const x200 = Math.round(((x512 + 4) * 200) / 512);
    const imRahmen = punkt(ergebnis.inhalt, x200, 100);
    expect(imRahmen[3]).toBe(255);
    expect(weg(imRahmen, [250, 250, 250]), "dort liegt noch Foto").toBeGreaterThan(40);
  });

  /** Ein kaputtes oder fremdes Format gibt `null`, statt den ganzen Abruf umzuwerfen. */
  it("gibt null statt zu werfen, wenn es kein JPEG ist", () => {
    expect(zeichneRahmen(Buffer.from("kein bild", "utf8"), 1)).toBeNull();
    expect(
      zeichneRahmen(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 2),
    ).toBeNull();
  });

  /** Fehlt ein Overlay im Container, geht das Bild ungerahmt hinaus statt mit einem Fehler. */
  it("gibt null, wenn das Overlay fehlt", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async (original) => {
      const echt = await original<typeof Fs>();
      return {
        ...echt,
        readFileSync: (pfad: string, ...rest: unknown[]) => {
          if (String(pfad).includes("rahmen")) throw new Error("ENOENT");
          return (echt.readFileSync as (...a: unknown[]) => unknown)(pfad, ...rest);
        },
      };
    });
    const frisch = await import("../src/services/rahmen.js");
    expect(frisch.zeichneRahmen(testbild(512, 250, 250, 250), 1)).toBeNull();
  });

  it("die Hilfe trennt die Raenge deutlich", () => {
    const gold = zeichneRahmen(testbild(512, 128, 128, 128), 1);
    expect(gold).not.toBeNull();
    if (gold === null) return;
    expect(abweichung(gold.inhalt, 1)).toBeLessThan(10);
    expect(abweichung(gold.inhalt, 2)).toBeGreaterThan(20);
    expect(abweichung(gold.inhalt, 3)).toBeGreaterThan(20);
  });
});
