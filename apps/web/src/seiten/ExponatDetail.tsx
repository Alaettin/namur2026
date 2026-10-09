import { useState, type ChangeEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiFehler, api, useAbruf } from "../lib/api.js";
import {
  Feld,
  Fehlerhinweis,
  Flaeche,
  Knopf,
  Markierung,
  Ueberschrift,
  Zustand,
  knopfKlassen,
} from "../bausteine/basis.js";
import { Rueckfrage, Schaufenster } from "../bausteine/dialog.js";
import type { Ich } from "../lib/ich.js";
import { type Person } from "./Ansprechpartner.js";
import { PERSONENFELDER } from "../lib/personenfelder.js";

/** Obergrenzen, dieselben wie im Modell auf dem Server. */
const MAX = { dokumente: 10, links: 10, kontakte: 5 };

/**
 * Ist das ein Bild, das sich in einem Fenster zeigen lässt?
 *
 * **Nicht `startsWith("image/")`.** `image/vnd.dwg` und `image/vnd.dxf` sind bei IANA unter
 * `image/` registriert, sind aber CAD-Zeichnungen, die kein Browser darstellt. Dieselbe
 * Regel steht serverseitig in `services/mime.ts`; sie ist hier wiederholt, weil die
 * Oberfläche sie ohne Rückfrage braucht.
 */
function istBild(mimeType: string | null): boolean {
  if (mimeType === null || !mimeType.startsWith("image/")) return false;
  return !mimeType.startsWith("image/vnd.");
}

interface Dokument {
  id: string;
  platz: number;
  titel: string;
  beschreibung: string | null;
  dateiId: string;
  mimeType: string | null;
  originalName: string | null;
  groesse: number | null;
}

interface LinkEintrag {
  id: string;
  platz: number;
  titel: string;
  url: string;
}

/**
 * Ein Ansprechpartner **an diesem Exponat**: die Stammdaten plus der Platz aus der
 * Zuweisung. Ohne Foto, das gibt es seit dem 08.10.2026 nicht mehr.
 */
interface Kontakt {
  id: string;
  platz: number;
  titel: string | null;
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
  /** Die Schau liest die Felder ueber `PERSONENFELDER`, also ueber den Namen. */
  [feld: string]: unknown;
}

interface ExponatDaten {
  id: string;
  kennung: string;
  name: string;
  beschreibung: string | null;
  dokumente: Dokument[];
  links: LinkEintrag[];
  kontakte: Kontakt[];
  betreuer: string[];
  scanbar: boolean;
  /** Verschiedene Besucher, denen an diesem Exponat schon etwas zugeordnet wurde. */
  betroffeneBesucher: number;
}

/** Ein Symbol, das eine Adresse in einem neuen Tab öffnet. */
function OeffnenLink({ ziel, titel }: { ziel: string; titel: string }) {
  return (
    <a
      href={ziel}
      target="_blank"
      /*
       * Ein gewöhnlicher Link, **kein `window.open` mit Feature-String**: der öffnet unter
       * iOS keinen Tab. `noreferrer` hält die Adresse dieser Seite aus dem Protokoll des
       * Ziels, und sie trägt die Kennung des Exponats.
       */
      rel="noreferrer"
      aria-label={titel}
      title={titel}
      className="flex size-9 shrink-0 items-center justify-center text-text-hinweis hover:text-primaer-dunkel"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <path d="M15 3h6v6" />
        <path d="M10 14L21 3" />
      </svg>
    </a>
  );
}

/** Ein Symbol, das etwas in einem Fenster zeigt. */
function AnsehenKnopf({ titel, aufKlick }: { titel: string; aufKlick: () => void }) {
  return (
    <button
      type="button"
      aria-label={titel}
      title={titel}
      onClick={aufKlick}
      className="flex size-9 shrink-0 items-center justify-center text-text-hinweis hover:text-primaer-dunkel"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  );
}

export function ExponatDetail({ ich }: { ich: Ich }) {
  const { id } = useParams();
  const abruf = useAbruf<ExponatDaten>(`/api/exponate/${String(id)}`);
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [exponatLoeschen, setzeExponatLoeschen] = useState(false);
  const navigate = useNavigate();
  const [zuLoeschen, setzeZuLoeschen] = useState<{
    art: string;
    zielId: string;
    betroffene: number;
  } | null>(null);
  const [bildschau, setzeBildschau] = useState<{ dateiId: string; titel: string } | null>(null);
  const [kontaktschau, setzeKontaktschau] = useState<Kontakt | null>(null);
  const [kontaktNeu, setzeKontaktNeu] = useState(false);

  const istAdmin = ich.rolle === "admin";
  const e = abruf.daten;

  async function ladeDokumenteHoch(ereignis: ChangeEvent<HTMLInputElement>) {
    /*
     * **Erst die Liste sichern, dann das Feld leeren.** `input.value = ""` leert die
     * FileList an Ort und Stelle; wer danach darauf zugreift, schickt nichts hinaus, und
     * im Serverprotokoll fehlt der Aufruf ganz.
     */
    const dateien = Array.from(ereignis.target.files ?? []);
    ereignis.target.value = "";
    if (dateien.length === 0) return;

    setzeFehler(null);
    try {
      for (const datei of dateien) {
        const formular = new FormData();
        formular.append("datei", datei);
        const hoch = await api<{ id: string }>("/api/dateien", { method: "POST", body: formular });
        await api(`/api/exponate/${String(id)}/dokumente`, {
          method: "POST",
          body: JSON.stringify({ dateiId: hoch.id, titel: datei.name.replace(/\.[^.]+$/, "") }),
        });
      }
      abruf.neu();
    } catch (ursache) {
      setzeFehler(ursache instanceof ApiFehler ? ursache.message : "Hochladen nicht möglich.");
    }
  }

  async function frageBetroffene(art: string, zielId: string) {
    try {
      const antwort = await api<{ betroffene: number }>(
        `/api/exponate/${String(id)}/inhalte/${art}/${zielId}/betroffene`,
      );
      setzeZuLoeschen({ art, zielId, betroffene: antwort.betroffene });
    } catch {
      setzeZuLoeschen({ art, zielId, betroffene: 0 });
    }
  }

  /** Eine Zeile im Abschnitt: Platz, Beschriftung, Ansehen, Entfernen. */
  function Zeile({
    platz,
    text,
    unterzeile,
    werkzeug,
    art,
    zielId,
  }: {
    platz: number;
    text: string;
    unterzeile?: string;
    werkzeug?: ReactNode;
    art: "dokument" | "link" | "kontakt";
    zielId: string;
  }) {
    return (
      <li className="flex items-center justify-between gap-3 border-b border-linie py-2.5 text-sm last:border-b-0">
        <span className="flex min-w-0 items-center gap-3">
          <code className="shrink-0 font-mono text-xs text-text-hinweis">
            {String(platz).padStart(2, "0")}
          </code>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{text}</span>
            {unterzeile !== undefined && (
              <span className="truncate text-xs text-text-hinweis">{unterzeile}</span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {werkzeug}
          {istAdmin && (
            <Knopf
              art="still"
              className="h-8 px-3 text-[13px]"
              onClick={() => void frageBetroffene(art, zielId)}
            >
              Entfernen
            </Knopf>
          )}
        </span>
      </li>
    );
  }

  function Abschnitt({
    titel,
    anzahl,
    grenze,
    children,
    formular,
  }: {
    titel: string;
    anzahl: number;
    grenze: number;
    children: ReactNode;
    formular?: ReactNode;
  }) {
    const voll = anzahl >= grenze;
    return (
      <Flaeche className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            {titel} ({anzahl} von {grenze})
          </h2>
          {voll && <Markierung text="PLÄTZE VOLL" farbe="var(--color-fehler)" />}
        </div>
        {anzahl === 0 ? (
          <p className="text-sm text-text-hinweis">Noch nichts hinterlegt.</p>
        ) : (
          <ul className="flex flex-col">{children}</ul>
        )}
        {istAdmin && !voll && formular}
        {voll && (
          <p className="text-[13px] text-text-hinweis">
            Alle {grenze} Plätze sind belegt. Erst einen freigeben, dann lässt sich wieder etwas
            hinzufügen. Die Obergrenze zu ändern verlangt ein neues Mapping in Axon.
          </p>
        )}
      </Flaeche>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Ueberschrift>{e === null ? "Exponat" : `${e.kennung} ${e.name}`}</Ueberschrift>
        <div className="flex flex-wrap items-center gap-4">
          {e !== null && e.scanbar && (
            <Link to={`/exponate/${String(id)}/scan`}>
              <Knopf>Scannen</Knopf>
            </Link>
          )}
          {e !== null && istAdmin && (
            <Knopf
              art="gefahr"
              onClick={() => {
                setzeFehler(null);
                setzeExponatLoeschen(true);
              }}
            >
              Exponat löschen
            </Knopf>
          )}
          <Link to="/exponate" className="text-[13px] font-semibold text-primaer-dunkel">
            ← Zurück zur Liste
          </Link>
        </div>
      </div>

      <Zustand laedt={abruf.laedt} fehler={abruf.fehler}>
        {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

        {e !== null && (
          <>
            {!e.scanbar && (
              <Flaeche className="flex flex-col gap-2 p-6">
                <h2 className="text-lg font-semibold">Noch nichts zum Zuordnen</h2>
                <p className="text-sm text-text-zweit">
                  Solange dieses Exponat keine Dokumente, Links oder Ansprechpartner hat, bleibt das
                  Scannen gesperrt: ein Betreuer könnte einem Besucher nichts geben.
                </p>
              </Flaeche>
            )}

            <Abschnitt
              titel="Dokumente"
              anzahl={e.dokumente.length}
              grenze={MAX.dokumente}
              formular={
                <div className="flex flex-col gap-2 border-t border-linie pt-4">
                  {/*
                    Feld `sr-only`, Label als Knopf: neben einem sichtbaren Dateifeld setzt
                    der Browser seinen eigenen Text ("Keine Datei ausgewaehlt"), und der
                    ist mit CSS nicht erreichbar.
                  */}
                  <label className={knopfKlassen("rand", "cursor-pointer self-start")}>
                    Dokument hinzufügen
                    <input
                      type="file"
                      multiple
                      onChange={(ev) => void ladeDokumenteHoch(ev)}
                      className="sr-only"
                    />
                  </label>
                </div>
              }
            >
              {e.dokumente.map((d) => (
                <Zeile
                  key={d.id}
                  platz={d.platz}
                  text={d.titel}
                  unterzeile={d.originalName ?? undefined}
                  art="dokument"
                  zielId={d.id}
                  werkzeug={
                    istBild(d.mimeType) ? (
                      <AnsehenKnopf
                        titel="Bild ansehen"
                        aufKlick={() => {
                          setzeBildschau({ dateiId: d.dateiId, titel: d.titel });
                        }}
                      />
                    ) : (
                      <OeffnenLink ziel={`/api/dateien/${d.dateiId}`} titel="In neuem Tab öffnen" />
                    )
                  }
                />
              ))}
            </Abschnitt>

            <Abschnitt
              titel="Links"
              anzahl={e.links.length}
              grenze={MAX.links}
              formular={
                <LinkFormular
                  exponatId={String(id)}
                  aufAngelegt={abruf.neu}
                  aufFehler={setzeFehler}
                />
              }
            >
              {e.links.map((l) => (
                <Zeile
                  key={l.id}
                  platz={l.platz}
                  text={l.titel}
                  unterzeile={l.url}
                  art="link"
                  zielId={l.id}
                  werkzeug={<OeffnenLink ziel={l.url} titel="Link in neuem Tab öffnen" />}
                />
              ))}
            </Abschnitt>

            <Abschnitt
              titel="Ansprechpartner"
              anzahl={e.kontakte.length}
              grenze={MAX.kontakte}
              formular={
                <div className="border-t border-linie pt-4">
                  <Knopf
                    onClick={() => {
                      setzeFehler(null);
                      setzeKontaktNeu(true);
                    }}
                  >
                    Ansprechpartner hinzufügen
                  </Knopf>
                </div>
              }
            >
              {e.kontakte.map((c) => (
                <Zeile
                  key={c.id}
                  platz={c.platz}
                  text={`${c.vorname} ${c.nachname}`}
                  unterzeile={[c.firma, c.position].filter(Boolean).join(" · ") || undefined}
                  art="kontakt"
                  zielId={c.id}
                  werkzeug={
                    <AnsehenKnopf
                      titel="Ansprechpartner ansehen"
                      aufKlick={() => {
                        setzeKontaktschau(c);
                      }}
                    />
                  }
                />
              ))}
            </Abschnitt>
          </>
        )}
      </Zustand>

      {/* Bild in Groß */}
      <Schaufenster
        offen={bildschau !== null}
        aufOffen={(o) => {
          if (!o) setzeBildschau(null);
        }}
        titel={bildschau?.titel ?? "Bild"}
        breit
      >
        {bildschau !== null && (
          <img
            src={`/api/dateien/${bildschau.dateiId}`}
            alt={bildschau.titel}
            className="max-h-[70dvh] w-full bg-grund object-contain"
          />
        )}
      </Schaufenster>

      {/* Ansprechpartner im Detail */}
      <Schaufenster
        offen={kontaktschau !== null}
        aufOffen={(o) => {
          if (!o) setzeKontaktschau(null);
        }}
        titel={
          kontaktschau === null
            ? "Ansprechpartner"
            : `${kontaktschau.vorname} ${kontaktschau.nachname}`
        }
      >
        {kontaktschau !== null && (
          <div className="flex flex-col gap-5">
            {/* Kein Foto: Ansprechpartner tragen seit dem 08.10.2026 keines mehr. */}
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
              {PERSONENFELDER.map((f) => {
                const wert = kontaktschau[f.name];
                if (typeof wert !== "string" || wert === "") return null;
                return (
                  <div key={f.name} className="contents">
                    <dt className="font-semibold">{f.text}</dt>
                    <dd className="break-words text-text-zweit">{wert}</dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </Schaufenster>

      <KontaktAuswahl
        offen={kontaktNeu}
        aufOffen={setzeKontaktNeu}
        exponatId={String(id)}
        schonZugewiesen={e?.kontakte.map((c) => c.id) ?? []}
        aufZugewiesen={abruf.neu}
      />

      <Rueckfrage
        offen={zuLoeschen !== null}
        aufOffen={(o) => {
          if (!o) setzeZuLoeschen(null);
        }}
        titel="Inhalt entfernen?"
        bestaetigenText="Entfernen"
        art="gefahr"
        aufBestaetigen={() => {
          if (zuLoeschen === null) return;
          void api(`/api/exponate/${String(id)}/inhalte/${zuLoeschen.art}/${zuLoeschen.zielId}`, {
            method: "DELETE",
          }).then(() => {
            setzeZuLoeschen(null);
            abruf.neu();
          });
        }}
      >
        <p>
          {zuLoeschen !== null && zuLoeschen.betroffene > 0 ? (
            <>
              <b>{zuLoeschen.betroffene} Besucher</b> haben diesen Inhalt bereits zugeordnet
              bekommen. Er verschwindet auch bei ihnen aus dem Viewer.
            </>
          ) : (
            "Dieser Inhalt ist noch keinem Besucher zugeordnet."
          )}
        </p>
        <p>Der Platz wird frei und beim nächsten Hinzufügen wieder vergeben.</p>
      </Rueckfrage>

      {/*
        **Das ganze Exponat.** Mit Tippwort, und das Tippwort ist die Kennung: der Vorgang
        ist nicht umkehrbar und trifft Besucher, nicht nur den Bestand. Die Rückfrage nennt
        Zahlen statt "sind Sie sicher"; eine Warnung ohne Zahl ist eine Behauptung.
      */}
      {e !== null && (
        <Rueckfrage
          offen={exponatLoeschen}
          aufOffen={setzeExponatLoeschen}
          titel="Exponat löschen?"
          bestaetigenText="Endgültig löschen"
          art="gefahr"
          tippwort={e.kennung}
          aufBestaetigen={() => {
            void api(`/api/exponate/${String(id)}`, { method: "DELETE" })
              .then(() => {
                setzeExponatLoeschen(false);
                void navigate("/exponate");
              })
              .catch((ursache: unknown) => {
                setzeExponatLoeschen(false);
                setzeFehler(
                  ursache instanceof ApiFehler
                    ? ursache.message
                    : "Das Exponat ließ sich nicht löschen.",
                );
              });
          }}
        >
          <p>
            <b>
              {e.kennung} {e.name}
            </b>{" "}
            verschwindet mit allem, was daran hängt: {e.dokumente.length} Dokumente,{" "}
            {e.links.length} Links und {e.kontakte.length} Ansprechpartner-Zuweisungen.
          </p>
          <p>
            {e.betroffeneBesucher > 0 ? (
              <>
                <b>{e.betroffeneBesucher} Besucher</b> haben davon bereits etwas zugeordnet
                bekommen. Es verschwindet auch bei ihnen aus dem Viewer.
              </>
            ) : (
              "Bisher hat kein Besucher etwas von diesem Exponat zugeordnet bekommen."
            )}
          </p>
          <p>Die Ansprechpartner selbst bleiben in den Stammdaten erhalten.</p>
        </Rueckfrage>
      )}
    </>
  );
}

/** Titel und Adresse, direkt im Abschnitt. Zwei Felder brauchen kein eigenes Fenster. */
function LinkFormular({
  exponatId,
  aufAngelegt,
  aufFehler,
}: {
  exponatId: string;
  aufAngelegt: () => void;
  aufFehler: (text: string | null) => void;
}) {
  const [titel, setzeTitel] = useState("");
  const [url, setzeUrl] = useState("");
  const [laeuft, setzeLaeuft] = useState(false);

  return (
    <form
      className="flex flex-wrap items-end gap-3 border-t border-linie pt-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        aufFehler(null);
        setzeLaeuft(true);
        void api(`/api/exponate/${exponatId}/links`, {
          method: "POST",
          body: JSON.stringify({ titel, url }),
        })
          .then(() => {
            setzeTitel("");
            setzeUrl("");
            aufAngelegt();
          })
          .catch((u: unknown) => {
            aufFehler(u instanceof ApiFehler ? u.message : "Link ließ sich nicht anlegen.");
          })
          .finally(() => {
            setzeLaeuft(false);
          });
      }}
    >
      <label className="flex min-w-[12rem] flex-1 flex-col gap-2 text-[13px] font-semibold">
        Titel
        <Feld
          required
          value={titel}
          onChange={(ev) => {
            setzeTitel(ev.target.value);
          }}
          placeholder="Produktseite"
        />
      </label>
      <label className="flex min-w-[16rem] flex-[2] flex-col gap-2 text-[13px] font-semibold">
        Adresse
        <Feld
          required
          type="url"
          value={url}
          onChange={(ev) => {
            setzeUrl(ev.target.value);
          }}
          placeholder="https://"
        />
      </label>
      <Knopf type="submit" disabled={laeuft}>
        {laeuft ? "Wird angelegt …" : "Link hinzufügen"}
      </Knopf>
    </form>
  );
}

/**
 * Wählt einen **vorhandenen** Ansprechpartner aus und weist ihn dem Exponat zu.
 *
 * Angelegt werden sie unter Ansprechpartner: sie sind Stammdaten, die mehrere Exponate
 * teilen. Früher wurde hier angelegt, und derselbe Mensch stand dann an jedem Stand als
 * eigener Datensatz.
 */
function KontaktAuswahl({
  offen,
  aufOffen,
  exponatId,
  schonZugewiesen,
  aufZugewiesen,
}: {
  offen: boolean;
  aufOffen: (offen: boolean) => void;
  exponatId: string;
  schonZugewiesen: string[];
  aufZugewiesen: () => void;
}) {
  // Erst laden, wenn das Fenster offen ist: die Liste kann lang werden.
  const abruf = useAbruf<Person[]>(offen ? "/api/ansprechpartner" : null);
  const [suche, setzeSuche] = useState("");
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [laeuft, setzeLaeuft] = useState<string | null>(null);

  const begriff = suche.trim().toLowerCase();
  const offene = (abruf.daten ?? []).filter((p) => {
    if (schonZugewiesen.includes(p.id)) return false;
    if (begriff === "") return true;
    return `${p.vorname} ${p.nachname} ${p.firma ?? ""}`.toLowerCase().includes(begriff);
  });

  async function waehle(person: Person) {
    setzeLaeuft(person.id);
    setzeFehler(null);
    try {
      await api(`/api/exponate/${exponatId}/ansprechpartner`, {
        method: "POST",
        body: JSON.stringify({ ansprechpartnerId: person.id }),
      });
      aufZugewiesen();
      aufOffen(false);
    } catch (ursache) {
      setzeFehler(ursache instanceof ApiFehler ? ursache.message : "Zuweisen nicht möglich.");
    } finally {
      setzeLaeuft(null);
    }
  }

  return (
    <Schaufenster offen={offen} aufOffen={aufOffen} titel="Ansprechpartner auswählen" fliessend>
      {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

      <Feld
        type="search"
        placeholder="Nach Name oder Firma suchen"
        aria-label="Ansprechpartner suchen"
        value={suche}
        onChange={(ev) => {
          setzeSuche(ev.target.value);
        }}
      />

      <Zustand
        laedt={abruf.laedt}
        fehler={abruf.fehler}
        leer={abruf.daten !== null && offene.length === 0}
        leerText={
          begriff === ""
            ? "Alle vorhandenen Ansprechpartner stehen schon an diesem Exponat. Neue legst du unter Ansprechpartner an."
            : "Niemand passt zu dieser Suche."
        }
      >
        {/*
          `min-h-0 flex-1`: nur **diese** Liste laeuft, das Fenster selbst nicht. Vorher
          scrollten beide ineinander und der innere Balken lag ueber der Liste. `min-h-0`
          ist noetig, weil ein Flex-Kind sonst nicht unter seine Inhaltshoehe schrumpft.
        */}
        <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {offene.map((p) => (
            <li key={p.id} className="border-b border-linie last:border-b-0">
              <button
                type="button"
                disabled={laeuft !== null}
                onClick={() => void waehle(p)}
                className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm hover:bg-black/5 disabled:opacity-50"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">
                    {p.vorname} {p.nachname}
                  </span>
                  <span className="truncate text-xs text-text-hinweis">
                    {[p.firma, p.position].filter(Boolean).join(" · ") || "ohne Firma"}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-semibold text-primaer-dunkel">
                  {laeuft === p.id ? "…" : "Zuweisen"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Zustand>
    </Schaufenster>
  );
}
