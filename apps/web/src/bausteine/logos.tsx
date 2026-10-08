import { NavLink } from "react-router";
import { cn } from "./basis.js";
import axon from "../assets/axon-logo.svg";
import namur from "../assets/namur.png";
import pepperl from "../assets/pepperl-fuchs.png";

/**
 * Die drei Logos: AXON links, NAMUR mittig, Pepperl+Fuchs rechts.
 *
 * **Ein Baustein, nicht dreimal dasselbe Markup.** Die Reihe steht an drei Stellen (Anmeldung,
 * breite Kopfzeile, schmale Kopfzeile), und eine spaetere offizielle Datei soll an genau einer
 * Stelle getauscht werden.
 *
 * **Die Hoehen sind einzeln gesetzt, nicht einheitlich.** Die drei Marken haben sehr
 * verschiedene Formate: AXON 2,3:1, NAMUR 1,8:1, Pepperl **8,9:1**. Bei gleicher Hoehe wirkt
 * das fast quadratische NAMUR-Zeichen winzig neben der langen Wortmarke, und Pepperl waere
 * bei 24 px schon 214 px breit. Ausgeglichen heisst hier: NAMUR hoeher, Pepperl niedriger.
 *
 * `alt` traegt echten Text: das sind Partner, keine Zierde, und ein Schirmleser soll sie nennen.
 */

/** Die Hoehen je Stelle. Breiten ergeben sich aus dem Seitenverhaeltnis. */
const MASSE = {
  /** Kopfzeile: knapp, weil darunter noch zwei Zeilen kommen. */
  kopf: { axon: "w-[72px]", namur: "h-6", pepperl: "h-[15px]" },
  /** Anmeldung: die Karte ist innen nur rund 310 px breit. */
  anmeldung: { axon: "w-[84px]", namur: "h-7", pepperl: "h-[17px]" },
} as const;

export function AxonLogo({ art, className }: { art: keyof typeof MASSE; className?: string }) {
  return (
    <img
      src={axon}
      alt="Neoception AXON"
      className={cn("block h-auto", MASSE[art].axon, className)}
    />
  );
}

export function NamurLogo({ art, className }: { art: keyof typeof MASSE; className?: string }) {
  // Das rote Feld gehoert zur Marke und bleibt; freistellen waere eine erfundene Variante.
  return (
    <img src={namur} alt="NAMUR" className={cn("block w-auto", MASSE[art].namur, className)} />
  );
}

export function PepperlLogo({ art, className }: { art: keyof typeof MASSE; className?: string }) {
  return (
    <img
      src={pepperl}
      alt="Pepperl+Fuchs"
      className={cn("block w-auto", MASSE[art].pepperl, className)}
    />
  );
}

/**
 * Alle drei nebeneinander, aussen angeschlagen und in der Mitte das rote Zeichen.
 *
 * Genutzt auf der Anmeldeseite und in der schmalen Kopfzeile. Die breite Kopfzeile setzt die
 * drei einzeln, weil dort noch Appname, Benutzername und „Abmelden" dazwischenstehen.
 */
export function Logoreihe({
  art,
  className,
  zurStartseite = false,
}: {
  art: keyof typeof MASSE;
  className?: string;
  /**
   * Macht **nur AXON** zum Link auf die Startseite.
   *
   * Nur AXON, weil das unsere Anwendung ist: ein Klick auf das NAMUR- oder Pepperl-Zeichen
   * soll nirgendwohin fuehren, erst recht nicht auf unser Dashboard. Auf der Anmeldeseite
   * gibt es keine Startseite, dort bleibt alles unverlinkt.
   */
  zurStartseite?: boolean;
}) {
  const axonbild = <AxonLogo art={art} />;
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      {zurStartseite ? (
        <NavLink to="/" aria-label="Startseite" className="flex shrink-0">
          {axonbild}
        </NavLink>
      ) : (
        axonbild
      )}
      <NamurLogo art={art} />
      <PepperlLogo art={art} />
    </div>
  );
}
