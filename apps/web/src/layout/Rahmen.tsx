import { NavLink, Outlet, useNavigate } from "react-router";
import { api } from "../lib/api.js";
import { Knopf, cn } from "../bausteine/basis.js";
import type { Ich } from "../lib/ich.js";
import logo from "../assets/axon-logo.svg";

/**
 * Kopfzeile und Inhaltsspalte, auf allen Geraeten gleich.
 *
 * **Ein Layout, eine Kopfzeile.** In den Entwuerfen ist sie in jede Datei kopiert; das ist
 * ein Artefakt des Werkzeugs und keine Vorgabe.
 */

const REITER_ADMIN = [
  { pfad: "/", text: "Dashboard", genau: true },
  { pfad: "/besucher", text: "Besucher" },
  { pfad: "/exponate", text: "Exponate" },
  { pfad: "/ansprechpartner", text: "Ansprechpartner" },
  { pfad: "/nutzer", text: "Nutzer" },
  { pfad: "/api", text: "API" },
  { pfad: "/einstellungen", text: "Einstellungen" },
];

/** Ein Betreuer sieht nur seine Exponate. Von dort geht es in den Scan-Ablauf. */
const REITER_BETREUER = [{ pfad: "/exponate", text: "Exponate", genau: true }];

export function Rahmen({ ich, aufAbmelden }: { ich: Ich; aufAbmelden: () => void }) {
  const navigate = useNavigate();
  const reiter = ich.rolle === "admin" ? REITER_ADMIN : REITER_BETREUER;

  return (
    <div className="min-h-screen bg-grund text-text">
      <header className="bg-flaeche">
        <div className="flex min-h-14 items-center gap-4 border-b border-linie px-6">
          <NavLink to="/" aria-label="Startseite" className="flex shrink-0">
            <img src={logo} alt="Neoception AXON" className="-my-1.5 block h-auto w-[86px]" />
          </NavLink>
          <span aria-hidden="true" className="h-7 w-px shrink-0 bg-linie" />
          {/*
            Nur **einmal** der Name, gruen und gesperrt. Der Entwurf zeigt daneben noch
            "Event Manager"; das ist bei Neoception ein anderes Produkt, und seit der Name
            feststeht saegte ein zweiter Text ohnehin dasselbe.
          */}
          <span className="min-w-0 truncate text-xs font-semibold tracking-[0.14em] text-primaer-dunkel">
            {ich.appName === "" ? "NAMUR HV 2026" : ich.appName}
          </span>
          <span className="ml-auto flex min-w-0 items-center gap-3">
            <span className="min-w-0 truncate text-sm font-medium">{ich.name}</span>
            <Knopf
              art="rand"
              className="h-[34px] px-3.5 text-[13px]"
              onClick={() => {
                void api("/api/auth/abmelden", { method: "POST" }).finally(() => {
                  aufAbmelden();
                  void navigate("/anmeldung");
                });
              }}
            >
              Abmelden
            </Knopf>
          </span>
        </div>

        <nav aria-label="Hauptnavigation" className="border-b border-linie">
          {/* Auf schmalen Bildschirmen waagerecht scrollbar, statt umzubrechen. */}
          <div className="mx-auto flex max-w-[992px] gap-1 overflow-x-auto px-4">
            {reiter.map((r) => (
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
          </div>
        </nav>
      </header>

      <main className="mx-auto flex max-w-[992px] flex-col gap-6 px-4 pt-10 pb-16">
        <Outlet />
      </main>
    </div>
  );
}
