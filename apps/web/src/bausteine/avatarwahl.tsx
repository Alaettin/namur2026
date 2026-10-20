/**
 * Das Bildraster zur Avatarwahl: Standardbild und Galerie, das gewählte umrandet.
 *
 * Seit dem 20.10.2026 ein eigener Baustein, weil ihn das Tablet und das Besucherdetail
 * brauchen. Die Wahl speichert hier nichts; das tut die Seite, die ihn zeigt.
 */
export function Avatarwahl({
  standard,
  avatare,
  gewaehlt,
  aufWahl,
  spalten = "grid-cols-3 sm:grid-cols-5",
}: {
  standard: string;
  avatare: string[];
  gewaehlt: string | null;
  aufWahl: (id: string) => void;
  spalten?: string;
}) {
  return (
    <ul className={`grid gap-4 ${spalten}`}>
      {[standard, ...avatare].map((id) => (
        <li key={id}>
          <button
            type="button"
            aria-pressed={gewaehlt === id}
            aria-label={id === standard ? "Standardbild" : "Bild auswählen"}
            onClick={() => {
              aufWahl(id);
            }}
            className={`block w-full overflow-hidden ${
              gewaehlt === id
                ? "outline outline-4 outline-offset-2 outline-primaer"
                : "outline outline-1 outline-linie"
            }`}
          >
            <img src={`/api/dateien/${id}`} alt="" className="aspect-square w-full object-cover" />
          </button>
        </li>
      ))}
    </ul>
  );
}
