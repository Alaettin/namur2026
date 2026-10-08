import type { FastifyInstance } from "fastify";
import { badRequest } from "../errors.js";
import type { Kontext } from "../kontext.js";
import { aendereBesucher, findeBesucher, TEXTFELDER } from "../services/besucher.js";
import { leseGalerie, STANDARD_AVATAR_ID } from "../services/standardavatar.js";

/**
 * Das Selbstbedienungs-Tablet am Stand.
 *
 * Ein Besucher scannt seinen eigenen Pass und pflegt danach seine Stammdaten oder waehlt
 * einen Avatar. Mehr nicht.
 *
 * **Eigene Routen statt geweiteter Rechte.** Die Verwaltungsrouten bleiben Admin-Sache;
 * haette man sie fuer `kiosk` geoeffnet, waere die enge Rolle eine Frage von Wachsamkeit
 * bei jeder kuenftigen Aenderung. Hier ist sie eine Frage des Routenbaums.
 *
 * **Es gibt bewusst keine Listenroute.** Ein Tablet im Publikum darf nie erfahren, welche
 * GUIDs es gibt.
 *
 * **Was diese Routen nicht leisten koennen:** Die GUIDs sind fortlaufend. Wer eine kennt,
 * kennt alle, und der Server kann nicht unterscheiden, ob eine GUID von der Kamera kam
 * oder erfunden wurde. Der Schutz ist der physische Pass und ein Geraet im Kioskmodus;
 * deshalb hat die Oberflaeche kein Eingabefeld fuer die GUID.
 */
export function kioskRoutes(app: FastifyInstance, ctx: Kontext): void {
  /**
   * Der Besucher, wie das Tablet ihn braucht.
   *
   * **Ausdruecklich aufgezaehlt, nicht durchgereicht.** `findeBesucher` liefert auch
   * Zeitstempel und interne Felder; was ein Geraet im Publikum sieht, soll hier
   * dastehen und nicht davon abhaengen, was eine andere Funktion spaeter ergaenzt.
   */
  app.get<{ Params: { guid: string } }>(
    "/api/kiosk/besucher/:guid",
    { preHandler: app.verlangeKiosk },
    async (req) => {
      const b = findeBesucher(ctx.db, req.params.guid);
      const felder = Object.fromEntries(TEXTFELDER.map((f) => [f, b[f]]));
      return { guid: b.guid, ...felder, avatarDateiId: b.avatarDateiId };
    },
  );

  /**
   * Stammdaten aendern.
   *
   * Die GUID steht im Pfad und wird nie aus dem Rumpf gelesen; `aendereBesucher` fasst
   * ohnehin nur `TEXTFELDER` und `avatarDateiId` an. Letzteres wird hier **entfernt**,
   * damit dieser Weg nicht am Galerie-Filter der Avatar-Route vorbeifuehrt.
   */
  app.patch<{ Params: { guid: string }; Body: Record<string, unknown> }>(
    "/api/kiosk/besucher/:guid",
    { preHandler: app.verlangeKiosk },
    async (req) => {
      const roh = req.body ?? {};
      const eingabe: Record<string, unknown> = {};
      for (const feld of TEXTFELDER) {
        if (feld in roh) eingabe[feld] = roh[feld];
      }
      if (typeof eingabe["vorname"] === "string" && eingabe["vorname"].trim() === "") {
        throw badRequest("pflicht-fehlt", "Field vorname must not be empty.");
      }
      if (typeof eingabe["nachname"] === "string" && eingabe["nachname"].trim() === "") {
        throw badRequest("pflicht-fehlt", "Field nachname must not be empty.");
      }

      const b = aendereBesucher(ctx.db, req.params.guid, eingabe);
      const felder = Object.fromEntries(TEXTFELDER.map((f) => [f, b[f]]));
      return { guid: b.guid, ...felder, avatarDateiId: b.avatarDateiId };
    },
  );

  /**
   * Die Auswahl der Avatare. Nur Ids; die Bilder holt der Klient ueber `/api/dateien/:id`.
   *
   * `standard` steht getrennt daneben, weil er kein Galeriebild ist, aber waehlbar sein
   * soll: jeder neue Besucher traegt ihn, und man muss dorthin zurueckkommen koennen.
   */
  app.get("/api/kiosk/avatare", { preHandler: app.verlangeKiosk }, () => ({
    standard: STANDARD_AVATAR_ID,
    avatare: leseGalerie(ctx.db),
  }));

  /**
   * Einen Avatar setzen. `null` bedeutet den Standard.
   *
   * **Nur Ids aus der Galerie.** Ohne diese Pruefung koennte ein Tablet den Avatar eines
   * Besuchers auf eine beliebige Datei zeigen lassen, etwa auf ein PDF von einem Exponat,
   * und das ginge als Base64 in jede `values`-Antwort der Konnektor-API hinaus.
   */
  app.patch<{ Params: { guid: string }; Body: { avatarDateiId?: unknown } }>(
    "/api/kiosk/besucher/:guid/avatar",
    { preHandler: app.verlangeKiosk },
    async (req) => {
      const roh = req.body?.avatarDateiId ?? null;
      if (roh !== null && typeof roh !== "string") {
        throw badRequest("avatar-ungueltig", "Field avatarDateiId must be a string or null.");
      }

      /*
       * `null` heisst "Standard", und Standard ist eine **echte Id**: `legeBesucherAn`
       * traegt sie bei jedem neuen Besucher ein. Hier `null` zu speichern funktionierte
       * zwar ueber den Rueckfall in `avatarFuer`, ergaebe aber zwei Schreibweisen fuer
       * denselben Zustand.
       */
      const wunsch = roh ?? STANDARD_AVATAR_ID;

      // **Nur Galerie oder Standard.** Alles andere waere eine beliebige Datei.
      if (wunsch !== STANDARD_AVATAR_ID && !leseGalerie(ctx.db).includes(wunsch)) {
        throw badRequest("avatar-unbekannt", "Field avatarDateiId must be one of the gallery.");
      }

      const b = aendereBesucher(ctx.db, req.params.guid, { avatarDateiId: wunsch });
      return { guid: b.guid, avatarDateiId: b.avatarDateiId };
    },
  );
}
