import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

/**
 * Validierung **gegen die Spec-Datei**, nicht gegen abgeschriebene Typen.
 *
 * Eine von Hand nachgebaute Typdefinition prueft nur, dass der Code zu sich selbst passt.
 * Sobald die Gegenseite eine neue Fassung schickt, faellt der Unterschied erst beim Kunden
 * auf. Deshalb wird `Connector Guide/connector-1.0.0.json` gelesen und daraus validiert.
 *
 * **Fehlt die Datei, wird der Lauf nicht still gruen.** Die Tests, die sie brauchen, zaehlen
 * sich hoch und melden sich am Ende mit einer sichtbaren Zeile ab. Ein uebersprungener
 * Vertragstest, den niemand bemerkt, ist schlimmer als gar keiner: er erzeugt Vertrauen,
 * das er nicht traegt.
 */

const SPEC_PFAD = fileURLToPath(
  new URL("../../../Connector Guide/connector-1.0.0.json", import.meta.url),
);

interface Spec {
  components: { schemas: Record<string, unknown> };
}

let spec: Spec | null = null;
let grund: string | null = null;

try {
  spec = JSON.parse(readFileSync(SPEC_PFAD, "utf8")) as Spec;
} catch (ursache) {
  grund = `connector-1.0.0.json nicht lesbar (${(ursache as Error).message})`;
}

export const specVorhanden = spec !== null;

export function fehlendeSpec(): string {
  return grund ?? "unbekannt";
}

/**
 * **Eine** AJV-Instanz fuer alle Validatoren, beim ersten Bedarf gebaut.
 *
 * Je Aufruf eine neue zu bauen hiesse, dieselben Schemata immer wieder anzumelden, und
 * `addKeyword` zweimal fuer denselben Namen bricht mit "already defined" ab.
 */
let ajv: Ajv | null = null;

function instanz(): Ajv {
  if (spec === null) throw new Error("Spec fehlt, vorher specVorhanden pruefen");
  if (ajv !== null) return ajv;

  const neu = new Ajv({ strict: false, allErrors: true });
  addFormats(neu);
  /*
   * OpenAPI 3.0.1 benutzt `nullable` und `example`, die der JSON-Schema-Entwurf nicht
   * kennt. Je nach Fassung bringt AJV `nullable` bereits mit, deshalb erst fragen: ein
   * zweites `addKeyword` wirft.
   */
  for (const wort of ["nullable", "example"]) {
    if (neu.getKeyword(wort) === false) neu.addKeyword(wort);
  }

  for (const [name, schema] of Object.entries(spec.components.schemas)) {
    // Geklont, damit AJV nicht in das geladene Dokument schreibt.
    neu.addSchema(JSON.parse(JSON.stringify(schema)) as object, `#/components/schemas/${name}`);
  }

  ajv = neu;
  return neu;
}

/** Validator fuer ein einzelnes Schema der Spec. */
export function validatorFuer(name: string): ValidateFunction {
  return instanz().compile({ $ref: `#/components/schemas/${name}` });
}

/** Validator fuer ein Array desselben Schemas, wie es die meisten Endpunkte liefern. */
export function arrayValidatorFuer(name: string): ValidateFunction {
  return instanz().compile({
    type: "array",
    items: { $ref: `#/components/schemas/${name}` },
  });
}
