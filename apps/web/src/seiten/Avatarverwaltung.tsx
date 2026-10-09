import { useRef, useState } from "react";
import { ApiFehler, api, useAbruf } from "../lib/api.js";
import { Fehlerhinweis, Flaeche, Knopf, Zustand, knopfKlassen } from "../bausteine/basis.js";
import { Rueckfrage } from "../bausteine/dialog.js";

/**
 * Die Avatare, die am Selbstbedienungs-Tablet zur Auswahl stehen.
 *
 * **Verkleinert wird hier im Browser**, nicht auf dem Server: 512 px, JPEG. Das spart eine
 * Bildbibliothek im Server, und ein natives Modul wäre im Container der nächste
 * Stolperstein. Der Server verlässt sich darauf aber nicht, er prüft die fertige Datei
 * selbst.
 *
 * Sortiert wird mit Pfeilen, nicht per Ziehen und Ablegen: bedienbar mit der Tastatur, und
 * vor allem prüfbar.
 */

const KANTE = 512;
const GUETE = 0.82;

/**
 * Wie groß die **gewählte** Datei höchstens sein darf, vor dem Verkleinern.
 *
 * Eine zweite Grenze neben der des Servers, und sie misst etwas anderes: der Server prüft
 * das **Ergebnis** (300 KB nach dem Verkleinern), diese hier die **Quelle**. Ohne sie geht
 * ein 40-MB-Foto aus einer Kamera zuerst durch `createImageBitmap`, und auf einem Tablet
 * bringt das den Tab um, bevor überhaupt etwas hochgeladen wird.
 */
const HOECHSTE_QUELLE = 10 * 1024 * 1024;

interface Zeile {
  dateiId: string;
  sortierung: number;
}

interface Stand {
  standard: string;
  avatare: Zeile[];
}

/** Mülleimer. Inline wie die übrigen Symbole im Projekt. */
function Muelleimer() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/**
 * Zeichnet das gewählte Bild quadratisch auf 512 px und gibt JPEG zurück.
 *
 * Mittig beschnitten, nicht verzerrt: ein in die Breite gezogenes Gesicht fiele am Stand
 * sofort auf.
 */
async function verkleinere(datei: File): Promise<Blob> {
  const bild = await createImageBitmap(datei);
  const kante = Math.min(bild.width, bild.height);
  const flaeche = document.createElement("canvas");
  flaeche.width = KANTE;
  flaeche.height = KANTE;
  const stift = flaeche.getContext("2d");
  if (stift === null) throw new Error("Kein 2D-Kontext verfügbar.");
  stift.drawImage(
    bild,
    (bild.width - kante) / 2,
    (bild.height - kante) / 2,
    kante,
    kante,
    0,
    0,
    KANTE,
    KANTE,
  );
  bild.close();

  return await new Promise<Blob>((loese, scheitere) => {
    flaeche.toBlob(
      (b) => {
        if (b === null) scheitere(new Error("Das Bild ließ sich nicht umwandeln."));
        else loese(b);
      },
      "image/jpeg",
      GUETE,
    );
  });
}

export function Avatarverwaltung() {
  const abruf = useAbruf<Stand>("/api/avatare");
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);
  const [zuLoeschen, setzeZuLoeschen] = useState<string | null>(null);
  const feld = useRef<HTMLInputElement | null>(null);

  const alle = abruf.daten?.avatare ?? [];
  const standard = abruf.daten?.standard ?? null;

  async function waehle(dateien: FileList | null) {
    // **Erst die Liste sichern, dann das Feld leeren**, sonst ist sie beim Zugriff weg.
    const gewaehlt = Array.from(dateien ?? []);
    if (feld.current !== null) feld.current.value = "";
    if (gewaehlt.length === 0) return;

    const zuGross = gewaehlt.find((d) => d.size > HOECHSTE_QUELLE);
    if (zuGross !== undefined) {
      setzeFehler(
        `„${zuGross.name}" ist ${String(Math.round(zuGross.size / 1024 / 1024))} MB groß. ` +
          `Höchstens ${String(HOECHSTE_QUELLE / 1024 / 1024)} MB je Datei.`,
      );
      return;
    }

    setzeLaeuft(true);
    setzeFehler(null);
    try {
      for (const datei of gewaehlt) {
        const klein = await verkleinere(datei);
        const formular = new FormData();
        formular.append("datei", klein, "avatar.jpg");
        await api("/api/avatare", { method: "POST", body: formular });
      }
      abruf.neu();
    } catch (ursache) {
      setzeFehler(
        ursache instanceof ApiFehler
          ? ursache.message
          : "Das Bild ließ sich nicht verarbeiten. Bitte ein anderes versuchen.",
      );
    } finally {
      setzeLaeuft(false);
    }
  }

  async function verschiebe(von: number, nach: number) {
    if (nach < 0 || nach >= alle.length) return;
    const ids = alle.map((a) => a.dateiId);
    const [weg] = ids.splice(von, 1);
    if (weg === undefined) return;
    ids.splice(nach, 0, weg);

    setzeFehler(null);
    try {
      await api("/api/avatare/reihenfolge", { method: "PATCH", body: JSON.stringify({ ids }) });
      abruf.neu();
    } catch {
      setzeFehler("Die Reihenfolge ließ sich nicht speichern.");
    }
  }

  async function loesche(dateiId: string) {
    setzeFehler(null);
    try {
      await api(`/api/avatare/${dateiId}`, { method: "DELETE" });
      setzeZuLoeschen(null);
      abruf.neu();
    } catch {
      setzeZuLoeschen(null);
      setzeFehler("Das Bild ließ sich nicht entfernen.");
    }
  }

  return (
    <Flaeche className="flex flex-col p-0">
      {/*
        `<details>` statt eines eigenen Auf-und-Zu, wie bei den Endpunkten auf der Seite API:
        Tastatur und Screenreader können das ohne Zutun, und ein eigener Zustand wäre ein
        zweiter neben dem DOM. Zu als Vorgabe, die Zahl steht trotzdem in der Kopfzeile.
      */}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 p-6">
          <h2 className="text-lg font-semibold">Avatare</h2>
          <span className="text-[13px] text-text-hinweis">{alle.length}</span>
          <span aria-hidden="true" className="ml-auto text-text-hinweis group-open:hidden">
            ▸
          </span>
          <span aria-hidden="true" className="ml-auto hidden text-text-hinweis group-open:inline">
            ▾
          </span>
        </summary>

        <div className="flex flex-col gap-5 px-6 pb-6">
          <div className="flex flex-wrap items-center gap-3">
            <label className={knopfKlassen("primaer", "cursor-pointer")}>
              {laeuft ? "Lädt …" : "Bild hinzufügen"}
              <input
                ref={feld}
                type="file"
                accept="image/*"
                multiple
                disabled={laeuft}
                onChange={(ev) => void waehle(ev.target.files)}
                className="sr-only"
              />
            </label>
            <span className="text-[13px] text-text-hinweis">
              Höchstens {HOECHSTE_QUELLE / 1024 / 1024} MB je Datei
            </span>
          </div>

          {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

          <Zustand laedt={abruf.laedt} fehler={abruf.fehler}>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-5 lg:grid-cols-6">
              {/*
                Das Standardbild steht mit in der Reihe, aber **ohne** Knöpfe: es ist kein
                Galerieeintrag, sondern der Rückfall. Zeigen statt verschweigen, damit
                niemand es sucht.
              */}
              {standard !== null && (
                <li className="flex flex-col gap-1">
                  <img
                    src={`/api/dateien/${standard}`}
                    alt="Standardbild"
                    className="aspect-square w-full object-cover outline outline-1 outline-linie"
                  />
                  <span className="text-[11px] font-semibold tracking-[0.08em] text-text-hinweis uppercase">
                    Standard
                  </span>
                </li>
              )}

              {alle.map((a, i) => (
                <li key={a.dateiId} className="flex flex-col gap-1">
                  <img
                    src={`/api/dateien/${a.dateiId}`}
                    alt={`Avatar ${String(i + 1)}`}
                    className="aspect-square w-full object-cover outline outline-1 outline-linie"
                  />
                  <span className="flex flex-wrap items-center justify-between gap-1">
                    <span className="flex gap-1">
                      <Knopf
                        art="still"
                        className="h-8 w-8 px-0 text-[13px]"
                        aria-label={`Avatar ${String(i + 1)} nach vorn`}
                        disabled={i === 0}
                        onClick={() => void verschiebe(i, i - 1)}
                      >
                        ←
                      </Knopf>
                      <Knopf
                        art="still"
                        className="h-8 w-8 px-0 text-[13px]"
                        aria-label={`Avatar ${String(i + 1)} nach hinten`}
                        disabled={i === alle.length - 1}
                        onClick={() => void verschiebe(i, i + 1)}
                      >
                        →
                      </Knopf>
                    </span>
                    <Knopf
                      art="still"
                      className="h-8 w-8 px-0"
                      aria-label={`Avatar ${String(i + 1)} entfernen`}
                      onClick={() => {
                        setzeFehler(null);
                        setzeZuLoeschen(a.dateiId);
                      }}
                    >
                      <Muelleimer />
                    </Knopf>
                  </span>
                </li>
              ))}
            </ul>
          </Zustand>
        </div>
      </details>

      {/*
        Rückfrage statt sofortigem Löschen. Kein Tippwort: das wäre für ein Schmuckbild zu
        viel, und der Schaden ist umkehrbar, solange die Datei noch im Repo liegt.
      */}
      <Rueckfrage
        offen={zuLoeschen !== null}
        aufOffen={(o) => {
          if (!o) setzeZuLoeschen(null);
        }}
        titel="Avatar entfernen?"
        bestaetigenText="Entfernen"
        art="gefahr"
        aufBestaetigen={() => {
          if (zuLoeschen !== null) void loesche(zuLoeschen);
        }}
      >
        <p>Das Bild steht am Tablet nicht mehr zur Auswahl.</p>
        <p>
          Besucher, die es tragen, bekommen wieder das <b>Standardbild</b>.
        </p>
      </Rueckfrage>
    </Flaeche>
  );
}
