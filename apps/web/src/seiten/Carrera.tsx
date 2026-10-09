import { Link } from "react-router";
import { useAbruf } from "../lib/api.js";
import type { Ich } from "../lib/ich.js";
import {
  Flaeche,
  Knopf,
  Kopfzelle,
  Reihe,
  Tabellenflaeche,
  Ueberschrift,
  Zelle,
  Zustand,
} from "../bausteine/basis.js";

/**
 * Die Bestenliste der Carrera-Bahn.
 *
 * **Eine Person, eine Zeile.** Gezeigt wird die beste Zeit jedes Fahrers, nicht die
 * schnellsten 50 Runden: sonst belegte ein einzelner guter Fahrer mit fünf Runden fünf
 * Plätze, und die Liste beantwortete nicht mehr die Frage, wer vorn liegt. Gruppiert wird in
 * der Abfrage, siehe `services/runden.ts`.
 *
 * Das Podest zeigt dieselben drei, die auch in der Tabelle oben stehen. Doppelt, aber
 * absichtlich: das Podest ist der Blickfang, die Tabelle die vollständige Auskunft.
 */

interface Platz {
  rang: number;
  guid: string;
  name: string;
  firma: string | null;
  bestMs: number;
  anzeige: string;
  runden: number;
  avatarDateiId: string | null;
}

interface Stand {
  fahrer: number;
  runden: number;
  bestMs: number | null;
  plaetze: Platz[];
}

/** Sekunden mit Komma, wie überall sonst: 4.827 liest mancher als viertausend. */
function alsZeit(ms: number): string {
  return `${(ms / 1000).toFixed(3).replace(".", ",")} s`;
}

/**
 * Pfeil aus dem Kasten heraus, fuer „im Viewer oeffnen".
 *
 * Inline wie die uebrigen Symbole im Projekt. Der Link traegt ein `aria-label`: sein Inhalt
 * ist nur ein Bild, und ohne Namen liest ein Screenreader die Adresse vor.
 */
function Hinaus() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  );
}

function Kachel({ titel, wert, hinweis }: { titel: string; wert: string; hinweis?: string }) {
  return (
    <Flaeche className="flex flex-col gap-1 p-5">
      <span className="text-[11px] font-semibold tracking-[0.08em] text-text-hinweis uppercase">
        {titel}
      </span>
      <span className="text-3xl leading-none font-bold tracking-[-0.02em]">{wert}</span>
      {hinweis !== undefined && <span className="text-xs text-text-hinweis">{hinweis}</span>}
    </Flaeche>
  );
}

/** Die Farbe des Rangabzeichens. Gold, Silber, Bronze, sonst die Linienfarbe. */
const ABZEICHEN = ["#c9a227", "#9aa0a6", "#b06a3b"];

function Stufe({ platz }: { platz: Platz }) {
  const gold = platz.rang === 1;
  return (
    <Flaeche
      className={`flex flex-col items-center gap-3 p-6 text-center ${gold ? "sm:pt-10 sm:pb-10" : ""}`}
      /* Der Rahmen in der Rangfarbe, damit die Reihenfolge auch ohne Zahl zu sehen ist. */
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
        style={{ backgroundColor: ABZEICHEN[platz.rang - 1] ?? "var(--color-linie)" }}
        aria-hidden="true"
      >
        {platz.rang}
      </span>
      {platz.avatarDateiId !== null && (
        <img
          src={`/api/dateien/${platz.avatarDateiId}`}
          alt=""
          className={`aspect-square rounded-full object-cover outline outline-1 outline-linie ${
            gold ? "w-28" : "w-20"
          }`}
        />
      )}
      <span className="flex flex-col gap-0.5">
        <Link to={`/besucher/${platz.guid}`} className="font-semibold hover:underline">
          {platz.name}
        </Link>
        {platz.firma !== null && (
          <span className="text-[13px] text-text-hinweis">{platz.firma}</span>
        )}
      </span>
      {/*
        Ohne `font-mono`: IBM Plex Mono setzt vor das „s" eine Lücke, die wie ein Tippfehler
        aussieht. Hier zählt die Lesbarkeit, nicht die Spaltenbreite.
      */}
      <span
        className={`font-bold tracking-[-0.02em] tabular-nums ${gold ? "text-3xl" : "text-2xl"}`}
      >
        {platz.anzeige}
      </span>
      <span className="text-xs text-text-hinweis">
        {platz.runden} {platz.runden === 1 ? "Runde" : "Runden"}
      </span>
    </Flaeche>
  );
}

/**
 * Das Podest.
 *
 * **Am Handy untereinander in der Reihenfolge 1, 2, 3.** Drei Felder nebeneinander sind bei
 * 390 px unlesbar, und ein Podest, das man seitlich scrollen muss, ist keins. Ab `sm` steht
 * der Erste in der Mitte, so wie auf einem Siegerpodest.
 */
function Podest({ plaetze }: { plaetze: Platz[] }) {
  const [erster, zweiter, dritter] = plaetze;
  if (erster === undefined) return null;

  return (
    <section aria-label="Podest" className="grid items-end gap-4 sm:grid-cols-3">
      {zweiter !== undefined && (
        <div className="order-2 sm:order-1">
          <Stufe platz={zweiter} />
        </div>
      )}
      <div className="order-1 sm:order-2">
        <Stufe platz={erster} />
      </div>
      {dritter !== undefined && (
        <div className="order-3">
          <Stufe platz={dritter} />
        </div>
      )}
    </section>
  );
}

export function Carrera({ ich }: { ich: Ich }) {
  const abruf = useAbruf<Stand>("/api/carrera/bestenliste");
  const daten = abruf.daten;
  const plaetze = daten?.plaetze ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Ueberschrift>Carrera</Ueberschrift>
        <Knopf art="rand" onClick={abruf.neu}>
          Aktualisieren
        </Knopf>
      </div>

      <Zustand laedt={abruf.laedt} fehler={abruf.fehler}>
        {daten !== null && (
          <>
            <section aria-label="Kennzahlen" className="grid gap-4 sm:grid-cols-3">
              <Kachel
                titel="Fahrer"
                wert={String(daten.fahrer)}
                hinweis="mit mindestens einer Runde"
              />
              <Kachel titel="Runden gesamt" wert={String(daten.runden)} />
              <Kachel
                titel="Schnellste Runde"
                wert={daten.bestMs === null ? "–" : alsZeit(daten.bestMs)}
              />
            </section>

            <Zustand
              laedt={false}
              fehler={null}
              leer={plaetze.length === 0}
              leerText="Noch keine Runde gefahren. Sobald die Bahn eine Runde meldet, steht sie hier."
            >
              <Podest plaetze={plaetze} />

              <Tabellenflaeche>
                <table className="w-full border-collapse text-sm max-sm:block sm:min-w-[640px]">
                  <thead className="max-sm:hidden">
                    <tr>
                      <Kopfzelle>Rang</Kopfzelle>
                      <Kopfzelle>Name</Kopfzelle>
                      <Kopfzelle>Firma</Kopfzelle>
                      <Kopfzelle>Beste Runde</Kopfzelle>
                      <Kopfzelle>Runden</Kopfzelle>
                      {/* Ohne Beschriftung: die Spalte traegt nur ein Symbol je Zeile. */}
                      <Kopfzelle>
                        <span className="sr-only">Viewer</span>
                      </Kopfzelle>
                    </tr>
                  </thead>
                  <tbody className="max-sm:block">
                    {plaetze.map((p) => (
                      <Reihe key={p.guid}>
                        <Zelle titel="Rang" className="font-semibold">
                          {p.rang}
                        </Zelle>
                        <Zelle titel="Name" className="font-semibold">
                          <Link to={`/besucher/${p.guid}`} className="hover:underline">
                            {p.name}
                          </Link>
                        </Zelle>
                        <Zelle titel="Firma" className="text-text-zweit">
                          {p.firma ?? "–"}
                        </Zelle>
                        <Zelle titel="Beste Runde" className="font-semibold tabular-nums">
                          {p.anzeige}
                        </Zelle>
                        <Zelle titel="Runden" className="text-text-zweit">
                          {p.runden}
                        </Zelle>
                        <Zelle titel="Viewer">
                          <a
                            href={`${ich.viewerBaseUrl}${encodeURIComponent(p.guid)}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`${p.name} im Viewer öffnen`}
                            className="inline-flex text-primaer-dunkel"
                          >
                            <Hinaus />
                          </a>
                        </Zelle>
                      </Reihe>
                    ))}
                  </tbody>
                </table>
              </Tabellenflaeche>
            </Zustand>
          </>
        )}
      </Zustand>
    </>
  );
}
