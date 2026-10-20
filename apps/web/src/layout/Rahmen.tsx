import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { DropdownMenu } from "radix-ui";
import { meldeAb } from "../lib/api.js";
import { Knopf, cn } from "../bausteine/basis.js";
import { Logoreihe } from "../bausteine/logos.js";
import type { Ich } from "../lib/ich.js";

/**
 * Kopfzeile und Inhaltsspalte.
 *
 * **Ein Layout, eine Kopfzeile.** In den Entwuerfen ist sie in jede Datei kopiert; das ist
 * ein Artefakt des Werkzeugs und keine Vorgabe.
 *
 * **Zwei Formen derselben Navigation.** Ab `lg` die Reiterzeile, darunter ein Menue hinter
 * drei Strichen (bis zum 20.10.2026 ab `sm`; zwischen 640 und 1024 px passten die Reiter
 * aber nicht mehr in eine Zeile). Sieben Reiter passen bei 390 px nicht nebeneinander, und eine waagerecht
 * scrollbare Zeile versteckt genau das, was rechts steht: niemand sucht dort. Die Eintraege
 * kommen in beiden Formen aus derselben Liste, damit keine Form einen Punkt verliert.
 */

const REITER_HAUPT = [
  { pfad: "/", text: "Dashboard", genau: true },
  { pfad: "/besucher", text: "Besucher" },
  { pfad: "/exponate", text: "Exponate" },
  { pfad: "/ansprechpartner", text: "Ansprechpartner" },
  { pfad: "/nutzer", text: "Nutzer" },
  { pfad: "/carrera", text: "Carrera" },
  { pfad: "/globale-daten", text: "Globale Daten" },
];

/**
 * Seltener gebraucht, in der Reiterzeile unter „Mehr“, seit dem 20.10.2026. Mit „Globale
 * Daten“ waren es zehn Reiter, und die Zeile bekam einen Scrollbalken. Im Menü hinter den
 * drei Strichen stehen sie weiter in einer Liste mit den anderen.
 */
const REITER_MEHR = [
  { pfad: "/api", text: "API" },
  { pfad: "/monitoring", text: "Monitoring" },
  { pfad: "/einstellungen", text: "Einstellungen" },
];

const REITER_ADMIN = [...REITER_HAUPT, ...REITER_MEHR];

/** Ein Betreuer sieht nur seine Exponate. Von dort geht es in den Scan-Ablauf. */
const REITER_BETREUER = [{ pfad: "/exponate", text: "Exponate", genau: true }];

interface Reiter {
  pfad: string;
  text: string;
  genau?: boolean;
}

/**
 * Ob ein Reiter zur aktuellen Seite gehört. **Aus dem Pfad bestimmt**, nicht nachgehalten:
 * ein zweiter Zustand neben der Adresse könnte abweichen. Dieselbe Regel wie `NavLink end`.
 */
function istAktiv(pathname: string, r: Reiter): boolean {
  return r.genau === true
    ? pathname === r.pfad
    : pathname === r.pfad || pathname.startsWith(`${r.pfad}/`);
}

export function Rahmen({ ich, aufAbmelden }: { ich: Ich; aufAbmelden: () => void }) {
  const navigate = useNavigate();
  const reiter = ich.rolle === "admin" ? REITER_ADMIN : REITER_BETREUER;
  const leiste = ich.rolle === "admin" ? REITER_HAUPT : REITER_BETREUER;
  const mehr = ich.rolle === "admin" ? REITER_MEHR : [];

  const abmelden = () => {
    void meldeAb().then(() => {
      aufAbmelden();
      void navigate("/anmeldung");
    });
  };

  return (
    <div className="min-h-screen bg-grund text-text">
      <header className="bg-flaeche">
        {/*
          **Zwei Fassungen derselben Logoreihe, umgeschaltet bei `lg` und nicht bei `sm`.**
          Pepperl+Fuchs ist 8,9:1 breit; zwischen 640 und 1024 px liefe das mittig gesetzte
          NAMUR in die rechte Gruppe aus Name und "Abmelden". Unterhalb bekommen die Logos
          deshalb eine eigene Zeile, oberhalb bleibt die Kopfzeile so, wie sie war, und die
          beiden Logos kommen nur dazu.

          Die Kopfzeile klebt nicht, die Logozeile wandert beim Scrollen also weg und kostet
          nur oben Platz. Das ist auf einem Telefon der Unterschied zwischen laestig und egal.
        */}
        <div className="border-b border-linie px-4 py-2.5 lg:hidden">
          <Logoreihe art="kopf" zurStartseite />
        </div>

        <div className="flex min-h-14 items-center gap-3 border-b border-linie px-4 sm:gap-4 sm:px-6">
          {/*
            Ab `lg` stehen die drei Logos hier, links gruppiert; darunter deckt sie die
            Logozeile oben ab. Dieselbe `Logoreihe`, nur ohne das voreingestellte
            `justify-between`: `cn` arbeitet mit twMerge, `justify-start` setzt sich durch.
          */}
          <Logoreihe art="kopf" zurStartseite className="hidden shrink-0 justify-start lg:flex" />
          <span aria-hidden="true" className="hidden h-7 w-px shrink-0 bg-linie lg:block" />
          {/*
            Nur **einmal** der Name, gruen und gesperrt. Der Entwurf zeigt daneben noch
            "Event Manager"; das ist bei Neoception ein anderes Produkt, und seit der Name
            feststeht saegte ein zweiter Text ohnehin dasselbe.
          */}
          <span className="min-w-0 truncate text-xs font-semibold tracking-[0.14em] text-primaer-dunkel">
            {ich.appName === "" ? "NAMUR HV 2026" : ich.appName}
          </span>

          {/* Ab `sm`: Name und Abmelden stehen offen in der Kopfzeile. */}
          <span className="ml-auto hidden min-w-0 items-center gap-3 sm:flex">
            <span className="min-w-0 truncate text-sm font-medium">{ich.name}</span>
            <Knopf art="rand" className="h-[34px] px-3.5 text-[13px]" onClick={abmelden}>
              Abmelden
            </Knopf>
          </span>

          {/* Unter `lg`: alles im Menue. Ab `sm` steht davor schon Name und Abmelden. */}
          <span className="ml-auto flex sm:ml-0 lg:hidden">
            <Hauptmenue reiter={reiter} ich={ich} aufAbmelden={abmelden} />
          </span>
        </div>

        <nav aria-label="Hauptnavigation" className="hidden border-b border-linie lg:block">
          {/* Kein `overflow-x-auto` mehr: die Zeile passt, und ein Scrollbalken versteckt. */}
          <div className="mx-auto flex max-w-[992px] gap-1 px-4">
            {leiste.map((r) => (
              <NavLink
                key={r.pfad}
                to={r.pfad}
                end={r.genau === true}
                className={({ isActive }) =>
                  cn(
                    "flex h-[46px] shrink-0 items-center px-4 text-sm",
                    isActive
                      ? "font-semibold text-text shadow-[inset_0_-2px_0_var(--color-primaer)]"
                      : "font-medium text-text-hinweis hover:text-text",
                  )
                }
              >
                {r.text}
              </NavLink>
            ))}
            {mehr.length > 0 && <MehrMenue reiter={mehr} />}
          </div>
        </nav>
      </header>

      <main className="mx-auto flex max-w-[992px] flex-col gap-6 px-4 pt-8 pb-16 sm:pt-10">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * Die drei Striche und das, was darunter aufklappt.
 *
 * Radix statt Eigenbau: Tastaturbedienung, Fokusfalle, Escape, Scroll-Sperre und
 * `aria-expanded` sind hier keine Kuer. Ein handgebautes Menue hat davon erfahrungsgemaess
 * die Haelfte, und was fehlt, faellt erst am Stand auf.
 *
 * Der aktive Eintrag wird **aus dem Pfad** bestimmt und nicht nachgehalten: ein zweiter
 * Zustand neben der Adresse koennte abweichen, und dann zeigte das Menue etwas anderes als
 * die Seite. Dieselbe Regel wie bei `NavLink end`.
 */
function Hauptmenue({
  reiter,
  ich,
  aufAbmelden,
}: {
  reiter: Reiter[];
  ich: Ich;
  aufAbmelden: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Menü"
          className="flex size-10 items-center justify-center border border-linie text-text"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 7h16" />
            <path d="M4 12h16" />
            <path d="M4 17h16" />
          </svg>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 flex w-[min(16rem,calc(100vw-2rem))] flex-col bg-flaeche py-1 shadow-[0_18px_48px_rgba(27,29,38,0.22)]"
        >
          {reiter.map((r) => (
            <DropdownMenu.Item
              key={r.pfad}
              onSelect={() => {
                void navigate(r.pfad);
              }}
              className={cn(
                "flex h-11 cursor-pointer items-center px-4 text-sm outline-none select-none",
                "data-[highlighted]:bg-grund",
                istAktiv(pathname, r)
                  ? "font-semibold text-text shadow-[inset_3px_0_0_var(--color-primaer)]"
                  : "font-medium text-text-hinweis",
              )}
            >
              {r.text}
            </DropdownMenu.Item>
          ))}

          <DropdownMenu.Separator className="my-1 h-px bg-linie" />

          {/*
            Der Name steht hier als Beschriftung, nicht als Eintrag: er ist nichts zum
            Anklicken, und ein Label faengt keinen Tastaturfokus.
          */}
          <DropdownMenu.Label className="truncate px-4 pt-1 pb-2 text-xs text-text-hinweis">
            Angemeldet als {ich.name}
          </DropdownMenu.Label>
          <DropdownMenu.Item
            onSelect={aufAbmelden}
            className="flex h-11 cursor-pointer items-center px-4 text-sm font-medium text-text outline-none select-none data-[highlighted]:bg-grund"
          >
            Abmelden
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * „Mehr ▾“ am Ende der Reiterzeile.
 *
 * Sieht aus wie ein Reiter und ist unterstrichen, wenn die aktuelle Seite darin steckt; dann
 * steht dort deren Name statt „Mehr“, damit man sieht, wo man ist.
 */
function MehrMenue({ reiter }: { reiter: Reiter[] }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const aktiv = reiter.find((r) => istAktiv(pathname, r));

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-[46px] shrink-0 items-center gap-1.5 px-4 text-sm",
            aktiv !== undefined
              ? "font-semibold text-text shadow-[inset_0_-2px_0_var(--color-primaer)]"
              : "font-medium text-text-hinweis hover:text-text",
          )}
        >
          {aktiv?.text ?? "Mehr"}
          <span aria-hidden="true" className="text-xs">
            ▾
          </span>
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={2}
          className="z-50 flex min-w-[12rem] flex-col bg-flaeche py-1 shadow-[0_18px_48px_rgba(27,29,38,0.22)]"
        >
          {reiter.map((r) => (
            <DropdownMenu.Item
              key={r.pfad}
              onSelect={() => {
                void navigate(r.pfad);
              }}
              className={cn(
                "flex h-11 cursor-pointer items-center px-4 text-sm outline-none select-none",
                "data-[highlighted]:bg-grund",
                istAktiv(pathname, r)
                  ? "font-semibold text-text shadow-[inset_3px_0_0_var(--color-primaer)]"
                  : "font-medium text-text-hinweis",
              )}
            >
              {r.text}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
