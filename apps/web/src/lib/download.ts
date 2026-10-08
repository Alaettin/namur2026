/**
 * Einen Text als Datei anbieten.
 *
 * Als Helfer, weil es zwei Stellen gibt (die uebersprungenen Zeilen nach dem Import und die
 * leere Vorlage davor) und der Ablauf aus Blob, Objekt-URL, Klick und Freigeben jedes Mal
 * derselbe ist. Das `revokeObjectURL` ist der Teil, den man beim Abschreiben vergisst, und
 * ohne das haelt der Browser den Inhalt bis zum Neuladen im Speicher.
 */
export function bieteAlsDatei(inhalt: string, dateiname: string): void {
  /*
   * `charset=utf-8` am Typ und sonst nichts: ein etwaiges BOM steht bereits im Text und
   * gehoert dorthin, nicht in den MIME-Typ. Die Vorlage vom Server bringt es mit.
   */
  const url = URL.createObjectURL(new Blob([inhalt], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = dateiname;
  a.click();
  URL.revokeObjectURL(url);
}
