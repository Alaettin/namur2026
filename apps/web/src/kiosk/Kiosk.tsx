import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ApiFehler, api, useAbruf } from "../lib/api.js";
import { Feld, Fehlerhinweis, Flaeche, Knopf, Ueberschrift, Zustand } from "../bausteine/basis.js";
import { Kamera, kameraMoeglich, type Kamerafehler } from "../scan/Kamera.js";
import type { Ich } from "../lib/ich.js";
import { GRUPPEN, PERSONENFELDER, felderDerGruppe, mitTitel } from "../lib/personenfelder.js";
import { Kioskrahmen } from "./Kioskrahmen.js";

/**
 * Das Selbstbedienungs-Tablet: Pass scannen, dann Stammdaten oder Avatar ändern.
 *
 * **Kein Eingabefeld für die GUID**, anders als im Betreuer-Scan. Die GUIDs sind
 * fortlaufend; mit einem Eingabefeld könnte am Tablet jeder die Daten eines beliebigen
 * anderen Besuchers öffnen, einfach durch Hochzählen. Der Schutz ist der physische Pass vor
 * der Kamera, und das Gerät gehört in den Kioskmodus des Browsers, ohne Adressleiste.
 *
 * Das ist eine Schranke der Bedienung, keine kryptografische; der Server kann nicht
 * unterscheiden, ob eine GUID von der Kamera kam oder erfunden wurde.
 */

type Feldname = string;

interface Besucher extends Record<Feldname, string | null> {
  guid: string;
  avatarDateiId: string | null;
}

// --- Scannen --------------------------------------------------------------------------

export function KioskScan({ ich, aufAbmelden }: { ich: Ich; aufAbmelden: () => void }) {
  const navigate = useNavigate();
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);

  const ausQr = useCallback(
    (inhalt: string) => {
      // Dieselbe Prüfung wie im Betreuer-Scan: ohne sie liefe jeder Werbe-QR-Code in eine
      // Serverabfrage.
      if (!inhalt.startsWith(ich.viewerBaseUrl)) {
        setzeFehler("Das ist kein Konferenzpass. Bitte den QR-Code auf dem Pass zeigen.");
        return;
      }
      const guid = inhalt.slice(ich.viewerBaseUrl.length).split(/[/?#]/)[0] ?? "";
      if (guid === "") {
        setzeFehler("Das ist kein Konferenzpass. Bitte den QR-Code auf dem Pass zeigen.");
        return;
      }
      setzeLaeuft(true);
      void navigate(`/kiosk/${encodeURIComponent(decodeURIComponent(guid))}`);
    },
    [ich.viewerBaseUrl, navigate],
  );

  return (
    <Kioskrahmen aufAbmelden={aufAbmelden} zeitsperre={false}>
      <Ueberschrift>Pass scannen</Ueberschrift>
      <p className="text-[17px] leading-relaxed text-text-zweit">
        Halte den QR-Code deines Konferenzpasses vor die Kamera. Danach kannst du deine Daten ändern
        und dir ein Bild aussuchen.
      </p>

      {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

      {kameraMoeglich() ? (
        <div className="overflow-hidden bg-black">
          <Kamera
            pausiert={laeuft}
            aufTreffer={ausQr}
            aufFehler={(art: Kamerafehler) => {
              setzeFehler(
                art === "verweigert"
                  ? "Die Kamera ist für diese Seite gesperrt. Bitte das Standpersonal ansprechen."
                  : "Die Kamera lässt sich nicht starten. Bitte das Standpersonal ansprechen.",
              );
            }}
          />
        </div>
      ) : (
        <Fehlerhinweis>
          Die Kamera ist hier nicht verfügbar. Browser geben sie nur über HTTPS frei. Bitte das
          Standpersonal ansprechen.
        </Fehlerhinweis>
      )}
    </Kioskrahmen>
  );
}

// --- Zwischenmenü ---------------------------------------------------------------------

export function KioskMenue({ aufAbmelden }: { aufAbmelden: () => void }) {
  const { guid } = useParams();
  const navigate = useNavigate();
  const abruf = useAbruf<Besucher>(`/api/kiosk/besucher/${String(guid)}`);
  const b = abruf.daten;

  return (
    <Kioskrahmen
      aufAbmelden={aufAbmelden}
      aufAblauf={() => {
        void navigate("/kiosk", { replace: true });
      }}
    >
      <Zustand laedt={abruf.laedt} fehler={abruf.fehler}>
        {b !== null && (
          <>
            <div className="flex flex-wrap items-center gap-5">
              {b.avatarDateiId !== null && (
                <img
                  src={`/api/dateien/${b.avatarDateiId}`}
                  alt="Dein Bild"
                  className="size-20 shrink-0 object-cover"
                />
              )}
              <div className="flex min-w-0 flex-col">
                <Ueberschrift>
                  Hallo {mitTitel(b.titel, b.vorname ?? "")} {b.nachname}
                </Ueberschrift>
                <span className="text-[15px] text-text-hinweis">{b.firma ?? "ohne Firma"}</span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Kachel
                titel="Daten ändern"
                text="Name, Firma, Anschrift und Kontakt."
                aufKlick={() => {
                  void navigate(`/kiosk/${String(guid)}/stammdaten`);
                }}
              />
              <Kachel
                titel="Bild aussuchen"
                text="Wähle ein Bild, das im Viewer erscheint."
                aufKlick={() => {
                  void navigate(`/kiosk/${String(guid)}/avatar`);
                }}
              />
            </div>

            <Knopf
              art="rand"
              className="self-start"
              onClick={() => {
                void navigate("/kiosk", { replace: true });
              }}
            >
              Fertig
            </Knopf>
          </>
        )}
      </Zustand>
    </Kioskrahmen>
  );
}

/**
 * Speichern und Abbrechen, am unteren Rand klebend.
 *
 * Die Avatargalerie ist hoeher als ein Tabletbildschirm; ohne das klebende Band muesste man
 * erst scrollen, um ueberhaupt speichern zu koennen, und genau das uebersieht jemand, der
 * im Stehen tippt.
 */
function Knopfzeile({
  laeuft,
  aufSpeichern,
  aufAbbrechen,
}: {
  laeuft: boolean;
  aufSpeichern: () => void;
  aufAbbrechen: () => void;
}) {
  return (
    <div className="sticky bottom-0 -mx-6 mt-auto flex flex-wrap gap-4 border-t border-linie bg-grund px-6 py-4">
      <Knopf className="h-14 px-8 text-[17px]" disabled={laeuft} onClick={aufSpeichern}>
        {laeuft ? "Speichert …" : "Speichern"}
      </Knopf>
      <Knopf art="rand" className="h-14 px-8 text-[17px]" disabled={laeuft} onClick={aufAbbrechen}>
        Abbrechen
      </Knopf>
    </div>
  );
}

function Kachel({ titel, text, aufKlick }: { titel: string; text: string; aufKlick: () => void }) {
  return (
    <button
      type="button"
      onClick={aufKlick}
      className="flex flex-col gap-2 bg-flaeche p-7 text-left shadow-flaeche hover:brightness-[0.98]"
    >
      <span className="text-xl font-bold tracking-[-0.01em]">{titel}</span>
      <span className="text-[15px] text-text-zweit">{text}</span>
    </button>
  );
}

// --- Stammdaten -----------------------------------------------------------------------

export function KioskStammdaten({ aufAbmelden }: { aufAbmelden: () => void }) {
  const { guid } = useParams();
  const navigate = useNavigate();
  const abruf = useAbruf<Besucher>(`/api/kiosk/besucher/${String(guid)}`);
  const [entwurf, setzeEntwurf] = useState<Record<string, string> | null>(null);
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);

  const b = abruf.daten;
  /*
   * Der Entwurf entsteht beim ersten Rendern mit Daten, nicht in einem Effekt: ein Effekt,
   * der auf `b` hört, überschriebe die Eingaben bei jedem erneuten Abruf.
   */
  const werte =
    entwurf ??
    (b === null ? null : Object.fromEntries(PERSONENFELDER.map((f) => [f.name, b[f.name] ?? ""])));

  function setze(feld: string, wert: string) {
    setzeEntwurf({ ...(werte ?? {}), [feld]: wert });
  }

  async function speichere() {
    if (werte === null) return;
    setzeLaeuft(true);
    setzeFehler(null);
    try {
      await api(`/api/kiosk/besucher/${String(guid)}`, {
        method: "PATCH",
        body: JSON.stringify(werte),
      });
      void navigate(`/kiosk/${String(guid)}`);
    } catch (ursache) {
      setzeFehler(
        ursache instanceof ApiFehler && ursache.code === "pflicht-fehlt"
          ? "Vorname und Nachname dürfen nicht leer sein."
          : "Das Speichern hat nicht geklappt. Bitte noch einmal versuchen.",
      );
    } finally {
      setzeLaeuft(false);
    }
  }

  return (
    <Kioskrahmen
      aufAbmelden={aufAbmelden}
      aufAblauf={() => {
        void navigate("/kiosk", { replace: true });
      }}
    >
      <Ueberschrift>Deine Daten</Ueberschrift>

      <Zustand laedt={abruf.laedt} fehler={abruf.fehler}>
        {werte !== null && (
          <>
            {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

            {/*
              Je Gruppe eine Fläche. Am Tablet steht jemand dabei und tippt im Stehen; elf
              Felder am Stück sind dort mehr im Weg als am Schreibtisch.
            */}
            {GRUPPEN.map((gruppe) => (
              <Flaeche key={gruppe} className="flex flex-col gap-5 p-7">
                <h2 className="text-[11px] font-semibold tracking-[0.08em] text-text-hinweis uppercase">
                  {gruppe}
                </h2>
                <div className="grid gap-5 sm:grid-cols-2">
                  {felderDerGruppe(gruppe).map((f) => (
                    <label key={f.name} className="flex flex-col gap-2 text-[14px] font-semibold">
                      {f.text}
                      {f.pflicht === true && <span className="sr-only">Pflichtfeld</span>}
                      <Feld
                        className="h-12 text-[16px] font-normal"
                        value={werte[f.name] ?? ""}
                        onChange={(ev) => {
                          setze(f.name, ev.target.value);
                        }}
                      />
                    </label>
                  ))}
                </div>
              </Flaeche>
            ))}

            <Knopfzeile
              laeuft={laeuft}
              aufSpeichern={() => void speichere()}
              aufAbbrechen={() => {
                void navigate(`/kiosk/${String(guid)}`);
              }}
            />
          </>
        )}
      </Zustand>
    </Kioskrahmen>
  );
}

// --- Avatar ---------------------------------------------------------------------------

interface Galerie {
  standard: string;
  avatare: string[];
}

export function KioskAvatar({ aufAbmelden }: { aufAbmelden: () => void }) {
  const { guid } = useParams();
  const navigate = useNavigate();
  const besucher = useAbruf<Besucher>(`/api/kiosk/besucher/${String(guid)}`);
  const galerie = useAbruf<Galerie>("/api/kiosk/avatare");
  const [gewaehlt, setzeGewaehlt] = useState<string | null>(null);
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);

  const g = galerie.daten;
  const aktuell = gewaehlt ?? besucher.daten?.avatarDateiId ?? g?.standard ?? null;

  async function speichere() {
    setzeLaeuft(true);
    setzeFehler(null);
    try {
      await api(`/api/kiosk/besucher/${String(guid)}/avatar`, {
        method: "PATCH",
        body: JSON.stringify({ avatarDateiId: aktuell }),
      });
      void navigate(`/kiosk/${String(guid)}`);
    } catch {
      setzeFehler("Das Speichern hat nicht geklappt. Bitte noch einmal versuchen.");
    } finally {
      setzeLaeuft(false);
    }
  }

  return (
    <Kioskrahmen
      aufAbmelden={aufAbmelden}
      aufAblauf={() => {
        void navigate("/kiosk", { replace: true });
      }}
    >
      <Ueberschrift>Dein Bild</Ueberschrift>

      <Zustand laedt={besucher.laedt || galerie.laedt} fehler={besucher.fehler ?? galerie.fehler}>
        {g !== null && (
          <>
            {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

            <ul className="grid grid-cols-3 gap-4 sm:grid-cols-5">
              {[g.standard, ...g.avatare].map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    aria-pressed={aktuell === id}
                    aria-label={id === g.standard ? "Standardbild" : "Bild auswählen"}
                    onClick={() => {
                      setzeGewaehlt(id);
                    }}
                    className={`block w-full overflow-hidden ${
                      aktuell === id
                        ? "outline outline-4 outline-offset-2 outline-primaer"
                        : "outline outline-1 outline-linie"
                    }`}
                  >
                    <img
                      src={`/api/dateien/${id}`}
                      alt=""
                      className="aspect-square w-full object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>

            <Knopfzeile
              laeuft={laeuft}
              aufSpeichern={() => void speichere()}
              aufAbbrechen={() => {
                void navigate(`/kiosk/${String(guid)}`);
              }}
            />
          </>
        )}
      </Zustand>
    </Kioskrahmen>
  );
}
