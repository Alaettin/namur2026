import { useState, type ReactNode } from "react";
import { Dialog as RadixDialog } from "radix-ui";
import { Feld, Fehlerhinweis, Knopf } from "./basis.js";

/**
 * Rueckfrage vor einer Handlung, die sich nicht zurueckholen laesst.
 *
 * Radix bringt Fokusfalle, Escape, Scroll-Sperre und die ARIA-Verdrahtung mit. Ein selbst
 * gebauter Dialog hat davon erfahrungsgemaess die Haelfte.
 */
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
          className="fixed top-1/2 left-1/2 z-50 flex w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 bg-flaeche p-7 shadow-[0_18px_48px_rgba(27,29,38,0.22)]"
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

          <div className="flex flex-wrap justify-end gap-3">
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
          className={`fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto bg-flaeche p-6 shadow-[0_18px_48px_rgba(27,29,38,0.22)] ${
            breit ? "w-[min(60rem,calc(100vw-2rem))]" : "w-[min(34rem,calc(100vw-2rem))]"
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
