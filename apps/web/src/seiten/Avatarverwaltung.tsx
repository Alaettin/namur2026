import { useRef, useState } from "react";
import { ApiFehler, api, useAbruf } from "../lib/api.js";
import { Fehlerhinweis, Flaeche, Knopf, Zustand, knopfKlassen } from "../bausteine/basis.js";

/**
 * Die Avatare, die am Selbstbedienungs-Tablet zur Auswahl stehen.
 *
 * **Verkleinert wird hier im Browser**, nicht auf dem Server: 512 px, JPEG. Das spart eine
 * Bildbibliothek im Server, und ein natives Modul wäre im Container der nächste
 * Stolperstein. Der Server verlässt sich darauf aber nicht, er prüft Typ und Größe selbst.
 *
 * Sortiert wird mit Pfeilen, nicht per Ziehen und Ablegen: bedienbar mit der Tastatur, und
 * vor allem prüfbar.
 */

const KANTE = 512;
const GUETE = 0.82;

interface Zeile {
  dateiId: string;
  sortierung: number;
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
  const abruf = useAbruf<{ avatare: Zeile[] }>("/api/avatare");
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);
  const feld = useRef<HTMLInputElement | null>(null);

  const alle = abruf.daten?.avatare ?? [];

  async function waehle(dateien: FileList | null) {
    // **Erst die Liste sichern, dann das Feld leeren**, sonst ist sie beim Zugriff weg.
    const gewaehlt = Array.from(dateien ?? []);
    if (feld.current !== null) feld.current.value = "";
    if (gewaehlt.length === 0) return;

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
      abruf.neu();
    } catch {
      setzeFehler("Das Bild ließ sich nicht entfernen.");
    }
  }

  return (
    <Flaeche className="flex flex-col gap-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Avatare für das Tablet</h2>
          <p className="text-[13px] text-text-hinweis">
            {alle.length} zur Auswahl. Besucher, deren Bild entfernt wird, bekommen wieder das
            Standardbild.
          </p>
        </div>
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
      </div>

      {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

      <Zustand
        laedt={abruf.laedt}
        fehler={abruf.fehler}
        leer={alle.length === 0}
        leerText="Kein Bild zur Auswahl. Am Tablet bleibt dann nur das Standardbild."
      >
        {/*
          Bei 390 px nur zwei Spalten: drei lassen fuer zwei Pfeile plus "Entfernen" keinen
          Platz, und die Zeile schob die ganze Seite waagerecht hinaus.
        */}
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-5 lg:grid-cols-6">
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
                  className="h-8 px-2 text-[13px]"
                  aria-label={`Avatar ${String(i + 1)} entfernen`}
                  onClick={() => void loesche(a.dateiId)}
                >
                  Entfernen
                </Knopf>
              </span>
            </li>
          ))}
        </ul>
      </Zustand>
    </Flaeche>
  );
}
