import { useEffect, useState, type ChangeEvent } from "react";
import { ApiFehler, api, useAbruf } from "../lib/api.js";
import {
  Feld,
  Fehlerhinweis,
  Flaeche,
  Knopf,
  Markierung,
  Monowert,
  Ueberschrift,
  Zustand,
  knopfKlassen,
} from "../bausteine/basis.js";
import { Rueckfrage } from "../bausteine/dialog.js";

/**
 * Globale Daten: Datenpunkte, die der Konnektor jedem Besucher gleich ausliefert.
 *
 * Seit dem 20.10.2026. Die propertyId (`Global01`, ...) vergibt der Server; jede neue muss in
 * Axon gemappt werden, bevor sie im Viewer erscheint.
 */

interface Eintrag {
  id: string;
  propertyId: string;
  name: string;
  art: "text" | "datei";
  text: string | null;
  dateiId: string | null;
  dateiname: string | null;
  mimeType: string | null;
}

export function GlobaleDaten() {
  const abruf = useAbruf<Eintrag[]>("/api/globale-daten");
  const [name, setzeName] = useState("");
  const [art, setzeArt] = useState<"text" | "datei">("text");
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [zuLoeschen, setzeZuLoeschen] = useState<Eintrag | null>(null);
  // Die Liste aus dem Abruf, lokal nachgeführt, damit Speichern die Seite nicht neu lädt.
  const [liste, setzeListe] = useState<Eintrag[] | null>(null);
  useEffect(() => {
    if (abruf.daten !== null) setzeListe(abruf.daten);
  }, [abruf.daten]);

  async function anlegen() {
    setzeFehler(null);
    try {
      await api("/api/globale-daten", { method: "POST", body: JSON.stringify({ name, art }) });
      setzeName("");
      abruf.neu();
    } catch (ursache) {
      setzeFehler(ursache instanceof ApiFehler ? ursache.message : "Anlegen nicht möglich.");
    }
  }

  function ersetze(neu: Eintrag) {
    setzeListe((l) => (l ?? []).map((e) => (e.id === neu.id ? neu : e)));
  }

  return (
    <>
      <Ueberschrift>Globale Daten</Ueberschrift>
      <p className="text-sm text-text-zweit">
        Gelten für jeden Besucher gleich. Neue Datenpunkte müssen in Axon gemappt werden.
      </p>

      {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

      <Flaeche className="flex flex-col gap-4 p-6">
        <h2 className="text-lg font-semibold">Datenpunkt anlegen</h2>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void anlegen();
          }}
        >
          <label className="flex min-w-[14rem] flex-1 flex-col gap-2 text-[13px] font-semibold">
            Name
            <Feld
              required
              value={name}
              onChange={(e) => {
                setzeName(e.target.value);
              }}
            />
          </label>
          <fieldset className="flex items-center gap-4 text-sm">
            <legend className="sr-only">Art</legend>
            {(["text", "datei"] as const).map((a) => (
              <label key={a} className="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="art"
                  checked={art === a}
                  onChange={() => {
                    setzeArt(a);
                  }}
                  className="size-5 accent-primaer"
                />
                {a === "text" ? "Text" : "Datei"}
              </label>
            ))}
          </fieldset>
          <Knopf type="submit">Anlegen</Knopf>
        </form>
      </Flaeche>

      <Zustand
        laedt={abruf.laedt && liste === null}
        fehler={abruf.fehler}
        leer={liste !== null && liste.length === 0}
        leerText="Noch keine globalen Daten."
      >
        <ul className="flex flex-col gap-3">
          {liste?.map((e) => (
            <Karte
              key={e.id}
              e={e}
              aufGespeichert={ersetze}
              aufFehler={setzeFehler}
              aufLoeschen={() => {
                setzeZuLoeschen(e);
              }}
            />
          ))}
        </ul>
      </Zustand>

      <Rueckfrage
        offen={zuLoeschen !== null}
        aufOffen={(o) => {
          if (!o) setzeZuLoeschen(null);
        }}
        titel={`${zuLoeschen?.propertyId ?? ""} löschen?`}
        bestaetigenText="Löschen"
        art="gefahr"
        aufBestaetigen={() => {
          const ziel = zuLoeschen;
          if (ziel === null) return;
          void api(`/api/globale-daten/${ziel.id}`, { method: "DELETE" })
            .then(() => {
              setzeZuLoeschen(null);
              abruf.neu();
            })
            .catch((u: unknown) => {
              setzeFehler(u instanceof ApiFehler ? u.message : "Löschen nicht möglich.");
            });
        }}
      >
        <p>
          <b>{zuLoeschen?.name}</b> verschwindet für alle Besucher. Ein Mapping in Axon greift
          danach ins Leere; die Nummer wird nicht wieder vergeben.
        </p>
      </Rueckfrage>
    </>
  );
}

function Karte({
  e,
  aufGespeichert,
  aufFehler,
  aufLoeschen,
}: {
  e: Eintrag;
  aufGespeichert: (neu: Eintrag) => void;
  aufFehler: (text: string | null) => void;
  aufLoeschen: () => void;
}) {
  const [text, setzeText] = useState(e.text ?? "");
  const [laeuft, setzeLaeuft] = useState(false);
  const [gespeichert, setzeGespeichert] = useState(false);

  useEffect(() => {
    if (!gespeichert) return;
    const t = setTimeout(() => {
      setzeGespeichert(false);
    }, 3000);
    return () => {
      clearTimeout(t);
    };
  }, [gespeichert]);

  async function setze(koerper: object) {
    setzeLaeuft(true);
    aufFehler(null);
    try {
      await api(`/api/globale-daten/${e.id}`, { method: "PATCH", body: JSON.stringify(koerper) });
      // Die Liste neu holen, damit Dateiname und Typ stimmen; nur dieser Eintrag ändert sich.
      const alle = await api<Eintrag[]>("/api/globale-daten");
      const neu = alle.find((x) => x.id === e.id);
      if (neu !== undefined) aufGespeichert(neu);
      setzeGespeichert(true);
    } catch (ursache) {
      aufFehler(ursache instanceof ApiFehler ? ursache.message : "Speichern nicht möglich.");
    } finally {
      setzeLaeuft(false);
    }
  }

  async function waehleDatei(ereignis: ChangeEvent<HTMLInputElement>) {
    // Erst die Liste sichern, dann das Feld leeren: `value = ""` leert die FileList.
    const datei = Array.from(ereignis.target.files ?? [])[0];
    ereignis.target.value = "";
    if (datei === undefined) return;
    setzeLaeuft(true);
    try {
      const formular = new FormData();
      formular.append("datei", datei);
      const hoch = await api<{ id: string }>("/api/dateien", { method: "POST", body: formular });
      await setze({ dateiId: hoch.id });
    } catch (ursache) {
      aufFehler(ursache instanceof ApiFehler ? ursache.message : "Hochladen nicht möglich.");
      setzeLaeuft(false);
    }
  }

  const istBild = e.mimeType?.startsWith("image/") === true && !e.mimeType.startsWith("image/vnd.");

  return (
    <li>
      <Flaeche className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          {/* Name in eigener Zeile: bei 390 px quetschte ihn sonst das Etikett zusammen. */}
          <div className="flex items-center gap-3">
            <Monowert wert={e.propertyId} />
            <Markierung
              text={e.art === "text" ? "TEXT" : "DATEI"}
              farbe="var(--color-text-hinweis)"
            />
            <Knopf art="still" className="ml-auto h-9 px-3 text-[13px]" onClick={aufLoeschen}>
              Löschen
            </Knopf>
          </div>
          <span className="text-[15px] font-semibold break-words">{e.name}</span>
        </div>

        {e.art === "text" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              void setze({ text });
            }}
          >
            <textarea
              aria-label={`Text für ${e.propertyId}`}
              value={text}
              rows={3}
              onChange={(ev) => {
                setzeText(ev.target.value);
                setzeGespeichert(false);
              }}
              className="w-full rounded-none border border-linie-feld bg-flaeche p-3 text-[15px]"
            />
            <div className="flex items-center gap-3">
              <Knopf type="submit" disabled={laeuft}>
                {laeuft ? "Wird gespeichert …" : "Speichern"}
              </Knopf>
              <span role="status" className="text-sm font-semibold text-primaer-dunkel">
                {gespeichert && "Gespeichert"}
              </span>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            {e.dateiId !== null &&
              (istBild ? (
                <img
                  src={`/api/dateien/${e.dateiId}`}
                  alt={`Vorschau ${e.propertyId}`}
                  className="size-24 border border-linie object-contain"
                />
              ) : (
                <a
                  href={`/api/dateien/${e.dateiId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-semibold text-primaer-dunkel"
                >
                  {e.dateiname ?? "Datei"} öffnen ↗
                </a>
              ))}
            {/* Das Feld ist `sr-only`, das Label trägt das Aussehen, wie beim CSV-Import. */}
            <label
              className={knopfKlassen(
                "rand",
                laeuft ? "pointer-events-none opacity-50" : "cursor-pointer",
              )}
            >
              {e.dateiId === null ? "Datei hochladen" : "Datei ersetzen"}
              <input
                type="file"
                className="sr-only"
                disabled={laeuft}
                onChange={(ev) => void waehleDatei(ev)}
              />
            </label>
            <span role="status" className="text-sm font-semibold text-primaer-dunkel">
              {gespeichert && "Gespeichert"}
            </span>
          </div>
        )}
      </Flaeche>
    </li>
  );
}
