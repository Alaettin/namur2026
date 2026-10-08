import { useState, type FormEvent } from "react";
import { ApiFehler, api } from "../lib/api.js";
import { Feld, Fehlerhinweis, Knopf } from "../bausteine/basis.js";
import logo from "../assets/axon-logo.svg";
import keyvisual from "../assets/keyvisual.png";

/**
 * Anmeldung mit E-Mail und Passwort.
 *
 * Es gibt **keine Selbstregistrierung** und kein "Passwort vergessen": Zugaenge vergibt die
 * Orga, und ein neues Startpasswort setzt ein Admin.
 */
export function Anmeldung({ aufAngemeldet }: { aufAngemeldet: () => void }) {
  const [email, setzeEmail] = useState("");
  const [passwort, setzePasswort] = useState("");
  const [fehler, setzeFehler] = useState<string | null>(null);
  const [laeuft, setzeLaeuft] = useState(false);

  async function absenden(e: FormEvent) {
    e.preventDefault();
    setzeLaeuft(true);
    setzeFehler(null);
    try {
      await api("/api/auth/anmelden", {
        method: "POST",
        body: JSON.stringify({ email, passwort }),
      });
      aufAngemeldet();
    } catch (ursache) {
      /*
       * **Eine Meldung fuer jeden Fall**, wie im Entwurf: weder wird verraten, ob die
       * E-Mail bekannt ist, noch ob das Konto deaktiviert wurde. Eine Sperre mit Countdown
       * gibt es laut Design nicht; die Anmeldegrenze des Servers meldet sich mit 429 und
       * bekommt deshalb einen eigenen Satz.
       */
      const status = ursache instanceof ApiFehler ? ursache.status : 0;
      setzeFehler(
        status === 429
          ? "Zu viele Versuche. Bitte in einigen Minuten erneut probieren."
          : status === 0
            ? "Keine Verbindung zum Dienst."
            : "E-Mail oder Passwort ist nicht korrekt.",
      );
    } finally {
      setzeLaeuft(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-grund px-4 py-12">
      {/* Statisch, nicht bewegt: ausdrueckliche Vorgabe der Uebergabe. */}
      <img
        src={keyvisual}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 w-[1700px] max-w-none -translate-x-1/2 -translate-y-1/2"
      />
      <main className="relative flex w-full max-w-[420px] flex-col gap-7 bg-flaeche p-10 shadow-[0_18px_48px_rgba(27,29,38,0.13)]">
        <div className="flex flex-col gap-5">
          <img src={logo} alt="Neoception AXON" className="-mx-5 -my-3 block h-auto w-[132px]" />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold tracking-[0.14em] text-primaer-dunkel uppercase">
              NAMUR HV 2026
            </span>
            <h1 className="text-[32px] leading-tight font-bold tracking-[-0.02em]">Anmelden</h1>
          </div>
        </div>

        {fehler !== null && <Fehlerhinweis>{fehler}</Fehlerhinweis>}

        <form className="flex flex-col gap-4.5" onSubmit={(e) => void absenden(e)}>
          <label className="flex flex-col gap-2 text-[13px] font-semibold">
            E-Mail
            <Feld
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => {
                setzeEmail(e.target.value);
              }}
            />
          </label>
          <label className="flex flex-col gap-2 text-[13px] font-semibold">
            Passwort
            <Feld
              type="password"
              autoComplete="current-password"
              required
              value={passwort}
              onChange={(e) => {
                setzePasswort(e.target.value);
              }}
            />
          </label>
          <Knopf type="submit" className="mt-1.5 h-12 text-base" disabled={laeuft}>
            {laeuft ? "Wird geprüft …" : "Anmelden"}
          </Knopf>
        </form>

        <p className="text-[13px] leading-relaxed text-text-hinweis">
          Zugänge vergibt die Konferenz-Orga.
        </p>
      </main>
    </div>
  );
}
