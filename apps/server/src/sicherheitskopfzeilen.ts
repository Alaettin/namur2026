import type { FastifyInstance } from "fastify";

/**
 * Sicherheitskopfzeilen auf jeder Antwort.
 *
 * Handgesetzt statt `@fastify/helmet`: es sind ein Dutzend Zeilen, und der Wert je Zeile
 * gehoert an dieser Stelle erklaert, nicht in die Vorgaben einer Bibliothek.
 *
 * Der `onSend`-Haken trifft **alle** Antworten, auch die statischen Dateien und den
 * SPA-Rueckfall; ein preHandler wuerde die statische Auslieferung verpassen.
 */

/**
 * Die Content-Security-Policy, zugeschnitten auf die eigene Oberflaeche.
 *
 * `style-src 'unsafe-inline'`: Radix und andere Bauteile setzen Stile direkt am Element,
 * ohne das laedt die Oberflaeche nicht. Skripte sind gebuendelt, dort also **kein**
 * `unsafe-inline`. `img-src ... data: blob:` fuer die Vorschau hochgeladener Dokumente,
 * die als Blob-URL im Browser entsteht. `connect-src 'self'`, weil der Klient nur die
 * eigene API ruft. `frame-ancestors 'none'` verbietet das Einbetten.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function installiereSicherheitskopfzeilen(app: FastifyInstance, production: boolean): void {
  app.addHook("onSend", (_req, reply, nutzlast, fertig) => {
    void reply.header("content-security-policy", CSP);
    void reply.header("x-frame-options", "DENY");
    void reply.header("x-content-type-options", "nosniff");
    /*
     * `no-referrer`: die Besucher-Detailseite verlinkt den Viewer, und die Adresse dieser
     * Seite traegt die GUID des Besuchers. Mit Referrer stuende sie im Protokoll jedes
     * Ziels, das ein Betreuer von hier aus anklickt.
     */
    void reply.header("referrer-policy", "no-referrer");
    /*
     * **`camera=(self)`, nicht `camera=()`.** Der Scan-Ablauf am Exponat ist der Kern
     * dieser App und laeuft ueber `getUserMedia`. Mit leerer Liste sperrt der Browser die
     * Kamera, ohne dass die Seite einen Fehler sieht: der Nutzer bekaeme die
     * Verweigerungsmeldung aus `ErrCamera`, ohne je gefragt worden zu sein.
     */
    void reply.header("permissions-policy", "camera=(self), microphone=(), geolocation=()");
    /*
     * HSTS nur in Produktion: im Entwicklungsbetrieb laeuft der Server ueber http, und ein
     * ausgesandtes HSTS wuerde den Browser fuer localhost auf https festnageln.
     *
     * Ohne `includeSubDomains` und ohne `preload`: `sliplane.app` traegt fremde Dienste,
     * und `preload` ist praktisch nicht zurueckzunehmen.
     */
    if (production) {
      void reply.header("strict-transport-security", "max-age=31536000");
    }
    fertig(null, nutzlast);
  });
}
