# Übergabe: namur-hv-2026

Web-App für die NAMUR-Hauptversammlung 2026 (Ende November). Sie verwaltet Konferenzbesucher und Exponate und verbindet beides: Ein Betreuer scannt am Exponat den Pass eines Besuchers und ordnet ihm Inhalte zu. Der öffentliche Viewer (`viewer-namur2026.aas.neoception.dev/<GUID>`) zeigt diese Inhalte danach an. Den Viewer baut diese App nicht.

Dieses Paket ist der UI-Entwurf. Die Dateien unter `screens/` sind Entwurfsdateien aus dem Design-Canvas, keine fertigen Komponenten. Nimm Aufbau, Texte, Abstände und Farbwerte daraus, schreib den Code neu.

## So liest du die Entwürfe

- Jede `screens/*.dc.html` ist ein Bildschirm. Das Markup zwischen `<x-dc>` und `</x-dc>` ist normales HTML mit Inline-Styles; alle Werte sind dort exakt.
- `{{name}}` sind Platzhalter, gefüllt aus `renderVals()` im `<script type="text/x-dc">` unten in derselben Datei. Dort stehen auch die Beispieldaten.
- `<sc-for list="{{x}}" as="y">` ist eine Schleife, `<sc-if value="{{b}}">` eine Bedingung.
- `<dc-import name="AppHeader" ...>` bindet `AppHeader.dc.html` als Komponente ein, die Attribute sind Props.
- `M*.dc.html` und `ScanMatchTablet.dc.html` sind nur Rahmen, die eine Seite in Handy- bzw. Tablet-Breite zeigen. Sie belegen: gleiche Inhalte auf allen Geräten, nur das Layout bricht um.
- `canvas.json` listet alle Bildschirme mit Titel.

## Technik

- shadcn/ui als Bauteilgrundlage, an die Werte unten angepasst (eckige Flächen, Pill-Knöpfe).
- Eine responsive Web-App, kein separater Mobile-Build. Desktop, Tablet und Handy zeigen dieselben Inhalte.
- Oberflächensprache Deutsch, keine Mehrsprachigkeit. Keine Gedankenstriche in Beschriftungen.

## Rollen

| Rolle | Sieht |
|-------|-------|
| Admin | Dashboard, Besucher, Exponate, Nutzer, API |
| Betreuer | nur Exponate (die eigenen) und von dort den Scan-Ablauf |

Besucher sind keine Nutzer, sie melden sich nie an. Es gibt keine Selbstregistrierung.

Der Scanner ist nur über ein Exponat erreichbar, nie über die Hauptnavigation. Ein Betreuer mit genau einem Exponat landet nach der Anmeldung direkt in dessen Scan-Ablauf.

## Navigation

Kopfzeile (`AppHeader.dc.html`) auf allen Geräten gleich:

- Zeile 1, weiß: AXON-Logo, Trennstrich, „Event Manager“, „NAMUR HV 2026“ (grün, gesperrt), rechts Nutzername und Pill „Abmelden“.
- Zeile 2: Reiter, aktiver Reiter mit 2 px grüner Unterkante. Auf schmalen Bildschirmen horizontal scrollbar.

## Bildschirme und Routen (Vorschlag)

| Datei | Route | Inhalt |
|-------|-------|--------|
| `Login.dc.html` | `/login` | E-Mail, Passwort. Fehlerzustand nur „E-Mail oder Passwort ist nicht korrekt“, keine Sperre mit Countdown |
| `Main.dc.html` | `/` | Dashboard: 4 Kennzahlen, Balken je Exponat, Datenqualität, letzte Zuordnungen |
| `Visitors.dc.html` | `/besucher` | Suche, Tabelle, Seitenumschaltung. Keine Filter |
| `VisitorsEmpty.dc.html` | `/besucher` leer | Wege: CSV importieren, Besucher anlegen |
| `VisitorDetail.dc.html` | `/besucher/:guid` (auch Anlegen) | Stammdaten, Avatar, GUID eintragen oder erzeugen, „Im Viewer öffnen“, Zuordnungen je Exponat, einzeln entfernbar |
| `CsvImport.dc.html` | `/besucher/import` | Schritt 2: Beanstandungen, Spaltenzuordnung, Vorschau, Ergänzen oder Ersetzen |
| `CsvResult.dc.html` | Schritt 3 | Ergebnis mit Zahlen |
| `Exhibits.dc.html` | `/exponate` | Tabelle aller Exponate |
| `ExhibitDetail.dc.html` | `/exponate/:id` | Dokumente, Links, mehrere Ansprechpartner, Betreuer, Knopf „Scannen“ |
| `ExhibitEmpty.dc.html` | `/exponate/:id` neu | Leerer Zustand, Scannen gesperrt bis zum ersten Inhalt |
| `Users.dc.html` | `/nutzer` | App-Nutzer, Rolle, Exponate, Passwort zurücksetzen, deaktivieren, Anlegen |
| `Api.dc.html` | `/api` | Basis-URL, Connector-Aufrufe, Beispielaufruf, letzte Aufrufe |
| `ScanPick.dc.html` | `/exponate` (Betreuer) | Eigene Exponate |
| `ScanReady.dc.html` | `/exponate/:id/scan` | Exponatname, letzte Zuordnungen, Knopf „Pass scannen“ unten |
| `ScanCamera.dc.html` | Kamera | Zielrahmen, Taschenlampe, Abbrechen, „GUID von Hand eingeben“ |
| `ScanMatch.dc.html` | Treffer | Besucherkarte, Inhalte mit Häkchen, Schalter „Alles zuordnen“, „Zuordnen (n)“ unten. Interaktiv ausgearbeitet |
| `ScanSuccess.dc.html` | Erfolg | Rückmeldung, nach 2 s automatisch zurück zur Kamera |
| `ErrNotPass.dc.html` | Fehler | QR-Code ist kein Pass dieser Konferenz |
| `ErrUnknown.dc.html` | Fehler | GUID unbekannt |
| `ErrCamera.dc.html` | Fehler | Kamera verweigert oder fehlt, Eingabe der GUID von Hand |
| `ErrOffline.dc.html` | Fehler | Keine Verbindung beim Zuordnen, Auswahl bleibt erhalten, solange die Seite offen ist |
| `ErrNoContent.dc.html` | Fehler | Exponat hat noch keine Inhalte |

Kein Offline-Modus, kein Pass-Druck, kein Viewer.

## Datenmodell

**Besucher:** GUID, Vorname, Nachname, Firma, Position, E-Mail, Straße, PLZ, Ort, Land, Website, Avatar (Bild). GUID frei eingetragen oder auf Knopfdruck erzeugt, überall in Monospace mit Kopierknopf.

**Exponat:** Kennung (z. B. E03), Name, Beschreibung, Dokumente (Datei, Titel, Beschreibung, Typ, Größe), Links (URL, Titel), **beliebig viele Ansprechpartner** (Felder wie Besucher ohne GUID, mit Bild), Betreuer (App-Nutzer).

**Zuordnung:** Besucher, Exponat, Betreuer, Zeitpunkt, welche Inhalte.
- Eine Zuordnung zeigt auf das Dokument selbst. Wird es ersetzt, sieht der Besucher die neue Fassung.
- Ein später hochgeladenes Dokument kommt nicht automatisch zu bestehenden Zuordnungen.
- Inhalte, die ein Besucher an diesem Exponat schon hat, sind im Treffer als „bereits zugeordnet“ markiert und zählen nicht in „Zuordnen (n)“.

**App-Nutzer:** Name, E-Mail, Startpasswort, Rolle (Admin, Betreuer), Exponate, aktiv/deaktiviert.

## CSV-Import

- Nur CSV, Trennzeichen Semikolon oder Komma. **Keine Bilder, kein ZIP.** Avatare werden je Besucher in der Detailansicht hochgeladen.
- Alle Beanstandungen vor der Übernahme zeigen: doppelte GUID, ungültige E-Mail, fehlender Pflichtwert. Beanstandete Zeilen werden übersprungen.
- Wahl Ergänzen (neue GUIDs anlegen, bekannte aktualisieren) oder Ersetzen (nicht enthaltene Besucher samt Zuordnungen entfernen).
- Ergebnis: neu angelegt, aktualisiert, übersprungen; übersprungene Zeilen als CSV herunterladbar.

## Connector API

Axon Core holt die Besucherdaten für den Viewer über die Connector API v3 dieser App. Die GUID des Besuchers ist die `itemId`. Referenz: Swagger v3 (RC), abgelegt in der Neoception-Wissensbank unter „90 Journal and Sources / 2026-09-09 Connector API swagger v3 RC“.

| Methode | Pfad | Liefert (Entwurf) |
|---------|------|-------------------|
| GET | `/api/connector/model` | Datenmodell |
| GET | `/api/connector/hierarchy` | Hierarchie der Items |
| GET | `/api/connector/hierarchy/levels` | Ebenen der Hierarchie |
| GET | `/api/connector/ids` | GUIDs aller Besucher |
| GET | `/api/connector/identification?itemId=` | Identifikation eines Besuchers |
| POST | `/api/connector/properties?itemId=` | Eigenschaftswerte, Body `PropertyValuesRequest` |
| POST | `/api/connector/documents?itemId=` | Zugeordnete Inhalte, Body `PropertiesWithLanguage` |

Authentifizierung laut Swagger: OAuth2, Authorization Code über Keycloak.

## Design-Werte

Erscheinung der AXON-Familie, hell, angelehnt an den PCN Event Manager.

| Rolle | Wert |
|-------|------|
| Seitengrund | `#EFEFEF` |
| Flächen, Kopfzeile | `#FFFFFF`, Schatten `0 2px 6px rgba(27,29,38,.07)` |
| Text | `#1B1D26`, sekundär `#43454F`, Hinweise `#5E606C` |
| Linien | `#E3E4E7`, Eingabefelder `#CBCCD2` |
| Primär (Knöpfe, Akzentlinien) | PF Green `#00A587` |
| Grüne Textlinks | `#00846D` |
| Fehler, Warnung | `#C24E1E`, Hintergrund `#FDE4D8` |
| Kamera-Ansicht | dunkel `#101219` bis `#43454F` |
| Erfolg-Vollbild | `#006353` |

- Schrift: Raleway (400 bis 800) für alles, IBM Plex Mono für GUIDs, Kennungen, Pfade, Uhrzeiten.
- Überschrift Seite 36 px/700, Tracking −0,02 em. Tabellenköpfe 11 px/600, Versalien, 0,08 em.
- Inhaltsspalte max. 992 px, zentriert, 16 px Rand.
- Flächen, Tabellen, Eingabefelder: 0 px Radius. Knöpfe, Segment-Umschalter, Seitenumschaltung: Pill-Form.
- Status-Markierungen: eckig, 22 px hoch, 11 px/700 Versalien, weiß auf Farbe, mit „●“ (z. B. ● NEU, ● FEHLER, ● BETREUER).
- Scan-Ablauf: Bedienelemente mindestens 48 px, Hauptknopf 64 bis 68 px, Haupthandlung unten im Daumenbereich.
- Fokus sichtbar, Core Blue `#1C5DB3`.
- Icons: Strich-Icons im Stil von lucide (shadcn-Standard). Das Neoception Design System hat kein UI-Icon-Set, Freigabe durch die Markenverantwortlichen steht aus.

Assets: `assets/keyvisual.png` (Anmeldung, statisch), `assets/axon-logo.svg` (Kopfzeile, Anmeldung).

## Offene Punkte

- Antwortschemas der Connector-Aufrufe: in der Swagger nur „200 OK“. Was jeder Aufruf genau liefert, ist festzulegen.
- Welche der sieben Aufrufe tatsächlich gebraucht werden. Im PCN-Weekly vom 28.08. hieß es für den Event Manager: nur model und value.
- Basis-URL (`https://[HOST]/api/connector`) und Connector-ID stehen noch nicht fest.
- Kontrast: Weiß auf `#00A587` liegt bei Knopfschrift unter WCAG AA. Falls gefordert, `#00846D` als Knopffläche.
- App-Name „Event Manager“ aus der Vorlage übernommen, bitte bestätigen.
- Beispieldaten (Personen, Firmen, Zahlen) sind erfunden.
