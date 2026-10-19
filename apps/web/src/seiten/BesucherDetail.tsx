import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiFehler, api, useAbruf } from "../lib/api.js";
import { GRUPPEN, PERSONENFELDER, felderDerGruppe } from "../lib/personenfelder.js";
import {
  Feld,
  Fehlerhinweis,
  Flaeche,
  Knopf,
  Monowert,
  Ueberschrift,
  Zustand,
} from "../bausteine/basis.js";
import { Rueckfrage } from "../bausteine/dialog.js";
import type { Ich } from "../lib/ich.js";
import { BesucherExponate } from "./BesucherExponate.js";

/**
 * Die zehn Textfelder, dieselben wie im Konnektor-Modell.
 *
 * Ausdruecklich typisiert, damit alle Eintraege dieselbe Form haben: ohne das leitet
 * TypeScript aus der Liste eine Vereinigung ab, in der `pflicht` nur bei manchen
 * Varianten existiert und deshalb nirgends lesbar ist.
 */

/** Eine gefahrene Runde, wie der Server sie liefert. */
interface Runde {
  lapId: string;
  platz: number;
  lapNumber: number | null;
  laneNumber: number | null;
  durationMs: number;
  startedUtcMs: number | null;
  anzeige: string;
}

/** Die schnellste Runde, lesbar. Gleiche Schreibweise wie der Server: Komma, drei Stellen. */
function besteRunde(runden: Runde[]): string {
  if (runden.length === 0) return "–";
  const ms = Math.min(...runden.map((r) => r.durationMs));
  return `${(ms / 1000).toFixed(3).replace(".", ",")} s`;
}

/** Datum und Uhrzeit ohne Jahr; die Veranstaltung dauert drei Tage. */
function zeitpunkt(ms: number): string {
  return new Date(ms).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Werte = Record<string, string>;

/**
 * Die geladenen Daten eines Besuchers.
 *
 * `Werte` deckt nur die Textfelder ab; `avatarDateiId` kann `null` sein und passt deshalb
 * nicht in dessen Indexsignatur. Beide stehen hier nebeneinander statt ineinander.
 */
type BesucherDaten = Werte & {
  guid: string;
  avatarDateiId: string | null;
};

export function BesucherDetail({ ich }: { ich: Ich }) {
  const { guid } = useParams();
  const navigate = useNavigate();
  const neu = guid === undefined;

  const abruf = useAbruf<
    BesucherDaten & {
      zuordnungen: { id: string }[];
      runden: Runde[];
    }
  >(neu ? null : `/api/besucher/${String(guid)}`);

  const [werte, setzeWerte] = useState<Werte>({});
  const [eigeneGuid, setzeEigeneGuid] = useState("");
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);
  const [loeschen, setzeLoeschen] = useState(false);
  const [gespeichert, setzeGespeichert] = useState(false);

  // Die Rückmeldung steht drei Sekunden, dann ist sie wieder weg; Muster wie `Monowert`.
  useEffect(() => {
    if (!gespeichert) return;
    const t = setTimeout(() => {
      setzeGespeichert(false);
    }, 3000);
    return () => {
      clearTimeout(t);
    };
  }, [gespeichert]);

  /*
   * Das Formular ist der **einzige** Ort, an dem die Eingaben stehen. Sie werden einmal
   * aus den geladenen Daten vorbelegt und danach nicht mehr nachgezogen; ein `useEffect`,
   * der bei jeder Antwort ueberschreibt, wuerde die Eingabe des Nutzers wegwerfen.
   */
  useEffect(() => {
    if (abruf.daten === null) return;
    const vorbelegt: Werte = {};
    for (const f of PERSONENFELDER) vorbelegt[f.name] = abruf.daten[f.name] ?? "";
    setzeWerte(vorbelegt);
  }, [abruf.daten]);

  async function speichern() {
    setzeLaeuft(true);
    setzeFehler(null);
    setzeGespeichert(false);
    try {
      if (neu) {
        const angelegt = await api<{ guid: string }>("/api/besucher", {
          method: "POST",
          body: JSON.stringify({ ...werte, ...(eigeneGuid === "" ? {} : { guid: eigeneGuid }) }),
        });
        void navigate(`/besucher/${angelegt.guid}`, { replace: true });
      } else {
        /*
         * **Nicht neu laden.** `abruf.neu()` setzte die ganze Seite kurz auf „Wird geladen“:
         * kein sichtbares Ergebnis, nur ein Blinken, und die Exponate klappten wieder zu.
         * Die Antwort ist der gespeicherte Datensatz; aus ihr kommt das Formular, so stehen
         * dort die Werte, wie der Server sie abgelegt hat (getrimmt, leer statt `null`).
         */
        const neuStand = await api<Record<string, string | null>>(`/api/besucher/${String(guid)}`, {
          method: "PATCH",
          body: JSON.stringify(werte),
        });
        const gesetzt: Werte = {};
        for (const f of PERSONENFELDER) gesetzt[f.name] = neuStand[f.name] ?? "";
        setzeWerte(gesetzt);
        setzeGespeichert(true);
      }
    } catch (ursache) {
      setzeFehler(ursache instanceof ApiFehler ? ursache.message : "Speichern nicht möglich.");
    } finally {
      setzeLaeuft(false);
    }
  }

  const aktuelleGuid = abruf.daten?.guid ?? "";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Ueberschrift>
          {neu ? "Besucher anlegen" : `${werte["vorname"] ?? ""} ${werte["nachname"] ?? ""}`}
        </Ueberschrift>
        <Link to="/besucher" className="text-[13px] font-semibold text-primaer-dunkel">
          ← Zurück zur Liste
        </Link>
      </div>

      <Zustand laedt={abruf.laedt} fehler={abruf.fehler}>
        {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

        <Flaeche className="flex flex-col gap-5 p-6">
          <h2 className="text-lg font-semibold">Stammdaten</h2>

          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void speichern();
            }}
          >
            {/*
              Nach Gruppen, mit Zwischenüberschrift. Elf Felder am Stück sind eine Wand;
              die Anschrift gehört sichtbar zusammen.
            */}
            {GRUPPEN.map((gruppe) => (
              <fieldset key={gruppe} className="contents">
                <legend className="col-span-full pt-2 text-[11px] font-semibold tracking-[0.08em] text-text-hinweis uppercase">
                  {gruppe}
                </legend>
                {felderDerGruppe(gruppe).map((f) => (
                  <label key={f.name} className="flex flex-col gap-2 text-[13px] font-semibold">
                    {f.text}
                    {f.pflicht === true && <span className="sr-only">Pflichtfeld</span>}
                    <Feld
                      type={f.typ ?? "text"}
                      required={f.pflicht === true}
                      value={werte[f.name] ?? ""}
                      onChange={(e) => {
                        setzeWerte((w) => ({ ...w, [f.name]: e.target.value }));
                        // Die Meldung soll nie für ungespeicherte Eingaben stehen.
                        setzeGespeichert(false);
                      }}
                    />
                  </label>
                ))}
              </fieldset>
            ))}

            {neu && (
              <label className="flex flex-col gap-2 text-[13px] font-semibold sm:col-span-2">
                GUID (leer lassen, dann wird eine erzeugt)
                <span className="flex gap-2">
                  <Feld
                    value={eigeneGuid}
                    onChange={(e) => {
                      setzeEigeneGuid(e.target.value);
                    }}
                    placeholder="wird erzeugt"
                    className="font-mono text-sm"
                  />
                  <Knopf
                    art="rand"
                    onClick={() => {
                      setzeEigeneGuid(crypto.randomUUID());
                    }}
                  >
                    Erzeugen
                  </Knopf>
                </span>
                <span className="font-normal text-text-hinweis">
                  Erlaubt sind Buchstaben, Ziffern, Bindestrich und Unterstrich, höchstens 50
                  Zeichen.
                </span>
              </label>
            )}

            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Knopf type="submit" disabled={laeuft}>
                {laeuft ? "Wird gespeichert …" : "Speichern"}
              </Knopf>
              {/* `role="status"` liest der Bildschirmleser vor, ohne den Fokus zu nehmen. */}
              <span role="status" className="order-last text-sm font-semibold sm:order-none">
                {gespeichert && (
                  <span className="inline-flex items-center gap-1.5 text-primaer-dunkel">
                    <svg
                      width="16"
                      height="16"
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
                    Gespeichert
                  </span>
                )}
              </span>
              {!neu && (
                <Knopf
                  art="gefahr"
                  onClick={() => {
                    setzeLoeschen(true);
                  }}
                >
                  Löschen
                </Knopf>
              )}
            </div>
          </form>
        </Flaeche>

        {!neu && (
          <>
            <Flaeche className="flex flex-col gap-4 p-6">
              <h2 className="text-lg font-semibold">Foto</h2>
              <Avatarbild dateiId={abruf.daten?.avatarDateiId ?? null} />
            </Flaeche>

            {/*
              Die Runden von der Carrera-Bahn. Die Anzeigezeile kommt fertig vom Server:
              dieselbe Zeile geht in die Konnektor-Antwort, und zwei Fassungen liefen beim
              ersten Feinschliff auseinander.
            */}
            <Flaeche className="flex flex-col gap-4 p-6">
              <h2 className="text-lg font-semibold">Runden ({abruf.daten?.runden.length ?? 0})</h2>
              {abruf.daten !== null && abruf.daten.runden.length === 0 ? (
                <p className="text-sm text-text-hinweis">
                  Noch keine Runde gefahren. Die Carrera-Bahn meldet sie nach jeder Runde.
                </p>
              ) : (
                <>
                  <p className="text-[13px] text-text-hinweis">
                    Beste Runde: <b>{besteRunde(abruf.daten?.runden ?? [])}</b>
                  </p>
                  <ul className="flex flex-col">
                    {(abruf.daten?.runden ?? []).map((r) => (
                      <li
                        key={r.lapId}
                        className="flex flex-wrap items-center justify-between gap-3 border-b border-linie py-2.5 text-sm last:border-b-0"
                      >
                        <span className="flex items-center gap-3">
                          <code className="shrink-0 font-mono text-xs text-text-hinweis">
                            {String(r.platz).padStart(2, "0")}
                          </code>
                          <span className="font-medium">{r.anzeige}</span>
                        </span>
                        <span className="text-xs text-text-hinweis">
                          {r.startedUtcMs === null ? "" : zeitpunkt(r.startedUtcMs)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Flaeche>

            <Flaeche className="flex flex-col gap-4 p-6">
              <h2 className="text-lg font-semibold">Pass</h2>
              <div className="flex flex-wrap items-center gap-4">
                <Monowert wert={aktuelleGuid} />
                <a
                  href={`${ich.viewerBaseUrl}${encodeURIComponent(aktuelleGuid)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[13px] font-semibold text-primaer-dunkel"
                >
                  Im Viewer öffnen ↗
                </a>
              </div>
            </Flaeche>

            <BesucherExponate guid={aktuelleGuid} aufFehler={setzeFehler} />
          </>
        )}
      </Zustand>

      <Rueckfrage
        offen={loeschen}
        aufOffen={setzeLoeschen}
        titel="Besucher löschen?"
        bestaetigenText="Löschen"
        art="gefahr"
        aufBestaetigen={() => {
          void api(`/api/besucher/${String(guid)}`, { method: "DELETE" }).then(() => {
            void navigate("/besucher");
          });
        }}
      >
        <p>
          Der Besucher und seine {abruf.daten?.zuordnungen.length ?? 0} Zuordnungen werden entfernt.
          Sein Pass zeigt danach nichts mehr an.
        </p>
      </Rueckfrage>
    </>
  );
}

/**
 * Das Foto eines Besuchers, **nur zur Anzeige**.
 *
 * Hochladen gibt es hier seit dem 08.10.2026 nicht mehr: jeder Besucher bekommt denselben
 * Standard-Avatar, den der Server als Rückfall liefert. Eine Funktion zum Ändern ist
 * angekündigt, das Feld `avatarDateiId` bleibt dafür bestehen.
 *
 * Steht dort nichts, wird trotzdem ein Bild gezeigt: der Server fällt in `values` auf den
 * Standard zurück, und eine Maske, die „kein Foto" behauptet, während der Viewer eines
 * zeigt, wäre schlicht falsch.
 */
function Avatarbild({ dateiId }: { dateiId: string | null }) {
  const quelle = dateiId === null ? "/api/standard-avatar" : `/api/dateien/${dateiId}`;
  return (
    <img
      src={quelle}
      alt="Foto des Besuchers"
      className="size-40 shrink-0 rounded-full bg-grund object-cover"
    />
  );
}
