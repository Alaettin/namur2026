import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { Dateiablage } from "../ablage/dateien.js";
import { stelleStandardAvatarSicher } from "./standardavatar.js";
import { befuelleGalerieEinmalig, vergissErstbefuellung } from "./avatare.js";
import { SCHLUESSEL_UNBEKANNT } from "./abrufe.js";
import {
  appNutzer,
  besucher,
  dateien,
  exponate,
  exponatBetreuer,
  exponatDokumente,
  ansprechpartner,
  exponatAnsprechpartner,
  einstellungen,
  exponatLinks,
  konnektorAbrufe,
  zuordnungen,
} from "../db/schema.js";

/**
 * Testdaten einspielen und alles zuruecksetzen, fuer den Entwicklermodus.
 *
 * Beides laeuft nur fuer Admins, siehe die Routen. **Der Schalter in der Oberflaeche ist
 * keine Sicherheitsgrenze**, er blendet die Knoepfe nur aus; wer die Adresse kennt, kaeme
 * sonst ohne Rolle daran.
 */

export interface Bestand {
  besucher: number;
  exponate: number;
  dokumente: number;
  links: number;
  kontakte: number;
  zuordnungen: number;
  dateien: number;
  /** GUIDs mit mindestens einem Konnektor-Abruf, siehe `services/abrufe.ts`. */
  abrufe: number;
  /** Bleiben beim Zuruecksetzen erhalten. Nur zur Anzeige im Rueckfragedialog. */
  appNutzer: number;
}

/**
 * Was beim Zuruecksetzen verschwindet, in Zahlen.
 *
 * Der Rueckfragedialog nennt sie. Ein "Sind Sie sicher?" ohne Zahlen klickt man weg; eine
 * Rueckfrage, die weiss, wovon sie spricht, haelt einen Moment auf.
 */
export function leseBestand(db: Db): Bestand {
  const n = (abfrage: { get: () => { n: number } | undefined }) => abfrage.get()?.n ?? 0;

  return {
    besucher: n(db.select({ n: sql<number>`count(*)` }).from(besucher)),
    exponate: n(db.select({ n: sql<number>`count(*)` }).from(exponate)),
    dokumente: n(db.select({ n: sql<number>`count(*)` }).from(exponatDokumente)),
    links: n(db.select({ n: sql<number>`count(*)` }).from(exponatLinks)),
    kontakte: n(db.select({ n: sql<number>`count(*)` }).from(ansprechpartner)),
    zuordnungen: n(db.select({ n: sql<number>`count(*)` }).from(zuordnungen)),
    dateien: n(db.select({ n: sql<number>`count(*)` }).from(dateien)),
    abrufe: n(db.select({ n: sql<number>`count(*)` }).from(konnektorAbrufe)),
    appNutzer: n(db.select({ n: sql<number>`count(*)` }).from(appNutzer)),
  };
}

/**
 * Loescht den gesamten Fachbestand. **App-Nutzer bleiben.**
 *
 * Wuerden sie mitgeloescht, kaeme nach dem Zuruecksetzen niemand mehr hinein: der
 * Bootstrap aus `ADMIN_EMAIL` greift erst beim naechsten **Start** und nur, solange kein
 * Admin existiert. Ein Knopf, der die eigene Anmeldung mitnimmt, ist kein Reset, sondern
 * eine Falle.
 *
 * Reihenfolge wie in `loescheDatei`: **erst die Datenbank in einer Transaktion, dann die
 * Dateien von der Platte.** Andersherum bliebe bei einem Abbruch ein Datensatz stehen, der
 * auf nichts zeigt; eine Datei ohne Datensatz belegt dagegen nur Platz.
 */
export async function setzeZurueck(db: Db, ablage: Dateiablage): Promise<Bestand> {
  const vorher = leseBestand(db);

  // Pfade vor dem Loeschen merken, danach sind sie weg.
  const pfade = db
    .select({ pfad: dateien.pfad })
    .from(dateien)
    .all()
    .map((d) => d.pfad);

  db.transaction((tx) => {
    /*
     * Reihenfolge von innen nach aussen. `on delete cascade` wuerde das meiste ohnehin
     * erledigen, aber nur solange `foreign_keys = ON` wirklich gesetzt ist; ausdrueckliches
     * Loeschen haengt nicht an einem PRAGMA.
     */
    /*
     * Die Abrufzaehler zuerst: sie haengen an `besucher`, und ein stehengebliebener
     * Zaehler waere nach dem Zuruecksetzen eine Zahl ohne Besucher dahinter.
     */
    tx.delete(konnektorAbrufe).run();
    /*
     * Und der Zaehler fuer unbekannte GUIDs, der an keinem Besucher haengt. **Gezielt
     * dieser eine Schluessel**, nicht die ganze Tabelle `einstellungen`: dort steht auch
     * der Schalter fuer die Konnektor-Anmeldung, und der ist eine Einstellung des
     * Betreibers, kein Fachbestand.
     */
    tx.delete(einstellungen).where(eq(einstellungen.schluessel, SCHLUESSEL_UNBEKANNT)).run();
    tx.delete(zuordnungen).run();
    tx.delete(exponatDokumente).run();
    tx.delete(exponatLinks).run();
    tx.delete(exponatAnsprechpartner).run();
    tx.delete(ansprechpartner).run();
    tx.delete(exponatBetreuer).run();
    tx.delete(exponate).run();
    tx.delete(besucher).run();
    tx.delete(dateien).run();
  });

  // Erst jetzt die Platte. Ein Fehler hier laesst eine Waise liegen, keine Luecke.
  for (const pfad of pfade) await ablage.loesche(pfad);

  /*
   * **Den Standard-Avatar wieder anlegen.**
   *
   * Er liegt in `dateien` und ging oben mit. Angelegt wurde er bisher nur beim **Start**,
   * also war er nach einem Zuruecksetzen bis zum naechsten Neustart weg: `/api/standard-avatar`
   * antwortete 404 und jeder Besucher erschien ohne Bild. Gemeldet am 08.10.2026.
   *
   * Zuruecksetzen soll den Zustand einer frischen Installation herstellen, und dazu gehoert er.
   */
  await stelleStandardAvatarSicher(db, ablage, () => {
    // Fehlt das Bild im Repo, ist das kein Grund, das Zuruecksetzen scheitern zu lassen.
  });
  /*
   * Die Galerie wieder herstellen. Dafuer muss der Merker weg: das Zuruecksetzen soll den
   * Zustand einer frischen Installation herstellen, und dazu gehoeren die 20 Bilder.
   */
  vergissErstbefuellung(db);
  await befuelleGalerieEinmalig(db, ablage, () => {
    // Fehlt ein Bild im Repo, ist das kein Grund, das Zuruecksetzen scheitern zu lassen.
  });

  return vorher;
}
