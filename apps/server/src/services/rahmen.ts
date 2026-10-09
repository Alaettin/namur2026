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

/** So viele Punkte breit ist der weiche Uebergang vom Rahmen ins Foto. */
const UEBERGANG = 2;

/**
 * Das Profil ueber die Breite des Randes, von aussen (`t = 0`) nach innen (`t = 1`).
 *
 * **Darum sieht es nach Metall aus und nicht nach Farbe.** Eine Leiste faengt das Licht nicht
 * ueberall gleich: aussen liegt sie im Schatten, kurz dahinter ist der Grat am hellsten, zur
 * Innenkante faellt sie wieder ab. Ein konstanter Wert ergaebe dagegen genau den Anstrich,
 * den wir loswerden wollen.
 */
function profil(t: number): number {
  // Kurz hinter der Aussenkante der Grat, danach gleichmaessiger Abfall nach innen.
  const grat = Math.exp(-(((t - 0.32) / 0.26) ** 2));
  return 0.74 + 0.52 * grat - 0.16 * t;
}

/**
 * Der Lichtstreifen laengs des Rahmens, aus der Lage im Bild.
 *
 * Zwei Aufhellungen auf der Diagonale, eine kraeftige und eine schwaechere. Dadurch laeuft
 * das Licht ueber den Rahmen, statt an jeder Stelle gleich zu sein.
 */
function glanz(anteil: number): number {
  const breit = Math.exp(-(((anteil - 0.3) / 0.22) ** 2));
  const schmal = Math.exp(-(((anteil - 0.78) / 0.12) ** 2));
  return 1 + 0.3 * breit + 0.14 * schmal;
}

/** Haelt einen Farbwert in 0 bis 255. */
function begrenze(wert: number): number {
  return wert < 0 ? 0 : wert > 255 ? 255 : Math.round(wert);
}

/**
 * Zeichnet den Rand in das Bild und gibt es als JPEG zurueck.
 *
 * **Gibt `null` zurueck**, wenn die Datei kein lesbares JPEG ist. Dann geht das Bild
 * unveraendert hinaus; der Aufrufer protokolliert das. Zu werfen waere falsch: ein Besucher
 * ohne Rahmen ist besser als eine Antwort, die ganz ausfaellt.
 */
export function zeichneRahmen(jpeg: Buffer, rang: 1 | 2 | 3): Buffer | null {
  const farbe = RANGFARBEN[rang];
  let bild;
  try {
    bild = decode(jpeg, { useTArray: true });
  } catch {
    return null;
  }

  const { width: breite, height: hoehe, data } = bild;
  if (breite === 0 || hoehe === 0) return null;

  const rand = Math.max(3, Math.round(Math.min(breite, hoehe) * ANTEIL));

  for (let y = 0; y < hoehe; y++) {
    const randY = Math.min(y, hoehe - 1 - y);
    for (let x = 0; x < breite; x++) {
      /*
       * **Der Abstand zur naechstgelegenen Kante**, nicht zur oberen oder linken. Daraus
       * ergeben sich die Gehrungen in den Ecken von selbst; das zeilenweise Fuellen davor
       * hatte dort eine sichtbare Naht.
       */
      const tiefe = Math.min(randX(x, breite), randY);
      if (tiefe >= rand + UEBERGANG) {
        // Innen: bis zum rechten Rand ueberspringen, das ist der weitaus groesste Teil.
        x = breite - rand - UEBERGANG - 1;
        continue;
      }

      const i = (y * breite + x) * 4;
      const t = tiefe / rand;
      let faktor = profil(t) * glanz((x + y) / (breite + hoehe));

      // Zwei feine Linien fassen den Rahmen ein: aussen dunkel, innen hell.
      if (tiefe < 2) faktor *= 0.62;
      else if (tiefe >= rand - 2 && tiefe < rand) faktor *= 1.24;

      const r = begrenze(farbe.r * faktor);
      const g = begrenze(farbe.g * faktor);
      const b = begrenze(farbe.b * faktor);

      if (tiefe < rand) {
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
        continue;
      }

      /*
       * **Der weiche Uebergang ins Foto.** Ohne ihn steht die Innenkante hart und treppig im
       * Bild; zwei anteilig gemischte Punkte genuegen, damit sie sauber wirkt.
       */
      const anteil = 1 - (tiefe - rand + 1) / (UEBERGANG + 1);
      data[i] = begrenze((data[i] ?? 0) * (1 - anteil) + r * anteil);
      data[i + 1] = begrenze((data[i + 1] ?? 0) * (1 - anteil) + g * anteil);
      data[i + 2] = begrenze((data[i + 2] ?? 0) * (1 - anteil) + b * anteil);
    }
  }

  zeichneMedaille(data, breite, hoehe, farbe, rang);

  return Buffer.from(encode({ data, width: breite, height: hoehe }, GUETE).data);
}

/** Abstand zur linken oder rechten Kante, je nachdem welche naeher liegt. */
function randX(x: number, breite: number): number {
  return Math.min(x, breite - 1 - x);
}

/**
 * Ein Strich einer Ziffer, im Einheitsquadrat 0 bis 1 mit y nach unten.
 *
 * Zwei Formen reichen fuer 1, 2 und 3: Strecken und Kreisbogen. Daraus eine Ziffer zu bauen
 * ist deutlich weniger Aufwand, als eine Schrift mitzuliefern und zu rastern, und das
 * Ergebnis ist bei drei Zeichen genauso gut.
 */
type Strich =
  | { art: "linie"; x1: number; y1: number; x2: number; y2: number }
  | { art: "bogen"; cx: number; cy: number; r: number; von: number; bis: number };

/**
 * Die drei Ziffern.
 *
 * Winkel in Grad, 0 ist rechts und wachsende Werte drehen im Uhrzeigersinn, weil y nach unten
 * zeigt. 270 ist also oben.
 */
const ZIFFERN: Record<1 | 2 | 3, Strich[]> = {
  1: [
    { art: "linie", x1: 0.33, y1: 0.28, x2: 0.52, y2: 0.12 },
    { art: "linie", x1: 0.52, y1: 0.12, x2: 0.52, y2: 0.88 },
    { art: "linie", x1: 0.3, y1: 0.88, x2: 0.74, y2: 0.88 },
  ],
  2: [
    { art: "bogen", cx: 0.5, cy: 0.34, r: 0.23, von: 205, bis: 395 },
    { art: "linie", x1: 0.71, y1: 0.42, x2: 0.24, y2: 0.86 },
    { art: "linie", x1: 0.22, y1: 0.87, x2: 0.78, y2: 0.87 },
  ],
  3: [
    { art: "bogen", cx: 0.5, cy: 0.32, r: 0.21, von: 195, bis: 430 },
    { art: "bogen", cx: 0.5, cy: 0.68, r: 0.23, von: 290, bis: 520 },
  ],
};

/** Kuerzester Abstand eines Punktes zu einem Strich, im Einheitsquadrat. */
function abstand(px: number, py: number, strich: Strich): number {
  if (strich.art === "linie") {
    const dx = strich.x2 - strich.x1;
    const dy = strich.y2 - strich.y1;
    const laenge = dx * dx + dy * dy;
    const t =
      laenge === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - strich.x1) * dx + (py - strich.y1) * dy) / laenge));
    return Math.hypot(px - (strich.x1 + t * dx), py - (strich.y1 + t * dy));
  }

  const winkel = ((Math.atan2(py - strich.cy, px - strich.cx) * 180) / Math.PI + 360) % 360;
  /*
   * Der Bogen darf ueber 360 hinauslaufen, deshalb wird der Winkel des Punktes so weit
   * gedreht, bis er in das Fenster faellt. Liegt er ausserhalb, zaehlt der Abstand zum
   * naeheren Bogenende, sonst haette ein Bogen ueberall seinen vollen Kreis als Abstand.
   */
  const innerhalb =
    (winkel >= strich.von && winkel <= strich.bis) ||
    (winkel + 360 >= strich.von && winkel + 360 <= strich.bis);
  if (innerhalb) return Math.abs(Math.hypot(px - strich.cx, py - strich.cy) - strich.r);

  const ende = (grad: number) => ({
    x: strich.cx + strich.r * Math.cos((grad * Math.PI) / 180),
    y: strich.cy + strich.r * Math.sin((grad * Math.PI) / 180),
  });
  const a = ende(strich.von);
  const b = ende(strich.bis);
  return Math.min(Math.hypot(px - a.x, py - a.y), Math.hypot(px - b.x, py - b.y));
}

/** Wie gross die Medaille ist, als Anteil der kuerzeren Kante. */
const MEDAILLE = 0.3;

/**
 * Die Medaille mit der Platzziffer, unten rechts.
 *
 * **Warum ueberhaupt eine Ziffer:** die drei Rangfarben unterscheiden sich auf einem blassen
 * oder schraeg stehenden Messebildschirm weniger, als man denkt. Die Ziffer sagt den Platz
 * auch dann, wenn Gold und Bronze ineinanderlaufen.
 *
 * Gezeichnet wird mit weichen Kanten: der Deckungsgrad eines Punktes kommt aus seinem Abstand
 * zur Kante, nicht aus einem Ja oder Nein. Ohne das saehe ein Kreis bei 150 px wie eine Treppe
 * aus.
 */
function zeichneMedaille(
  data: Uint8Array | Buffer,
  breite: number,
  hoehe: number,
  farbe: Farbe,
  rang: 1 | 2 | 3,
): void {
  const r = (Math.min(breite, hoehe) * MEDAILLE) / 2;
  const cx = breite - r - Math.min(breite, hoehe) * 0.045;
  const cy = hoehe - r - Math.min(breite, hoehe) * 0.045;

  const striche = ZIFFERN[rang];
  // Die Ziffer sitzt mittig auf der Medaille und fuellt etwa zwei Drittel ihres Durchmessers.
  const zifferGroesse = r * 1.15;
  const strichbreite = r * 0.15;

  const vonX = Math.max(0, Math.floor(cx - r - 2));
  const bisX = Math.min(breite - 1, Math.ceil(cx + r + 2));
  const vonY = Math.max(0, Math.floor(cy - r - 2));
  const bisY = Math.min(hoehe - 1, Math.ceil(cy + r + 2));

  for (let y = vonY; y <= bisY; y++) {
    for (let x = vonX; x <= bisX; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const abstandMitte = Math.hypot(dx, dy);
      // Deckung der Scheibe, ueber einen Punkt weich auslaufend.
      const deckung = Math.max(0, Math.min(1, r - abstandMitte + 0.5));
      if (deckung <= 0) continue;

      /*
       * Die Scheibe ist oben links hell und unten rechts dunkel, wie eine gewoelbte Muenze
       * unter Licht von oben. Dazu aussen ein dunkler Saum, der sie vom Foto abhebt.
       */
      const woelbung = 1.18 - 0.42 * ((dx + dy) / (2 * r) + 0.5);
      const saum = abstandMitte > r - 2 ? 0.6 : abstandMitte > r - 4 ? 0.85 : 1;
      let faktor = woelbung * saum;

      // Die Ziffer: dunkel auf der hellen Scheibe, mit weicher Kante.
      const px = (x + 0.5 - (cx - zifferGroesse / 2)) / zifferGroesse;
      const py = (y + 0.5 - (cy - zifferGroesse / 2)) / zifferGroesse;
      let naechster = Infinity;
      for (const strich of striche) naechster = Math.min(naechster, abstand(px, py, strich));
      const zifferDeckung = Math.max(
        0,
        Math.min(1, (strichbreite / 2 - naechster * zifferGroesse) / 1.5 + 0.5),
      );
      if (zifferDeckung > 0) faktor = faktor * (1 - zifferDeckung) + 0.3 * zifferDeckung;

      const i = (y * breite + x) * 4;
      const r2 = begrenze(farbe.r * faktor);
      const g2 = begrenze(farbe.g * faktor);
      const b2 = begrenze(farbe.b * faktor);
      data[i] = begrenze((data[i] ?? 0) * (1 - deckung) + r2 * deckung);
      data[i + 1] = begrenze((data[i + 1] ?? 0) * (1 - deckung) + g2 * deckung);
      data[i + 2] = begrenze((data[i + 2] ?? 0) * (1 - deckung) + b2 * deckung);
      data[i + 3] = 255;
    }
  }
}
