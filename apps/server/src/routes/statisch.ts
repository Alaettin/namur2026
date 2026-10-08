import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/**
 * Das gebaute Frontend ausliefern, damit die Anwendung aus **einem** Dienst besteht.
 *
 * Registriert wird **nach** den API-Routen. Fastify sucht zuerst eine passende Route, und
 * der Rueckfall greift nur, wenn keine gefunden wurde.
 */

/**
 * Liegt unter diesem Pfad ein gebautes Frontend? Im Entwicklungsbetrieb liefert Vite die
 * Oberflaeche und `apps/web/dist` gibt es vielleicht gar nicht; dann laeuft der Server als
 * reine API weiter, und ein Abbruch waere falsch.
 */
export function frontendVorhanden(wurzel: string): boolean {
  return existsSync(join(wurzel, "index.html"));
}

export async function statischeDateien(app: FastifyInstance, wurzel: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: wurzel,
    // Vite haengt an jede Datei unter /assets einen Inhaltshash. Genau dafuer ist
    // `immutable` gedacht: aendert sich der Inhalt, aendert sich der Name. `index.html`
    // traegt keinen Hash und darf deshalb nie aus dem Cache kommen, sonst sucht der
    // Browser nach der naechsten Auslieferung weiter die alten Namen.
    maxAge: 0,
    setHeaders: (antwort, pfad) => {
      if (pfad.includes(`${sep}assets${sep}`)) {
        void antwort.header("cache-control", "public, max-age=31536000, immutable");
      } else {
        void antwort.header("cache-control", "no-cache");
      }
    },
  });
}
