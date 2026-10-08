import { useRef, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api.js";
import { Knopf } from "../bausteine/basis.js";
import { Logoreihe } from "../bausteine/logos.js";
import { useZeitsperre } from "./zeitsperre.js";

/**
 * Der Rahmen um alle Kiosk-Bildschirme.
 *
 * **Keine Navigation.** Wer am Tablet steht, soll genau den einen Weg haben: scannen,
 * ändern, fertig. Reiter oder ein Menü wären hier nur Türen zu Seiten, die ein Besucher
 * nicht sehen darf.
 *
 * Er trägt zwei Dinge, die jeder Bildschirm braucht: die Zeitsperre und den Weg hinaus für
 * das Standpersonal.
 */

/** Wie lange der unbeschriftete Bereich gedrückt werden muss, bis das Abmelden greift. */
const ABMELDEN_MS = 3000;

export function Kioskrahmen({
  children,
  aufAbmelden,
  /** Beim Ablauf der Zeitsperre. Auf dem Scanbildschirm bewusst ohne Wirkung. */
  aufAblauf,
  zeitsperre = true,
}: {
  children: ReactNode;
  aufAbmelden: () => void;
  aufAblauf?: () => void;
  zeitsperre?: boolean;
}) {
  const navigate = useNavigate();
  const sperre = useZeitsperre(() => {
    if (zeitsperre) aufAblauf?.();
  });

  const halten = useRef<ReturnType<typeof setTimeout> | null>(null);

  function beginneHalten() {
    halten.current = setTimeout(() => {
      void api("/api/auth/abmelden", { method: "POST" }).finally(() => {
        aufAbmelden();
        void navigate("/anmeldung");
      });
    }, ABMELDEN_MS);
  }

  function endeHalten() {
    if (halten.current !== null) clearTimeout(halten.current);
    halten.current = null;
  }

  return (
    /*
      Jede Berührung und jede Eingabe setzt die Uhr zurück. In der Aufnahmephase
      (`capture`), damit es auch dann greift, wenn ein Kind das Ereignis abfängt.
    */
    <div
      className="flex min-h-screen flex-col bg-grund text-text"
      onPointerDownCapture={sperre.melden}
      onKeyDownCapture={sperre.melden}
    >
      <header className="flex items-center justify-between gap-4 border-b border-linie bg-flaeche px-6 py-3">
        <Logoreihe art="kopf" className="justify-start gap-5" />
        {/*
          **Abmelden ist kein Knopf.** Ein beschrifteter Knopf wird am Stand aus Versehen
          getroffen, und dann steht das Tablet bis jemand das Passwort kennt. Drei Sekunden
          auf eine unbeschriftete Fläche ist für das Standpersonal eine Sekunde Arbeit und
          für einen Besucher kein Versehen.
        */}
        <span
          aria-label="Gedrückt halten zum Abmelden"
          role="button"
          tabIndex={-1}
          onPointerDown={beginneHalten}
          onPointerUp={endeHalten}
          onPointerLeave={endeHalten}
          className="size-9 shrink-0 cursor-default"
        />
      </header>

      <main className="mx-auto flex w-full max-w-[820px] flex-1 flex-col gap-6 px-6 py-8">
        {children}
      </main>

      {sperre.restSekunden !== null && zeitsperre && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-4 border-t border-linie bg-flaeche px-6 py-4 shadow-[0_-8px_24px_rgba(27,29,38,0.12)]"
        >
          <span className="text-[15px] font-medium">
            Noch da? Der Bildschirm wird in {sperre.restSekunden} Sekunden zurückgesetzt.
          </span>
          <Knopf onClick={sperre.melden}>Ich bin noch da</Knopf>
        </div>
      )}
    </div>
  );
}
