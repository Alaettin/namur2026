import { afterEach, describe, expect, it } from "vitest";
import { starte, type Pruefstand } from "./hilfe.js";

/**
 * Die Sicherheitskopfzeilen, und vor allem die CSP.
 *
 * Eine fehlende Direktive faellt still auf `default-src` zurueck. Sie meldet sich also
 * **nicht** als Sicherheitsproblem, sondern als kaputte Funktion an einer ganz anderen
 * Stelle. Genau das ist mit `worker-src` passiert: das Kamerabild im Scan war da, nur
 * dekodierte niemand, weil der Worker von `qr-scanner` ein blob:-Worker ist.
 */

let stand: Pruefstand | null = null;
afterEach(async () => {
  await stand?.ende();
  stand = null;
});

/** Zerlegt die Kopfzeile in Direktive -> Quellenliste. */
async function csp(): Promise<Map<string, string[]>> {
  stand = await starte();
  const antwort = await stand.app.inject({ url: "/api/health" });
  const roh = antwort.headers["content-security-policy"];
  expect(typeof roh, "die Kopfzeile fehlt ganz").toBe("string");

  const karte = new Map<string, string[]>();
  for (const teil of String(roh).split(";")) {
    const stuecke = teil.trim().split(/\s+/);
    const name = stuecke.shift();
    if (name !== undefined && name !== "") karte.set(name, stuecke);
  }
  return karte;
}

describe("Content-Security-Policy", () => {
  it("erlaubt dem Scanner seinen blob:-Worker", async () => {
    const regeln = await csp();
    /*
     * Ausdruecklich **nicht** gegen den ganzen Kopfzeilentext geprueft: ein `includes`
     * auf dem Rohtext ginge auch durch, wenn `blob:` nur in `img-src` steht.
     */
    expect(regeln.get("worker-src")).toEqual(["'self'", "blob:"]);
  });

  /**
   * **Die Gegenrichtung.** Die Lockerung oben gilt dem Worker und sonst nichts. Waechst
   * `blob:` irgendwann nach `script-src` hinueber, duerfte jede Seite beliebigen
   * zusammengebauten Code ausfuehren, und die Regel hier faengt das.
   */
  it("laesst Skripte weiterhin nur aus eigener Quelle", async () => {
    const regeln = await csp();
    expect(regeln.get("script-src")).toEqual(["'self'"]);
    expect(regeln.get("default-src")).toEqual(["'self'"]);
    expect(regeln.get("object-src")).toEqual(["'none'"]);
  });

  it("erlaubt die Kamera der eigenen Seite", async () => {
    stand = await starte();
    const antwort = await stand.app.inject({ url: "/api/health" });
    expect(antwort.headers["permissions-policy"]).toContain("camera=(self)");
  });
});
