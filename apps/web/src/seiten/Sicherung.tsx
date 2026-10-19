import { useState, type ChangeEvent } from "react";
import { ApiFehler, api } from "../lib/api.js";
import { bieteAlsDatei } from "../lib/download.js";
import { Fehlerhinweis, Flaeche, Knopf, knopfKlassen } from "../bausteine/basis.js";
import { Rueckfrage } from "../bausteine/dialog.js";

/**
 * Sicherung und Auswertung, zwei Abschnitte der Einstellungen. Seit dem 19.10.2026.
 *
 * **Nicht hinter dem Entwicklermodus:** beides ist Betrieb, nicht Entwicklung. Die Rechte
 * prueft der Server, beide Wege verlangen die Admin-Rolle.
 */

interface Bestand {
  besucher: number;
  exponate: number;
  zuordnungen: number;
  dateien: number;
  runden: number;
  appNutzer: number;
}

interface Pruefergebnis {
  sicherung: { erstellt: string; fassung: string; bestand: Bestand; dateien: number };
  aktuell: Bestand;
}

const ZEILEN: [keyof Bestand, string][] = [
  ["besucher", "Besucher"],
  ["exponate", "Exponate"],
  ["zuordnungen", "Zuordnungen"],
  ["dateien", "Dateien"],
  ["runden", "Rundenzeiten"],
  ["appNutzer", "Anmeldungen"],
];

export function Sicherung() {
  const [datei, setzeDatei] = useState<File | null>(null);
  const [pruefung, setzePruefung] = useState<Pruefergebnis | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);
  const [fehler, setzeFehler] = useState<string | null>(null);

  async function waehle(ereignis: ChangeEvent<HTMLInputElement>) {
    // Erst die Liste sichern, dann das Feld leeren: `value = ""` leert die FileList.
    const erste = Array.from(ereignis.target.files ?? [])[0];
    ereignis.target.value = "";
    if (erste === undefined) return;

    setzeFehler(null);
    setzeLaeuft(true);
    try {
      const formular = new FormData();
      formular.append("datei", erste);
      setzePruefung(
        await api<Pruefergebnis>("/api/sicherung/pruefen", { method: "POST", body: formular }),
      );
      setzeDatei(erste);
    } catch (ursache) {
      setzeFehler(
        ursache instanceof ApiFehler ? ursache.message : "Die Datei ließ sich nicht lesen.",
      );
    } finally {
      setzeLaeuft(false);
    }
  }

  async function spieleEin() {
    if (datei === null) return;
    setzeLaeuft(true);
    setzeFehler(null);
    try {
      const formular = new FormData();
      formular.append("datei", datei);
      await api("/api/sicherung", { method: "POST", body: formular });
      /*
       * **Neu laden statt weiterarbeiten.** Jede geladene Liste ist jetzt veraltet, und das
       * eigene Konto kann im eingespielten Bestand fehlen; dann fuehrt das Neuladen zur
       * Anmeldung.
       */
      window.location.reload();
    } catch (ursache) {
      setzeFehler(
        ursache instanceof ApiFehler ? ursache.message : "Das Einspielen ist nicht durchgekommen.",
      );
      setzeLaeuft(false);
    }
  }

  async function auswertung() {
    setzeFehler(null);
    try {
      const { dateiname, inhalt } = await api<{ dateiname: string; inhalt: string }>(
        "/api/auswertung",
      );
      bieteAlsDatei(inhalt, dateiname);
    } catch (ursache) {
      setzeFehler(
        ursache instanceof ApiFehler ? ursache.message : "Die Auswertung ließ sich nicht laden.",
      );
    }
  }

  return (
    <>
      {fehler !== null && pruefung === null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

      <Flaeche className="flex flex-col gap-4 p-6">
        <h2 className="text-lg font-semibold">Sicherung</h2>
        <div className="flex flex-wrap gap-3">
          {/* Ein echter Link: der Browser lädt die Datei selbst und zeigt den Fortschritt. */}
          <a href="/api/sicherung" download className={knopfKlassen("primaer")}>
            Export
          </a>
          <label
            className={knopfKlassen(
              "rand",
              laeuft ? "pointer-events-none opacity-50" : "cursor-pointer",
            )}
          >
            Import
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => void waehle(e)}
              className="sr-only"
              disabled={laeuft}
            />
          </label>
        </div>
      </Flaeche>

      <Flaeche className="flex flex-col gap-4 p-6">
        <h2 className="text-lg font-semibold">Auswertung</h2>
        <div>
          <Knopf art="rand" onClick={() => void auswertung()}>
            Download CSV
          </Knopf>
        </div>
      </Flaeche>

      <Rueckfrage
        offen={pruefung !== null}
        aufOffen={(o) => {
          if (!o) {
            setzePruefung(null);
            setzeDatei(null);
            setzeFehler(null);
          }
        }}
        titel="Sicherung einspielen?"
        bestaetigenText="Bestand ersetzen"
        art="gefahr"
        tippwort="EINSPIELEN"
        laeuft={laeuft}
        fehler={fehler}
        aufBestaetigen={() => void spieleEin()}
      >
        {pruefung !== null && (
          <>
            <p>
              Sicherung vom <b>{new Date(pruefung.sicherung.erstellt).toLocaleString("de-DE")}</b>,
              Fassung {pruefung.sicherung.fassung}. Der aktuelle Bestand wird vollständig ersetzt:
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] tracking-[0.08em] text-text-hinweis uppercase">
                  <th className="py-1 font-semibold" />
                  <th className="py-1 text-right font-semibold">Jetzt</th>
                  <th className="py-1 text-right font-semibold">Sicherung</th>
                </tr>
              </thead>
              <tbody>
                {ZEILEN.map(([feld, text]) => (
                  <tr key={feld} className="border-t border-linie">
                    <td className="py-1">{text}</td>
                    <td className="py-1 text-right tabular-nums">{pruefung.aktuell[feld]}</td>
                    <td className="py-1 text-right font-semibold tabular-nums">
                      {pruefung.sicherung.bestand[feld]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Auch die Anmeldungen kommen aus der Sicherung. Fehlt dein Konto dort, wirst du danach
              abgemeldet.
            </p>
          </>
        )}
      </Rueckfrage>
    </>
  );
}
