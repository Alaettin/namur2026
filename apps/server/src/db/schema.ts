import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/**
 * Das vollstaendige Schema nach der Uebergabe, in einer Datei und einer Datenbank.
 *
 * Auch die Tabellen, die erst Auftrag 2 fuellt, stehen schon hier: das Modell ist
 * entschieden, und eine Migration ist billiger als zwei.
 *
 * Zeitstempel sind Millisekunden seit 1970 als `integer`. SQLite kennt keinen eigenen
 * Zeittyp; eine Zahl laesst sich vergleichen und sortieren, ein ISO-Text nur zufaellig
 * richtig.
 */

const jetzt = sql`(unixepoch() * 1000)`;

// --- Nutzer und Rollen ---------------------------------------------------------------

export const appNutzer = sqliteTable(
  "app_nutzer",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Immer klein geschrieben gespeichert, siehe `normalisiereEmail`. */
    email: text("email").notNull().unique(),
    passwortHash: text("passwort_hash").notNull(),
    /*
     * Reines `text` ohne CHECK in SQLite, der Aufzaehlungstyp wirkt nur in TypeScript.
     * Eine weitere Rolle braucht deshalb **keine Migration**.
     *
     * `kiosk` ist das Selbstbedienungs-Tablet am Stand: es darf genau einen Besucher
     * lesen und aendern, nachdem dessen Pass gescannt wurde, und sonst nichts.
     */
    rolle: text("rolle", { enum: ["admin", "betreuer", "kiosk"] }).notNull(),
    /*
     * Deaktivierte Nutzer bleiben stehen, statt geloescht zu werden: ihre Kennung haengt
     * an jeder Zuordnung, die sie vorgenommen haben, und die soll nachvollziehbar bleiben.
     */
    aktiv: integer("aktiv", { mode: "boolean" }).notNull().default(true),
    angelegt: integer("angelegt").notNull().default(jetzt),
    zuletztAngemeldet: integer("zuletzt_angemeldet"),
  },
  (t) => [index("app_nutzer_email_idx").on(t.email)],
);

export const exponatBetreuer = sqliteTable(
  "exponat_betreuer",
  {
    exponatId: text("exponat_id")
      .notNull()
      .references(() => exponate.id, { onDelete: "cascade" }),
    appNutzerId: text("app_nutzer_id")
      .notNull()
      .references(() => appNutzer.id, { onDelete: "cascade" }),
  },
  (t) => [
    unique("exponat_betreuer_paar").on(t.exponatId, t.appNutzerId),
    index("exponat_betreuer_nutzer_idx").on(t.appNutzerId),
  ],
);

// --- Dateien -------------------------------------------------------------------------

export const dateien = sqliteTable("dateien", {
  id: text("id").primaryKey(),
  /** Relativ zu `DATA_DIR/dateien`, nie absolut: der Pfad muss einen Umzug ueberleben. */
  pfad: text("pfad").notNull(),
  /** Aus der Dateiendung bestimmt, nicht aus dem Kopf des Browsers. */
  mimeType: text("mime_type").notNull(),
  groesse: integer("groesse").notNull(),
  originalName: text("original_name").notNull(),
  sha256: text("sha256").notNull(),
  angelegt: integer("angelegt").notNull().default(jetzt),
});

// --- Besucher ------------------------------------------------------------------------

export const besucher = sqliteTable("besucher", {
  /** Die GUID ist der Schluessel, nicht eine eigene Id: sie ist die `itemId` fuer Axon. */
  guid: text("guid").primaryKey(),
  /** Akademischer Titel, etwa "Dr." oder "Prof. Dr.". Freitext, weil die Formen zu viele sind. */
  titel: text("titel"),
  vorname: text("vorname").notNull(),
  nachname: text("nachname").notNull(),
  firma: text("firma"),
  position: text("position"),
  email: text("email"),
  strasse: text("strasse"),
  plz: text("plz"),
  ort: text("ort"),
  land: text("land"),
  website: text("website"),
  /*
   * `set null`, nicht `cascade`: wird ein Bild geloescht, verliert der Besucher sein
   * Avatar, aber nicht seinen Datensatz.
   */
  avatarDateiId: text("avatar_datei_id").references(() => dateien.id, { onDelete: "set null" }),
  angelegt: integer("angelegt").notNull().default(jetzt),
  geaendert: integer("geaendert").notNull().default(jetzt),
});

// --- Exponate und ihre Inhalte -------------------------------------------------------

export const exponate = sqliteTable("exponate", {
  id: text("id").primaryKey(),
  /** Zum Beispiel `E03`. Steht in den propertyIds des Modells, deshalb eng begrenzt. */
  kennung: text("kennung").notNull().unique(),
  name: text("name").notNull(),
  beschreibung: text("beschreibung"),
  angelegt: integer("angelegt").notNull().default(jetzt),
});

/**
 * `platz` ist die Bruecke zum Modell der Konnektor-API.
 *
 * Er wird beim Anlegen als kleinste freie Nummer vergeben und aendert sich danach nie:
 * aus ihm entsteht `{K}_Doc03_Title`, und der Content-Admin hat das in Axon gemappt.
 * Loeschen gibt den Platz frei.
 */
export const exponatDokumente = sqliteTable(
  "exponat_dokumente",
  {
    id: text("id").primaryKey(),
    exponatId: text("exponat_id")
      .notNull()
      .references(() => exponate.id, { onDelete: "cascade" }),
    platz: integer("platz").notNull(),
    dateiId: text("datei_id")
      .notNull()
      .references(() => dateien.id),
    titel: text("titel").notNull(),
    beschreibung: text("beschreibung"),
  },
  (t) => [unique("exponat_dokumente_platz").on(t.exponatId, t.platz)],
);

export const exponatLinks = sqliteTable(
  "exponat_links",
  {
    id: text("id").primaryKey(),
    exponatId: text("exponat_id")
      .notNull()
      .references(() => exponate.id, { onDelete: "cascade" }),
    platz: integer("platz").notNull(),
    url: text("url").notNull(),
    titel: text("titel").notNull(),
  },
  (t) => [unique("exponat_links_platz").on(t.exponatId, t.platz)],
);

/**
 * Ansprechpartner als **eigenstaendige Stammdaten**.
 *
 * Frueher hing jeder an genau einem Exponat (`exponat_kontakte`). Mehrere Exponate koennen
 * denselben Menschen aber gemeinsam haben, und dann stand er doppelt im Bestand: zwei
 * Datensaetze, die beim Korrigieren einer E-Mail auseinanderlaufen.
 *
 * **Kein Foto.** Ansprechpartner brauchen keines, und damit entfaellt auch der Datenpunkt
 * `{K}_Contact{NN}_Image` im Konnektor-Modell.
 */
export const ansprechpartner = sqliteTable("ansprechpartner", {
  id: text("id").primaryKey(),
  /** Siehe `besucher.titel`: dieselbe Feldliste traegt beide. */
  titel: text("titel"),
  vorname: text("vorname").notNull(),
  nachname: text("nachname").notNull(),
  firma: text("firma"),
  position: text("position"),
  email: text("email"),
  strasse: text("strasse"),
  plz: text("plz"),
  ort: text("ort"),
  land: text("land"),
  website: text("website"),
  angelegt: integer("angelegt").notNull().default(jetzt),
  geaendert: integer("geaendert").notNull().default(jetzt),
});

/**
 * Welcher Ansprechpartner an welchem Exponat auf welchem Platz steht.
 *
 * **Der Platz gehoert hierher, nicht an die Person.** Er ist die Bruecke zum Modell
 * (`{K}_Contact03_Email`) und damit eine Eigenschaft der Zuweisung: derselbe Mensch kann an
 * E01 auf Platz 1 und an E04 auf Platz 3 stehen.
 *
 * Zwei Eindeutigkeiten: ein Platz je Exponat nur einmal, und dieselbe Person nicht zweimal
 * am selben Exponat.
 */
export const exponatAnsprechpartner = sqliteTable(
  "exponat_ansprechpartner",
  {
    exponatId: text("exponat_id")
      .notNull()
      .references(() => exponate.id, { onDelete: "cascade" }),
    ansprechpartnerId: text("ansprechpartner_id")
      .notNull()
      .references(() => ansprechpartner.id, { onDelete: "cascade" }),
    platz: integer("platz").notNull(),
  },
  (t) => [
    unique("exponat_ansprechpartner_platz").on(t.exponatId, t.platz),
    unique("exponat_ansprechpartner_paar").on(t.exponatId, t.ansprechpartnerId),
    index("exponat_ansprechpartner_person_idx").on(t.ansprechpartnerId),
  ],
);

// --- Zuordnungen ---------------------------------------------------------------------

/**
 * Was ein Besucher an einem Exponat bekommen hat.
 *
 * Der Eindeutigkeitsschluessel traegt die Zusage "Zuordnen ist idempotent": ein zweiter
 * Versuch nach einem Netzfehler legt nichts doppelt an. `exponatId` steht trotz
 * `zielId` dabei, weil `values` je Exponat gruppiert antwortet und sonst jede Abfrage
 * drei Tabellen zusammenfuehren muesste.
 */
export const zuordnungen = sqliteTable(
  "zuordnungen",
  {
    id: text("id").primaryKey(),
    besucherGuid: text("besucher_guid")
      .notNull()
      .references(() => besucher.guid, { onDelete: "cascade" }),
    exponatId: text("exponat_id")
      .notNull()
      .references(() => exponate.id, { onDelete: "cascade" }),
    art: text("art", { enum: ["dokument", "link", "kontakt"] }).notNull(),
    /** Id in `exponat_dokumente`, `exponat_links` oder `exponat_kontakte`, je nach `art`. */
    zielId: text("ziel_id").notNull(),
    appNutzerId: text("app_nutzer_id")
      .notNull()
      .references(() => appNutzer.id),
    zeitpunkt: integer("zeitpunkt").notNull().default(jetzt),
  },
  (t) => [
    unique("zuordnungen_eindeutig").on(t.besucherGuid, t.art, t.zielId),
    index("zuordnungen_besucher_idx").on(t.besucherGuid),
    index("zuordnungen_exponat_idx").on(t.exponatId),
  ],
);

// --- Einstellungen zur Laufzeit ------------------------------------------------------

/**
 * Schalter, die sich im Betrieb aendern lassen, als Schluessel und Wert.
 *
 * Warum eine Tabelle und nicht die Umgebung: der Nutzer soll sie in der Oberflaeche
 * umlegen koennen, ohne den Dienst neu zu starten. Und warum nicht der localStorage wie
 * beim Entwicklermodus: die Auswertung steht auf dem **Server**, ein Wert im Browser
 * waere dort nur eine Behauptung.
 *
 * Der Wert ist Text, nicht `integer`: hier landen spaeter auch Schluessel, die keine
 * Schalter sind, und ein Typ je Schluessel waere eine Spalte je Schluessel.
 */
export const einstellungen = sqliteTable("einstellungen", {
  schluessel: text("schluessel").primaryKey(),
  wert: text("wert").notNull(),
  geaendert: integer("geaendert").notNull().default(jetzt),
});

// --- Monitoring der Konnektor-Abrufe --------------------------------------------------

/**
 * Wie oft und wann Axon eine GUID abgefragt hat.
 *
 * **Eine Zeile je Besucher, nicht je Anfrage.** Ein vollstaendiges Abrufprotokoll gab es
 * hier schon einmal und flog am 08.10.2026 wieder raus, weil es unbegrenzt waechst. Diese
 * Fassung beantwortet dieselbe Frage mit Zaehlern: die Tabelle kann nie groesser werden
 * als die Besucherzahl, und je Anfrage faellt genau ein Upsert an.
 *
 * **Nur bekannte GUIDs stehen hier.** Die Konnektor-API verlangt bewusst keine Anmeldung;
 * legte jede unbekannte GUID eine Zeile an, koennte sie jeder beliebig aufblaehen. Abrufe
 * auf Unbekanntes zaehlt deshalb ein einzelner Wert in `einstellungen`.
 *
 * Die drei Spalten sind die drei Endpunkte mit GUID. Getrennt, weil die Frage am Stand
 * nicht "wurde abgefragt" lautet, sondern "kam der Viewer bis zu den Dokumenten".
 */
export const konnektorAbrufe = sqliteTable("konnektor_abrufe", {
  guid: text("guid")
    .primaryKey()
    .references(() => besucher.guid, { onDelete: "cascade" }),
  hierarchy: integer("hierarchy").notNull().default(0),
  werte: integer("werte").notNull().default(0),
  dokumente: integer("dokumente").notNull().default(0),
  zuerst: integer("zuerst").notNull().default(jetzt),
  zuletzt: integer("zuletzt").notNull().default(jetzt),
});

// --- Avatare zur Auswahl am Tablet ----------------------------------------------------

/**
 * Welche Bilder am Selbstbedienungs-Tablet zur Auswahl stehen, und in welcher Folge.
 *
 * **Zeilen statt Dateien im Repo.** Bis zum 09.10.2026 war die Galerie eine feste Liste von
 * 20 Ids, die der Start bei jedem Fehlen neu anlegte. Sobald ein Admin eines loeschen darf,
 * ist genau das falsch: der geloeschte Avatar kaeme beim naechsten Neustart zurueck. Die
 * Erstbefuellung ist deshalb einmalig, siehe `services/avatare.ts`.
 *
 * `datei_id` ist der Schluessel: eine Datei ist genau einmal in der Galerie. `cascade`,
 * damit das Loeschen der Datei die Zeile mitnimmt; die Besucher daran haengen ueber
 * `on delete set null` und fallen auf den Standard zurueck.
 */
export const avatare = sqliteTable("avatare", {
  dateiId: text("datei_id")
    .primaryKey()
    .references(() => dateien.id, { onDelete: "cascade" }),
  /** Eins-basiert und beim Umsortieren neu vergeben, damit keine Luecken entstehen. */
  sortierung: integer("sortierung").notNull(),
  angelegt: integer("angelegt").notNull().default(jetzt),
});

// --- Rundenzeiten von der Carrera-Bahn ------------------------------------------------

/**
 * Eine gefahrene Runde, gemeldet von der Software der Carrera-Bahn.
 *
 * **`lap_id` ist seine UUID, nicht unsere.** Er erzeugt sie, und er nennt sie beim
 * Zuruecknehmen einer Runde; eine eigene Id daneben waere eine zweite Wahrheit.
 *
 * **`besucher_guid` ist sein `participant_id`.** Laut seiner Mail ist das die gescannte
 * AAS-Item-ID, also genau unsere GUID. Die Zuordnung Runde -> Besucher ist damit gegeben,
 * ohne dass jemand etwas abgleichen muss. Anonyme Runden tragen dort `null` und werden
 * nicht gespeichert, siehe `services/runden.ts`.
 *
 * **Nur aktive Runden.** `deleted_utc_ms` und `deletion_reason` aus seinem Schema bekommen
 * hier keine Spalte: kommt eine Meldung mit gesetztem `deleted_utc_ms`, wird die Runde
 * geloescht statt markiert. Eine Tabelle, in der die Haelfte nicht gilt, muesste an jeder
 * Abfrage gefiltert werden, und genau das wird einmal vergessen.
 *
 * Die uebrigen Spalten sind sein Datensatz, auch die, die er als "nicht relevant"
 * markiert. Was ankommt, wird aufgehoben; was wir wegwerfen, ist weg.
 */
export const runden = sqliteTable(
  "runden",
  {
    lapId: text("lap_id").primaryKey(),
    besucherGuid: text("besucher_guid")
      .notNull()
      .references(() => besucher.guid, { onDelete: "cascade" }),
    /** 1 bis 20, der Platz im Konnektor-Modell. Kleinste freie Nummer, wie bei Dokumenten. */
    platz: integer("platz").notNull(),

    raceId: text("race_id"),
    eventId: text("event_id"),
    eventName: text("event_name"),
    identityNamespace: text("identity_namespace"),
    pseudonym: text("pseudonym"),
    installationLabel: text("installation_label"),

    isAnonymous: integer("is_anonymous"),
    laneNumber: integer("lane_number"),
    targetLapCount: integer("target_lap_count"),
    lapNumber: integer("lap_number"),

    startedUtcMs: integer("started_utc_ms"),
    localDate: text("local_date"),
    localUtcOffsetMinutes: integer("local_utc_offset_minutes"),
    /** Die Rundenzeit in Millisekunden. Das einzige Pflichtmass. */
    durationMs: integer("duration_ms").notNull(),

    angelegt: integer("angelegt").notNull().default(jetzt),
  },
  (t) => [
    unique("runden_platz").on(t.besucherGuid, t.platz),
    index("runden_besucher_idx").on(t.besucherGuid),
  ],
);
