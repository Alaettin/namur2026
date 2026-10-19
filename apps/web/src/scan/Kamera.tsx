import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

/**
 * Der Kamerasucher.
 *
 * **Die Komponente wird nie neu eingehängt, um die Kamera neu zu starten.** Steuerung läuft
 * über `pausiert`. Ein Remount reißt das `<video>` mit weg, und auf iOS bleibt dann ein
 * toter MediaStream zurück, den niemand mehr freigibt.
 */

export type Kamerafehler = "unsicher" | "verweigert" | "keine" | "unbekannt";

/**
 * Gibt der Browser die Kamera überhaupt frei?
 *
 * `getUserMedia` verlangt einen **sicheren Kontext**. `localhost` gilt als sicher, eine
 * Netzwerkadresse wie `192.168.178.42` nicht. Das wird **vor** dem Startversuch geprüft,
 * damit nicht eine Verweigerungsmeldung erscheint, die wie ein Fehler des Nutzers aussieht.
 */
export function kameraMoeglich(): boolean {
  return window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === "function";
}

export function Kamera({
  pausiert,
  aufTreffer,
  aufFehler,
}: {
  pausiert: boolean;
  aufTreffer: (inhalt: string) => void;
  aufFehler: (art: Kamerafehler) => void;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const scanner = useRef<QrScanner | null>(null);
  const [licht, setzeLicht] = useState(false);
  const [hatLicht, setzeHatLicht] = useState(false);
  const [kameras, setzeKameras] = useState<QrScanner.Camera[]>([]);
  const [wechselt, setzeWechselt] = useState(false);

  /*
   * Die Rückrufe liegen in einem Ref, damit der Scanner **einmal** aufgebaut wird und nicht
   * bei jedem Rendern neu. Sonst hinge an jedem Zustandswechsel ein Kamerastart.
   */
  const rueckruf = useRef({ aufTreffer, aufFehler });
  rueckruf.current = { aufTreffer, aufFehler };

  useEffect(() => {
    const element = video.current;
    if (element === null) return;

    if (!kameraMoeglich()) {
      rueckruf.current.aufFehler(window.isSecureContext ? "keine" : "unsicher");
      return;
    }

    const s = new QrScanner(element, (ergebnis) => rueckruf.current.aufTreffer(ergebnis.data), {
      // Die rückseitige Kamera, sonst filmt das Handy den Betreuer.
      preferredCamera: "environment",
      highlightScanRegion: false,
      maxScansPerSecond: 5,
    });
    scanner.current = s;

    s.start()
      .then(async () => {
        setzeHatLicht(await s.hasFlash());
        /*
         * **Erst nach dem Start auflisten.** Ids und Namen gibt der Browser erst heraus, wenn
         * die Kamera freigegeben ist. Ein Fehler hier kostet nur den Wechselknopf.
         */
        setzeKameras(await QrScanner.listCameras(true).catch(() => []));
      })
      .catch((ursache: unknown) => {
        const name = (ursache as { name?: string }).name ?? "";
        rueckruf.current.aufFehler(
          name === "NotAllowedError"
            ? "verweigert"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "keine"
              : "unbekannt",
        );
      });

    return () => {
      s.stop();
      s.destroy();
      scanner.current = null;
    };
  }, []);

  /*
   * Anhalten und Fortsetzen über das Prop.
   *
   * **iOS beendet die Kamera, sobald die Seite in den Hintergrund geht**, und die
   * Scan-Schleife stirbt dabei still: das Bild steht, und kein Fehler erscheint. Deshalb
   * wird beim Zurückkehren neu gestartet statt nur fortgesetzt.
   */
  useEffect(() => {
    const s = scanner.current;
    if (s === null) return;
    if (pausiert) s.pause();
    else void s.start().catch(() => undefined);
  }, [pausiert]);

  useEffect(() => {
    function beiSichtbarkeit() {
      const s = scanner.current;
      if (s === null || pausiert) return;
      if (document.visibilityState === "visible") void s.start().catch(() => undefined);
      else s.pause();
    }
    document.addEventListener("visibilitychange", beiSichtbarkeit);
    return () => {
      document.removeEventListener("visibilitychange", beiSichtbarkeit);
    };
  }, [pausiert]);

  /*
   * **Zur naechsten Kamera der Liste.** Welche gerade laeuft, steht nur im Videostrom; ohne
   * Treffer beginnt der Wechsel bei der ersten. Gemerkt wird die Wahl bewusst nicht: nach
   * dem Neuladen startet wieder die Rueckkamera, damit kein Handy am Stand unbemerkt mit der
   * Frontkamera beginnt. Scheitert der Wechsel, bleibt die bisherige Kamera, ohne
   * Fehlerbildschirm.
   */
  async function wechsle() {
    const s = scanner.current;
    if (s === null || kameras.length < 2) return;
    const strom = video.current?.srcObject;
    const jetzt =
      strom instanceof MediaStream ? strom.getVideoTracks()[0]?.getSettings().deviceId : undefined;
    const naechste = kameras[(kameras.findIndex((k) => k.id === jetzt) + 1) % kameras.length];
    if (naechste === undefined) return;

    setzeWechselt(true);
    try {
      await s.setCamera(naechste.id);
      // Frontkameras haben meist kein Licht; der Knopf richtet sich nach der neuen Kamera.
      setzeLicht(false);
      setzeHatLicht(await s.hasFlash());
    } catch {
      // Bei der bisherigen Kamera bleiben.
    } finally {
      setzeWechselt(false);
    }
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-kamera-dunkel">
      <video ref={video} className="size-full object-cover" playsInline muted />

      {/* Zielrahmen. Reine Zierde, deshalb aus dem Zugänglichkeitsbaum genommen. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div className="size-[62vw] max-h-[280px] max-w-[280px] border-2 border-white/80" />
      </div>

      {kameras.length > 1 && (
        <button
          type="button"
          disabled={wechselt}
          className="absolute top-4 right-4 flex size-12 items-center justify-center rounded-full bg-black/55 text-white disabled:opacity-50"
          onClick={() => void wechsle()}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
            <path d="M15.5 12.5A3.5 3.5 0 0 0 9 11" />
            <path d="M8.5 13.5A3.5 3.5 0 0 0 15 15" />
            <path d="M9 8.5V11h2.5" />
            <path d="M15 17.5V15h-2.5" />
          </svg>
          <span className="sr-only">Kamera wechseln</span>
        </button>
      )}

      {hatLicht && (
        <button
          type="button"
          aria-pressed={licht}
          className="absolute right-4 bottom-4 flex size-12 items-center justify-center rounded-full bg-black/55 text-white"
          onClick={() => {
            const s = scanner.current;
            if (s === null) return;
            void s.toggleFlash().then(() => {
              setzeLicht((an) => !an);
            });
          }}
        >
          <span className="text-xl" aria-hidden="true">
            {licht ? "☀" : "☾"}
          </span>
          <span className="sr-only">Taschenlampe</span>
        </button>
      )}
    </div>
  );
}
