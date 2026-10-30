import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  besucher,
  dateien,
  exponate,
  exponatDokumente,
  exponatLinks,
  globaleDaten,
  zuordnungen,
} from "../db/schema.js";
import type { Dateiablage } from "../ablage/dateien.js";
import { leseInhalt } from "../services/dateien.js";
import { zeichneRahmen } from "../services/rahmen.js";
import { istInlineBild } from "../services/mime.js";
import { avatarFuer } from "../services/standardavatar.js";
import {
  PERSONENFELDER,
  VISITOR_ALIAS,
  VISITOR_AVATAR,
  VISITOR_RANK,
  VISITOR_TITLE,
  dokumentBeschreibung,
  dokumentDatei,
  dokumentTitel,
  exponatBeschreibung,
  exponatName,
  kontaktFeld,
  linkTitel,
  linkUrl,
  MAX_TOP_MODELL,
  topPosition,
  globalId,
  visitorFeld,
  visitorRunde,
} from "./felder.js";
import { ansprechpartnerVonExponat } from "../services/ansprechpartner.js";
import {
  bestenliste,
  platzAlsText,
  podestrang,
  rundeAlsText,
  rundenVonBesucher,
} from "../services/runden.js";

/**
 * Was ein Besucher an Werten hat, in der Form der Konnektor-Spezifikation.
 *
 * Die ganze Fachlogik von `/values` und `/documents` steht hier. Die Routen daneben lesen
 * nur die Anfrage und reichen durch.
 */

export interface ProductProperty {
  propertyId: string;
  value: string;
  /** Nur bei sprachabhaengigen Texten. Dokumente tragen sie nicht. */
  valueLanguage?: string;
  mimeType?: string;
  filename?: string;
  size?: number;
  languages?: string[];
  needsResolve?: boolean;
}

/** Alle Inhalte sind deutsch, siehe Uebergabe. */
export const SPRACHE = "de";

/**
 * Ein Wert, bevor entschieden ist, wie er nach aussen geht.
 *
 * `dateiId` unterscheidet Text von Dokument: ein Dokument traegt eine, ein Text nicht.
 */
interface RohWert {
  propertyId: string;
  text: string | null;
  dateiId: string | null;
  /**
   * Podestplatz des Besuchers, nur am Avatar gesetzt.
   *
   * Steht hier und nicht in `nachAussen`, weil dort nur noch Dateien und keine Personen
   * mehr bekannt sind. `null` heisst: kein Rahmen, Bild unveraendert.
   */
  rang?: 1 | 2 | 3 | null;
}

/**
 * Schreibt einen Dateinamen auf das Muster der Spec um.
 *
 * Das Muster `^[A-Za-z0-9_-]+\.?[A-Za-z0-9_-]+$` schliesst gewoehnliche Kundendateinamen
 * aus: `Datenblatt (DE).pdf` passt nicht, `Pruefbericht.pdf` wegen des Umlauts auch nicht.
 * Ein durchgereichter Name laesst die Antwort am Vertragstest der Gegenseite scheitern,
 * und zwar erst beim Kunden.
 *
 * Aus `Datenblatt (DE).pdf` wird `Datenblatt-DE.pdf`. Uebernommen aus dem AXON Connector.
 */
export function dateinameFuerSpec(name: string): string {
  const punkt = name.lastIndexOf(".");
  const hatEndung = punkt > 0 && punkt < name.length - 1;
  const stamm = hatEndung ? name.slice(0, punkt) : name;
  const endung = hatEndung ? name.slice(punkt + 1) : "";

  const saeubern = (teil: string) =>
    teil
      .normalize("NFKD")
      // Umlaute zerfallen durch NFKD in Buchstabe plus Zeichen, das Zeichen faellt hier weg.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      // Fuehrende und folgende Trennstriche sind haesslich und vom Muster nicht verlangt.
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");

  const sauberStamm = saeubern(stamm) || "datei";
  const sauberEndung = saeubern(endung);
  return sauberEndung === "" ? sauberStamm : `${sauberStamm}.${sauberEndung}`;
}

/**
 * Der Wert eines Personenfeldes, so wie er hinausgeht.
 *
 * **Mit `titelImVornamen`** wird der Titel dem Vornamen vorangestellt: aus "Dr." und "Dirk"
 * wird `FirstName = "Dr. Dirk"`. So bei den Ansprechpartnern. Beim Besucher geht der Titel
 * seit dem 19.10.2026 getrennt als `Visitor_Title` hinaus, und der Vorname bleibt rein.
 *
 * Gibt `null`, wenn nichts hinausgeht: leere Felder werden ausgelassen, nicht als leerer
 * Text geliefert, und das Titelfeld selbst geht ueber diese Funktion nie einzeln hinaus.
 */
function personenwert(
  person: Record<string, unknown>,
  feld: string,
  id: string | null,
  titelImVornamen: boolean,
): string | null {
  if (id === null) return null;
  const wert = person[feld];
  if (typeof wert !== "string" || wert.trim() === "") return null;

  if (feld !== "vorname" || !titelImVornamen) return wert;
  const titel = person["titel"];
  // Ohne Titel bleibt der Vorname unveraendert, insbesondere **ohne** fuehrendes Leerzeichen.
  return typeof titel === "string" && titel.trim() !== "" ? `${titel.trim()} ${wert}` : wert;
}

/**
 * Sammelt alle Rohwerte eines Besuchers.
 *
 * **Vom Exponat kommt nur etwas, wenn der Besucher dort mindestens eine Zuordnung hat**,
 * und davon nur die zugeordneten Elemente. Alles andere wird ausgelassen, was die Spec
 * ausdruecklich erlaubt. Ein Betreuer soll niemandem etwas geben, das er ihm nicht gegeben
 * hat.
 */
export function sammleWerte(db: Db, guid: string): RohWert[] {
  const person = db.select().from(besucher).where(eq(besucher.guid, guid)).get();
  if (person === undefined) return [];

  const werte: RohWert[] = [];
  // Einmal je Abruf, frisch: speist den Siegerrahmen **und** die Top 10.
  const vorne = bestenliste(db, MAX_TOP_MODELL);

  if (person.titel !== null && person.titel.trim() !== "") {
    werte.push({ propertyId: VISITOR_TITLE, text: person.titel.trim(), dateiId: null });
  }
  for (const { feld, id } of PERSONENFELDER) {
    const wert = personenwert(person, feld, id, false);
    if (wert !== null && id !== null) {
      werte.push({ propertyId: visitorFeld(id), text: wert, dateiId: null });
    }
  }
  // Eigene Eigenschaft, siehe `VISITOR_ALIAS`. Leer faellt aus wie jedes andere Feld.
  if (person.alias !== null && person.alias.trim() !== "") {
    werte.push({ propertyId: VISITOR_ALIAS, text: person.alias, dateiId: null });
  }
  /*
   * **Rueckfall auf den Standard-Avatar.** Jeder neue Besucher traegt dessen Id seit dem
   * 08.10.2026 ausdruecklich, und am Tablet kann er sich seit dem 08.10. ein anderes Bild
   * aussuchen. Der Rueckfall bleibt fuer die Zeilen, bei denen `avatarDateiId` doch `null`
   * ist, etwa nachdem ein Avatar aus der Galerie geloescht wurde.
   */
  const avatar = avatarFuer(db, person.avatarDateiId);
  if (avatar !== null) {
    /*
     * **Der Rang wird hier gelesen, bei jedem Abruf.** Steht der Besucher gerade auf einem
     * der drei Podestplaetze, bekommt sein Bild weiter unten den Rahmen in Gold, Silber
     * oder Bronze.
     */
    werte.push({
      propertyId: VISITOR_AVATAR,
      text: null,
      dateiId: avatar,
      rang: podestrang(vorne, guid),
    });
  }

  /*
   * **Die gefahrenen Runden, je Platz eine Zeile.** Nicht gefahrene Plaetze fallen aus der
   * Antwort, wie jedes leere Feld; der Viewer zeigt dann nur, was wirklich gefahren wurde.
   * Vor den Exponaten, weil der frühe `return` unten sonst die Runden verschluckte, sobald
   * ein Besucher noch keine Zuordnung hat.
   */
  for (const runde of rundenVonBesucher(db, guid)) {
    werte.push({
      propertyId: visitorRunde(runde.platz),
      text: rundeAlsText(runde),
      dateiId: null,
    });
  }
  // Der eigene Platz, ebenfalls vor dem fruehen `return`. Nicht gefahren: nichts.
  const platz = platzAlsText(db, guid);
  if (platz !== null) werte.push({ propertyId: VISITOR_RANK, text: platz, dateiId: null });

  /*
   * **Die Top 10, fuer jeden Besucher dieselbe.** Ebenfalls vor dem fruehen `return`: auch
   * wer weder faehrt noch etwas zugeordnet bekam, sieht die Liste. Nicht besetzte Plaetze
   * fallen aus. Der Fahrer ist **nur** sein Alias, ohne Alias "Anonym"; der Klarname eines
   * anderen Besuchers gehoert nicht in einen oeffentlichen Viewer.
   */
  for (const p of vorne) {
    const alias = p.alias?.trim() ?? "";
    werte.push({
      propertyId: topPosition(p.rang),
      text: `${alias === "" ? "Anonym" : alias} - ${p.anzeige}`,
      dateiId: null,
    });
  }

  /*
   * **Die globalen Daten**, fuer jeden Besucher dieselben, seit dem 20.10.2026. Ebenfalls vor
   * dem fruehen `return`. Eine Datei geht als Rohwert mit `dateiId` hinaus; Bild oder Ticket
   * entscheidet `nachAussen`, wie bei den Exponat-Dokumenten. Leere fallen aus.
   */
  for (const g of db.select().from(globaleDaten).orderBy(asc(globaleDaten.nummer)).all()) {
    if (g.art === "text" && g.text !== null && g.text.trim() !== "") {
      werte.push({ propertyId: globalId(g.nummer), text: g.text, dateiId: null });
    } else if (g.art === "datei" && g.dateiId !== null) {
      werte.push({ propertyId: globalId(g.nummer), text: null, dateiId: g.dateiId });
    }
  }

  const meine = db.select().from(zuordnungen).where(eq(zuordnungen.besucherGuid, guid)).all();
  if (meine.length === 0) return werte;

  // Je Exponat einmal, auch wenn dort mehrere Elemente zugeordnet sind.
  const exponatIds = [...new Set(meine.map((z) => z.exponatId))];

  for (const exponatId of exponatIds) {
    const e = db.select().from(exponate).where(eq(exponate.id, exponatId)).get();
    if (e === undefined) continue;
    const k = e.kennung;

    werte.push({ propertyId: exponatName(k), text: e.name, dateiId: null });
    if (e.beschreibung !== null && e.beschreibung.trim() !== "") {
      werte.push({ propertyId: exponatBeschreibung(k), text: e.beschreibung, dateiId: null });
    }

    const zielIds = (art: "dokument" | "link" | "kontakt") =>
      new Set(meine.filter((z) => z.exponatId === exponatId && z.art === art).map((z) => z.zielId));

    const dokIds = zielIds("dokument");
    if (dokIds.size > 0) {
      const dokumente = db
        .select()
        .from(exponatDokumente)
        .where(eq(exponatDokumente.exponatId, exponatId))
        .orderBy(asc(exponatDokumente.platz))
        .all();
      for (const d of dokumente) {
        if (!dokIds.has(d.id)) continue;
        werte.push({ propertyId: dokumentDatei(k, d.platz), text: null, dateiId: d.dateiId });
        werte.push({ propertyId: dokumentTitel(k, d.platz), text: d.titel, dateiId: null });
        if (d.beschreibung !== null && d.beschreibung.trim() !== "") {
          werte.push({
            propertyId: dokumentBeschreibung(k, d.platz),
            text: d.beschreibung,
            dateiId: null,
          });
        }
      }
    }

    const linkIds = zielIds("link");
    if (linkIds.size > 0) {
      const links = db
        .select()
        .from(exponatLinks)
        .where(eq(exponatLinks.exponatId, exponatId))
        .orderBy(asc(exponatLinks.platz))
        .all();
      for (const l of links) {
        if (!linkIds.has(l.id)) continue;
        werte.push({ propertyId: linkUrl(k, l.platz), text: l.url, dateiId: null });
        werte.push({ propertyId: linkTitel(k, l.platz), text: l.titel, dateiId: null });
      }
    }

    /*
     * **Alle Ansprechpartner des Exponats, nicht nur zugeordnete.** Entscheidung vom
     * 19.10.2026: Ansprechpartner gehoeren zum Exponat und kommen mit, sobald der Besucher
     * dort irgendetwas bekommen hat. Steht derselbe Mensch an zwei Exponaten, geht er
     * deshalb zweimal hinaus, je unter dem Platz, den er an diesem Exponat hat: an E01 als
     * `Contact01`, an E04 als `Contact03`.
     *
     * Kein Foto: `{K}_Contact{NN}_Image` gibt es nicht.
     */
    for (const c of ansprechpartnerVonExponat(db, exponatId)) {
      for (const { feld, id } of PERSONENFELDER) {
        const wert = personenwert(c, feld, id, true);
        if (wert !== null && id !== null) {
          werte.push({ propertyId: kontaktFeld(k, c.platz, id), text: wert, dateiId: null });
        }
      }
    }
  }

  return werte;
}

export interface AnfrageWerte {
  /** Texte, die mit Sprachkennzeichen zurueckkommen. */
  mitSprache: string[];
  /** Texte ohne Sprachkennzeichen. */
  ohneSprache: string[];
  sprachen: string[];
  /** Leerer Rumpf: alles liefern. */
  allesLiefern: boolean;
}

/**
 * Liest `PropertyValuesRequest`.
 *
 * `null` und `[]` sind an jeder Stelle gueltige Eingaben. Ein Konnektor, der darauf mit
 * 500 antwortet, ist nicht konform; deshalb wird hier nichts vorausgesetzt, sondern
 * geprueft.
 */
export function leseAnfrage(koerper: unknown): AnfrageWerte {
  const o = (typeof koerper === "object" && koerper !== null ? koerper : {}) as Record<
    string,
    unknown
  >;
  const texte = (wert: unknown): string[] =>
    Array.isArray(wert) ? wert.filter((x): x is string => typeof x === "string") : [];

  const mit = (o["propertiesWithLanguage"] ?? null) as Record<string, unknown> | null;
  const ohne = (o["propertiesWithoutLanguage"] ?? null) as Record<string, unknown> | null;

  const mitSprache = mit === null ? [] : texte(mit["propertyIds"]);
  const ohneSprache = ohne === null ? [] : texte(ohne["propertyIds"]);
  const sprachen = mit === null ? [] : texte(mit["languages"]);

  return {
    mitSprache,
    ohneSprache,
    sprachen,
    // Nichts gefragt heisst alles. Die Spec erlaubt, mehr zu liefern als gefragt.
    allesLiefern: mitSprache.length === 0 && ohneSprache.length === 0,
  };
}

/**
 * Formt Rohwerte in die Antwort der Spec.
 *
 * @param alsDokumente `/documents` loest Tickets ein: dort steht `needsResolve: false` und
 * der eingebettete Inhalt. In `/values` steht bei denselben Dokumenten `needsResolve: true`
 * und der Ticketwert.
 */
export async function nachAussen(
  db: Db,
  ablage: Dateiablage,
  roh: RohWert[],
  optionen: { alsDokumente: boolean; ohneSprache: Set<string> },
): Promise<ProductProperty[]> {
  const ergebnis: ProductProperty[] = [];

  for (const wert of roh) {
    if (wert.dateiId === null) {
      /*
       * Ein Text. Mit Sprachkennzeichen, ausser er wurde ausdruecklich ohne angefragt.
       *
       * **Rueckfall statt Auslassen:** alle Inhalte sind deutsch, und wird `de` nicht in
       * der Vorzugsliste genannt, kommt der Text trotzdem mit `valueLanguage: "de"`. Ein
       * Viewer, der auf Englisch steht, zeigt dann deutschen Text statt gar nichts.
       */
      ergebnis.push({
        propertyId: wert.propertyId,
        value: wert.text ?? "",
        ...(optionen.ohneSprache.has(wert.propertyId) ? {} : { valueLanguage: SPRACHE }),
      });
      continue;
    }

    const datei = db.select().from(dateien).where(eq(dateien.id, wert.dateiId)).get();
    if (datei === undefined) continue;

    const filename = dateinameFuerSpec(datei.originalName);
    const bild = istInlineBild(datei.mimeType);

    /*
     * **Die Regel hat zwei Richtungen, und beide stehen hier.**
     *
     * Der Guide fuehrt in seiner Tabelle "Document Value Retrieval" `By Value` als
     * "supported only for image documents" und `By Ticket` als fuer Bilder **nicht**
     * erlaubt. Daraus folgt fuer ein gespeichertes Dokument genau eine Zuordnung:
     *
     *   Bild        -> By Value, niemals Ticket
     *   Nicht-Bild  -> By Ticket, niemals By Value
     *
     * Im AXON Connector war bis zum 08.09.2026 nur die erste Haelfte geprueft. Weil sie
     * geprueft war, sah die Regel geprueft aus, und der Import setzte jedes Datenblatt auf
     * den Wertweg: 214 272 Bytes Base64 mitten in einer Antwort, die 933 haben sollte.
     *
     * Dokumente stehen **immer** in `propertiesWithLanguage` und kommen hier ohne
     * `valueLanguage`: das AAS-Metamodell kennt die Unterscheidung nicht, also entscheidet
     * der Konnektor, und ein Dateiname hat keine Sprache.
     */
    if (bild) {
      const inhalt = await leseInhalt(ablage, datei.pfad);
      if (inhalt === null) continue;

      /*
       * **Der Siegerrahmen, aufgelegt im Moment des Abrufs.** Nur fuer die ersten drei der
       * Carrera-Bestenliste und nur auf dem Avatar, seit dem 20.10.2026 aus den Overlays in
       * `assets/rahmen`. Gerahmt ist es ein PNG (aussen durchsichtig), also tragen Typ und
       * Dateiendung das mit. Ist die Datei kein lesbares JPEG oder fehlt das Overlay, gibt
       * `zeichneRahmen` `null` und das Bild geht unveraendert hinaus.
       */
      let hinaus = inhalt;
      let mimeType = datei.mimeType;
      let name = filename;
      const rang = wert.rang ?? null;
      if (rang !== null) {
        const gerahmt = zeichneRahmen(inhalt, rang);
        if (gerahmt !== null) {
          hinaus = gerahmt.inhalt;
          mimeType = gerahmt.mimeType;
          name = `${filename.replace(/\.[^.]*$/, "")}.png`;
        }
      }

      ergebnis.push({
        propertyId: wert.propertyId,
        value: hinaus.toString("base64"),
        mimeType,
        filename: name,
        /*
         * **Die Groesse des Gesendeten, nicht die der Ablage.** Mit Rahmen sind es andere
         * Bytes; eine Gegenseite, die nach `size` puffert, bekaeme sonst eine Zahl, die
         * nicht stimmt.
         */
        size: hinaus.length,
        needsResolve: false,
      });
      continue;
    }

    if (!optionen.alsDokumente) {
      /*
       * Der Ticketweg in `/values`. **Der Ticketwert ist die `propertyId` selbst.**
       *
       * Die Spec sagt nicht, was `propertyId` in der Antwort von `/documents` bedeutet.
       * Faellt der Ticketwert mit ihr zusammen, loest sich die Frage auf, statt
       * beantwortet zu werden, und beide Lesarten stimmen. Der Guide nennt genau das als
       * einfachste Form. Verworfen: der Dateiname als Ticket, denn `datenblatt.pdf` und
       * `datenblatt.docx` landeten unter demselben Schluessel.
       *
       * `filename` und `mimeType` tragen hier **dieselben** Werte wie spaeter in
       * `/documents`; darauf prueft die Gegenseite.
       */
      ergebnis.push({
        propertyId: wert.propertyId,
        value: wert.propertyId,
        mimeType: datei.mimeType,
        filename,
        size: datei.groesse,
        needsResolve: true,
      });
      continue;
    }

    const inhalt = await leseInhalt(ablage, datei.pfad);
    if (inhalt === null) continue;
    ergebnis.push({
      propertyId: wert.propertyId,
      value: inhalt.toString("base64"),
      mimeType: datei.mimeType,
      filename,
      size: datei.groesse,
      needsResolve: false,
    });
  }

  return ergebnis;
}
