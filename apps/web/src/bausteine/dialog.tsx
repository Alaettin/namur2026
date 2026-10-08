import { useState, type ReactNode } from "react";
import { Dialog as RadixDialog } from "radix-ui";
import { Feld, Fehlerhinweis, Knopf } from "./basis.js";

/**
 * Rueckfrage vor einer Handlung, die sich nicht zurueckholen laesst.
 *
 * Radix bringt Fokusfalle, Escape, Scroll-Sperre und die ARIA-Verdrahtung mit. Ein selbst
 * gebauter Dialog hat davon erfahrungsgemaess die Haelfte.
 */

/**
 * Lage und Groesse beider Fenster.
 *
 * **Ab `sm` mittig, darunter ein Blatt am unteren Rand.** Bei 390 px war die Bedienung
 * nicht zuverlaessig: die Knoepfe standen oben, also ausserhalb der Daumenzone, und ein
 * mittig schwebendes Fenster laesst darueber und darunter Flaechen stehen, die den Griff
 * abfangen. Am unteren Rand gibt es beides nicht mehr, und das Fenster darf die volle
 * Breite nehmen.
 *
 * `max-h-[85dvh]` statt `vh`: die Adressleiste mobiler Browser faehrt ein und aus, und
 * `vh` rechnet mit der ausgefahrenen Hoehe. Der Unterschied ist genau die Knopfzeile.
 */
const LAGE = [
  "fixed z-50 flex flex-col bg-flaeche",
  "max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[85dvh] max-sm:rounded-t-xl",
  "sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
  "shadow-[0_18px_48px_rgba(27,29,38,0.22)]",
].join(" ");
export function Rueckfrage({
  offen,
  aufOffen,
  titel,
  children,
  bestaetigenText,
  tippwort,
  art = "primaer",
  laeuft = false,
  fehler = null,
  aufBestaetigen,
}: {
  offen: boolean;
  aufOffen: (offen: boolean) => void;
  titel: string;
  children: ReactNode;
  bestaetigenText: string;
  /**
   * Muss abgetippt werden, bevor der Knopf aktiv wird.
   *
   * Nur bei den wirklich teuren Handlungen. **Ein "Sind Sie sicher?" klickt man weg**; ein
   * Wort abzutippen zwingt dazu, den Satz darueber gelesen zu haben.
   */
  tippwort?: string;
  art?: "primaer" | "gefahr";
  laeuft?: boolean;
  fehler?: string | null;
  aufBestaetigen: () => void;
}) {
  const [getippt, setzeGetippt] = useState("");
  const freigegeben = tippwort === undefined || getippt === tippwort;

  return (
    <RadixDialog.Root
      open={offen}
      onOpenChange={(neu) => {
        // Beim Schliessen leeren, sonst steht das Wort beim naechsten Oeffnen noch da und
        // der Knopf waere sofort aktiv.
        if (!neu) setzeGetippt("");
        aufOffen(neu);
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <RadixDialog.Content
          className={`${LAGE} gap-5 overflow-y-auto p-6 sm:w-[min(32rem,calc(100vw-2rem))] sm:p-7`}
          aria-describedby={undefined}
        >
          <RadixDialog.Title className="text-2xl font-bold tracking-[-0.01em]">
            {titel}
          </RadixDialog.Title>

          <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-text-zweit">
            {children}
          </div>

          {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

          {tippwort !== undefined && (
            <label className="flex flex-col gap-2 text-[13px] font-semibold text-text">
              Zum Bestätigen <code className="font-mono">{tippwort}</code> eintippen
              <Feld
                value={getippt}
                onChange={(e) => {
                  setzeGetippt(e.target.value);
                }}
                autoComplete="off"
                spellCheck={false}
                aria-label={`Zum Bestätigen ${tippwort} eintippen`}
              />
            </label>
          )}

          <div className="flex flex-wrap justify-end gap-3 max-sm:sticky max-sm:bottom-0 max-sm:-mx-6 max-sm:-mb-6 max-sm:justify-stretch max-sm:border-t max-sm:border-linie max-sm:bg-flaeche max-sm:p-4 max-sm:[&>*]:flex-1">
            <RadixDialog.Close asChild>
              <Knopf art="rand" disabled={laeuft}>
                Abbrechen
              </Knopf>
            </RadixDialog.Close>
            <Knopf art={art} disabled={!freigegeben || laeuft} onClick={aufBestaetigen}>
              {laeuft ? "Läuft …" : bestaetigenText}
            </Knopf>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * Ein Fenster, das nur etwas zeigt: ein Bild in Groß, die Daten eines Ansprechpartners.
 *
 * Getrennt von `Rueckfrage`, weil die beiden Verschiedenes tun. Eine Rückfrage bremst vor
 * einer Handlung und braucht zwei Knöpfe; hier gibt es nichts zu entscheiden, nur zu
 * schließen.
 */
export function Schaufenster({
  offen,
  aufOffen,
  titel,
  breit = false,
  children,
}: {
  offen: boolean;
  aufOffen: (offen: boolean) => void;
  titel: string;
  /** Für Bilder: nimmt so viel Platz, wie der Bildschirm hergibt. */
  breit?: boolean;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={offen} onOpenChange={aufOffen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <RadixDialog.Content
          className={`${LAGE} gap-4 overflow-y-auto p-6 sm:max-h-[90dvh] ${
            breit ? "sm:w-[min(60rem,calc(100vw-2rem))]" : "sm:w-[min(34rem,calc(100vw-2rem))]"
          }`}
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between gap-4">
            <RadixDialog.Title className="text-xl font-bold tracking-[-0.01em]">
              {titel}
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label="Schließen"
                className="flex size-9 shrink-0 items-center justify-center text-text-hinweis hover:text-text"
              >
                <svg
                  width="20"
                  height="20"
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
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
