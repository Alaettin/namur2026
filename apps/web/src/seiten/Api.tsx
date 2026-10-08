import { useState } from "react";
import { ApiFehler, api, useAbruf } from "../lib/api.js";
import {
  Fehlerhinweis,
  Flaeche,
  Knopf,
  Markierung,
  Monowert,
  Ueberschrift,
  Feld,
  Zustand,
} from "../bausteine/basis.js";

/**
 * Der Bildschirm API.
 *
 * Aufbau und Erscheinung wie im Entwurf, **der Inhalt ist ersetzt**: `Api.dc.html`
 * beschreibt die „Connector API v3" mit `/identification`, `?itemId=` und Keycloak. Das ist
 * die Seite **von Axon Core**, nicht die API, die dieser Dienst liefert. Maßgeblich ist die
 * Connector-Spezifikation 1.0.0 mit ihren neun Endpunkten unter `/connector`.
 */

interface Info {
  basisUrl: string;
  basicUser: string | null;
  basicGesetzt: boolean;
  /** Ob /connector eine Basic-Authentifizierung verlangt. Vorgabe auf dem Server: nein. */
  anmeldungVerlangt: boolean;
  specVersion: string;
  endpunkte: Endpunkt[];
  /** Eine echte GUID aus dem Bestand, als Vorbelegung des Prüfstands. */
  beispielGuid: string | null;
}

interface Endpunkt {
  kennung: string;
  methode: "GET" | "POST";
  anzeigePfad: string;
  guid: boolean;
  rumpfVorschlag: string | null;
}

interface Ergebnis {
  status: number;
  dauerMs: number;
  contentType: string | null;
  koerper: string;
  groesse: number;
  gekuerzt: boolean;
}

export function Api() {
  const { daten, laedt, fehler, neu } = useAbruf<Info>("/api/konnektor/info");
  const [laeuft, setzeLaeuft] = useState(false);
  const [schalterFehler, setzeSchalterFehler] = useState<string | null>(null);

  /**
   * Legt den Schalter um und holt die Auskunft neu.
   *
   * **Kein eigener Zustand für die Stellung.** Sie käme sonst aus zwei Quellen, und nach
   * einem abgelehnten Aufruf stünde in der Oberfläche etwas anderes als auf dem Server.
   * Maßgeblich ist, was `/api/konnektor/info` meldet.
   */
  async function lege(an: boolean) {
    setzeLaeuft(true);
    setzeSchalterFehler(null);
    try {
      await api("/api/konnektor/zugang", {
        method: "PATCH",
        body: JSON.stringify({ anmeldungVerlangt: an }),
      });
      neu();
    } catch (ursache) {
      setzeSchalterFehler(
        ursache instanceof ApiFehler ? ursache.message : "Der Schalter ließ sich nicht umlegen.",
      );
    } finally {
      setzeLaeuft(false);
    }
  }

  return (
    <>
      <Ueberschrift>API</Ueberschrift>

      <Zustand laedt={laedt} fehler={fehler}>
        {daten !== null && (
          <>
            <Flaeche className="flex flex-col gap-5 p-6">
              <h2 className="text-lg font-semibold">Zugang</h2>

              <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
                <dt className="font-semibold">Basis-Adresse</dt>
                <dd>
                  <Monowert wert={daten.basisUrl} />
                </dd>
              </dl>

              <div className="flex flex-wrap items-start justify-between gap-4 border-t border-linie pt-5">
                <div className="flex flex-col gap-1">
                  <h3 className="flex items-center gap-3 text-[15px] font-semibold">
                    Anmeldung verlangen
                    {!daten.anmeldungVerlangt && (
                      <Markierung text="AUS" farbe="var(--color-fehler)" />
                    )}
                  </h3>
                  <p className="max-w-prose text-sm text-text-zweit">
                    Steht der Schalter an, verlangt jeder Aufruf unter{" "}
                    <code className="font-mono text-xs">/connector</code> eine
                    Basic-Authentifizierung. <code className="font-mono text-xs">/health</code>{" "}
                    bleibt in beiden Stellungen anonym erreichbar, sonst meldete der Dienst sich
                    selbst als krank.
                  </p>
                </div>
                <Knopf
                  art={daten.anmeldungVerlangt ? "rand" : "primaer"}
                  aria-pressed={daten.anmeldungVerlangt}
                  disabled={laeuft}
                  onClick={() => {
                    void lege(!daten.anmeldungVerlangt);
                  }}
                >
                  {daten.anmeldungVerlangt ? "Ausschalten" : "Einschalten"}
                </Knopf>
              </div>

              {schalterFehler !== null && <Fehlerhinweis>{schalterFehler}</Fehlerhinweis>}

              {daten.anmeldungVerlangt ? (
                <>
                  <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
                    <dt className="font-semibold">Verfahren</dt>
                    <dd className="text-text-zweit">Basic-Authentifizierung</dd>
                    <dt className="font-semibold">Benutzer</dt>
                    <dd className="font-mono text-xs">{daten.basicUser ?? "nicht gesetzt"}</dd>
                    <dt className="font-semibold">Passwort</dt>
                    <dd className="text-text-zweit">
                      {/*
                        Das Passwort wird **nicht angezeigt**, auch nicht hinter der Anmeldung.
                        Eine Seite, die ein Geheimnis ausgibt, ist eine Seite, von der man
                        Bildschirmfotos macht.
                      */}
                      {daten.basicGesetzt ? (
                        <>
                          steht in der Umgebung unter{" "}
                          <code className="font-mono text-xs">CONNECTOR_BASIC_PASSWORT</code>
                        </>
                      ) : (
                        <Markierung text="NICHT GESETZT" farbe="var(--color-fehler)" />
                      )}
                    </dd>
                  </dl>
                  {!daten.basicGesetzt && (
                    <p className="text-[13px] text-fehler">
                      Die Anmeldung ist verlangt, aber es sind keine Zugangsdaten gesetzt: damit ist
                      die Schnittstelle vollständig gesperrt und Axon erreicht nichts. Setze{" "}
                      <code className="font-mono text-xs">CONNECTOR_BASIC_USER</code> und{" "}
                      <code className="font-mono text-xs">CONNECTOR_BASIC_PASSWORT</code> in der
                      Umgebung.
                    </p>
                  )}
                </>
              ) : (
                /*
                 * Der Hinweis steht hier **im Klartext**, nicht als beiläufige Zeile. Die
                 * Vorgabe ist aus, und wer die Seite aufmacht, soll nicht erst nachrechnen
                 * müssen, was das bedeutet.
                 */
                <p className="max-w-prose text-[13px] text-fehler">
                  <b>Die Schnittstelle ist ohne Anmeldung erreichbar.</b>
                </p>
              )}
            </Flaeche>

            <Flaeche className="flex flex-col gap-3 p-6">
              <h2 className="text-lg font-semibold">Endpunkte AXON Connector</h2>
              <ul className="flex flex-col divide-y divide-linie border-t border-linie">
                {daten.endpunkte.map((e) => (
                  <EndpunktProbe key={e.kennung} endpunkt={e} beispielGuid={daten.beispielGuid} />
                ))}
              </ul>
            </Flaeche>
          </>
        )}
      </Zustand>
    </>
  );
}

/**
 * Ein Endpunkt zum Ausprobieren: aufklappen, Werte eintragen, senden.
 *
 * `<details>` statt eines eigenen Auf-und-Zu: Tastatur und Screenreader können das ohne
 * Zutun, und der Zustand überlebt ein erneutes Rendern der Liste.
 *
 * Gesendet wird an `/api/konnektor/probe`, **nicht** direkt an `/connector`: ist die
 * Anmeldung eingeschaltet, bräuchte der Browser die Basic-Zugangsdaten, und das Passwort
 * wird auf dieser Seite bewusst nie ausgegeben.
 */
function EndpunktProbe({
  endpunkt,
  beispielGuid,
}: {
  endpunkt: Endpunkt;
  beispielGuid: string | null;
}) {
  const [guid, setzeGuid] = useState(beispielGuid ?? "");
  const [rumpf, setzeRumpf] = useState(endpunkt.rumpfVorschlag ?? "");
  const [laeuft, setzeLaeuft] = useState(false);
  const [ergebnis, setzeErgebnis] = useState<Ergebnis | null>(null);
  const [fehler, setzeFehler] = useState<string | null>(null);

  async function sende() {
    setzeLaeuft(true);
    setzeFehler(null);
    try {
      setzeErgebnis(
        await api<Ergebnis>("/api/konnektor/probe", {
          method: "POST",
          body: JSON.stringify({ endpunkt: endpunkt.kennung, guid, rumpf }),
        }),
      );
    } catch (ursache) {
      setzeErgebnis(null);
      setzeFehler(ursache instanceof ApiFehler ? ursache.message : "Aufruf nicht möglich.");
    } finally {
      setzeLaeuft(false);
    }
  }

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 py-3">
          <span className="w-12 shrink-0 font-mono text-xs font-semibold">{endpunkt.methode}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{endpunkt.anzeigePfad}</span>
          <span aria-hidden="true" className="text-text-hinweis group-open:hidden">
            ▸
          </span>
          <span aria-hidden="true" className="hidden text-text-hinweis group-open:inline">
            ▾
          </span>
        </summary>

        <div className="flex flex-col gap-3 pb-4">
          {endpunkt.guid && (
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              GUID
              <Feld
                value={guid}
                onChange={(ev) => {
                  setzeGuid(ev.target.value);
                }}
                className="max-w-[320px] font-mono text-xs"
              />
            </label>
          )}

          {endpunkt.rumpfVorschlag !== null && (
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              Rumpf (JSON)
              <textarea
                value={rumpf}
                rows={4}
                spellCheck={false}
                onChange={(ev) => {
                  setzeRumpf(ev.target.value);
                }}
                className="w-full border border-linie-feld bg-flaeche p-3 font-mono text-xs"
              />
            </label>
          )}

          <Knopf
            className="self-start"
            disabled={laeuft}
            onClick={() => {
              void sende();
            }}
          >
            {laeuft ? "Läuft …" : "Senden"}
          </Knopf>

          {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

          {ergebnis !== null && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                <Markierung
                  text={`HTTP ${String(ergebnis.status)}`}
                  farbe={
                    ergebnis.status >= 400 ? "var(--color-fehler)" : "var(--color-primaer-dunkel)"
                  }
                />
                <span className="text-text-hinweis">{ergebnis.dauerMs} ms</span>
                <span className="text-text-hinweis">{(ergebnis.groesse / 1024).toFixed(1)} KB</span>
              </div>
              {ergebnis.gekuerzt && (
                <p className="text-[13px] text-fehler">
                  Die Antwort ist gekürzt dargestellt. Vollständig sind es{" "}
                  {(ergebnis.groesse / 1024).toFixed(1)} KB.
                </p>
              )}
              <pre className="max-h-80 overflow-auto bg-grund p-4 font-mono text-xs leading-relaxed">
                {huebsch(ergebnis.koerper)}
              </pre>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * JSON eingerückt, alles andere unverändert.
 *
 * `/health` antwortet mit leerem Rumpf, und eine gekürzte Antwort ist kein gültiges JSON
 * mehr. Beides darf die Anzeige nicht umwerfen, deshalb der Rückfall auf den Rohtext.
 */
function huebsch(text: string): string {
  if (text.trim() === "") return "(leerer Rumpf)";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
