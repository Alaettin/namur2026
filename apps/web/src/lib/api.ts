import { useCallback, useEffect, useState } from "react";

/**
 * Zugriff auf die eigene API.
 *
 * Alles laeuft ueber die **eigene Herkunft**: im Entwicklungsbetrieb reicht Vite `/api`
 * an den Dienst durch, im Betrieb liefert der Dienst die Oberflaeche selbst aus. Deshalb
 * relative Adressen und `credentials: "same-origin"`; eine absolute Adresse auf denselben
 * Dienst unter anderem Port scheitert still an der eigenen CSP (`connect-src 'self'` gilt
 * fuer die Herkunft, nicht fuer den Dienst).
 */

export class ApiFehler extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiFehler";
  }
}

export async function api<T>(pfad: string, optionen: RequestInit = {}): Promise<T> {
  const antwort = await fetch(pfad, {
    credentials: "same-origin",
    ...optionen,
    headers: {
      ...(optionen.body !== undefined && !(optionen.body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...optionen.headers,
    },
  });

  if (antwort.status === 204) return undefined as T;

  const text = await antwort.text();
  const koerper = text === "" ? null : (JSON.parse(text) as unknown);

  if (!antwort.ok) {
    const o = (koerper ?? {}) as Record<string, unknown>;
    throw new ApiFehler(
      antwort.status,
      typeof o["code"] === "string" ? o["code"] : "unbekannt",
      typeof o["message"] === "string" ? o["message"] : `HTTP ${String(antwort.status)}`,
      o,
    );
  }
  return koerper as T;
}

export interface Abruf<T> {
  daten: T | null;
  laedt: boolean;
  fehler: ApiFehler | null;
  /** Noch einmal holen, etwa nach einer Aenderung. */
  neu: () => void;
}

/**
 * Laedt eine Adresse und haelt Ladezustand und Fehler.
 *
 * **Die geladenen Daten werden nicht in einen zweiten Zustand gespiegelt.** Wer sie in ein
 * Formular kopiert und danach beides pflegt, hat zwei Wahrheiten; abgeleitet wird, was
 * sich ableiten laesst.
 *
 * `laedt` startet auf `true`, damit der leere Zustand **erst nach** dem Laden erscheint und
 * nicht waehrenddessen aufblitzt.
 */
export function useAbruf<T>(pfad: string | null): Abruf<T> {
  const [daten, setzeDaten] = useState<T | null>(null);
  const [laedt, setzeLaedt] = useState(pfad !== null);
  const [fehler, setzeFehler] = useState<ApiFehler | null>(null);
  const [zaehler, setzeZaehler] = useState(0);

  useEffect(() => {
    if (pfad === null) {
      setzeDaten(null);
      setzeLaedt(false);
      return;
    }
    /*
     * Beim Wechsel des Pfades wird die alte Antwort verworfen. Ohne das gewinnt bei
     * schnellem Tippen in der Suche die **langsamere** Anfrage, und die Liste zeigt ein
     * Ergebnis, das nicht zur Eingabe passt.
     */
    let gilt = true;
    setzeLaedt(true);
    setzeFehler(null);

    api<T>(pfad)
      .then((ergebnis) => {
        if (gilt) setzeDaten(ergebnis);
      })
      .catch((ursache: unknown) => {
        if (!gilt) return;
        setzeFehler(
          ursache instanceof ApiFehler
            ? ursache
            : new ApiFehler(0, "netzwerk", "Keine Verbindung zum Dienst."),
        );
      })
      .finally(() => {
        if (gilt) setzeLaedt(false);
      });

    return () => {
      gilt = false;
    };
  }, [pfad, zaehler]);

  const neu = useCallback(() => {
    setzeZaehler((z) => z + 1);
  }, []);

  return { daten, laedt, fehler, neu };
}

/**
 * Liest einen Schalter aus dem localStorage.
 *
 * In try/catch, weil der Zugriff in einem privaten Fenster oder bei gesperrten Site-Daten
 * **wirft**, nicht nur leer zurueckkommt. Die Seite muss ohne ihn richtig funktionieren.
 */
export function leseSchalter(name: string): boolean {
  try {
    return window.localStorage.getItem(name) === "1";
  } catch {
    return false;
  }
}

export function setzeSchalter(name: string, an: boolean): void {
  try {
    if (an) window.localStorage.setItem(name, "1");
    else window.localStorage.removeItem(name);
  } catch {
    // Absichtlich still: der Schalter ist eine Bequemlichkeit, kein Zustand, auf dem
    // etwas beruht.
  }
}
