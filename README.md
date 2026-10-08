# namur-hv-2026

Web-App für die NAMUR-Hauptversammlung 2026. Sie verwaltet Konferenzbesucher und Exponate:
Ein Betreuer scannt am Exponat den Pass eines Besuchers und ordnet ihm Inhalte zu
(Dokumente, Links, Ansprechpartner). Der Viewer von Axon Core zeigt sie danach unter
`viewer-namur2026.aas.neoception.dev/<GUID>` an.

Zwei Oberflächen in einem Dienst: die angemeldete Verwaltung (`/`, `/api/...`) und die
öffentliche Konnektor-API nach Spec 1.0.0 (`/connector/...`), mit getrennter
Authentifizierung.

**Maßgeblich ist die Projektakte**, nicht diese Datei: `01 Projekte` → `02 Arbeit` →
`11 NAMUR HV 2026` in Outline Privat, samt der Kindnotiz „Übergabe an Claude Code".

## Stand

| Auftrag | Inhalt | Stand |
|---------|--------|-------|
| 1 | Gerüst, Anmeldung, Datenhaltung, Dateiablage | **fertig, lokal.** Rollout auf Sliplane steht aus |
| 2 | Fachlogik und Konnektor-API | **fertig, lokal gemessen** |
| 3A | Verwaltungsoberfläche, Einstellungen | **fertig** |
| 3B | Scan-Ablauf, CSV-Import | **fertig** |
| — | Nacharbeiten (08.10.) | 112 Server- und 54 Abnahmetests grün |

**Offen:** der Rollout, und damit der Kameraweg auf echten Geräten. `getUserMedia` verlangt
einen sicheren Kontext; über `http://` und eine Netzwerkadresse gibt kein Browser die Kamera
frei. Geprüft ist bisher der Scan über die Eingabe von Hand.

Das Modell: **10 Dokumente, 10 Links, 5 Ansprechpartner** je Exponat, also 102 Datenpunkte
je Exponat plus 11 für den Besucher. Die Obergrenzen stehen als Konstanten in
[apps/server/src/modell/felder.ts](apps/server/src/modell/felder.ts). **Jede Änderung daran
verlangt ein neues Mapping in Axon.**

Die Oberfläche ist in Auftrag 1 bewusst nur ein Gerüst: Tokens, Schriften, Platzhalterseite.
Die Bildschirme entstehen in Auftrag 3 aus den Entwürfen unter `design/screens/`.

## Aufbau

```
apps/server     Fastify, TypeScript, Node 22. Eine SQLite-Datei (better-sqlite3, WAL, Drizzle)
apps/web        React 19, Vite, Tailwind 4
design/         Die Entwürfe aus Claude Design. Vorlage, kein Quelltext (siehe HANDOFF.md)
Connector Guide/ connector-1.0.0.json und der DTI Connector Guide, für Auftrag 2
docker/         Dockerfile für den späteren Rollout
```

Vorlage für Gerüst, Dockerfile und Konnektor-API ist das Projekt **AXON Connector**.

## Loslegen

Unter Windows genügt ein Doppelklick auf **`start.bat`**. Das Skript prüft pnpm, legt bei
Bedarf die `.env` aus der Vorlage an, installiert, erzeugt fehlende Migrationen, startet
Dienst und Oberfläche in je einem Fenster und öffnet den Browser. Fehlt in der `.env` ein
Pflichtwert, hält es an und sagt welcher, statt zwei Fenster zu öffnen, von denen eines
sofort wieder zugeht.

Von Hand:

```bash
pnpm install
cp .env.example .env     # ausfüllen, mindestens SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORT
pnpm migrationen         # nur nötig, wenn sich das Schema geändert hat
pnpm dev:server          # Server auf 3220
pnpm dev                 # Oberfläche auf 5273, reicht /api und /connector durch
```

`SESSION_SECRET` erzeugen:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Der erste Admin entsteht beim Start aus `ADMIN_EMAIL` und `ADMIN_PASSWORT`, aber nur
solange noch kein Admin existiert. Es gibt keine Selbstregistrierung.

## Prüfen

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Die Abnahme im Browser läuft gegen den **gebauten** Dienst, nicht gegen Vite: nur dort gilt
die Content-Security-Policy.

```bash
pnpm build && node apps/server/dist/index.js   # in einem eigenen Fenster
pnpm exec playwright test
```

Die Einrichtung meldet sich **einmal** an und legt die Sitzung ab. Das ist kein Beiwerk:
die Anmeldegrenze lässt 10 Versuche je Viertelstunde und E-Mail zu, und ein Testlauf, der
sich je Fall neu anmeldet, sperrt sich selbst aus. Ist das passiert, hilft ein Neustart des
Dienstes, der Zähler liegt im Speicher.

Für eine Messung gegen den **gebauten** Dienst den Server direkt mit `node` starten, nicht
über `pnpm run`, und vorher nachsehen, welcher Prozess wirklich auf dem Port lauscht:

```bash
pnpm build && node apps/server/dist/index.js
```

## Fallen, die schon einmal Zeit gekostet haben

- **Ohne `ENV DATA_DIR=/data` schreibt der Container am Volume vorbei.** Lokal unsichtbar,
  weil dort die `.env` danebensteht.
- **Native Module gehören in `external` in `build.mjs`**, sonst bricht erst der Container
  mit `ERR_AMBIGUOUS_MODULE_SYNTAX`. Betrifft `better-sqlite3` und `@node-rs/argon2`.
- **`@fastify/rate-limit` braucht `hook: "preHandler"`**, sonst ist der Rumpf beim Bilden
  des Schlüssels noch nicht geparst und die Anmeldegrenze gilt in Wahrheit je IP statt je
  E-Mail. Sichtbar nur an einer Gegenprobe mit einer zweiten E-Mail.
- **`camera=(self)` in der Permissions-Policy.** Mit `camera=()` sperrt der Browser den
  QR-Scan, ohne dass die Seite einen Fehler sieht.
- **Die Dokumentregel hat zwei Richtungen.** Bilder gehen By Value und niemals über den
  Ticketweg, Nicht-Bilder gehen By Ticket und niemals By Value. Im AXON Connector war bis
  zum 08.09.2026 nur die erste Hälfte geprüft, und weil sie geprüft war, sah die Regel
  geprüft aus: jedes PDF ging als Base64 mitten in die Antwort von `/values`.
- **`EADDRINUSE` sieht aus wie ein laufender Server.** Scheitert ein Start daran, hält der
  alte Prozess den Port, und die Messung kommt aus dem alten Bündel. Die PID im
  Startprotokoll muss die sein, die der Port meldet.
- **Eine Oberfläche gilt erst als geprüft, wenn der Weg durch sie hindurch geprüft ist.**
  Dreimal fehlte eine fertige Server-Funktion in der Oberfläche (Links, Ansprechpartner,
  Betreuer-Zuweisung), weil alle Abnahmen die Daten über die API anlegten.
- **Die Exponatkennung wird wiederverwendet.** Wird E03 gelöscht, heißt das nächste wieder
  E03 und erbt dessen Mapping in Axon. So entschieden; die Rückfrage beim Löschen sagt es.
- **Die Kamera braucht HTTPS.** `localhost` gilt als sicherer Kontext, eine Netzwerkadresse
  nicht. Zum Prüfen auf echten Geräten führt kein Weg am Rollout vorbei.
- **CSV aus Excel ist meist Windows-1252.** Der Dekodierer braucht `fatal: true`, sonst
  ersetzt er ungültige Folgen still und die Erkennung greift nie.
- **Diese Ablage liegt unter OneDrive.** Sieht ein Wert aus der `.env` falsch aus, zuerst
  den Zeitstempel der Datei ansehen.
- **In `start.bat` wird mit `ping` gewartet, nicht mit `timeout /t`.** `timeout` bricht ab,
  sobald stdin umgeleitet ist. Beim Doppelklick fällt das nie auf.
- **Die `.env` wird mit Node geprüft, nicht mit `findstr`.** `findstr /x` vergleicht ganze
  Zeilen und braucht dafür CRLF; eine `.env` mit reinen LF-Enden ist für `findstr` eine
  einzige Zeile, und die Prüfung läuft still ins Leere. Genau so ist die erste Fassung
  durchgerutscht.

## Nicht Teil des Projekts

Der Viewer, Offline-Modus, Selbstregistrierung, Mandanten, Mehrsprachigkeit, Druck der
Pässe, Leadexport, automatische Sicherung, Supabase.
