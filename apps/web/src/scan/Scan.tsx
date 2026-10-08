import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiFehler, api, useAbruf } from "../lib/api.js";
import { Feld, Knopf, Markierung } from "../bausteine/basis.js";
import { Kamera, kameraMoeglich, type Kamerafehler } from "./Kamera.js";
import type { Ich } from "../lib/ich.js";

/**
 * Der Scan-Ablauf am Exponat, nach den Entwürfen `ScanReady` bis `ScanSuccess` und den
 * fünf Fehlerbildschirmen.
 *
 * Vollbild mit eigener Kopfzeile, nicht in der Inhaltsspalte: der Ablauf läuft am Stand auf
 * dem Handy, und die Haupthandlung gehört unten in den Daumenbereich.
 */

type Schritt =
  | { art: "bereit" }
  | { art: "kamera" }
  | { art: "handeingabe" }
  | { art: "treffer"; guid: string }
  | { art: "erfolg"; anzahl: number }
  | { art: "fehler"; grund: Fehlergrund; text?: string };

type Fehlergrund = "kein-pass" | "unbekannt" | "kamera" | "offline" | "ohne-inhalt";

interface Element {
  id: string;
  platz: number;
  titel?: string;
  url?: string;
  vorname?: string;
  nachname?: string;
  bereitsZugeordnet: boolean;
}

interface Treffer {
  besucher: {
    guid: string;
    vorname: string;
    nachname: string;
    firma: string | null;
    position: string | null;
  };
  dokumente: Element[];
  links: Element[];
  kontakte: Element[];
  offen: number;
}

interface Exponat {
  id: string;
  kennung: string;
  name: string;
  scanbar: boolean;
}

export function Scan({ ich }: { ich: Ich }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const exponat = useAbruf<Exponat>(`/api/exponate/${String(id)}`);
  const [schritt, setzeSchritt] = useState<Schritt>({ art: "bereit" });

  /**
   * Die Auswahl des Nutzers, getrennt vom geladenen Treffer gehalten.
   *
   * **Sie überlebt einen Netzfehler**, solange die Seite offen ist: `ErrOffline` zeigt
   * „Erneut versuchen", und das schickt denselben Rumpf. Darauf beruht die Zusage aus der
   * Übergabe, und die Idempotenz des Servers trägt sie.
   */
  const [auswahl, setzeAuswahl] = useState<Set<string>>(new Set());
  const letzterRumpf = useRef<unknown>(null);

  const kennung = exponat.daten?.kennung ?? "";

  function abbrechen() {
    void navigate(ich.rolle === "admin" ? `/exponate/${String(id)}` : "/exponate");
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-grund text-text">
      <header className="flex min-h-[60px] shrink-0 items-center gap-2.5 border-b border-linie bg-flaeche py-1.5 pr-4 pl-2">
        <button
          type="button"
          aria-label="Scannen beenden"
          className="flex size-12 items-center justify-center"
          onClick={abbrechen}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        </button>
        <span className="flex-1 truncate text-base font-bold">
          {schritt.art === "treffer" ? "Pass erkannt" : (exponat.daten?.name ?? "Scannen")}
        </span>
        <span className="font-mono text-[13px]">{kennung}</span>
      </header>

      {exponat.daten !== null && !exponat.daten.scanbar ? (
        <OhneInhalt exponatId={String(id)} />
      ) : (
        <Inhalt
          schritt={schritt}
          setzeSchritt={setzeSchritt}
          exponatId={String(id)}
          viewerBasis={ich.viewerBaseUrl}
          auswahl={auswahl}
          setzeAuswahl={setzeAuswahl}
          letzterRumpf={letzterRumpf}
        />
      )}
    </div>
  );
}

/** `ErrNoContent`: ohne Inhalte gibt es nichts zuzuordnen. */
function OhneInhalt({ exponatId }: { exponatId: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <Markierung text="OHNE INHALT" farbe="var(--color-fehler)" />
      <h1 className="text-2xl font-bold">Noch nichts zum Zuordnen</h1>
      <p className="max-w-prose text-text-zweit">
        Dieses Exponat hat weder Dokumente noch Links oder Ansprechpartner. Solange das so ist,
        bekäme ein Besucher beim Scannen nichts.
      </p>
      <Link to={`/exponate/${exponatId}`}>
        <Knopf art="rand">Zum Exponat</Knopf>
      </Link>
    </div>
  );
}

function Inhalt({
  schritt,
  setzeSchritt,
  exponatId,
  viewerBasis,
  auswahl,
  setzeAuswahl,
  letzterRumpf,
}: {
  schritt: Schritt;
  setzeSchritt: (s: Schritt) => void;
  exponatId: string;
  viewerBasis: string;
  auswahl: Set<string>;
  setzeAuswahl: (s: Set<string>) => void;
  letzterRumpf: { current: unknown };
}) {
  const [handEingabe, setzeHandEingabe] = useState("");

  /**
   * Prüft den QR-Inhalt und holt den Treffer.
   *
   * Der Inhalt **muss** mit der Viewer-Adresse beginnen; die GUID ist das letzte
   * Pfadsegment. Ein beliebiger QR-Code ergibt `ErrNotPass`, eine unbekannte GUID
   * `ErrUnknown`. Ohne diese Prüfung liefe jeder Werbe-QR-Code in eine Serverabfrage.
   */
  const ausQr = useCallback(
    (inhalt: string) => {
      if (!inhalt.startsWith(viewerBasis)) {
        setzeSchritt({ art: "fehler", grund: "kein-pass" });
        return;
      }
      const guid = inhalt.slice(viewerBasis.length).split(/[/?#]/)[0] ?? "";
      if (guid === "") {
        setzeSchritt({ art: "fehler", grund: "kein-pass" });
        return;
      }
      setzeSchritt({ art: "treffer", guid: decodeURIComponent(guid) });
    },
    [viewerBasis, setzeSchritt],
  );

  if (schritt.art === "bereit") {
    return (
      <div className="flex flex-1 flex-col justify-end gap-4 p-6">
        <div className="flex-1" />
        {!kameraMoeglich() && (
          <p className="bg-fehler-grund px-4 py-3 text-sm">
            Die Kamera ist hier nicht verfügbar. Browser geben sie nur über HTTPS frei, und diese
            Seite läuft über eine ungesicherte Verbindung. Du kannst die GUID von Hand eingeben.
          </p>
        )}
        <Knopf
          className="h-16 w-full text-lg"
          disabled={!kameraMoeglich()}
          onClick={() => {
            setzeSchritt({ art: "kamera" });
          }}
        >
          Pass scannen
        </Knopf>
        <Knopf
          art="rand"
          className="h-12 w-full"
          onClick={() => {
            setzeSchritt({ art: "handeingabe" });
          }}
        >
          GUID von Hand eingeben
        </Knopf>
      </div>
    );
  }

  if (schritt.art === "kamera") {
    return (
      <>
        <Kamera
          pausiert={false}
          aufTreffer={ausQr}
          aufFehler={(art: Kamerafehler) => {
            setzeSchritt({ art: "fehler", grund: "kamera", text: art });
          }}
        />
        <div className="shrink-0 border-t border-linie bg-flaeche p-4">
          <Knopf
            art="rand"
            className="h-12 w-full"
            onClick={() => {
              setzeSchritt({ art: "handeingabe" });
            }}
          >
            GUID von Hand eingeben
          </Knopf>
        </div>
      </>
    );
  }

  if (schritt.art === "handeingabe") {
    return (
      <form
        className="flex flex-1 flex-col gap-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (handEingabe.trim() === "") return;
          setzeSchritt({ art: "treffer", guid: handEingabe.trim() });
        }}
      >
        <label className="flex flex-col gap-2 text-sm font-semibold">
          GUID vom Pass
          <Feld
            autoFocus
            value={handEingabe}
            onChange={(e) => {
              setzeHandEingabe(e.target.value);
            }}
            className="h-14 font-mono text-base"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="flex-1" />
        <Knopf type="submit" className="h-16 w-full text-lg" disabled={handEingabe.trim() === ""}>
          Weiter
        </Knopf>
        <Knopf
          art="rand"
          className="h-12 w-full"
          onClick={() => {
            setzeSchritt(kameraMoeglich() ? { art: "kamera" } : { art: "bereit" });
          }}
        >
          Abbrechen
        </Knopf>
      </form>
    );
  }

  if (schritt.art === "treffer") {
    return (
      <TrefferAnsicht
        guid={schritt.guid}
        exponatId={exponatId}
        auswahl={auswahl}
        setzeAuswahl={setzeAuswahl}
        letzterRumpf={letzterRumpf}
        setzeSchritt={setzeSchritt}
      />
    );
  }

  if (schritt.art === "erfolg")
    return <Erfolg anzahl={schritt.anzahl} setzeSchritt={setzeSchritt} />;

  return (
    <Fehler
      schritt={schritt}
      setzeSchritt={setzeSchritt}
      auswahl={auswahl}
      letzterRumpf={letzterRumpf}
      exponatId={exponatId}
    />
  );
}

function TrefferAnsicht({
  guid,
  exponatId,
  auswahl,
  setzeAuswahl,
  letzterRumpf,
  setzeSchritt,
}: {
  guid: string;
  exponatId: string;
  auswahl: Set<string>;
  setzeAuswahl: (s: Set<string>) => void;
  letzterRumpf: { current: unknown };
  setzeSchritt: (s: Schritt) => void;
}) {
  const abruf = useAbruf<Treffer>(
    `/api/scan/besucher/${encodeURIComponent(guid)}?exponat=${encodeURIComponent(exponatId)}`,
  );
  const [laeuft, setzeLaeuft] = useState(false);
  const vorbelegt = useRef(false);

  const alle: { art: "dokument" | "link" | "kontakt"; e: Element }[] =
    abruf.daten === null
      ? []
      : [
          ...abruf.daten.dokumente.map((e) => ({ art: "dokument" as const, e })),
          ...abruf.daten.links.map((e) => ({ art: "link" as const, e })),
          ...abruf.daten.kontakte.map((e) => ({ art: "kontakt" as const, e })),
        ];

  /*
   * **„Alles zuordnen" ist vorausgewählt**, und zwar genau einmal nach dem Laden. Ein
   * `useEffect` ohne diese Sperre würde die Auswahl des Nutzers bei jedem Rendern
   * überschreiben.
   */
  useEffect(() => {
    if (abruf.daten === null || vorbelegt.current) return;
    vorbelegt.current = true;
    setzeAuswahl(
      new Set(
        [
          ...abruf.daten.dokumente.map((e) => ({ art: "dokument", e })),
          ...abruf.daten.links.map((e) => ({ art: "link", e })),
          ...abruf.daten.kontakte.map((e) => ({ art: "kontakt", e })),
        ]
          .filter((x) => !x.e.bereitsZugeordnet)
          .map((x) => `${x.art}:${x.e.id}`),
      ),
    );
  }, [abruf.daten, setzeAuswahl]);

  if (abruf.fehler !== null) {
    // 404 heißt: diese GUID gibt es nicht. Alles andere ist ein Netz- oder Serverfehler.
    const grund: Fehlergrund = abruf.fehler.status === 404 ? "unbekannt" : "offline";
    setzeSchritt({ art: "fehler", grund });
    return null;
  }
  if (abruf.laedt || abruf.daten === null) {
    return <p className="flex-1 p-10 text-center text-sm text-text-hinweis">Wird geladen …</p>;
  }

  const b = abruf.daten.besucher;
  const offen = alle.filter((x) => !x.e.bereitsZugeordnet);
  const gewaehlt = offen.filter((x) => auswahl.has(`${x.art}:${x.e.id}`));
  const alleAn = offen.length > 0 && gewaehlt.length === offen.length;

  function beschrifte(art: string, e: Element): string {
    if (art === "kontakt") return `${e.vorname ?? ""} ${e.nachname ?? ""}`.trim();
    return e.titel ?? "";
  }

  async function zuordnen() {
    const rumpf = {
      guid,
      exponatId,
      elemente: gewaehlt.map((x) => ({ art: x.art, zielId: x.e.id })),
    };
    letzterRumpf.current = rumpf;
    setzeLaeuft(true);
    try {
      const e = await api<{ neu: number }>("/api/scan/zuordnen", {
        method: "POST",
        body: JSON.stringify(rumpf),
      });
      setzeSchritt({ art: "erfolg", anzahl: e.neu });
    } catch (ursache) {
      /*
       * Bei einem Netzfehler **bleibt die Auswahl stehen**: `ErrOffline` bietet „Erneut
       * versuchen" und schickt denselben Rumpf. Ein 404 ist dagegen ein Sachfehler.
       */
      const status = ursache instanceof ApiFehler ? ursache.status : 0;
      setzeSchritt({ art: "fehler", grund: status === 404 ? "unbekannt" : "offline" });
    } finally {
      setzeLaeuft(false);
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <section
          aria-label="Besucher"
          className="flex items-center gap-4 bg-flaeche p-4 shadow-flaeche"
        >
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-text text-xl font-bold text-white">
            {(b.vorname[0] ?? "") + (b.nachname[0] ?? "")}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xl leading-tight font-bold">
              {b.vorname} {b.nachname}
            </span>
            {b.firma !== null && <span className="font-semibold">{b.firma}</span>}
            {b.position !== null && <span className="text-sm text-text-zweit">{b.position}</span>}
          </div>
        </section>

        {offen.length > 0 && (
          <div className="flex min-h-[60px] items-center justify-between gap-3 bg-flaeche px-4 shadow-flaeche">
            <span id="lbl-alles" className="text-base font-bold">
              Alles zuordnen
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={alleAn}
              aria-labelledby="lbl-alles"
              className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${alleAn ? "bg-primaer" : "bg-linie-feld"}`}
              onClick={() => {
                setzeAuswahl(alleAn ? new Set() : new Set(offen.map((x) => `${x.art}:${x.e.id}`)));
              }}
            >
              <span
                className={`absolute top-1 size-6 rounded-full bg-white transition-all ${alleAn ? "left-7" : "left-1"}`}
              />
            </button>
          </div>
        )}

        {(
          [
            ["Dokumente", "dokument"],
            ["Links", "link"],
            ["Ansprechpartner", "kontakt"],
          ] as const
        ).map(([titel, art]) => {
          const gruppe = alle.filter((x) => x.art === art);
          if (gruppe.length === 0) return null;
          return (
            <section key={art} className="flex flex-col gap-2">
              <h2 className="mx-0.5 text-[11px] font-semibold tracking-[0.08em] text-text-hinweis uppercase">
                {titel}
              </h2>
              <div className="flex flex-col bg-flaeche shadow-flaeche">
                {gruppe.map(({ e }) => {
                  const schluessel = `${art}:${e.id}`;
                  return (
                    <label
                      key={e.id}
                      className="flex min-h-[60px] cursor-pointer items-center gap-3.5 border-b border-linie px-4 py-2 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        className="size-6 shrink-0 accent-primaer"
                        checked={e.bereitsZugeordnet || auswahl.has(schluessel)}
                        disabled={e.bereitsZugeordnet}
                        onChange={(ev) => {
                          const neu = new Set(auswahl);
                          if (ev.target.checked) neu.add(schluessel);
                          else neu.delete(schluessel);
                          setzeAuswahl(neu);
                        }}
                      />
                      <span className="min-w-0 flex-1 text-[15px] leading-tight font-semibold">
                        {beschrifte(art, e)}
                      </span>
                      {e.bereitsZugeordnet && (
                        <Markierung text="BEREITS ZUGEORDNET" farbe="var(--color-text-hinweis)" />
                      )}
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex shrink-0 justify-end border-t border-linie bg-flaeche px-4 pt-3.5 pb-5">
        <Knopf
          className="h-16 w-full max-w-[420px] text-lg"
          disabled={gewaehlt.length === 0 || laeuft}
          onClick={() => void zuordnen()}
        >
          {laeuft ? "Wird zugeordnet …" : `Zuordnen (${String(gewaehlt.length)})`}
        </Knopf>
      </div>
    </>
  );
}

/** `ScanSuccess`: zwei Sekunden Rückmeldung, dann zurück zur Kamera. */
function Erfolg({ anzahl, setzeSchritt }: { anzahl: number; setzeSchritt: (s: Schritt) => void }) {
  useEffect(() => {
    const t = setTimeout(() => {
      setzeSchritt(kameraMoeglich() ? { art: "kamera" } : { art: "bereit" });
    }, 2000);
    return () => {
      clearTimeout(t);
    };
  }, [setzeSchritt]);

  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-4 bg-erfolg px-6 text-center text-white"
    >
      <span className="text-6xl" aria-hidden="true">
        ✓
      </span>
      <p className="text-2xl font-bold">
        {anzahl === 0 ? "Schon zugeordnet" : `${String(anzahl)} zugeordnet`}
      </p>
      <p className="opacity-80">
        {anzahl === 0
          ? "Der Besucher hatte diese Inhalte bereits."
          : "Der Besucher sieht sie sofort im Viewer."}
      </p>
    </div>
  );
}

function Fehler({
  schritt,
  setzeSchritt,
  auswahl,
  letzterRumpf,
  exponatId,
}: {
  schritt: Schritt;
  setzeSchritt: (s: Schritt) => void;
  auswahl: Set<string>;
  letzterRumpf: { current: unknown };
  exponatId: string;
}) {
  const [laeuft, setzeLaeuft] = useState(false);
  if (schritt.art !== "fehler") return null;

  const texte: Record<Fehlergrund, { titel: string; text: string }> = {
    "kein-pass": {
      titel: "Kein Konferenzpass",
      text: "Dieser QR-Code gehört nicht zur NAMUR HV 2026. Bitte den Pass des Besuchers scannen.",
    },
    unbekannt: {
      titel: "GUID unbekannt",
      text: "Zu diesem Pass gibt es keinen Besucher. Vielleicht ein Tippfehler, oder der Besucher wurde noch nicht angelegt.",
    },
    kamera: {
      titel: "Kamera nicht verfügbar",
      text:
        schritt.text === "unsicher"
          ? "Browser geben die Kamera nur über HTTPS frei, und diese Seite läuft über eine ungesicherte Verbindung."
          : schritt.text === "verweigert"
            ? "Der Zugriff wurde abgelehnt. In den Browsereinstellungen lässt er sich wieder erlauben."
            : "Es wurde keine Kamera gefunden.",
    },
    offline: {
      titel: "Keine Verbindung",
      text: "Die Zuordnung ist nicht durchgekommen. Deine Auswahl ist gespeichert, solange diese Seite offen bleibt.",
    },
    "ohne-inhalt": {
      titel: "Noch nichts zum Zuordnen",
      text: "Dieses Exponat hat noch keine Inhalte.",
    },
  };

  const { titel, text } = texte[schritt.grund];
  const kannWiederholen = schritt.grund === "offline" && letzterRumpf.current !== null;

  return (
    <div className="flex flex-1 flex-col justify-end gap-4 p-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <span
          className="flex size-14 items-center justify-center rounded-full bg-fehler-grund text-2xl text-fehler"
          aria-hidden="true"
        >
          !
        </span>
        <h1 className="text-2xl font-bold">{titel}</h1>
        <p className="max-w-prose text-text-zweit">{text}</p>
        {schritt.grund === "offline" && auswahl.size > 0 && (
          <p className="text-sm text-text-hinweis">
            {auswahl.size} {auswahl.size === 1 ? "Element" : "Elemente"} ausgewählt
          </p>
        )}
      </div>

      {kannWiederholen && (
        <Knopf
          className="h-16 w-full text-lg"
          disabled={laeuft}
          onClick={() => {
            setzeLaeuft(true);
            // **Derselbe Rumpf.** Das Zuordnen ist idempotent, ein zweiter Versuch legt
            // nichts doppelt an.
            void api<{ neu: number }>("/api/scan/zuordnen", {
              method: "POST",
              body: JSON.stringify(letzterRumpf.current),
            })
              .then((e) => {
                setzeSchritt({ art: "erfolg", anzahl: e.neu });
              })
              .catch(() => {
                setzeSchritt({ art: "fehler", grund: "offline" });
              })
              .finally(() => {
                setzeLaeuft(false);
              });
          }}
        >
          {laeuft ? "Wird gesendet …" : "Erneut versuchen"}
        </Knopf>
      )}

      <Knopf
        art="rand"
        className="h-12 w-full"
        onClick={() => {
          setzeSchritt({ art: "handeingabe" });
        }}
      >
        GUID von Hand eingeben
      </Knopf>
      {kameraMoeglich() && (
        <Knopf
          art="still"
          className="h-12 w-full"
          onClick={() => {
            setzeSchritt({ art: "kamera" });
          }}
        >
          Weiter scannen
        </Knopf>
      )}
      <Link
        to={`/exponate/${exponatId}`}
        className="text-center text-[13px] font-semibold text-primaer-dunkel"
      >
        Zum Exponat
      </Link>
    </div>
  );
}
