import { decode, encode } from "jpeg-js";
import type * as Fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zeichneRahmen } from "../src/services/rahmen.js";
import { abweichung, overlay, rangVonBild } from "./rahmen-hilfe.js";

/**
 * Der Siegerrahmen auf dem Avatarbild, seit dem 20.10.2026 aus den Overlays des Nutzers
 * (`assets/rahmen/{gold,silber,bronze}.png`).
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

function punkt(jpeg: Buffer, x: number, y: number): [number, number, number] {
  const bild = decode(jpeg, { useTArray: true });
  const i = (y * bild.width + x) * 4;
  return [bild.data[i] ?? 0, bild.data[i + 1] ?? 0, bild.data[i + 2] ?? 0];
}

/**
 * Ob ein Punkt samt Umgebung (8 px) im Overlay voll durchsichtig ist. Direkt neben der
 * Rahmenkante verschmiert die JPEG-Kodierung die Farben; das ist kein Uebermalen.
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
        const gerahmt = zeichneRahmen(original, rang);
        expect(gerahmt).not.toBeNull();
        if (gerahmt === null) return;
        expect(rangVonBild(gerahmt), `Rang ${String(rang)} auf ${String(farbe)}`).toBe(rang);
      }
      // Ungerahmt erkennt die Hilfe keinen Rang; sonst bewiese das Obige nichts.
      expect(rangVonBild(original)).toBeNull();
    }
  });

  /**
   * **Wo das Overlay durchsichtig ist, bleibt das Foto.** Gesucht werden die Punkte, an denen
   * alle drei Overlays voll transparent sind, also die Mitte und die Ecken.
   */
  it("laesst die durchsichtigen Stellen unberuehrt", () => {
    const original = testbild(512, 30, 140, 220);
    const vorher = decode(original, { useTArray: true }).data;
    for (const rang of [1, 2, 3] as const) {
      const gerahmt = zeichneRahmen(original, rang);
      expect(gerahmt).not.toBeNull();
      if (gerahmt === null) return;
      const nachher = decode(gerahmt, { useTArray: true }).data;
      const o = overlay(rang).data;
      let geprueft = 0;
      let groessteAbweichung = 0;
      for (let i = 0; i < 512 * 512; i += 53) {
        if (!frei(o, i)) continue;
        geprueft++;
        for (let k = 0; k < 3; k++) {
          const d = Math.abs((nachher[i * 4 + k] ?? 0) - (vorher[i * 4 + k] ?? 0));
          groessteAbweichung = Math.max(groessteAbweichung, d);
        }
      }
      expect(geprueft, "keine durchsichtigen Punkte gefunden").toBeGreaterThan(500);
      expect(groessteAbweichung, `Rang ${String(rang)}: Foto uebermalt`).toBeLessThan(8);
      // Und die Bildmitte im Besonderen.
      expect(
        Math.max(...punkt(gerahmt, 256, 256).map((v, k) => Math.abs(v - [30, 140, 220][k]!))),
      ).toBeLessThan(8);
    }
  });

  /** Ein Bild in anderer Groesse bekommt das Overlay passend skaliert, nicht beschnitten. */
  it("skaliert das Overlay auf andere Bildgroessen", () => {
    const gerahmt = zeichneRahmen(testbild(200, 250, 250, 250), 1);
    expect(gerahmt).not.toBeNull();
    if (gerahmt === null) return;
    const bild = decode(gerahmt, { useTArray: true });
    expect([bild.width, bild.height]).toEqual([200, 200]);
    // Mitte frei, linker Rand auf halber Hoehe golden (Overlay dort fast deckend).
    expect(Math.max(...punkt(gerahmt, 100, 100).map((v) => Math.abs(v - 250)))).toBeLessThan(8);
    const o = overlay(1);
    const oi = (256 * o.width + Math.round((10 / 200) * 512)) * 4;
    const erwartet = [o.data[oi] ?? 0, o.data[oi + 1] ?? 0, o.data[oi + 2] ?? 0];
    const ist = punkt(gerahmt, 10, 100);
    expect(Math.max(...ist.map((v, k) => Math.abs(v - erwartet[k]!)))).toBeLessThan(40);
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
    expect(abweichung(gold, 1)).toBeLessThan(10);
    expect(abweichung(gold, 2)).toBeGreaterThan(20);
    expect(abweichung(gold, 3)).toBeGreaterThan(20);
  });
});
