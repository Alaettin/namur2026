import { useEffect, useState } from "react";
import { ApiFehler, api, useAbruf } from "../lib/api.js";
import { Blaetterleiste, useBlaettern, useSprungZuEintrag } from "../bausteine/blaettern.js";
import {
  Feld,
  Fehlerhinweis,
  Flaeche,
  Knopf,
  Kopfzelle,
  Markierung,
  Monowert,
  Tabellenflaeche,
  Ueberschrift,
  Zelle,
  Zustand,
} from "../bausteine/basis.js";
import { Rueckfrage, Schaufenster } from "../bausteine/dialog.js";

interface Nutzerzeile {
  id: string;
  name: string;
  email: string;
  rolle: "admin" | "betreuer";
  aktiv: boolean;
  zuletztAngemeldet: number | null;
  exponate: string[];
}

export function Nutzer() {
  const abruf = useAbruf<Nutzerzeile[]>("/api/nutzer");
  const { seite, zuSeite, sichtbar, gesamt } = useBlaettern(abruf.daten ?? []);
  const springeZu = useSprungZuEintrag(abruf.daten ?? [], zuSeite);
  const [fehler, setzeFehler] = useState<string | null>(null);
  /** Wird genau einmal angezeigt, nach dem Anlegen oder Zuruecksetzen. */
  const [startpasswort, setzeStartpasswort] = useState<{ email: string; wert: string } | null>(
    null,
  );
  const [name, setzeName] = useState("");
  const [email, setzeEmail] = useState("");
  const [rolle, setzeRolle] = useState<"admin" | "betreuer">("betreuer");
  const [frage, setzeFrage] = useState<Nutzerzeile | null>(null);
  const [zuweisen, setzeZuweisen] = useState<Nutzerzeile | null>(null);

  function melde(ursache: unknown, ersatz: string) {
    setzeFehler(ursache instanceof ApiFehler ? ursache.message : ersatz);
  }

  return (
    <>
      <Ueberschrift>Nutzer</Ueberschrift>

      {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

      {startpasswort !== null && (
        <Flaeche className="flex flex-col gap-3 border-l-4 border-primaer p-6">
          <h2 className="text-lg font-semibold">Startpasswort für {startpasswort.email}</h2>
          <Monowert wert={startpasswort.wert} />
          <p className="text-[13px] text-text-hinweis">
            Es wird <b>nur jetzt</b> angezeigt und nirgends gespeichert. Geht es verloren, setzt du
            einfach ein neues.
          </p>
          <Knopf
            art="rand"
            className="self-start"
            onClick={() => {
              setzeStartpasswort(null);
            }}
          >
            Verstanden
          </Knopf>
        </Flaeche>
      )}

      <Flaeche className="flex flex-col gap-4 p-6">
        <h2 className="text-lg font-semibold">Nutzer anlegen</h2>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(ev) => {
            ev.preventDefault();
            setzeFehler(null);
            void api<{ id: string; email: string; startpasswort: string }>("/api/nutzer", {
              method: "POST",
              body: JSON.stringify({ name, email, rolle }),
            })
              .then((angelegt) => {
                setzeStartpasswort({ email: angelegt.email, wert: angelegt.startpasswort });
                setzeName("");
                setzeEmail("");
                abruf.neu();
                springeZu(angelegt.id);
              })
              .catch((u: unknown) => {
                melde(u, "Anlegen nicht möglich.");
              });
          }}
        >
          <label className="flex min-w-[12rem] flex-1 flex-col gap-2 text-[13px] font-semibold">
            Name
            <Feld
              required
              value={name}
              onChange={(e) => {
                setzeName(e.target.value);
              }}
            />
          </label>
          <label className="flex min-w-[14rem] flex-1 flex-col gap-2 text-[13px] font-semibold">
            E-Mail
            <Feld
              type="email"
              required
              value={email}
              onChange={(e) => {
                setzeEmail(e.target.value);
              }}
            />
          </label>
          <label className="flex flex-col gap-2 text-[13px] font-semibold">
            Rolle
            <select
              value={rolle}
              onChange={(e) => {
                setzeRolle(e.target.value as "admin" | "betreuer");
              }}
              className="h-11 rounded-none border border-linie-feld bg-flaeche px-3 text-[15px]"
            >
              <option value="betreuer">Betreuer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <Knopf type="submit">Anlegen</Knopf>
        </form>
      </Flaeche>

      <Zustand laedt={abruf.laedt} fehler={abruf.fehler}>
        <Tabellenflaeche>
          <table className="w-full min-w-[780px] border-collapse text-sm">
            <thead>
              <tr>
                <Kopfzelle>Name</Kopfzelle>
                <Kopfzelle>E-Mail</Kopfzelle>
                <Kopfzelle>Rolle</Kopfzelle>
                <Kopfzelle>Exponate</Kopfzelle>
                <Kopfzelle className="text-right">
                  <span className="sr-only">Aktionen</span>
                </Kopfzelle>
              </tr>
            </thead>
            <tbody>
              {sichtbar.map((n) => (
                <tr key={n.id}>
                  <Zelle className="font-semibold">
                    <span className="flex items-center gap-2">
                      {n.name}
                      {!n.aktiv && <Markierung text="GESPERRT" farbe="var(--color-fehler)" />}
                    </span>
                  </Zelle>
                  <Zelle className="text-text-zweit">{n.email}</Zelle>
                  <Zelle>
                    {n.rolle === "admin" ? (
                      <Markierung text="ADMIN" />
                    ) : (
                      <Markierung text="BETREUER" farbe="var(--color-text-zweit)" />
                    )}
                  </Zelle>
                  <Zelle>
                    {n.rolle === "admin" ? (
                      // Ein Admin kommt an jedes Exponat, eine Zuweisung waere ohne Wirkung.
                      <span className="text-text-hinweis">alle</span>
                    ) : (
                      <Knopf
                        art="still"
                        className="h-8 px-3 text-[13px]"
                        onClick={() => {
                          setzeFehler(null);
                          setzeZuweisen(n);
                        }}
                      >
                        {n.exponate.length} zuweisen
                      </Knopf>
                    )}
                  </Zelle>
                  <Zelle className="text-right">
                    <span className="flex flex-wrap justify-end gap-2">
                      <Knopf
                        art="still"
                        className="h-8 px-3 text-[13px]"
                        onClick={() => {
                          setzeFehler(null);
                          void api<{ startpasswort: string }>(`/api/nutzer/${n.id}/passwort`, {
                            method: "POST",
                          })
                            .then((a) => {
                              setzeStartpasswort({ email: n.email, wert: a.startpasswort });
                            })
                            .catch((u: unknown) => {
                              melde(u, "Zurücksetzen nicht möglich.");
                            });
                        }}
                      >
                        Passwort
                      </Knopf>
                      <Knopf
                        art="still"
                        className="h-8 px-3 text-[13px]"
                        onClick={() => {
                          setzeFehler(null);
                          if (n.aktiv) {
                            setzeFrage(n);
                            return;
                          }
                          void api(`/api/nutzer/${n.id}/aktiv`, {
                            method: "POST",
                            body: JSON.stringify({ aktiv: true }),
                          })
                            .then(abruf.neu)
                            .catch((u: unknown) => {
                              melde(u, "Nicht möglich.");
                            });
                        }}
                      >
                        {n.aktiv ? "Deaktivieren" : "Aktivieren"}
                      </Knopf>
                    </span>
                  </Zelle>
                </tr>
              ))}
            </tbody>
          </table>
        </Tabellenflaeche>
      </Zustand>

      <Blaetterleiste seite={seite} gesamt={gesamt} aufSeite={zuSeite} />

      <ExponatZuweisung
        nutzer={zuweisen}
        aufSchliessen={() => {
          setzeZuweisen(null);
        }}
        aufGespeichert={abruf.neu}
        aufFehler={setzeFehler}
      />

      <Rueckfrage
        offen={frage !== null}
        aufOffen={(o) => {
          if (!o) setzeFrage(null);
        }}
        titel="Nutzer deaktivieren?"
        bestaetigenText="Deaktivieren"
        art="gefahr"
        aufBestaetigen={() => {
          if (frage === null) return;
          void api(`/api/nutzer/${frage.id}/aktiv`, {
            method: "POST",
            body: JSON.stringify({ aktiv: false }),
          })
            .then(() => {
              setzeFrage(null);
              abruf.neu();
            })
            .catch((u: unknown) => {
              melde(u, "Nicht möglich.");
              setzeFrage(null);
            });
        }}
      >
        <p>
          <b>{frage?.name}</b> kann sich danach nicht mehr anmelden, und eine laufende Sitzung endet
          bei der nächsten Anfrage.
        </p>
        <p>
          Der Zugang bleibt bestehen und lässt sich jederzeit wieder aktivieren. Bereits
          vorgenommene Zuordnungen bleiben ihm zugeschrieben.
        </p>
      </Rueckfrage>
    </>
  );
}

/**
 * Welche Exponate ein Betreuer betreut.
 *
 * Gespeichert wird die **ganze Liste auf einmal**: `setzeExponateVonNutzer` ersetzt, statt
 * zu ergänzen, und zwar in einer Transaktion. Wer ein Häkchen entfernt, erwartet, dass es
 * weg ist.
 *
 * Die Route gab es seit Auftrag 1, nur hatte die Oberfläche nie ein Formular dafür: ein
 * Betreuer ließ sich schlicht keinem Exponat zuweisen.
 */
function ExponatZuweisung({
  nutzer,
  aufSchliessen,
  aufGespeichert,
  aufFehler,
}: {
  nutzer: { id: string; name: string; exponate: string[] } | null;
  aufSchliessen: () => void;
  aufGespeichert: () => void;
  aufFehler: (text: string | null) => void;
}) {
  const abruf = useAbruf<{ id: string; kennung: string; name: string }[]>(
    nutzer === null ? null : "/api/exponate",
  );
  const [gewaehlt, setzeGewaehlt] = useState<Set<string>>(new Set());
  const [laeuft, setzeLaeuft] = useState(false);

  // Beim Öffnen einmal mit dem aktuellen Stand vorbelegen.
  useEffect(() => {
    if (nutzer === null) return;
    setzeGewaehlt(new Set(nutzer.exponate));
  }, [nutzer]);

  async function speichern() {
    if (nutzer === null) return;
    setzeLaeuft(true);
    aufFehler(null);
    try {
      await api(`/api/nutzer/${nutzer.id}/exponate`, {
        method: "PUT",
        body: JSON.stringify({ exponate: [...gewaehlt] }),
      });
      aufGespeichert();
      aufSchliessen();
    } catch (ursache) {
      aufFehler(ursache instanceof ApiFehler ? ursache.message : "Zuweisen nicht möglich.");
    } finally {
      setzeLaeuft(false);
    }
  }

  return (
    <Schaufenster
      offen={nutzer !== null}
      aufOffen={(o) => {
        if (!o) aufSchliessen();
      }}
      titel={nutzer === null ? "Exponate" : `Exponate von ${nutzer.name}`}
    >
      <Zustand
        laedt={abruf.laedt}
        fehler={abruf.fehler}
        leer={abruf.daten !== null && abruf.daten.length === 0}
        leerText="Es gibt noch keine Exponate."
      >
        <ul className="flex max-h-[50dvh] flex-col overflow-y-auto">
          {abruf.daten?.map((e) => (
            <li key={e.id} className="border-b border-linie last:border-b-0">
              <label className="flex cursor-pointer items-center gap-3 py-3 text-sm">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-primaer"
                  checked={gewaehlt.has(e.id)}
                  onChange={(ev) => {
                    const neu = new Set(gewaehlt);
                    if (ev.target.checked) neu.add(e.id);
                    else neu.delete(e.id);
                    setzeGewaehlt(neu);
                  }}
                />
                <span className="flex min-w-0 items-center gap-3">
                  <code className="font-mono text-xs text-text-hinweis">{e.kennung}</code>
                  <span className="truncate font-medium">{e.name}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </Zustand>

      <p className="text-[13px] text-text-hinweis">
        Ein Betreuer sieht nur die hier gewählten Exponate und kann nur dort scannen.
      </p>

      <div className="flex flex-wrap justify-end gap-3">
        <Knopf art="rand" onClick={aufSchliessen} disabled={laeuft}>
          Abbrechen
        </Knopf>
        <Knopf disabled={laeuft} onClick={() => void speichern()}>
          {laeuft ? "Wird gespeichert …" : "Speichern"}
        </Knopf>
      </div>
    </Schaufenster>
  );
}
