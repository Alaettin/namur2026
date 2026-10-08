import { useAbruf } from "../lib/api.js";
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
import { Blaetterleiste, useBlaettern } from "../bausteine/blaettern.js";

/**
 * Was Axon über die Konnektor-API abgefragt hat.
 *
 * **Zähler, kein Protokoll.** Eine Zeile je Besucher, nicht je Anfrage. Ein vollständiges
 * Abrufprotokoll gab es hier schon einmal und flog am 08.10.2026 wieder raus, weil es
 * unbegrenzt wächst; diese Fassung beantwortet dieselbe Frage, ohne das zu wiederholen.
 *
 * Besucher **ohne** Abruf stehen nicht in der Liste. Bei 700 Besuchern und einer Handvoll
 * Abrufe wäre die Seite sonst eine Wüste aus Nullen; die Kopfzahl sagt dasselbe in einer
 * Zeile.
 */

interface Eintrag {
  guid: string;
  name: string;
  hierarchy: number;
  werte: number;
  dokumente: number;
  gesamt: number;
  zuerst: number;
  zuletzt: number;
}

interface Stand {
  abgefragt: number;
  besucherGesamt: number;
  abrufeGesamt: number;
  unbekannteAbrufe: number;
  letzter: number | null;
  eintraege: Eintrag[];
}

/** Datum und Uhrzeit, ohne Jahr: die Veranstaltung dauert drei Tage. */
function zeitpunkt(ms: number): string {
  return new Date(ms).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

export function Monitoring() {
  const abruf = useAbruf<Stand>("/api/monitoring");
  const daten = abruf.daten;
  const { seite, zuSeite, sichtbar, gesamt } = useBlaettern(daten?.eintraege ?? []);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Ueberschrift>Monitoring</Ueberschrift>
        <Knopf art="rand" onClick={abruf.neu}>
          Aktualisieren
        </Knopf>
      </div>

      <Zustand laedt={abruf.laedt} fehler={abruf.fehler}>
        {daten !== null && (
          <>
            <section aria-label="Kennzahlen" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kachel
                titel="Abgefragt"
                wert={`${String(daten.abgefragt)} / ${String(daten.besucherGesamt)}`}
                hinweis="Besucher mit mindestens einem Abruf"
              />
              <Kachel titel="Abrufe gesamt" wert={String(daten.abrufeGesamt)} />
              <Kachel
                titel="Unbekannte GUIDs"
                wert={String(daten.unbekannteAbrufe)}
                hinweis="Axon fragte nach etwas, das es hier nicht gibt"
              />
              <Kachel
                titel="Zuletzt"
                wert={daten.letzter === null ? "–" : zeitpunkt(daten.letzter)}
              />
            </section>

            <Zustand
              laedt={false}
              fehler={null}
              leer={daten.eintraege.length === 0}
              leerText="Noch kein Abruf über die Konnektor-API. Sobald Axon eine GUID abfragt, steht sie hier."
            >
              <Tabellenflaeche>
                <table className="w-full border-collapse text-sm max-sm:block sm:min-w-[780px]">
                  <thead className="max-sm:hidden">
                    <tr>
                      <Kopfzelle>GUID</Kopfzelle>
                      <Kopfzelle>Name</Kopfzelle>
                      <Kopfzelle>Hierarchy</Kopfzelle>
                      <Kopfzelle>Values</Kopfzelle>
                      <Kopfzelle>Documents</Kopfzelle>
                      <Kopfzelle>Gesamt</Kopfzelle>
                      <Kopfzelle>Zuletzt</Kopfzelle>
                    </tr>
                  </thead>
                  <tbody className="max-sm:block">
                    {sichtbar.map((a) => (
                      <Reihe key={a.guid}>
                        <Zelle titel="GUID" className="font-mono text-xs">
                          {a.guid}
                        </Zelle>
                        <Zelle className="font-semibold">{a.name}</Zelle>
                        <Zelle titel="Hierarchy" className="text-text-zweit">
                          {a.hierarchy}
                        </Zelle>
                        <Zelle titel="Values" className="text-text-zweit">
                          {a.werte}
                        </Zelle>
                        <Zelle titel="Documents" className="text-text-zweit">
                          {a.dokumente}
                        </Zelle>
                        <Zelle titel="Gesamt" className="font-semibold">
                          {a.gesamt}
                        </Zelle>
                        <Zelle titel="Zuletzt" className="text-text-zweit">
                          {zeitpunkt(a.zuletzt)}
                        </Zelle>
                      </Reihe>
                    ))}
                  </tbody>
                </table>
              </Tabellenflaeche>

              <Blaetterleiste seite={seite} gesamt={gesamt} aufSeite={zuSeite} />
            </Zustand>
          </>
        )}
      </Zustand>
    </>
  );
}
