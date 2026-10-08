/**
 * MIME-Typ **aus der Endung**, nicht aus dem Header.
 *
 * Beim Hochladen meldet der Browser fuer CAD-Dateien `file.type === ""`, und ein Speicher
 * liefert dann `application/octet-stream`. Ein Header ist damit nie leer, und eine
 * Endungstabelle **dahinter** laeuft ins Leere: sie greift nie, weil immer schon etwas
 * dasteht. Die Endung hat deshalb Vorrang.
 *
 * Uebernommen aus dem AXON Connector.
 */
const NACH_ENDUNG: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  xml: "application/xml",
  json: "application/json",
  zip: "application/zip",
  txt: "text/plain",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  aasx: "application/asset-administration-shell-package",
  // CAD. Beide sind bei IANA unter `image/` registriert, und genau das ist die Falle,
  // siehe `istInlineBild`.
  dwg: "image/vnd.dwg",
  dxf: "image/vnd.dxf",
  stp: "model/step",
  step: "model/step",
  igs: "model/iges",
  iges: "model/iges",
  stl: "model/stl",
  edz: "application/octet-stream",
};

export function mimeAusName(dateiname: string): string {
  const punkt = dateiname.lastIndexOf(".");
  if (punkt < 0 || punkt === dateiname.length - 1) return "application/octet-stream";
  const endung = dateiname.slice(punkt + 1).toLowerCase();
  return NACH_ENDUNG[endung] ?? "application/octet-stream";
}

/**
 * Ist das ein Bild, das inline als Base64 ausgeliefert werden darf?
 *
 * **Nicht `startsWith("image/")`.** `image/vnd.dwg` und `image/vnd.dxf` sind bei IANA
 * unter `image/` registriert, sind aber CAD-Zeichnungen und keine Bilder. Ein
 * Praefixvergleich liefert eine 40-MB-Zeichnung als Base64 inline aus.
 *
 * Gebraucht wird das in Auftrag 2, wo `values` Bilder By Value und alles andere By Ticket
 * ausliefert. Es steht hier, weil die Regel zur Ableitung des Typs gehoert und nicht zur
 * Auslieferung.
 */
export function istInlineBild(mimeType: string): boolean {
  if (!mimeType.startsWith("image/")) return false;
  return !mimeType.startsWith("image/vnd.");
}
