import { useEffect, useState } from "react";
import { ApiFehler, api, useAbruf } from "../lib/api.js";
import { Blaetterleiste, useBlaettern, useSprungZuEintrag } from "../bausteine/blaettern.js";
import {
  Feld,
  Fehlerhinweis,
  Knopf,
  Kopfzelle,
  Reihe,
  Tabellenflaeche,
  Ueberschrift,
  Zelle,
  Zustand,
} from "../bausteine/basis.js";
import { Rueckfrage, Schaufenster } from "../bausteine/dialog.js";

/**
 * Ansprechpartner als eigenständige Stammdaten.
 *
 * Sie gehören **keinem** Exponat: mehrere Stände können denselben Menschen nennen, und
 * früher stand er dann doppelt im Bestand und lief beim Korrigieren auseinander. Am Exponat
 * wird nur noch ausgewählt.
 */

export const KONTAKTFELDER = [
  { name: "vorname", text: "Vorname", pflicht: true },
  { name: "nachname", text: "Nachname", pflicht: true },
  { name: "firma", text: "Firma" },
  { name: "position", text: "Position" },
  { name: "email", text: "E-Mail", typ: "email" },
  { name: "strasse", text: "Straße" },
  { name: "plz", text: "PLZ" },
  { name: "ort", text: "Ort" },
  { name: "land", text: "Land" },
  { name: "website", text: "Website" },
] as const;

export interface Person {
  id: string;
  vorname: string;
  nachname: string;
  firma: string | null;
  position: string | null;
  email: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  land: string | null;
  website: string | null;
  exponate: string[];
}

export function Ansprechpartner() {
  const abruf = useAbruf<Person[]>("/api/ansprechpartner");
  const { seite, zuSeite, sichtbar, gesamt } = useBlaettern(abruf.daten ?? []);
  const springeZu = useSprungZuEintrag(abruf.daten ?? [], zuSeite);
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [bearbeiten, setzeBearbeiten] = useState<Person | "neu" | null>(null);
  const [loeschen, setzeLoeschen] = useState<Person | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Ueberschrift>Ansprechpartner</Ueberschrift>
        <Knopf
          onClick={() => {
            setzeFehler(null);
            setzeBearbeiten("neu");
          }}
        >
          Ansprechpartner anlegen
        </Knopf>
      </div>

      {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

      <Zustand
        laedt={abruf.laedt}
        fehler={abruf.fehler}
        leer={abruf.daten !== null && abruf.daten.length === 0}
        leerText="Noch keine Ansprechpartner angelegt."
      >
        <Tabellenflaeche>
          <table className="w-full border-collapse text-sm max-sm:block sm:min-w-[720px]">
            <thead className="max-sm:hidden">
              <tr>
                <Kopfzelle>Name</Kopfzelle>
                <Kopfzelle>Firma und Position</Kopfzelle>
                <Kopfzelle>E-Mail</Kopfzelle>
                <Kopfzelle>Exponate</Kopfzelle>
                <Kopfzelle className="text-right">
                  <span className="sr-only">Aktionen</span>
                </Kopfzelle>
              </tr>
            </thead>
            <tbody className="max-sm:block">
              {sichtbar.map((p) => (
                <Reihe key={p.id}>
                  <Zelle className="font-semibold">
                    {p.vorname} {p.nachname}
                  </Zelle>
                  <Zelle titel="Firma">
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{p.firma ?? "—"}</span>
                      {p.position !== null && (
                        <span className="text-xs text-text-hinweis">{p.position}</span>
                      )}
                    </span>
                  </Zelle>
                  <Zelle titel="E-Mail" className="text-text-zweit">
                    {p.email ?? "—"}
                  </Zelle>
                  <Zelle titel="Exponate" className="text-text-zweit">
                    {p.exponate.length}
                  </Zelle>
                  <Zelle className="text-right">
                    <span className="flex flex-wrap justify-end gap-2">
                      <Knopf
                        art="still"
                        className="h-8 px-3 text-[13px]"
                        onClick={() => {
                          setzeFehler(null);
                          setzeBearbeiten(p);
                        }}
                      >
                        Bearbeiten
                      </Knopf>
                      <Knopf
                        art="still"
                        className="h-8 px-3 text-[13px]"
                        onClick={() => {
                          setzeFehler(null);
                          setzeLoeschen(p);
                        }}
                      >
                        Löschen
                      </Knopf>
                    </span>
                  </Zelle>
                </Reihe>
              ))}
            </tbody>
          </table>
        </Tabellenflaeche>
      </Zustand>

      <Blaetterleiste seite={seite} gesamt={gesamt} aufSeite={zuSeite} />

      <PersonFormular
        person={bearbeiten}
        aufSchliessen={() => {
          setzeBearbeiten(null);
        }}
        aufGespeichert={(neueId) => {
          abruf.neu();
          if (neueId !== undefined) springeZu(neueId);
        }}
      />

      <Rueckfrage
        offen={loeschen !== null}
        aufOffen={(o) => {
          if (!o) setzeLoeschen(null);
        }}
        titel="Ansprechpartner löschen?"
        bestaetigenText="Löschen"
        art="gefahr"
        aufBestaetigen={() => {
          if (loeschen === null) return;
          void api(`/api/ansprechpartner/${loeschen.id}`, { method: "DELETE" })
            .then(() => {
              setzeLoeschen(null);
              abruf.neu();
            })
            .catch((u: unknown) => {
              setzeFehler(u instanceof ApiFehler ? u.message : "Löschen nicht möglich.");
              setzeLoeschen(null);
            });
        }}
      >
        <p>
          <b>
            {loeschen?.vorname} {loeschen?.nachname}
          </b>{" "}
          wird entfernt.
        </p>
        {loeschen !== null && loeschen.exponate.length > 0 ? (
          <p>
            Die Person steht an <b>{loeschen.exponate.length} Exponaten</b>. Dort verschwindet sie,
            und Besucher, denen sie schon zugeordnet wurde, sehen sie nicht mehr im Viewer.
          </p>
        ) : (
          <p>Sie ist noch keinem Exponat zugewiesen.</p>
        )}
      </Rueckfrage>
    </>
  );
}

/** Anlegen und Bearbeiten teilen sich das Formular; es unterscheidet nur am Titel. */
function PersonFormular({
  person,
  aufSchliessen,
  aufGespeichert,
}: {
  person: Person | "neu" | null;
  aufSchliessen: () => void;
  aufGespeichert: (neueId?: string) => void;
}) {
  const [werte, setzeWerte] = useState<Record<string, string>>({});
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);

  /*
   * Beim Öffnen einmal vorbelegen. Die Abhängigkeit ist `person` selbst: ein neuer Aufruf
   * mit einer anderen Person füllt neu, ein erneutes Rendern mit derselben nicht.
   */
  useEffect(() => {
    if (person === null) return;
    if (person === "neu") {
      setzeWerte({});
      return;
    }
    const vorbelegt: Record<string, string> = {};
    for (const f of KONTAKTFELDER) vorbelegt[f.name] = person[f.name] ?? "";
    setzeWerte(vorbelegt);
  }, [person]);

  async function speichern() {
    if (person === null) return;
    setzeLaeuft(true);
    setzeFehler(null);
    try {
      if (person === "neu") {
        const angelegt = await api<{ id: string }>("/api/ansprechpartner", {
          method: "POST",
          body: JSON.stringify(werte),
        });
        aufGespeichert(angelegt.id);
        aufSchliessen();
        return;
      } else {
        await api(`/api/ansprechpartner/${person.id}`, {
          method: "PATCH",
          body: JSON.stringify(werte),
        });
      }
      aufGespeichert();
      aufSchliessen();
    } catch (ursache) {
      setzeFehler(ursache instanceof ApiFehler ? ursache.message : "Speichern nicht möglich.");
    } finally {
      setzeLaeuft(false);
    }
  }

  const vollstaendig =
    (werte["vorname"] ?? "").trim() !== "" && (werte["nachname"] ?? "").trim() !== "";

  return (
    <Schaufenster
      offen={person !== null}
      aufOffen={(o) => {
        if (!o) aufSchliessen();
      }}
      titel={person === "neu" ? "Ansprechpartner anlegen" : "Ansprechpartner bearbeiten"}
    >
      {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

      <form
        className="flex flex-col gap-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          void speichern();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {KONTAKTFELDER.map((f) => (
            <label key={f.name} className="flex flex-col gap-2 text-[13px] font-semibold">
              {f.text}
              <Feld
                type={"typ" in f ? f.typ : "text"}
                required={"pflicht" in f}
                value={werte[f.name] ?? ""}
                onChange={(ev) => {
                  setzeWerte((w) => ({ ...w, [f.name]: ev.target.value }));
                }}
              />
            </label>
          ))}
        </div>

        <div className="flex flex-wrap justify-end gap-3">
          <Knopf art="rand" onClick={aufSchliessen} disabled={laeuft}>
            Abbrechen
          </Knopf>
          <Knopf type="submit" disabled={!vollstaendig || laeuft}>
            {laeuft ? "Wird gespeichert …" : "Speichern"}
          </Knopf>
        </div>
      </form>
    </Schaufenster>
  );
}
