import { useState, type FormEvent } from "react";
import { ApiFehler, api } from "../lib/api.js";
import { Feld, Fehlerhinweis, Knopf } from "../bausteine/basis.js";
import { Logoreihe } from "../bausteine/logos.js";
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
      {/*
        Statisch, nicht bewegt: ausdrueckliche Vorgabe der Uebergabe.

        **`object-cover` statt einer festen Breite.** Bis zum 08.10.2026 stand hier
        `w-[1700px]`, und genau bis 1700 px sah das richtig aus. Darueber hinaus blieb das
        Bild stehen und liess links und rechts graue Flaechen; auf einem 3440 px breiten
        Schirm je rund 870 px. Die Datei ist mit 8716 x 2827 px gross genug, sie wurde nur
        klein gehalten. `inset-0` plus `size-full` spannt sie auf, `object-cover` behaelt
        das Seitenverhaeltnis und schneidet den Ueberschuss ab; der Kasten darum traegt
        bereits `overflow-hidden`.
      */}
      <img
        src={keyvisual}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full object-cover"
      />
      <main className="relative flex w-full max-w-[420px] flex-col gap-7 bg-flaeche p-6 shadow-[0_18px_48px_rgba(27,29,38,0.13)] sm:p-10">
        <div className="flex flex-col gap-5">
          {/*
            Die drei Logos statt nur AXON. Die Karte ist bei 390 px innen rund 310 px breit,
            und Pepperl+Fuchs ist 8,9:1; die Hoehen im Baustein sind darauf abgestimmt.
          */}
          <Logoreihe art="anmeldung" />
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
      </main>
    </div>
  );
}
