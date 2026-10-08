import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Knopf, cn } from "./basis.js";

/**
 * Die Seitenumschaltung, einmal für alle Listen.
 *
 * Sie stand bis zum 08.10.2026 vollständig in `Besucher.tsx`. Mit drei weiteren Listen wäre
 * sie dreimal abgeschrieben worden, und die Eigenheiten darin (das Fenster von fünf Seiten,
 * die Seite in der Adresse) hätten sich auseinanderentwickelt.
 */

/** Seitengröße der Listen, die **im Browser** blättern. */
export const JE_SEITE = 10;

/**
 * Liest die Seitennummer aus der Adresse und liefert einen Weg, sie zu setzen.
 *
 * In der Adresse und nicht im Zustand, damit ein Neuladen oder ein Lesezeichen auf derselben
 * Seite landet. Ungültiges fällt auf 1 zurück, statt eine leere Liste zu zeigen.
 */
export function useSeite(): [number, (nummer: number) => void] {
  const [parameter, setzeParameter] = useSearchParams();
  const roh = Number(parameter.get("seite") ?? "1");
  const seite = Number.isInteger(roh) && roh >= 1 ? roh : 1;

  return [
    seite,
    (nummer: number) => {
      const neu = new URLSearchParams(parameter);
      if (nummer <= 1) neu.delete("seite");
      else neu.set("seite", String(nummer));
      setzeParameter(neu);
    },
  ];
}

/**
 * Schneidet die aktuelle Seite aus einer vollständig geladenen Liste.
 *
 * **Für kleine Listen gedacht**, die der Server ohnehin am Stück liefert: Exponate sind auf
 * 99 Kennungen begrenzt, Ansprechpartner und Nutzer liegen im zweistelligen Bereich. Die
 * Besucherliste blättert dagegen auf dem Server, dort sind es Hunderte.
 */
export function seitenAusschnitt<T>(alle: T[], seite: number, jeSeite = JE_SEITE): T[] {
  return alle.slice((seite - 1) * jeSeite, seite * jeSeite);
}

/**
 * Die Leiste unter einer Liste.
 *
 * Erscheint **nur**, wenn es mehr als eine Seite gibt: bei neun Exponaten wäre sie nur ein
 * Bedienelement, das nichts tut.
 */
export function Blaetterleiste({
  seite,
  gesamt,
  jeSeite = JE_SEITE,
  aufSeite,
}: {
  seite: number;
  gesamt: number;
  jeSeite?: number;
  aufSeite: (nummer: number) => void;
}) {
  const seiten = Math.max(1, Math.ceil(gesamt / jeSeite));
  if (seiten <= 1) return null;

  const von = gesamt === 0 ? 0 : (seite - 1) * jeSeite + 1;
  const bis = Math.min(seite * jeSeite, gesamt);

  /*
   * Ein Fenster von höchstens fünf Seiten um die aktuelle.
   *
   * Vorher standen dort immer die Seiten 1 bis 7. Mit zwei Seiten Testdaten fiel das nicht
   * auf; bei 700 Besuchern sind es 28 Seiten, und wer auf Seite 20 stand, bekam nur die
   * ersten sieben angeboten. Fünf statt sieben, weil die Leiste bei 390 px sonst über den
   * Rand läuft.
   */
  const fenster = 5;
  const sichtbar =
    seiten <= fenster
      ? Array.from({ length: seiten }, (_, i) => i + 1)
      : Array.from(
          { length: fenster },
          (_, i) =>
            Math.min(Math.max(1, seite - Math.floor(fenster / 2)), seiten - fenster + 1) + i,
        );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-[13px] text-text-hinweis">
        Zeige {von} bis {bis} von {gesamt}
      </span>
      <nav aria-label="Seiten" className="flex flex-wrap gap-2">
        <Knopf
          art="rand"
          className="h-9 w-11 px-0"
          aria-label="Vorherige Seite"
          disabled={seite <= 1}
          onClick={() => {
            aufSeite(seite - 1);
          }}
        >
          ←
        </Knopf>
        {sichtbar.map((n) => (
          <button
            key={n}
            type="button"
            aria-current={n === seite ? "page" : undefined}
            onClick={() => {
              aufSeite(n);
            }}
            className={cn(
              "size-9 rounded-full text-[13px] font-bold",
              n === seite ? "bg-text text-white" : "text-text-hinweis hover:bg-black/5",
            )}
          >
            {n}
          </button>
        ))}
        <Knopf
          art="rand"
          className="h-9 w-11 px-0"
          aria-label="Nächste Seite"
          disabled={seite >= seiten}
          onClick={() => {
            aufSeite(seite + 1);
          }}
        >
          →
        </Knopf>
      </nav>
    </div>
  );
}

/**
 * Alles, was eine im Browser geblätterte Liste braucht.
 *
 * Die Seitennummer wird **begrenzt**: steht in der Adresse `seite=4` und die Liste schrumpft
 * auf zwei Seiten, zeigte der Ausschnitt sonst nichts an, und die Seite sähe leer aus,
 * obwohl Einträge da sind.
 */
export function useBlaettern<T>(alle: T[], jeSeite = JE_SEITE) {
  const [gewuenscht, zuSeite] = useSeite();
  const seiten = Math.max(1, Math.ceil(alle.length / jeSeite));
  const seite = Math.min(gewuenscht, seiten);
  return {
    seite,
    zuSeite,
    sichtbar: seitenAusschnitt(alle, seite, jeSeite),
    gesamt: alle.length,
  };
}

/**
 * Springt auf die Seite, auf der ein frisch angelegter Eintrag steht.
 *
 * **Warum das nötig ist:** die Listen sind alphabetisch sortiert, ein neuer Eintrag landet
 * also irgendwo, und bei mehr als zehn Einträgen oft nicht auf Seite eins. Ohne diesen
 * Sprung legt man jemanden an und er ist scheinbar verschwunden. Aufgefallen am 08.10.2026
 * an zwei Abnahmetests, die den neuen Eintrag nicht mehr fanden.
 *
 * Zurückgegeben wird eine Funktion, der man nach dem Anlegen die Id übergibt. Gesprungen
 * wird erst, wenn die neu geladene Liste sie enthält.
 */
export function useSprungZuEintrag<T extends { id: string }>(
  alle: T[],
  zuSeite: (nummer: number) => void,
  jeSeite = JE_SEITE,
): (id: string) => void {
  const [gesucht, setzeGesucht] = useState<string | null>(null);

  useEffect(() => {
    if (gesucht === null) return;
    const stelle = alle.findIndex((e) => e.id === gesucht);
    // Noch nicht drin: die Liste wird gerade neu geladen, beim nächsten Lauf wieder prüfen.
    if (stelle < 0) return;
    zuSeite(Math.floor(stelle / jeSeite) + 1);
    setzeGesucht(null);
  }, [alle, gesucht, jeSeite, zuSeite]);

  return setzeGesucht;
}
