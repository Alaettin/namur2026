import { decode, encode } from "jpeg-js";
import { describe, expect, it } from "vitest";
import { RANGFARBEN, zeichneRahmen } from "../src/services/rahmen.js";

/**
 * Der Siegerrahmen auf dem Avatarbild.
 *
 * Geprueft wird beides: dass der Rand die Rangfarbe traegt **und** dass die Bildmitte
 * unberuehrt bleibt. Nur die Ecke zu pruefen ginge auch durch, wenn das ganze Bild uebermalt
 * waere, und dann waere vom Gesicht nichts mehr zu sehen.
 */

const KANTE = 128;

/** Ein einfarbiges JPEG, an dem sich jede Veraenderung ablesen laesst. */
function testbild(r: number, g: number, b: number): Buffer {
  const data = new Uint8Array(KANTE * KANTE * 4);
  for (let i = 0; i < KANTE * KANTE; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return Buffer.from(encode({ data, width: KANTE, height: KANTE }, 100).data);
}

/** Der Farbwert an einer Stelle, nach dem erneuten Kodieren. */
function punkt(jpeg: Buffer, x: number, y: number) {
  const bild = decode(jpeg, { useTArray: true });
  const i = (y * bild.width + x) * 4;
  return { r: bild.data[i] ?? 0, g: bild.data[i + 1] ?? 0, b: bild.data[i + 2] ?? 0 };
}

/**
 * Wie weit zwei Farben auseinanderliegen.
 *
 * **Kein exakter Vergleich:** JPEG ist verlustbehaftet, nach dem Kodieren steht an einer
 * Stelle nie genau der Wert, den man hineingeschrieben hat. Ein Schwellwert ist hier die
 * ehrliche Pruefung, kein Nachgeben.
 */
function abstand(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

describe("Siegerrahmen", () => {
  it("faerbt den Rand und laesst die Mitte in Ruhe", () => {
    const weiss = { r: 250, g: 250, b: 250 };
    const original = testbild(weiss.r, weiss.g, weiss.b);

    const gerahmt = zeichneRahmen(original, RANGFARBEN[1]);
    expect(gerahmt).not.toBeNull();
    if (gerahmt === null) return;

    // Dieselbe Kantenlaenge, es wird nichts beschnitten.
    const bild = decode(gerahmt, { useTArray: true });
    expect([bild.width, bild.height]).toEqual([KANTE, KANTE]);

    // Die Ecke traegt Gold.
    expect(abstand(punkt(gerahmt, 2, 2), RANGFARBEN[1]), "Ecke ohne Rahmenfarbe").toBeLessThan(40);
    // Und die Mitte ist noch das Bild.
    expect(abstand(punkt(gerahmt, KANTE / 2, KANTE / 2), weiss), "Mitte uebermalt").toBeLessThan(
      40,
    );
  });

  it("nimmt fuer jeden Rang eine andere Farbe", () => {
    const original = testbild(250, 250, 250);
    const ecken = ([1, 2, 3] as const).map((rang) => {
      const gerahmt = zeichneRahmen(original, RANGFARBEN[rang]);
      expect(gerahmt).not.toBeNull();
      return punkt(gerahmt ?? Buffer.alloc(0), 2, 2);
    });

    expect(abstand(ecken[0] ?? { r: 0, g: 0, b: 0 }, ecken[1] ?? { r: 0, g: 0, b: 0 })).toBeGreaterThan(
      40,
    );
    expect(abstand(ecken[1] ?? { r: 0, g: 0, b: 0 }, ecken[2] ?? { r: 0, g: 0, b: 0 })).toBeGreaterThan(
      40,
    );
  });

  /** Ein kaputtes oder fremdes Format gibt `null`, statt den ganzen Abruf umzuwerfen. */
  it("gibt null statt zu werfen, wenn es kein JPEG ist", () => {
    expect(zeichneRahmen(Buffer.from("kein bild", "utf8"), RANGFARBEN[1])).toBeNull();
    // PNG-Kennbytes, sonst nichts.
    expect(
      zeichneRahmen(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), RANGFARBEN[2]),
    ).toBeNull();
  });
});
