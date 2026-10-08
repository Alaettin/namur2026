@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo  NAMUR HV 2026: Entwicklungsumgebung
echo ========================================
echo.

where pnpm >nul 2>&1
if errorlevel 1 (
  echo FEHLER: pnpm wurde nicht gefunden.
  echo Entweder "npm install -g pnpm@10.30.3" ausfuehren oder "corepack enable".
  pause
  exit /b 1
)

REM Eine .env aus Platzhaltern ist schlimmer als keine: sie sieht eingerichtet aus, aber
REM der Dienst bricht beim Start an einem leeren SESSION_SECRET ab. Er laeuft in einem
REM eigenen Fenster, und das blitzt dann nur kurz auf. Deshalb hier anlegen und
REM **anhalten**, nicht weiterlaufen.
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo .env fehlte und wurde aus .env.example angelegt.
  echo.
  echo Bitte jetzt in der .env setzen, dann start.bat erneut aufrufen:
  echo   SESSION_SECRET   ein echter Zufallswert, mindestens 32 Zeichen
  echo   ADMIN_EMAIL      die E-Mail des ersten Admins
  echo   ADMIN_PASSWORT   dessen Startpasswort
  echo.
  echo Zufallswert erzeugen:
  echo   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
  echo.
  pause
  exit /b 1
)

REM Dieselbe Falle bei einer .env, die zwar existiert, deren Pflichtwerte aber noch leer
REM sind. Geprueft wird in Node, nicht mit findstr: `findstr /x` braucht CRLF, und eine
REM .env mit reinen LF-Enden ist fuer findstr **eine** Zeile. Der Vergleich passt dann nie
REM und die Pruefung laeuft still ins Leere.
node "scripts\pruefe-env.mjs"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Abhaengigkeiten werden installiert, das dauert einen Moment ...
  call pnpm install
  if errorlevel 1 (
    echo FEHLER: pnpm install ist fehlgeschlagen.
    pause
    exit /b 1
  )
  echo.
)

REM Eine Datenbank ohne Migrationen laeuft in "no such table" statt in einen Startfehler.
if not exist "apps\server\drizzle\meta\_journal.json" (
  echo Migrationen werden erzeugt ...
  call pnpm migrationen
  if errorlevel 1 (
    echo FEHLER: die Migrationen liessen sich nicht erzeugen.
    pause
    exit /b 1
  )
  echo.
)

echo Dienst startet auf http://localhost:3220
start "NAMUR HV 2026 Dienst" cmd /k "cd /d "%~dp0" && pnpm dev:server"

echo Oberflaeche startet auf http://localhost:5273
start "NAMUR HV 2026 Oberflaeche" cmd /k "cd /d "%~dp0" && pnpm dev"

echo.
echo Beide Fenster laufen weiter. Zum Beenden dort jeweils Strg+C.
echo Der Browser oeffnet gleich die Oberflaeche.

REM `ping` statt `timeout /t`: timeout bricht ab, sobald stdin umgeleitet ist, mit
REM "Die Eingabeumleitung wird nicht unterstuetzt". Beim Doppelklick faellt das nie auf,
REM aus jedem Skript heraus sofort.
ping -n 6 127.0.0.1 >nul
start "" "http://localhost:5273"

endlocal
