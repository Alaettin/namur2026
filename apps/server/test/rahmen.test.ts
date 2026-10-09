import { decode, encode } from "jpeg-js";
import { describe, expect, it } from "vitest";
import { RANGFARBEN, zeichneRahmen } from "../src/services/rahmen.js";

/**
 * Der Siegerrahmen auf dem Avatarbild.
 *
 * Seit er nach Metall aussieht, ist er **nicht mehr einfarbig**: ein Profil ueber die Breite
 * und ein Lichtstreifen laengs machen ihn heller und dunkler. Ein Kriterium, das einen festen
 * Farbwert erwartet, waere deshalb falsch; gemeint war immer der **Farbton**, und genau der
 * wird hier geprueft.
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

interface Punkt {
  r: number;
  g: number;
  b: number;
}

function punkt(jpeg: Buffer, x: number, y: number): Punkt {
  const bild = decode(jpeg, { useTArray: true });
  const i = (y * bild.width + x) * 4;
  return { r: bild.data[i] ?? 0, g: bild.data[i + 1] ?? 0, b: bild.data[i + 2] ?? 0 };
}

function abstand(a: Punkt, b: Punkt): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/**
 * Welcher Rangfarbe ein Punkt am naechsten kommt, **unabhaengig von der Helligkeit**.
 *
 * Dafuer wird er auf dieselbe Summe gebracht wie die Vergleichsfarbe. Ohne diesen Schritt
 * wandert aufgehelltes Bronze rechnerisch zu Gold hinueber, und der Fall ginge aus dem
 * falschen Grund durch.
 */
function naechsterRang(p: Punkt): 1 | 2 | 3 {
  let bester: 1 | 2 | 3 = 1;
  let kleinster = Infinity;
  for (const rang of [1, 2, 3] as const) {
    const ziel = RANGFARBEN[rang];
    const summeZiel = ziel.r + ziel.g + ziel.b;
    const summeP = p.r + p.g + p.b || 1;
    const f = summeZiel / summeP;
    const d = abstand({ r: p.r * f, g: p.g * f, b: p.b * f }, ziel);
    if (d < kleinster) {
      kleinster = d;
      bester = rang;
    }
  }
  return bester;
}

/** Die Breite des Randes, wie `zeichneRahmen` sie rechnet. */
const RAND = Math.round(KANTE * 0.06);

describe("Siegerrahmen", () => {
  it("faerbt den Rand im Farbton des Rangs und laesst die Mitte in Ruhe", () => {
    const weiss = { r: 250, g: 250, b: 250 };
    const original = testbild(weiss.r, weiss.g, weiss.b);

    for (const rang of [1, 2, 3] as const) {
      const gerahmt = zeichneRahmen(original, rang);
      expect(gerahmt).not.toBeNull();
      if (gerahmt === null) return;

      // Dieselbe Kantenlaenge, es wird nichts beschnitten.
      const bild = decode(gerahmt, { useTArray: true });
      expect([bild.width, bild.height]).toEqual([KANTE, KANTE]);

      // Mitten im linken Rand, auf halber Hoehe: dort liegt keine Medaille.
      const imRand = punkt(gerahmt, Math.floor(RAND / 2), Math.floor(KANTE / 2));
      expect(naechsterRang(imRand), `Rang ${String(rang)} im falschen Farbton`).toBe(rang);

      // Und die Bildmitte ist noch das Bild.
      expect(
        abstand(punkt(gerahmt, KANTE / 2, KANTE / 2 - 10), weiss),
        "Mitte uebermalt",
      ).toBeLessThan(40);
    }
  });

  /**
   * **Der Rahmen ist nicht flach.**
   *
   * Das ist der ganze Unterschied zur alten Fassung: dort trug jeder Punkt des Randes
   * denselben Wert. Geprueft wird quer ueber die Breite, von der dunklen Aussenlinie bis zum
   * hellen Grat.
   */
  it("hat Tiefe statt einer einzigen Farbe", () => {
    const gerahmt = zeichneRahmen(testbild(250, 250, 250), 1);
    expect(gerahmt).not.toBeNull();
    if (gerahmt === null) return;

    const mitte = Math.floor(KANTE / 2);
    const aussen = punkt(gerahmt, 0, mitte);
    const grat = punkt(gerahmt, Math.floor(RAND * 0.4), mitte);

    expect(abstand(aussen, grat), "Rand ohne Verlauf").toBeGreaterThan(60);
    // Und zwar in der richtigen Richtung: aussen liegt im Schatten.
    expect(aussen.r + aussen.g + aussen.b).toBeLessThan(grat.r + grat.g + grat.b);
  });

  /**
   * **Die Medaille traegt die Platzziffer.**
   *
   * Geprueft wird nicht die Form der Ziffer, sondern dass auf der Scheibe ueberhaupt etwas
   * Dunkles steht: ohne Ziffer waere sie gleichmaessig hell, und genau das soll sie nicht
   * sein. Wie die Ziffern aussehen, entscheidet der Blick auf das Bild, nicht ein Testwert.
   */
  it("setzt eine Medaille mit Ziffer in die untere rechte Ecke", () => {
    const gerahmt = zeichneRahmen(testbild(250, 250, 250), 2);
    expect(gerahmt).not.toBeNull();
    if (gerahmt === null) return;

    const bild = decode(gerahmt, { useTArray: true });
    // Der Bereich der Medaille, grosszuegig abgesteckt.
    const von = Math.floor(KANTE * 0.68);
    let dunkelste = 255 * 3;
    let hellste = 0;
    for (let y = von; y < KANTE; y++) {
      for (let x = von; x < KANTE; x++) {
        const i = (y * bild.width + x) * 4;
        const summe = (bild.data[i] ?? 0) + (bild.data[i + 1] ?? 0) + (bild.data[i + 2] ?? 0);
        dunkelste = Math.min(dunkelste, summe);
        hellste = Math.max(hellste, summe);
      }
    }
    expect(hellste - dunkelste, "die Medaille ist gleichmaessig, also ohne Ziffer").toBeGreaterThan(
      120,
    );
  });

  /** Ein kaputtes oder fremdes Format gibt `null`, statt den ganzen Abruf umzuwerfen. */
  it("gibt null statt zu werfen, wenn es kein JPEG ist", () => {
    expect(zeichneRahmen(Buffer.from("kein bild", "utf8"), 1)).toBeNull();
    // PNG-Kennbytes, sonst nichts.
    expect(
      zeichneRahmen(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 2),
    ).toBeNull();
  });
});
