import { useEffect, useRef, useState } from "react";

/**
 * Die Zeitsperre des Selbstbedienungs-Tablets.
 *
 * **Warum es sie gibt.** Das Geraet steht unbeaufsichtigt im Publikum. Wer mitten im
 * Formular weggeht, laesst sonst seine Adressdaten offen auf dem Bildschirm stehen, und der
 * Naechste sieht sie. Nach 90 Sekunden ohne Eingabe geht es deshalb zurueck zum Scan.
 *
 * **Ungespeicherte Eingaben sind danach weg.** Das ist Absicht: etwas zwischenzuspeichern
 * hiesse, die Daten des Vorgaengers aufzuheben, und genau das soll nicht passieren.
 *
 * 15 Sekunden vorher erscheint ein Hinweis mit "Ich bin noch da". Ohne den waere der
 * Ruecksprung fuer jemanden, der gerade nachdenkt, ein unerklaerlicher Datenverlust.
 */

export const SPERRE_MS = 90_000;
export const WARNUNG_MS = 15_000;

/** Wie oft die verbleibende Zeit nachgerechnet wird. */
const TAKT_MS = 500;

export interface Zeitsperre {
  /** Sekunden bis zum Ruecksprung, aber nur solange die Warnung laeuft. */
  restSekunden: number | null;
  /** Setzt die Uhr zurueck. An jede Eingabe und jede Beruehrung gehaengt. */
  melden: () => void;
}

/**
 * `aufAblauf` wird genau einmal je Ablauf gerufen.
 *
 * Die Uhr laeuft ueber `Date.now()` und einen Takt, nicht ueber einen einzelnen
 * `setTimeout`: ein Tablet, das zwischendurch schlaeft, haelt Timer an, und der Ruecksprung
 * kaeme dann erst Minuten spaeter. Mit einem Zeitstempel ist die Frist beim Aufwachen
 * bereits abgelaufen und es springt sofort zurueck.
 */
export function useZeitsperre(aufAblauf: () => void): Zeitsperre {
  const [restSekunden, setzeRest] = useState<number | null>(null);
  const letzte = useRef(Date.now());
  const gefeuert = useRef(false);

  // Im Ref gehalten, damit der Takt nicht bei jedem Rendern neu aufgesetzt wird.
  const ablauf = useRef(aufAblauf);
  ablauf.current = aufAblauf;

  useEffect(() => {
    const uhr = setInterval(() => {
      const vergangen = Date.now() - letzte.current;
      const rest = SPERRE_MS - vergangen;

      if (rest <= 0) {
        // Nur einmal, auch wenn der Takt noch zweimal laeuft, bevor die Seite wechselt.
        if (!gefeuert.current) {
          gefeuert.current = true;
          ablauf.current();
        }
        return;
      }
      setzeRest(rest <= WARNUNG_MS ? Math.ceil(rest / 1000) : null);
    }, TAKT_MS);

    return () => {
      clearInterval(uhr);
    };
  }, []);

  return {
    restSekunden,
    melden: () => {
      letzte.current = Date.now();
      gefeuert.current = false;
      setzeRest(null);
    },
  };
}
