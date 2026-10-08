import { useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ApiFehler, api } from "../lib/api.js";
import {
  Fehlerhinweis,
  Flaeche,
  Knopf,
  Kopfzelle,
  Tabellenflaeche,
  Ueberschrift,
  Zelle,
  cn,
} from "../bausteine/basis.js";
import { Rueckfrage } from "../bausteine/dialog.js";

/**
 * Besucher aus einer CSV einspielen, in drei Schritten nach `CsvImport` und `CsvResult`.
 *
 * **Schritt 2 ändert nichts.** Der Nutzer sieht alle Beanstandungen und kann die Datei
 * korrigieren, bevor etwas passiert; erst Schritt 3 schreibt.
 */

const ZIELFELDER = [
  "guid",
  "vorname",
  "nachname",
  "firma",
  "position",
  "email",
  "strasse",
  "plz",
  "ort",
  "land",
  "website",
] as const;

interface Beanstandung {
  zeile: number;
  art: string;
  text: string;
}

interface Zeilenbefund {
  zeile: number;
  werte: Record<string, string>;
  beanstandungen: Beanstandung[];
  bekannt: boolean;
}

interface Pruefergebnis {
  zeichensatz: string;
  trennzeichen: string;
  spalten: string[];
  zuordnung: (string | null)[];
  zeilenGesamt: number;
  uebernehmbar: number;
  uebersprungen: number;
  neu: number;
  aktualisiert: number;
  beanstandungen: Beanstandung[];
  vorschau: Zeilenbefund[];
}

interface Ergebnis {
  neu: number;
  aktualisiert: number;
  uebersprungen: number;
  entfernt: number;
  uebersprungeneCsv: string;
}

const ARTTEXT: Record<string, string> = {
  "guid-doppelt": "GUID doppelt in der Datei",
  "email-ungueltig": "E-Mail ungültig",
  "pflicht-fehlt": "Pflichtwert fehlt",
  "spalten-zahl": "Falsche Spaltenzahl",
};

export function CsvImport() {
  const navigate = useNavigate();
  const [datei, setzeDatei] = useState<File | null>(null);
  const [befund, setzeBefund] = useState<Pruefergebnis | null>(null);
  const [zuordnung, setzeZuordnung] = useState<(string | null)[]>([]);
  const [ergebnis, setzeErgebnis] = useState<Ergebnis | null>(null);
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);
  const [frage, setzeFrage] = useState(false);

  const schritt = ergebnis !== null ? 3 : befund !== null ? 2 : 1;

  async function pruefe(gewaehlteDatei: File, eigeneZuordnung?: (string | null)[]) {
    setzeLaeuft(true);
    setzeFehler(null);
    try {
      const formular = new FormData();
      formular.append("datei", gewaehlteDatei);
      if (eigeneZuordnung !== undefined) {
        formular.append("zuordnung", JSON.stringify(eigeneZuordnung));
      }
      const e = await api<Pruefergebnis>("/api/besucher/import/pruefen", {
        method: "POST",
        body: formular,
      });
      setzeBefund(e);
      setzeZuordnung(e.zuordnung);
    } catch (ursache) {
      setzeFehler(
        ursache instanceof ApiFehler ? ursache.message : "Die Datei ließ sich nicht lesen.",
      );
      setzeBefund(null);
    } finally {
      setzeLaeuft(false);
    }
  }

  function waehle(ereignis: ChangeEvent<HTMLInputElement>) {
    /*
     * **Erst die Liste sichern, dann das Feld leeren.** `input.value = ""` leert die
     * FileList an Ort und Stelle; wer danach darauf zugreift, schickt nichts hinaus.
     */
    const dateien = Array.from(ereignis.target.files ?? []);
    ereignis.target.value = "";
    const erste = dateien[0];
    if (erste === undefined) return;
    setzeDatei(erste);
    setzeErgebnis(null);
    void pruefe(erste);
  }

  async function uebernimm(modus: "ergaenzen" | "ersetzen") {
    if (datei === null) return;
    setzeLaeuft(true);
    setzeFehler(null);
    try {
      const formular = new FormData();
      formular.append("datei", datei);
      formular.append("zuordnung", JSON.stringify(zuordnung));
      formular.append("modus", modus);
      setzeErgebnis(
        await api<Ergebnis>("/api/besucher/import/uebernehmen", {
          method: "POST",
          body: formular,
        }),
      );
      setzeFrage(false);
    } catch (ursache) {
      setzeFehler(
        ursache instanceof ApiFehler ? ursache.message : "Die Übernahme ist gescheitert.",
      );
    } finally {
      setzeLaeuft(false);
    }
  }

  /** Die übersprungenen Zeilen als Datei anbieten. */
  function ladeUebersprungeneHerunter() {
    if (ergebnis === null) return;
    const blob = new Blob([ergebnis.uebersprungeneCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "uebersprungene-zeilen.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Link to="/besucher" className="self-start text-sm font-medium text-text-zweit">
        ← Besucher
      </Link>
      <Ueberschrift>Besucher importieren</Ueberschrift>

      <ol aria-label="Schritte" className="grid gap-x-4 sm:grid-cols-3">
        {[
          ["Datei wählen", datei?.name ?? "CSV, Semikolon oder Komma"],
          [
            "Vorschau prüfen",
            befund === null
              ? ""
              : `${befund.trennzeichen === ";" ? "Semikolon" : "Komma"} erkannt · ${String(befund.zeilenGesamt)} Zeilen`,
          ],
          ["Ergebnis", ergebnis === null ? "" : `${String(ergebnis.neu)} neu`],
        ].map(([titel, unter], i) => {
          const nummer = i + 1;
          const fertig = schritt > nummer;
          const aktiv = schritt === nummer;
          return (
            <li
              key={titel}
              aria-current={aktiv ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 py-3",
                aktiv
                  ? "shadow-[inset_0_-2px_0_var(--color-primaer)]"
                  : "shadow-[inset_0_-2px_0_var(--color-linie-feld)]",
                !aktiv && !fertig && "text-text-hinweis",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold",
                  fertig
                    ? "bg-primaer text-white"
                    : aktiv
                      ? "bg-text text-white"
                      : "border border-text-hinweis",
                )}
              >
                {fertig ? "✓" : nummer}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold">{titel}</span>
                {unter !== "" && (
                  <span className="truncate text-xs text-text-hinweis">{unter}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

      {schritt === 1 && (
        <Flaeche className="flex flex-col gap-4 p-6">
          <h2 className="text-lg font-semibold">Datei wählen</h2>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={waehle}
            className="text-sm file:mr-3 file:h-10 file:rounded-full file:border-0 file:bg-primaer file:px-5 file:text-sm file:font-semibold file:text-white"
          />
          <p className="text-[13px] leading-relaxed text-text-hinweis">
            Nur CSV, keine Bilder und kein ZIP. Trennzeichen Semikolon oder Komma, beides wird
            erkannt. Fotos lädst du je Besucher in der Detailansicht hoch. Eine Datei aus Excel wird
            auch dann richtig gelesen, wenn sie nicht als UTF-8 gespeichert ist.
          </p>
        </Flaeche>
      )}

      {schritt === 2 && befund !== null && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Als section mit Beschriftung, wie im Entwurf: die Abschnitte sind damit
                einzeln ansprechbar, auch für Hilfsmittel. */}
            <section
              aria-labelledby="h-beanstandungen"
              className="flex flex-col gap-3 bg-flaeche p-6 shadow-flaeche"
            >
              <h2 id="h-beanstandungen" className="text-lg font-bold">
                Beanstandungen
              </h2>
              {befund.beanstandungen.length === 0 ? (
                <p className="text-sm text-text-zweit">
                  Keine. Alle {befund.zeilenGesamt} Zeilen lassen sich übernehmen.
                </p>
              ) : (
                <>
                  {Object.entries(
                    befund.beanstandungen.reduce<Record<string, Beanstandung[]>>((acc, b) => {
                      (acc[b.art] ??= []).push(b);
                      return acc;
                    }, {}),
                  ).map(([art, liste]) => (
                    <div key={art} className="flex flex-col gap-1.5 border-t border-linie pt-3">
                      <span className="flex items-center gap-3">
                        <span className="flex-1 text-[15px] font-semibold">
                          {ARTTEXT[art] ?? art}
                        </span>
                        <span className="flex h-[22px] min-w-[22px] items-center justify-center bg-fehler px-1.5 text-xs font-bold text-white">
                          {liste.length}
                        </span>
                      </span>
                      <span className="font-mono text-xs leading-relaxed text-text-zweit">
                        {liste
                          .slice(0, 4)
                          .map((b) => `Zeile ${String(b.zeile)}: ${b.text}`)
                          .join("\n")}
                        {liste.length > 4 ? `\n… und ${String(liste.length - 4)} weitere` : ""}
                      </span>
                    </div>
                  ))}
                  <p className="mt-2 text-[13px] leading-relaxed text-text-hinweis">
                    Zeilen mit Beanstandung werden übersprungen. Korrigiere die Datei und lade sie
                    erneut, oder lege die Besucher einzeln an.
                  </p>
                </>
              )}
            </section>

            <section
              aria-labelledby="h-zuordnung"
              className="flex flex-col gap-3.5 bg-flaeche p-6 shadow-flaeche"
            >
              <h2 id="h-zuordnung" className="text-lg font-bold">
                Spaltenzuordnung
              </h2>
              <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
                {befund.spalten.map((spalte, i) => (
                  <div key={spalte + String(i)} className="flex min-w-0 items-center gap-2">
                    <label
                      htmlFor={`sp${String(i)}`}
                      className="w-20 shrink-0 truncate font-mono text-xs"
                      title={spalte}
                    >
                      {spalte}
                    </label>
                    <select
                      id={`sp${String(i)}`}
                      value={zuordnung[i] ?? ""}
                      onChange={(e) => {
                        const neu = [...zuordnung];
                        neu[i] = e.target.value === "" ? null : e.target.value;
                        setzeZuordnung(neu);
                        if (datei !== null) void pruefe(datei, neu);
                      }}
                      className="h-9 min-w-0 flex-1 rounded-none border border-linie-feld bg-flaeche px-2.5 text-[13px]"
                    >
                      <option value="">nicht übernehmen</option>
                      {ZIELFELDER.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-[13px] text-text-hinweis">
                Erkannt als {befund.zeichensatz === "utf-8" ? "UTF-8" : "Windows-1252"}. Vorname und
                Nachname sind Pflicht; eine fehlende GUID wird erzeugt.
              </p>
            </section>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-bold">Vorschau</h2>
            <Tabellenflaeche>
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr>
                    <Kopfzelle>Zeile</Kopfzelle>
                    <Kopfzelle>Name</Kopfzelle>
                    <Kopfzelle>Firma</Kopfzelle>
                    <Kopfzelle>GUID</Kopfzelle>
                    <Kopfzelle>Status</Kopfzelle>
                  </tr>
                </thead>
                <tbody>
                  {befund.vorschau.map((z) => (
                    <tr key={z.zeile}>
                      <Zelle className="font-mono text-xs text-text-hinweis">{z.zeile}</Zelle>
                      <Zelle className="font-semibold">
                        {`${z.werte["vorname"] ?? ""} ${z.werte["nachname"] ?? ""}`.trim() || "—"}
                      </Zelle>
                      <Zelle className="text-text-zweit">{z.werte["firma"] ?? "—"}</Zelle>
                      <Zelle className="font-mono text-xs">
                        {z.werte["guid"] ?? "wird erzeugt"}
                      </Zelle>
                      <Zelle>
                        {z.beanstandungen.length > 0 ? (
                          <span className="text-[13px] font-semibold text-fehler">
                            {z.beanstandungen.map((b) => ARTTEXT[b.art] ?? b.art).join(", ")}
                          </span>
                        ) : z.bekannt ? (
                          <span className="text-[13px] text-text-zweit">wird aktualisiert</span>
                        ) : (
                          <span className="text-[13px] text-text-zweit">neu</span>
                        )}
                      </Zelle>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Tabellenflaeche>
          </div>

          <Flaeche className="flex flex-col gap-4 p-6">
            <h2 className="text-lg font-bold">Übernehmen</h2>
            <p className="text-sm text-text-zweit">
              <b>{befund.neu}</b> neu, <b>{befund.aktualisiert}</b> werden aktualisiert,{" "}
              <b>{befund.uebersprungen}</b> übersprungen.
            </p>
            <div className="flex flex-wrap gap-3">
              <Knopf
                disabled={laeuft || befund.uebernehmbar === 0}
                onClick={() => void uebernimm("ergaenzen")}
              >
                Ergänzen
              </Knopf>
              <Knopf
                art="gefahr"
                disabled={laeuft || befund.uebernehmbar === 0}
                onClick={() => {
                  setzeFrage(true);
                }}
              >
                Ersetzen
              </Knopf>
            </div>
            <p className="text-[13px] leading-relaxed text-text-hinweis">
              <b>Ergänzen</b> legt neue Besucher an und aktualisiert bekannte. <b>Ersetzen</b>{" "}
              entfernt zusätzlich alle, die nicht in der Datei stehen, samt ihren Zuordnungen.
            </p>
          </Flaeche>
        </>
      )}

      {schritt === 3 && ergebnis !== null && (
        <Flaeche className="flex flex-col gap-5 p-6">
          <h2 className="text-lg font-bold">Import abgeschlossen</h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Neu angelegt", ergebnis.neu],
              ["Aktualisiert", ergebnis.aktualisiert],
              ["Übersprungen", ergebnis.uebersprungen],
              ["Entfernt", ergebnis.entfernt],
            ].map(([text, zahl]) => (
              <div key={String(text)} className="flex flex-col">
                <dt className="text-[11px] font-semibold tracking-[0.08em] text-text-hinweis uppercase">
                  {text}
                </dt>
                <dd className="text-3xl font-bold">{zahl}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-3">
            <Knopf
              onClick={() => {
                void navigate("/besucher");
              }}
            >
              Zur Besucherliste
            </Knopf>
            {ergebnis.uebersprungen > 0 && (
              <Knopf art="rand" onClick={ladeUebersprungeneHerunter}>
                Übersprungene Zeilen herunterladen
              </Knopf>
            )}
          </div>
          {ergebnis.uebersprungen > 0 && (
            <p className="text-[13px] text-text-hinweis">
              Die heruntergeladene Datei enthält die übersprungenen Zeilen samt Grund. Korrigiere
              sie und spiele sie erneut ein.
            </p>
          )}
        </Flaeche>
      )}

      <Rueckfrage
        offen={frage}
        aufOffen={setzeFrage}
        titel="Wirklich ersetzen?"
        bestaetigenText="Ersetzen"
        art="gefahr"
        tippwort="ERSETZEN"
        laeuft={laeuft}
        aufBestaetigen={() => void uebernimm("ersetzen")}
      >
        <p>
          Alle Besucher, die <b>nicht</b> in dieser Datei stehen, werden samt ihren Zuordnungen
          gelöscht. Ihre Pässe zeigen danach nichts mehr an.
        </p>
        <p>
          Die Datei enthält <b>{befund?.uebernehmbar ?? 0}</b> übernehmbare Zeilen. Was darüber
          hinaus im Bestand ist, verschwindet.
        </p>
      </Rueckfrage>
    </>
  );
}
