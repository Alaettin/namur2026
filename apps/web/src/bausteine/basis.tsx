import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useEffect, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/** Klassen zusammenfuehren, spaetere Tailwind-Klassen gewinnen. */
export function cn(...werte: ClassValue[]): string {
  return twMerge(clsx(werte));
}

/**
 * Die Bauteile nach den Design-Werten.
 *
 * Flaechen, Tabellen und Eingabefelder haben **0 px Radius**; rund sind nur Knoepfe,
 * Segment-Umschalter und die Seitenumschaltung. Das ist die auffaelligste Eigenheit des
 * Entwurfs und steht deshalb hier an einer Stelle, nicht in jeder Seite neu.
 */

export type KnopfArt = "primaer" | "rand" | "still" | "gefahr";

const KNOPF: Record<KnopfArt, string> = {
  primaer: "bg-primaer text-white hover:bg-primaer-dunkel",
  rand: "border border-text text-text hover:bg-black/5",
  still: "text-text-hinweis hover:text-text hover:bg-black/5",
  gefahr: "bg-fehler text-white hover:brightness-110",
};

/**
 * Das Aussehen eines Knopfes, auch fuer Elemente, die kein `<button>` sein koennen.
 *
 * Gebraucht fuer das `<label>` um einen Datei-Auswaehler: neben ein sichtbares
 * `<input type="file">` setzt der Browser seinen eigenen Text ("Keine Datei ausgewaehlt"),
 * und der laesst sich mit CSS nicht erreichen. Das Feld wird deshalb `sr-only` und das
 * Label traegt das Aussehen.
 */
export function knopfKlassen(art: KnopfArt = "primaer", className?: string): string {
  return cn(
    "inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-semibold",
    "transition-colors disabled:cursor-not-allowed disabled:opacity-45",
    KNOPF[art],
    className,
  );
}

export function Knopf({
  art = "primaer",
  className,
  // **Immer ein type.** Ohne ist ein <button> im Formular ein Absendeknopf, und Enter
  // loest den ersten aus, meist "Abbrechen".
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { art?: KnopfArt }) {
  return <button type={type} className={knopfKlassen(art, className)} {...rest} />;
}

export function Feld({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        // rounded-none ist Absicht, siehe oben.
        "h-11 w-full rounded-none border border-linie-feld bg-flaeche px-3 text-[15px] text-text",
        "placeholder:text-text-hinweis",
        className,
      )}
      {...rest}
    />
  );
}

export function Flaeche({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("bg-flaeche shadow-flaeche", className)}>{children}</div>;
}

/**
 * Eine Flaeche mit einer Tabelle, die breiter sein darf als der Bildschirm.
 *
 * Ein eigener Baustein, damit `overflow-x-auto` nicht an vier Stellen von Hand steht und
 * an einer davon vergessen wird. Die Tabellen tragen eine Mindestbreite; ohne den Ueberlauf
 * hier wuerde die ganze Seite waagerecht scrollen.
 *
 * **Gemessen am 07.10.2026 bei 390 px:** der Container ist 358 px breit, seine
 * `scrollWidth` 800, und `body.scrollWidth` bleibt bei 390. Der Ueberlauf greift also, und
 * weder `min-w-0` noch `max-w-full` sind dafuer noetig. Beide standen hier kurzzeitig drin,
 * weil die Abnahme einen Ueberstand meldete; die Ursache lag aber im Pruefkriterium, nicht
 * im Aufbau, siehe `e2e/verwaltung.spec.ts`.
 */
export function Tabellenflaeche({ children }: { children: ReactNode }) {
  /*
   * **Der Ueberlauf erst ab `sm`.** Unter `sm` ist die Tabelle keine Tabelle mehr, sondern
   * eine Liste von Karten (siehe `Reihe`), und dort gibt es nichts, was seitlich
   * herausragt. Bliebe `overflow-x-auto` auch dort stehen, versteckte es wieder genau die
   * Spalte mit den Knoepfen.
   */
  return <div className="bg-flaeche shadow-flaeche sm:overflow-x-auto">{children}</div>;
}

export function Ueberschrift({ children }: { children: ReactNode }) {
  return <h1 className="text-4xl leading-tight font-bold tracking-[-0.02em]">{children}</h1>;
}

/**
 * Tabellenkopf: 11 px, Versalien, 0,08 em Sperrung.
 *
 * **Traegt eine Spalte hier eine Breite, gehoert sie in die `sm:`-Variante.** Eine Breite
 * ohne Variante wirkt auch in der Kartenansicht und quetscht sie, und gegen eine
 * `sm:`-Regel setzt sie sich ohnehin nicht durch.
 */
export function Kopfzelle({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-4 py-3.5 text-left text-[11px] font-semibold tracking-[0.08em] text-text-hinweis uppercase",
        className,
      )}
    >
      {children}
    </th>
  );
}

/**
 * Eine Zeile der Tabelle, ab `sm`. Darunter eine Karte.
 *
 * Eine Tabelle mit fuenf Spalten passt bei 390 px nicht, und was seitlich herausragt,
 * findet niemand. Statt fuenf Seiten zweimal zu schreiben, schaltet die Darstellung hier
 * um: aus `table-row` wird ein Block mit Abstand und Trennlinie.
 */
export function Reihe({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <tr className={cn("max-sm:block max-sm:border-t max-sm:border-linie max-sm:py-2", className)}>
      {children}
    </tr>
  );
}

/**
 * Eine Zelle. `titel` ist die Beschriftung, die **nur in der Kartenansicht** erscheint.
 *
 * Ab `sm` steht sie im Tabellenkopf und waere hier doppelt; darunter gibt es keinen Kopf
 * mehr, und ein Wert ohne Beschriftung ist dann nicht mehr zuzuordnen. Zellen, die fuer
 * sich sprechen (ein Name, eine Knopfreihe), lassen `titel` weg.
 */
export function Zelle({
  children,
  className,
  titel,
}: {
  children?: ReactNode;
  className?: string;
  titel?: string;
}) {
  return (
    <td
      className={cn(
        "border-t border-linie px-4 py-3",
        "max-sm:flex max-sm:items-start max-sm:justify-between max-sm:gap-4 max-sm:border-t-0 max-sm:py-1.5",
        className,
      )}
    >
      {titel !== undefined && (
        <span
          aria-hidden="true"
          className="hidden shrink-0 pt-px text-[11px] font-semibold tracking-[0.08em] text-text-hinweis uppercase max-sm:block"
        >
          {titel}
        </span>
      )}
      {/*
        **`sm:contents` statt eines echten Elements.** Die Huelle braucht nur die
        Kartenansicht, damit der Wert als *ein* Flex-Kind neben der Beschriftung steht. Ab
        `sm` verschwindet sie aus dem Layout, und die Zelle sieht innen aus wie vorher;
        sonst saesse auf einmal ein Inline-Element um Knopfreihen und Bilder.
      */}
      <span
        className={cn(
          "min-w-0 sm:contents",
          // Mit Beschriftung steht der Wert rechts daneben; ohne nimmt er die Zeile ganz,
          // damit eine Knopfreihe ihre eigene Ausrichtung behaelt statt mittig zu kleben.
          titel !== undefined ? "max-sm:text-right" : "max-sm:w-full",
        )}
      >
        {children}
      </span>
    </td>
  );
}

/**
 * Mehrere Zahlen nebeneinander, Zahl gross und Bezeichnung klein darunter.
 *
 * Fuer die Inhalte eines Exponats. Vorher stand dort "2 Dokumente · 2 Links · 2 Kontakte"
 * in einer Zeile; die Zahlen gingen im Text unter, und am Telefon brach die Zeile um.
 *
 * `tabular-nums`, damit die Zahlen in untereinanderstehenden Zeilen auf derselben Breite
 * sitzen und die Spalte nicht zappelt.
 */
export function Zaehlerreihe({
  werte,
  className,
}: {
  werte: { zahl: number; text: string }[];
  className?: string;
}) {
  return (
    <span className={cn("flex flex-wrap items-start gap-x-5 gap-y-2", className)}>
      {werte.map((w) => (
        <span key={w.text} className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tabular-nums">{w.zahl}</span>
          <span className="text-[10px] font-semibold tracking-[0.08em] text-text-hinweis uppercase">
            {w.text}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Status-Markierung: eckig, 22 px hoch, mit Punkt. */
export function Markierung({
  text,
  farbe = "var(--color-primaer-dunkel)",
}: {
  text: string;
  farbe?: string;
}) {
  return (
    <span
      className="inline-flex h-[22px] items-center gap-1.5 px-2 text-[11px] font-bold tracking-wide text-white uppercase"
      style={{ background: farbe }}
    >
      <span aria-hidden="true">●</span>
      {text}
    </span>
  );
}

/**
 * Eine GUID oder Kennung: Monospace plus Kopierknopf **mit Rückmeldung**.
 *
 * Nach dem Kopieren wechselt das Symbol für 1,5 Sekunden auf einen Haken und daneben steht
 * „Kopiert". Ohne das sieht ein Klick genauso aus wie kein Klick, und man klickt noch
 * einmal, ohne zu wissen, ob es beim ersten Mal geklappt hat.
 *
 * **Die Rückmeldung erscheint nur bei Erfolg.** `navigator.clipboard` fehlt ohne HTTPS und
 * in älteren Browsern; dort steht stattdessen der Hinweis, den Wert zu markieren. Ein
 * Haken, der auch bei Misserfolg kommt, ist schlimmer als gar keiner.
 */
export function Monowert({ wert, kurz }: { wert: string; kurz?: boolean }) {
  const anzeige = kurz === true && wert.length > 14 ? `${wert.slice(0, 11)}…` : wert;
  const [stand, setzeStand] = useState<"ruht" | "kopiert" | "geht-nicht">("ruht");

  useEffect(() => {
    if (stand === "ruht") return;
    const t = setTimeout(() => {
      setzeStand("ruht");
    }, 1500);
    return () => {
      clearTimeout(t);
    };
  }, [stand]);

  return (
    <span className="inline-flex items-center gap-1">
      <code title={wert} className="font-mono text-xs">
        {anzeige}
      </code>
      <button
        type="button"
        aria-label="In die Zwischenablage kopieren"
        className="flex size-8 items-center justify-center text-text-hinweis hover:text-text"
        onClick={() => {
          const schreiben = navigator.clipboard?.writeText(wert);
          if (schreiben === undefined) {
            setzeStand("geht-nicht");
            return;
          }
          void schreiben
            .then(() => {
              setzeStand("kopiert");
            })
            .catch(() => {
              setzeStand("geht-nicht");
            });
        }}
      >
        {stand === "kopiert" ? (
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : (
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>

      {/* `role="status"` meldet den Wechsel auch Bildschirmlesern, ohne den Fokus zu nehmen. */}
      <span role="status" className="text-xs font-semibold">
        {stand === "kopiert" && <span className="text-primaer-dunkel">Kopiert</span>}
        {stand === "geht-nicht" && (
          <span className="text-fehler">Kopieren geht hier nicht, bitte markieren</span>
        )}
      </span>
    </span>
  );
}

/** Hinweisfläche für Fehler, wie im Entwurf der Anmeldung. */
export function Fehlerhinweis({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2.5 bg-fehler-grund px-3.5 py-3 text-sm font-medium text-text"
    >
      <span className="size-2 shrink-0 rounded-full bg-fehler" aria-hidden="true" />
      {children}
    </div>
  );
}

/**
 * Ladezustand und leerer Zustand.
 *
 * **Der leere Zustand erscheint erst nach dem Laden**, nicht waehrenddessen: sonst sieht
 * jeder Seitenaufruf kurz so aus, als gaebe es nichts.
 */
export function Zustand({
  laedt,
  fehler,
  leer,
  leerText,
  children,
}: {
  laedt: boolean;
  fehler: { message: string } | null;
  leer?: boolean;
  leerText?: string;
  children: ReactNode;
}) {
  if (laedt) return <p className="py-10 text-center text-sm text-text-hinweis">Wird geladen …</p>;
  if (fehler !== null) return <Fehlerhinweis>{fehler.message}</Fehlerhinweis>;
  if (leer === true) {
    return (
      <p className="py-10 text-center text-sm text-text-hinweis">
        {leerText ?? "Nichts vorhanden."}
      </p>
    );
  }
  return <>{children}</>;
}
