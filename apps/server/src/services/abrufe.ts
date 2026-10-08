import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { besucher, einstellungen, konnektorAbrufe } from "../db/schema.js";

/**
 * Monitoring der Konnektor-Abrufe: wie oft und wann wurde eine GUID abgefragt.
 *
 * **Zaehler, kein Protokoll.** Ein Protokoll mit einer Zeile je Anfrage gab es hier schon
 * einmal und flog am 08.10.2026 raus, weil es unbegrenzt waechst. Diese Fassung
 * beantwortet dieselbe Frage mit einer Zeile je Besucher; mehr Zeilen als Besucher kann es
 * nicht geben.
 */

/** Die drei Endpunkte mit GUID. Die Namen sind zugleich die Spalten. */
export type Abrufart = "hierarchy" | "werte" | "dokumente";

/**
 * Abrufe auf GUIDs, die wir nicht kennen, als **ein** Wert.
 *
 * Nicht je unbekannter GUID eine Zeile: die Konnektor-API verlangt nach ausdruecklicher
 * Entscheidung keine Anmeldung, jeder koennte die Tabelle also mit erfundenen GUIDs
 * fluten. Die Zahl allein beantwortet die Frage, die hier zaehlt: fragt Axon nach etwas,
 * das wir nicht haben?
 */
export const SCHLUESSEL_UNBEKANNT = "konnektor.unbekannteAbrufe";

/**
 * Zaehlt einen Abruf auf eine **bekannte** GUID.
 *
 * Ein einziger Upsert. `excluded` gibt es hier nicht zu lesen, der neue Stand ist immer
 * der alte plus eins; `zuerst` bleibt deshalb ausdruecklich unberuehrt.
 */
export function zaehleAbruf(db: Db, guid: string, art: Abrufart): void {
  const jetzt = Date.now();
  db.insert(konnektorAbrufe)
    .values({ guid, [art]: 1, zuerst: jetzt, zuletzt: jetzt })
    .onConflictDoUpdate({
      target: konnektorAbrufe.guid,
      set: {
        [art]: sql`${konnektorAbrufe[art]} + 1`,
        zuletzt: jetzt,
      },
    })
    .run();
}

/** Zaehlt einen Abruf auf eine unbekannte GUID, ohne eine Zeile anzulegen. */
export function zaehleUnbekannt(db: Db): void {
  db.insert(einstellungen)
    .values({ schluessel: SCHLUESSEL_UNBEKANNT, wert: "1" })
    .onConflictDoUpdate({
      target: einstellungen.schluessel,
      /*
       * In SQL hochzaehlen statt lesen und schreiben: zwei gleichzeitige Anfragen wuerden
       * sonst denselben Ausgangswert lesen und einer der beiden Abrufe ginge verloren.
       * `CAST` faengt einen verunglueckten Wert von Hand ab.
       */
      set: {
        wert: sql`CAST(CAST(${einstellungen.wert} AS INTEGER) + 1 AS TEXT)`,
        geaendert: Date.now(),
      },
    })
    .run();
}

export function leseUnbekannt(db: Db): number {
  const reihe = db
    .select({ wert: einstellungen.wert })
    .from(einstellungen)
    .where(eq(einstellungen.schluessel, SCHLUESSEL_UNBEKANNT))
    .get();
  const zahl = Number.parseInt(reihe?.wert ?? "0", 10);
  return Number.isFinite(zahl) ? zahl : 0;
}

export interface Abrufzeile {
  guid: string;
  name: string;
  hierarchy: number;
  werte: number;
  dokumente: number;
  gesamt: number;
  zuerst: number;
  zuletzt: number;
}

export interface Monitoringstand {
  /** Besucher mit mindestens einem Abruf. */
  abgefragt: number;
  /** Besucher insgesamt, als Bezugsgroesse. */
  besucherGesamt: number;
  /** Alle Abrufe auf bekannte GUIDs zusammen. */
  abrufeGesamt: number;
  unbekannteAbrufe: number;
  /** Zeitpunkt des juengsten Abrufs, `null` wenn es noch keinen gab. */
  letzter: number | null;
  eintraege: Abrufzeile[];
}

/**
 * Der ganze Stand fuer die Monitoring-Seite.
 *
 * Besucher **ohne** Abruf stehen bewusst nicht in der Liste: bei 700 Besuchern und einer
 * Handvoll Abrufen waere die Seite sonst eine Wueste aus Nullen. Die Kopfzahl
 * "abgefragt von insgesamt" sagt dasselbe in einer Zeile.
 */
export function leseMonitoring(db: Db): Monitoringstand {
  const gesamtSpalte = sql<number>`${konnektorAbrufe.hierarchy} + ${konnektorAbrufe.werte} + ${konnektorAbrufe.dokumente}`;

  const reihen = db
    .select({
      guid: konnektorAbrufe.guid,
      vorname: besucher.vorname,
      nachname: besucher.nachname,
      hierarchy: konnektorAbrufe.hierarchy,
      werte: konnektorAbrufe.werte,
      dokumente: konnektorAbrufe.dokumente,
      gesamt: gesamtSpalte,
      zuerst: konnektorAbrufe.zuerst,
      zuletzt: konnektorAbrufe.zuletzt,
    })
    .from(konnektorAbrufe)
    .innerJoin(besucher, eq(besucher.guid, konnektorAbrufe.guid))
    .orderBy(desc(konnektorAbrufe.zuletzt))
    .all();

  const besucherGesamt =
    db
      .select({ n: sql<number>`count(*)` })
      .from(besucher)
      .get()?.n ?? 0;

  return {
    abgefragt: reihen.length,
    besucherGesamt,
    abrufeGesamt: reihen.reduce((summe, r) => summe + r.gesamt, 0),
    unbekannteAbrufe: leseUnbekannt(db),
    letzter: reihen[0]?.zuletzt ?? null,
    eintraege: reihen.map(({ vorname, nachname, ...rest }) => ({
      ...rest,
      name: `${vorname} ${nachname}`.trim(),
    })),
  };
}
