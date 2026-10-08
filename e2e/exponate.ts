import type { APIRequestContext } from "@playwright/test";

/**
 * Exponate für die Abnahme anlegen und danach wieder wegräumen.
 *
 * **Warum das sein muss:** die Kennungen sind der Vorrat `E01` bis `E99`, und jeder Lauf hat
 * bisher welche verbraucht, ohne sie zurückzugeben. Am 08.10.2026 waren nach zwei Tagen alle
 * 99 vergeben. `POST /api/exponate` antwortete korrekt mit `kontingent-erschoepft`, zehn
 * Abnahmen scheiterten daran, und das sah nach einem Fehler der Oberfläche aus: die
 * Detailseite wurde nie erreicht, weil es gar kein Exponat gab.
 *
 * Die Kennung wird **nicht** mitgeschickt. Seit dem 08.10.2026 vergibt sie der Server als
 * kleinste freie Nummer; ein Feld im Aufruf wäre wirkungslos und läse sich, als hätte der
 * Test die Wahl.
 */

export interface Exponat {
  readonly id: string;
  readonly kennung: string;
  readonly name: string;
}

/**
 * Was dieser Worker angelegt hat, in der Reihenfolge der Anlage.
 *
 * Playwright lädt das Modul einmal je Worker, und die Abnahme läuft mit `workers: 1`. Jede
 * Testdatei räumt in ihrem eigenen `afterEach` auf, deshalb steht hier nie mehr als der
 * Bestand eines einzelnen Tests.
 */
const angelegt: string[] = [];

/**
 * Hochgeladene Dateien dieses Falls.
 *
 * Ein geloeschtes Exponat nimmt seine Dokumentzeilen mit, die **Datei** aber nicht: die
 * haengt an keinem Besitzer mehr und bleibt liegen. Nach einem Abnahmelauf waren das zwoelf
 * Stueck, und ueber Tage summiert es sich zu demselben Haufen, der am 08.10.2026 einmal von
 * Hand weggeraeumt werden musste.
 */
const dateien: string[] = [];

/**
 * Meldet ein Exponat zum Aufräumen an, das **über die Oberfläche** entstanden ist.
 *
 * Ein Fall, der auf „Anlegen" klickt, kommt nicht durch `legeExponatAn` und bliebe sonst
 * liegen: nach dem ersten Lauf mit Aufräumen standen genau zwei solche Reste im Bestand,
 * einer je Geräteprojekt.
 */
export function merkeExponat(id: string): void {
  angelegt.push(id);
}

/** Merkt eine hochgeladene Datei zum Aufräumen vor. */
export function merkeDatei(id: string): void {
  dateien.push(id);
}

/** Legt ein Exponat an und merkt es zum Aufräumen vor. */
export async function legeExponatAn(request: APIRequestContext, name: string): Promise<Exponat> {
  const antwort = await request.post("/api/exponate", { data: { name } });
  if (!antwort.ok()) {
    throw new Error(
      `Exponat "${name}" liess sich nicht anlegen: ${String(antwort.status())} ` +
        `${await antwort.text()}. Bei "kontingent-erschoepft" sind alle 99 Kennungen belegt, ` +
        "dann liegen Rückstände früherer Läufe im Bestand.",
    );
  }
  const exponat = (await antwort.json()) as Exponat;
  angelegt.push(exponat.id);
  return exponat;
}

/**
 * Löscht alles, was `legeExponatAn` angelegt hat. Gehört in ein `test.afterEach`.
 *
 * Fehler werden hier **nicht** geworfen: ein Test, der bereits durchgelaufen ist, soll nicht
 * nachträglich am Aufräumen scheitern. Gelingt das Löschen nicht, fällt es beim nächsten Lauf
 * an der Kontingentmeldung oben auf.
 */
export async function raeumeExponateAuf(request: APIRequestContext): Promise<void> {
  /*
   * **Erst die Exponate, dann die Dateien.** Solange ein Dokument auf eine Datei zeigt,
   * weist der Fremdschluessel ihr Loeschen zurueck; die Reihenfolge ist also keine
   * Geschmacksfrage.
   */
  while (angelegt.length > 0) {
    const id = angelegt.pop();
    if (id === undefined) break;
    try {
      await request.delete(`/api/exponate/${id}`);
    } catch {
      // absichtlich still, siehe oben
    }
  }

  while (dateien.length > 0) {
    const id = dateien.pop();
    if (id === undefined) break;
    try {
      await request.delete(`/api/dateien/${id}`);
    } catch {
      // absichtlich still, siehe oben
    }
  }
}

/** Angelegte Ansprechpartner dieses Falls. */
const personen: string[] = [];

/** Merkt einen angelegten Ansprechpartner zum Aufräumen vor. */
export function merkeAnsprechpartner(id: string): void {
  personen.push(id);
}

/**
 * Gibt die angelegten Ansprechpartner zurück. Gehört neben `raeumeExponateAuf`.
 *
 * **App-Nutzer stehen hier bewusst nicht:** die lassen sich nach Entwurf nicht löschen, nur
 * deaktivieren, damit ein Zurücksetzen niemanden aussperrt. Prüfnutzer sammeln sich deshalb
 * an und müssen von Hand aus dem Bestand genommen werden.
 */
export async function raeumeAnsprechpartnerAuf(request: APIRequestContext): Promise<void> {
  while (personen.length > 0) {
    const id = personen.pop();
    if (id === undefined) break;
    try {
      await request.delete(`/api/ansprechpartner/${id}`);
    } catch {
      // absichtlich still
    }
  }
}

/**
 * Auf welcher Seite steht der Eintrag mit dieser Id?
 *
 * Die Listen blättern seit dem 08.10.2026 zu zehnt, und ein neuer Eintrag landet
 * alphabetisch irgendwo. Ein Test, der ihn auf Seite eins sucht, findet ihn nicht mehr und
 * sieht aus wie ein Fehler der Oberfläche. Gerechnet statt geklickt: das ist eindeutig und
 * kostet keine Schleife über die Seiten.
 */
export async function seiteMitEintrag(
  request: APIRequestContext,
  pfad: string,
  id: string,
  jeSeite = 10,
): Promise<number> {
  const alle = (await (await request.get(pfad)).json()) as { id: string }[];
  const stelle = alle.findIndex((e) => e.id === id);
  if (stelle < 0) throw new Error(`Eintrag ${id} steht nicht in ${pfad}`);
  return Math.floor(stelle / jeSeite) + 1;
}

/** Angelegte Besucher dieses Falls, über ihre GUID. */
const besucher: string[] = [];

/** Merkt einen angelegten Besucher zum Aufräumen vor. */
export function merkeBesucher(guid: string): void {
  besucher.push(guid);
}

/**
 * Gibt die angelegten Besucher zurück.
 *
 * Dritte Quelle derselben Art Rückstand: nach zwei Tagen standen 87 Prüfbesucher neben den
 * 700 der Aussaat. Sie stören nicht sichtbar, verfälschen aber jede Zahl im Dashboard und
 * liefern die Beispiel-GUID auf der Seite API.
 */
export async function raeumeBesucherAuf(request: APIRequestContext): Promise<void> {
  while (besucher.length > 0) {
    const guid = besucher.pop();
    if (guid === undefined) break;
    try {
      await request.delete(`/api/besucher/${encodeURIComponent(guid)}`);
    } catch {
      // absichtlich still
    }
  }
}
