import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { ApiFehler, api, useAbruf } from "../lib/api.js";
import { Flaeche } from "../bausteine/basis.js";

/**
 * Die Exponate eines Besuchers, mit Kästchen zum Zuweisen.
 *
 * Seit dem 19.10.2026 statt der flachen Liste „LINK · Exponat ansehen“. Je Exponat ein
 * Kästchen für das Ganze und darunter eines je Dokument und Link. **Jede Änderung geht
 * sofort hinaus**, als Sollzustand dieses einen Exponats; einen Speichern-Knopf gibt es
 * nicht, weil die Kästchen sonst etwas zeigten, das noch nicht gilt.
 */

interface Inhalt {
  id: string;
  titel: string;
  zugeordnet: boolean;
}

interface ExponatSicht {
  id: string;
  kennung: string;
  name: string;
  besucht: boolean;
  dokumente: Inhalt[];
  links: (Inhalt & { url: string })[];
  kontakte: { id: string; name: string }[];
}

type Element = { art: "dokument" | "link"; zielId: string };

export function BesucherExponate({
  guid,
  aufFehler,
}: {
  guid: string;
  aufFehler: (text: string | null) => void;
}) {
  const abruf = useAbruf<ExponatSicht[]>(`/api/besucher/${encodeURIComponent(guid)}/exponate`);
  // Welches Exponat gerade gesendet wird; seine Kästchen sind solange gesperrt.
  const [sendet, setzeSendet] = useState<string | null>(null);

  async function setze(exponatId: string, elemente: Element[]) {
    setzeSendet(exponatId);
    aufFehler(null);
    try {
      await api(`/api/besucher/${encodeURIComponent(guid)}/zuordnungen/${exponatId}`, {
        method: "PUT",
        body: JSON.stringify({ elemente }),
      });
      abruf.neu();
    } catch (ursache) {
      aufFehler(ursache instanceof ApiFehler ? ursache.message : "Zuweisen nicht möglich.");
    } finally {
      setzeSendet(null);
    }
  }

  const liste = abruf.daten;
  const besucht = liste?.filter((e) => e.besucht).length ?? 0;

  return (
    <Flaeche className="flex flex-col gap-4 p-6">
      <h2 className="text-lg font-semibold">
        Exponate ({besucht} von {liste?.length ?? 0} besucht)
      </h2>
      {liste !== null && liste.length === 0 && (
        <p className="text-sm text-text-hinweis">Es gibt noch keine Exponate.</p>
      )}
      <ul className="flex flex-col gap-3">
        {liste?.map((e) => (
          <ExponatZeile
            key={e.id}
            e={e}
            gesperrt={sendet !== null}
            aufSetzen={(elemente) => void setze(e.id, elemente)}
          />
        ))}
      </ul>
    </Flaeche>
  );
}

function ExponatZeile({
  e,
  gesperrt,
  aufSetzen,
}: {
  e: ExponatSicht;
  gesperrt: boolean;
  aufSetzen: (elemente: Element[]) => void;
}) {
  const alle: Element[] = [
    ...e.dokumente.map((d) => ({ art: "dokument" as const, zielId: d.id })),
    ...e.links.map((l) => ({ art: "link" as const, zielId: l.id })),
  ];
  const zugeordnet: Element[] = [
    ...e.dokumente
      .filter((d) => d.zugeordnet)
      .map((d) => ({ art: "dokument" as const, zielId: d.id })),
    ...e.links.filter((l) => l.zugeordnet).map((l) => ({ art: "link" as const, zielId: l.id })),
  ];
  const leer = alle.length === 0;
  const voll = !leer && zugeordnet.length === alle.length;
  /*
   * **Teilweise** ist ein eigener Zustand: einige Inhalte, oder nur eine alte
   * Ansprechpartner-Zeile. Das Kästchen zeigt dann den Strich; ein Klick nimmt alles dazu.
   */
  const teilweise = e.besucht && !voll;

  /*
   * **Zu als Vorgabe**, mit eigenem Knopf statt `<details>`: das Kästchen sitzt in der
   * Kopfzeile, und ein Kästchen in `<summary>` klappt beim Anklicken je nach Browser mit.
   * Das ganze Exponat lässt sich auch zugeklappt an- und abwählen.
   */
  const [offen, setzeOffen] = useState(false);
  const inhaltId = useId();

  const kopf = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (kopf.current !== null) kopf.current.indeterminate = teilweise;
  }, [teilweise]);

  function umschalten(el: Element, an: boolean) {
    const rest = zugeordnet.filter((z) => !(z.art === el.art && z.zielId === el.zielId));
    aufSetzen(an ? [...rest, el] : rest);
  }

  return (
    <li className="border border-linie">
      <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 bg-grund px-4 py-2">
        <div className="flex min-w-[15rem] flex-1 items-center gap-3">
          <input
            ref={kopf}
            type="checkbox"
            className="size-6 shrink-0 accent-primaer"
            aria-label={`${e.kennung} ${e.name} besucht`}
            checked={voll}
            disabled={gesperrt || leer}
            onChange={() => {
              aufSetzen(voll ? [] : alle);
            }}
          />
          <button
            type="button"
            aria-expanded={offen}
            aria-controls={inhaltId}
            className="flex min-h-[48px] min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => {
              setzeOffen((o) => !o);
            }}
          >
            <span aria-hidden="true" className="w-3 text-text-hinweis">
              {offen ? "▾" : "▸"}
            </span>
            <span className="min-w-0 flex-1 text-[15px] font-semibold hyphens-auto">
              <span className="mr-2 text-text-hinweis">{e.kennung}</span>
              {e.name}
            </span>
            {!leer && (
              <span className="shrink-0 text-[13px] text-text-hinweis">
                {zugeordnet.length} von {alle.length}
              </span>
            )}
          </button>
        </div>
        <Link
          to={`/exponate/${e.id}`}
          className="ml-auto text-[13px] font-semibold text-primaer-dunkel"
        >
          Exponat ansehen
        </Link>
      </div>

      {offen && (
        <div id={inhaltId}>
          {leer ? (
            <p className="px-4 py-3 text-sm text-text-hinweis">
              Keine Dokumente oder Links, hier lässt sich nichts zuweisen.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-linie">
              {[
                ...e.dokumente.map((d) => ({
                  art: "dokument" as const,
                  ...d,
                  art_text: "Dokument",
                })),
                ...e.links.map((l) => ({ art: "link" as const, ...l, art_text: "Link" })),
              ].map((x) => (
                <li key={x.id}>
                  <label className="flex min-h-[48px] cursor-pointer items-center gap-3 px-4 py-1.5 pl-8 text-sm">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-primaer"
                      checked={x.zugeordnet}
                      disabled={gesperrt}
                      onChange={(ev) => {
                        umschalten({ art: x.art, zielId: x.id }, ev.target.checked);
                      }}
                    />
                    <span className="w-20 shrink-0 text-[11px] font-semibold tracking-[0.08em] text-text-hinweis uppercase">
                      {x.art_text}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{x.titel}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {e.kontakte.length > 0 && (
            <p className="border-t border-linie px-4 py-2.5 text-[13px] text-text-zweit">
              <span className="font-semibold">Ansprechpartner kommen mit:</span>{" "}
              {e.kontakte.map((c) => c.name).join(", ")}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
