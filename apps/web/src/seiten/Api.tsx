import { type ReactNode, useState } from "react";
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

/** Die Zugangsangaben einer Schnittstelle. Beide haben denselben Aufbau. */
interface Zugangsdaten {
  basisUrl: string;
  basicUser: string | null;
  basicGesetzt: boolean;
  /** Ob die Schnittstelle eine Basic-Authentifizierung verlangt. Vorgabe: nein. */
  anmeldungVerlangt: boolean;
}

interface Info extends Zugangsdaten {
  specVersion: string;
  /** Die Schnittstelle der Carrera-Bahn, mit eigenem Schalter und eigenen Zugangsdaten. */
  carrera: Zugangsdaten;
  endpunkte: Endpunkt[];
  /** Eine echte GUID aus dem Bestand, als Vorbelegung des Prüfstands. */
  beispielGuid: string | null;
}

interface Endpunkt {
  kennung: string;
  methode: "GET" | "POST" | "DELETE";
  anzeigePfad: string;
  gruppe: "konnektor" | "carrera";
  guid: boolean;
  /** Wie die Kennung im Pfad heißt: beim Löschen einer Runde ist es eine `lap_id`. */
  guidFeld: string;
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
   * Legt einen der beiden Schalter um und holt die Auskunft neu.
   *
   * **Kein eigener Zustand für die Stellung.** Sie käme sonst aus zwei Quellen, und nach
   * einem abgelehnten Aufruf stünde in der Oberfläche etwas anderes als auf dem Server.
   * Maßgeblich ist, was `/api/konnektor/info` meldet.
   */
  async function lege(pfad: string, an: boolean) {
    setzeLaeuft(true);
    setzeSchalterFehler(null);
    try {
      await api(pfad, { method: "PATCH", body: JSON.stringify({ anmeldungVerlangt: an }) });
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
            <Zugangsblock
              titel="Zugang AXON Connector"
              zugang={daten}
              pfadName="/connector"
              userVar="CONNECTOR_BASIC_USER"
              passwortVar="CONNECTOR_BASIC_PASSWORT"
              laeuft={laeuft}
              fehler={schalterFehler}
              aufSchalten={(an) => {
                void lege("/api/konnektor/zugang", an);
              }}
            >
              <code className="font-mono text-xs">/health</code> bleibt in beiden Stellungen anonym
              erreichbar, sonst meldete der Dienst sich selbst als krank.
            </Zugangsblock>

            <Flaeche className="flex flex-col gap-3 p-6">
              <h2 className="text-lg font-semibold">Endpunkte AXON Connector</h2>
              <Endpunktliste
                endpunkte={daten.endpunkte.filter((e) => e.gruppe === "konnektor")}
                beispielGuid={daten.beispielGuid}
              />
            </Flaeche>

            {/*
              Die Bahn steht als **eigener Abschnitt** darunter, mit eigenem Zugang: es ist ein
              anderer Partner, und anders als der Konnektor schreibt er.
            */}
            <Zugangsblock
              titel="Zugang Carrera-Bahn"
              zugang={daten.carrera}
              pfadName="/carrera"
              userVar="CARRERA_BASIC_USER"
              passwortVar="CARRERA_BASIC_PASSWORT"
              laeuft={laeuft}
              fehler={schalterFehler}
              aufSchalten={(an) => {
                void lege("/api/carrera/zugang", an);
              }}
            >
              Über diese Schnittstelle meldet die Software der Bahn jede gefahrene Runde.
            </Zugangsblock>

            <Flaeche className="flex flex-col gap-3 p-6">
              <h2 className="text-lg font-semibold">Endpunkte Carrera-Bahn</h2>
              <p className="max-w-prose text-sm text-text-zweit">
                <code className="font-mono text-xs">participant_id</code> ist die gescannte
                AAS-Item-ID, also die GUID des Besuchers. Ist sie leer, gilt die Runde als anonym
                und wird nicht gespeichert. Je Besucher werden höchstens {MAX_RUNDEN} Runden
                aufgezeichnet.
              </p>
              <p className="max-w-prose text-sm text-text-zweit">
                <code className="font-mono text-xs">/besucher/{"{guid}"}</code> liefert Name und
                Bild für den Bildschirm an der Bahn. Das Bild steht als Base64 in derselben Antwort,
                die damit rund 60 KB groß ist.
              </p>
              <Endpunktliste
                endpunkte={daten.endpunkte.filter((e) => e.gruppe === "carrera")}
                beispielGuid={daten.beispielGuid}
              />
            </Flaeche>
          </>
        )}
      </Zustand>
    </>
  );
}

/**
 * Die Obergrenze, wie sie der Server kennt.
 *
 * Steht hier als Zahl, weil die Seite nur davon erzählt; durchgesetzt wird sie in
 * `services/runden.ts`. Wäre die Zahl hier bindend, gehörte sie in die Antwort des Servers.
 */
const MAX_RUNDEN = 20;

/**
 * Der Zugang einer Schnittstelle: Basis-Adresse, Schalter, Zugangsdaten.
 *
 * Ein Baustein für beide, weil beide dieselbe Entscheidung zeigen. Was sich unterscheidet,
 * sind die Namen der Umgebungsvariablen und ein Satz Erklärung; beides kommt von außen.
 */
function Zugangsblock({
  titel,
  zugang,
  pfadName,
  userVar,
  passwortVar,
  laeuft,
  fehler,
  aufSchalten,
  children,
}: {
  titel: string;
  zugang: Zugangsdaten;
  pfadName: string;
  userVar: string;
  passwortVar: string;
  laeuft: boolean;
  fehler: string | null;
  aufSchalten: (an: boolean) => void;
  children: ReactNode;
}) {
  /*
   * **Ein `<section>` mit Namen, kein nacktes `div`.** Seit es zwei Zugangsblöcke gibt,
   * stehen „Einschalten" und die Warnung zweimal auf der Seite. Ohne Namen ist weder für
   * einen Screenreader noch für die Abnahme zu sagen, zu welcher Schnittstelle ein Knopf
   * gehört, und ein Fall griffe stillschweigend den falschen.
   */
  return (
    <Flaeche className="flex flex-col p-0">
      <section aria-label={titel} className="flex flex-col gap-5 p-6">
        <h2 className="text-lg font-semibold">{titel}</h2>

        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
          <dt className="font-semibold">Basis-Adresse</dt>
          <dd>
            <Monowert wert={zugang.basisUrl} />
          </dd>
        </dl>

        <div className="flex flex-wrap items-start justify-between gap-4 border-t border-linie pt-5">
          <div className="flex flex-col gap-1">
            <h3 className="flex items-center gap-3 text-[15px] font-semibold">
              Anmeldung verlangen
              {!zugang.anmeldungVerlangt && <Markierung text="AUS" farbe="var(--color-fehler)" />}
            </h3>
            <p className="max-w-prose text-sm text-text-zweit">
              Steht der Schalter an, verlangt jeder Aufruf unter{" "}
              <code className="font-mono text-xs">{pfadName}</code> eine Basic-Authentifizierung.{" "}
              {children}
            </p>
          </div>
          <Knopf
            art={zugang.anmeldungVerlangt ? "rand" : "primaer"}
            aria-pressed={zugang.anmeldungVerlangt}
            disabled={laeuft}
            onClick={() => {
              aufSchalten(!zugang.anmeldungVerlangt);
            }}
          >
            {zugang.anmeldungVerlangt ? "Ausschalten" : "Einschalten"}
          </Knopf>
        </div>

        {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

        {zugang.anmeldungVerlangt ? (
          <>
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
              <dt className="font-semibold">Verfahren</dt>
              <dd className="text-text-zweit">Basic-Authentifizierung</dd>
              <dt className="font-semibold">Benutzer</dt>
              <dd className="font-mono text-xs">{zugang.basicUser ?? "nicht gesetzt"}</dd>
              <dt className="font-semibold">Passwort</dt>
              <dd className="text-text-zweit">
                {/*
                  Das Passwort wird **nicht angezeigt**, auch nicht hinter der Anmeldung. Eine
                  Seite, die ein Geheimnis ausgibt, ist eine Seite, von der man Bildschirmfotos
                  macht.
                */}
                {zugang.basicGesetzt ? (
                  <>
                    steht in der Umgebung unter{" "}
                    <code className="font-mono text-xs">{passwortVar}</code>
                  </>
                ) : (
                  <Markierung text="NICHT GESETZT" farbe="var(--color-fehler)" />
                )}
              </dd>
            </dl>
            {!zugang.basicGesetzt && (
              <p className="text-[13px] text-fehler">
                Die Anmeldung ist verlangt, aber es sind keine Zugangsdaten gesetzt: damit ist die
                Schnittstelle vollständig gesperrt und niemand erreicht sie. Setze{" "}
                <code className="font-mono text-xs">{userVar}</code> und{" "}
                <code className="font-mono text-xs">{passwortVar}</code> in der Umgebung.
              </p>
            )}
          </>
        ) : (
          /*
           * Der Hinweis steht hier **im Klartext**, nicht als beiläufige Zeile. Die Vorgabe ist
           * aus, und wer die Seite aufmacht, soll nicht erst nachrechnen müssen, was das bedeutet.
           */
          <p className="max-w-prose text-[13px] text-fehler">
            <b>Die Schnittstelle ist ohne Anmeldung erreichbar.</b>
          </p>
        )}
      </section>
    </Flaeche>
  );
}

/** Die aufklappbaren Endpunkte einer Gruppe. */
function Endpunktliste({
  endpunkte,
  beispielGuid,
}: {
  endpunkte: Endpunkt[];
  beispielGuid: string | null;
}) {
  return (
    <ul className="flex flex-col divide-y divide-linie border-t border-linie">
      {endpunkte.map((e) => (
        <EndpunktProbe key={e.kennung} endpunkt={e} beispielGuid={beispielGuid} />
      ))}
    </ul>
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
  /*
   * Die Vorbelegung **nur bei einer GUID**: in das Feld `lap_id` gehört sie nicht, und eine
   * falsche Kennung beim Löschen liefert ein stummes 204, das wie Erfolg aussieht.
   */
  const [guid, setzeGuid] = useState(endpunkt.guidFeld === "GUID" ? (beispielGuid ?? "") : "");
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
              {endpunkt.guidFeld}
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
