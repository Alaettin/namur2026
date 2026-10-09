import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import {
  besucher,
  dateien,
  exponate,
  exponatDokumente,
  exponatLinks,
  zuordnungen,
} from "../db/schema.js";
import type { Dateiablage } from "../ablage/dateien.js";
import { istInlineBild } from "../services/mime.js";
import { avatarFuer } from "../services/standardavatar.js";
import {
  PERSONENFELDER,
  VISITOR_AVATAR,
  dokumentBeschreibung,
  dokumentDatei,
  dokumentTitel,
  exponatBeschreibung,
  exponatName,
  kontaktFeld,
  linkTitel,
  linkUrl,
  visitorFeld,
  visitorRunde,
} from "./felder.js";
import { ansprechpartnerVonExponat } from "../services/ansprechpartner.js";
import { rundeAlsText, rundenVonBesucher } from "../services/runden.js";

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
 * **Der Titel bekommt keine eigene propertyId**, sondern wird dem Vornamen vorangestellt:
 * aus "Dr." und "Anna" wird `FirstName = "Dr. Anna"`. Eine eigene Eigenschaft haette der
 * Content-Admin in Axon nachmappen muessen, sonst waere der Titel im Viewer unsichtbar
 * geblieben; so aendert sich das Modell ueberhaupt nicht.
 *
 * Gibt `null`, wenn nichts hinausgeht: leere Felder werden ausgelassen, nicht als leerer
 * Text geliefert, und das Titelfeld selbst geht nie einzeln hinaus.
 */
function personenwert(
  person: Record<string, unknown>,
  feld: string,
  id: string | null,
): string | null {
  if (id === null) return null;
  const wert = person[feld];
  if (typeof wert !== "string" || wert.trim() === "") return null;

  if (feld !== "vorname") return wert;
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

  for (const { feld, id } of PERSONENFELDER) {
    const wert = personenwert(person, feld, id);
    if (wert !== null && id !== null) {
      werte.push({ propertyId: visitorFeld(id), text: wert, dateiId: null });
    }
  }
  /*
   * **Rueckfall auf den Standard-Avatar.** Jeder neue Besucher traegt dessen Id seit dem
   * 08.10.2026 ausdruecklich, und am Tablet kann er sich seit dem 08.10. ein anderes Bild
   * aussuchen. Der Rueckfall bleibt fuer die Zeilen, bei denen `avatarDateiId` doch `null`
   * ist, etwa nachdem ein Avatar aus der Galerie geloescht wurde.
   */
  const avatar = avatarFuer(db, person.avatarDateiId);
  if (avatar !== null) {
    werte.push({ propertyId: VISITOR_AVATAR, text: null, dateiId: avatar });
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

    const kontaktIds = zielIds("kontakt");
    if (kontaktIds.size > 0) {
      /*
       * Ansprechpartner sind eigenstaendige Stammdaten; der **Platz** kommt aus der
       * Zuweisung zu diesem Exponat. Derselbe Mensch kann an E01 auf Platz 1 und an E04
       * auf Platz 3 stehen, und beide Male muss der richtige Datenpunkt entstehen.
       *
       * Kein Foto mehr: `{K}_Contact{NN}_Image` gibt es nicht.
       */
      for (const c of ansprechpartnerVonExponat(db, exponatId)) {
        if (!kontaktIds.has(c.id)) continue;
        for (const { feld, id } of PERSONENFELDER) {
          const wert = personenwert(c, feld, id);
          if (wert !== null && id !== null) {
            werte.push({ propertyId: kontaktFeld(k, c.platz, id), text: wert, dateiId: null });
          }
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
      ergebnis.push({
        propertyId: wert.propertyId,
        value: inhalt.toString("base64"),
        mimeType: datei.mimeType,
        filename,
        size: datei.groesse,
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

/**
 * Liest eine abgelegte Datei vollstaendig.
 *
 * Fehlt sie auf der Platte, wird der Wert ausgelassen statt die ganze Antwort mit 500
 * abzubrechen: ein fehlendes Foto darf nicht dazu fuehren, dass ein Besucher im Viewer
 * ueberhaupt nichts sieht.
 */
async function leseInhalt(ablage: Dateiablage, pfad: string): Promise<Buffer | null> {
  try {
    const stuecke: Buffer[] = [];
    for await (const stueck of ablage.lies(pfad)) stuecke.push(stueck as Buffer);
    return Buffer.concat(stuecke);
  } catch {
    return null;
  }
}
