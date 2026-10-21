import { useState } from "react";
import { ApiFehler, api, useAbruf } from "../lib/api.js";
import { Fehlerhinweis, Flaeche, Zustand } from "../bausteine/basis.js";

/**
 * Welche Events der Carrera-Bahn zaehlen, ein Abschnitt der Einstellungen. Seit dem 21.10.2026.
 *
 * Die Bahn schickt mit jeder Runde ihr Event mit ("DevTest" zum Testen, auf der HV etwa
 * "NHV-2026"). Angehakte Events zaehlen in Bestenliste, Besucherdetail und Viewer; nichts
 * angehakt heisst alle. **Jeder Haken gilt sofort**, wie die Kaestchen im Besucherdetail:
 * ein Speichern-Knopf hiesse, dass die Kaestchen etwas zeigen, das noch nicht gilt.
 */

interface Event {
  eventId: string;
  eventName: string | null;
  runden: number;
  gewertet: boolean;
}

export function CarreraEvents() {
  const abruf = useAbruf<{ events: Event[] }>("/api/carrera/events");
  const [events, setzeEvents] = useState<Event[] | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);
  const [fehler, setzeFehler] = useState<string | null>(null);

  // Nach einer Aenderung gilt die Antwort des Servers, vorher der Abruf.
  const liste = events ?? abruf.daten?.events ?? [];

  async function umschalten(eventId: string, an: boolean) {
    const vorher = liste;
    const neu = liste.map((e) => (e.eventId === eventId ? { ...e, gewertet: an } : e));
    /*
     * **Der Haken steht sofort**, nicht erst nach der Antwort. Sonst bleibt das Kaestchen
     * nach dem Klick einen Moment unveraendert und man klickt ein zweites Mal. Lehnt der
     * Server ab, springt es zurueck.
     */
    setzeEvents(neu);
    setzeLaeuft(true);
    setzeFehler(null);
    try {
      const antwort = await api<{ events: Event[] }>("/api/carrera/events", {
        method: "PUT",
        body: JSON.stringify({ eventIds: neu.filter((e) => e.gewertet).map((e) => e.eventId) }),
      });
      setzeEvents(antwort.events);
    } catch (ursache) {
      setzeEvents(vorher);
      setzeFehler(
        ursache instanceof ApiFehler ? ursache.message : "Der Aufruf ist nicht durchgekommen.",
      );
    } finally {
      setzeLaeuft(false);
    }
  }

  const keinerAn = !liste.some((e) => e.gewertet);

  return (
    <Flaeche className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Carrera: welche Events zählen?</h2>
        <p className="max-w-prose text-sm text-text-zweit">
          Angehakte Events zählen in Bestenliste, Besucherdetail und Viewer.{" "}
          <b>Nichts angehakt: alle Events zählen.</b> Gelöscht wird nichts, die übrigen Runden
          werden nur nicht angezeigt.
        </p>
      </div>

      <Zustand
        laedt={abruf.laedt}
        fehler={abruf.fehler}
        leer={liste.length === 0}
        leerText="Noch keine Runde gemeldet. Jedes Event erscheint hier, sobald die Bahn die erste Runde dafür schickt."
      >
        <ul aria-label="Carrera-Events" className="flex flex-col divide-y divide-linie">
          {liste.map((e) => (
            <li key={e.eventId}>
              <label className="flex min-h-[48px] cursor-pointer items-center gap-3 py-1.5 text-sm">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-primaer"
                  checked={e.gewertet}
                  disabled={laeuft}
                  onChange={(ev) => void umschalten(e.eventId, ev.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    {e.eventId === "" ? "(ohne Event)" : e.eventId}
                  </span>
                  {e.eventName !== null && e.eventName !== e.eventId && (
                    <span className="text-text-hinweis"> · {e.eventName}</span>
                  )}
                </span>
                <span className="shrink-0 text-text-zweit tabular-nums">
                  {e.runden} {e.runden === 1 ? "Runde" : "Runden"}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {keinerAn && <p className="text-[13px] text-text-hinweis">Zurzeit zählen alle Events.</p>}
      </Zustand>

      {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}
    </Flaeche>
  );
}
