import { useState } from "react";
import { ApiFehler, api, leseSchalter, setzeSchalter, useAbruf } from "../lib/api.js";
import { Flaeche, Knopf, Markierung, Ueberschrift, Zustand } from "../bausteine/basis.js";
import { Avatarverwaltung } from "./Avatarverwaltung.js";
import { Rueckfrage } from "../bausteine/dialog.js";
import type { Ich } from "../lib/ich.js";

/**
 * Einstellungen mit Entwicklermodus.
 *
 * **Der Schalter ist eine Bequemlichkeit je Browser, keine Sicherheitsgrenze.** Er blendet
 * die beiden Knoepfe ein und aus; beide Endpunkte dahinter verlangen serverseitig die
 * Admin-Rolle, und daran aendert der Schalter nichts. Wer die Adresse kennt, kaeme sonst
 * ohne Rolle an das Zuruecksetzen.
 */

const SCHALTER = "namur.entwicklermodus";

interface Bestand {
  besucher: number;
  exponate: number;
  dokumente: number;
  links: number;
  kontakte: number;
  zuordnungen: number;
  dateien: number;
  abrufe: number;
  appNutzer: number;
}

interface KonnektorInfo {
  basisUrl: string;
  basicUser: string | null;
  basicGesetzt: boolean;
  specVersion: string;
  modell: { datenpunkte: number; jeBesucher: number; exponate: number };
}

export function Einstellungen({ ich }: { ich: Ich }) {
  // Nur beim ersten Rendern aus dem Speicher lesen; danach ist der Zustand hier die
  // Wahrheit und wird beim Umschalten zurueckgeschrieben.
  const [entwickler, setzeEntwickler] = useState(() => leseSchalter(SCHALTER));

  const bestand = useAbruf<Bestand>(entwickler ? "/api/entwickler/bestand" : null);
  const info = useAbruf<KonnektorInfo>("/api/konnektor/info");

  const [dialog, setzeDialog] = useState<"aussaat" | "reset" | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [meldung, setzeMeldung] = useState<string | null>(null);

  async function fuehreAus(was: "aussaat" | "reset") {
    setzeLaeuft(true);
    setzeFehler(null);
    try {
      if (was === "aussaat") {
        const e = await api<{ exponate: number; besucher: number; zuordnungen: number }>(
          "/api/aussaat",
          { method: "POST" },
        );
        setzeMeldung(
          `Testdaten eingespielt: ${String(e.exponate)} Exponate, ${String(e.besucher)} Besucher, ${String(e.zuordnungen)} Zuordnungen.`,
        );
      } else {
        const e = await api<{ geloescht: Bestand }>("/api/entwickler/zuruecksetzen", {
          method: "POST",
          body: JSON.stringify({ bestaetigung: "ZURUECKSETZEN" }),
        });
        setzeMeldung(
          `Zurückgesetzt: ${String(e.geloescht.besucher)} Besucher, ${String(e.geloescht.exponate)} Exponate, ${String(e.geloescht.dateien)} Dateien entfernt. Die Anmeldungen sind geblieben.`,
        );
      }
      setzeDialog(null);
      bestand.neu();
      info.neu();
    } catch (ursache) {
      setzeFehler(
        ursache instanceof ApiFehler ? ursache.message : "Der Aufruf ist nicht durchgekommen.",
      );
    } finally {
      setzeLaeuft(false);
    }
  }

  const b = bestand.daten;
  const leer = b !== null && b.besucher === 0 && b.exponate === 0;

  return (
    <>
      <Ueberschrift>Einstellungen</Ueberschrift>

      {meldung !== null && (
        <div
          role="status"
          className="flex items-center gap-2.5 bg-primaer-dunkel/10 px-3.5 py-3 text-sm font-medium"
        >
          <span className="size-2 shrink-0 rounded-full bg-primaer-dunkel" aria-hidden="true" />
          {meldung}
        </div>
      )}

      <Flaeche className="flex flex-col gap-4 p-6">
        <h2 className="text-lg font-semibold">Diese Instanz</h2>
        <Zustand laedt={info.laedt} fehler={info.fehler}>
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[14rem_1fr]">
            <dt className="font-semibold">Angezeigter Name</dt>
            <dd className="text-text-zweit">
              {ich.appName === "" ? "NAMUR HV 2026" : ich.appName}
            </dd>
            <dt className="font-semibold">Viewer</dt>
            <dd className="font-mono text-xs break-all text-text-zweit">{ich.viewerBaseUrl}</dd>
            <dt className="font-semibold">Konnektor-Spezifikation</dt>
            <dd className="text-text-zweit">{info.daten?.specVersion}</dd>
            <dt className="font-semibold">Datenpunkte im Modell</dt>
            <dd className="text-text-zweit">
              {info.daten?.modell.datenpunkte} bei {info.daten?.modell.exponate} Exponaten
            </dd>
          </dl>
        </Zustand>
      </Flaeche>

      <Avatarverwaltung />

      <Flaeche className="flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-3 text-lg font-semibold">
              Entwicklermodus
              {entwickler && <Markierung text="AKTIV" farbe="var(--color-fehler)" />}
            </h2>
            <p className="max-w-prose text-sm text-text-zweit">
              Blendet Werkzeuge zum Befüllen und Leeren der Datenbank ein. Die Einstellung gilt nur
              in diesem Browser und ersetzt keine Berechtigung: beide Aufrufe verlangen auf dem
              Server die Admin-Rolle.
            </p>
          </div>
          <Knopf
            art={entwickler ? "rand" : "primaer"}
            aria-pressed={entwickler}
            onClick={() => {
              const neu = !entwickler;
              setzeEntwickler(neu);
              setzeSchalter(SCHALTER, neu);
              setzeMeldung(null);
            }}
          >
            {entwickler ? "Ausschalten" : "Einschalten"}
          </Knopf>
        </div>

        {entwickler && (
          <div className="flex flex-col gap-5 border-t border-linie pt-5">
            <Zustand laedt={bestand.laedt} fehler={bestand.fehler}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                {[
                  ["Besucher", b?.besucher],
                  ["Exponate", b?.exponate],
                  ["Zuordnungen", b?.zuordnungen],
                  ["Dateien", b?.dateien],
                ].map(([text, zahl]) => (
                  <div key={String(text)} className="flex flex-col">
                    <dt className="text-[11px] font-semibold tracking-[0.08em] text-text-hinweis uppercase">
                      {text}
                    </dt>
                    <dd className="text-2xl font-bold">{zahl ?? 0}</dd>
                  </div>
                ))}
              </dl>
            </Zustand>

            <div className="flex flex-wrap gap-3">
              <Knopf
                onClick={() => {
                  setzeFehler(null);
                  setzeDialog("aussaat");
                }}
                disabled={b !== null && !leer}
                title={b !== null && !leer ? "Es sind bereits Daten vorhanden" : undefined}
              >
                Testdaten einspielen
              </Knopf>
              <Knopf
                art="gefahr"
                onClick={() => {
                  setzeFehler(null);
                  setzeDialog("reset");
                }}
                disabled={leer}
              >
                Alles zurücksetzen
              </Knopf>
            </div>

            {b !== null && !leer && (
              <p className="text-[13px] text-text-hinweis">
                Testdaten lassen sich nur auf einen leeren Bestand einspielen. Erst zurücksetzen.
              </p>
            )}
          </div>
        )}
      </Flaeche>

      <Rueckfrage
        offen={dialog === "aussaat"}
        aufOffen={(o) => {
          if (!o) setzeDialog(null);
        }}
        titel="Testdaten einspielen?"
        bestaetigenText="Einspielen"
        laeuft={laeuft}
        fehler={fehler}
        aufBestaetigen={() => void fuehreAus("aussaat")}
      >
        <p>
          Angelegt werden 6 Exponate mit Dokumenten, Links und Ansprechpartnern, dazu 50 Besucher,
          von denen jeder dritte Zuordnungen bekommt.
        </p>
        <p>
          Die Daten sind erfunden und nur für Entwicklung und Abnahme gedacht. Sie erscheinen danach
          auch im Viewer, sobald der Konnektor in Axon eingetragen ist.
        </p>
      </Rueckfrage>

      <Rueckfrage
        offen={dialog === "reset"}
        aufOffen={(o) => {
          if (!o) setzeDialog(null);
        }}
        titel="Wirklich alles zurücksetzen?"
        bestaetigenText="Endgültig löschen"
        art="gefahr"
        tippwort="ZURUECKSETZEN"
        laeuft={laeuft}
        fehler={fehler}
        aufBestaetigen={() => void fuehreAus("reset")}
      >
        {/*
          Die Rueckfrage **nennt die Zahlen**. Ein "Sind Sie sicher?" klickt man weg; was
          verschwindet, soll dastehen.
        */}
        <p>Gelöscht werden unwiderruflich:</p>
        <ul className="list-disc pl-5">
          <li>
            <b>{b?.besucher ?? 0}</b> Besucher samt Fotos
          </li>
          <li>
            <b>{b?.exponate ?? 0}</b> Exponate mit {b?.dokumente ?? 0} Dokumenten, {b?.links ?? 0}{" "}
            Links und {b?.kontakte ?? 0} Ansprechpartnern
          </li>
          <li>
            <b>{b?.zuordnungen ?? 0}</b> Zuordnungen und {b?.dateien ?? 0} hochgeladene Dateien
          </li>
          <li>
            die Abrufzähler für <b>{b?.abrufe ?? 0}</b> GUIDs
          </li>
        </ul>
        <p>
          Die <b>{b?.appNutzer ?? 0} Anmeldungen bleiben erhalten</b>, sonst käme danach niemand
          mehr hinein.
        </p>
      </Rueckfrage>
    </>
  );
}
