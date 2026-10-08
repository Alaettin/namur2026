import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Prueft die .env, bevor start.bat zwei Fenster oeffnet.
 *
 * Der Dienst prueft dasselbe beim Start noch einmal und bricht mit klarer Meldung ab. Nur
 * laeuft er dann in einem eigenen Fenster, das sofort wieder zugeht: der Nutzer sieht ein
 * Aufblitzen und eine Oberflaeche, die auf einen Dienst wartet, den es nie gab.
 *
 * **In Node statt mit findstr.** `findstr /x` vergleicht ganze Zeilen und braucht dafuer
 * CRLF. Eine .env mit reinen LF-Enden ist fuer findstr **eine** Zeile, der Vergleich
 * passt nie, und die Pruefung laeuft still ins Leere, statt zu melden. Genau so ist die
 * erste Fassung dieser Pruefung durchgerutscht.
 *
 * Exitcode 0: alles da. 1: es fehlt etwas, die Meldung steht auf stdout.
 */

const PFLICHT = [
  { name: "SESSION_SECRET", minLaenge: 32, warum: "ohne diesen Wert startet der Dienst nicht" },
  { name: "ADMIN_EMAIL", minLaenge: 1, warum: "sonst entsteht kein erster Admin" },
  { name: "ADMIN_PASSWORT", minLaenge: 1, warum: "sonst entsteht kein erster Admin" },
];

const pfad = fileURLToPath(new URL("../.env", import.meta.url));

let roh;
try {
  roh = readFileSync(pfad, "utf8");
} catch {
  console.log("FEHLER: .env laesst sich nicht lesen.");
  process.exit(1);
}

/*
 * Eigener Zerleger statt `process.loadEnvFile`: der wuerde den Prozess mit einer
 * Ausnahme abbrechen, und gebraucht wird eine Liste **aller** fehlenden Werte, nicht der
 * erste Fehler. `\r` faellt beim Trimmen weg, damit CRLF und LF gleich behandelt werden.
 */
const werte = new Map();
for (const zeile of roh.split("\n")) {
  const sauber = zeile.trim();
  if (sauber === "" || sauber.startsWith("#")) continue;
  const gleich = sauber.indexOf("=");
  if (gleich < 0) continue;
  werte.set(sauber.slice(0, gleich).trim(), sauber.slice(gleich + 1).trim());
}

const maengel = [];
for (const { name, minLaenge, warum } of PFLICHT) {
  const wert = werte.get(name) ?? "";
  if (wert === "") maengel.push(`  ${name} ist leer, ${warum}`);
  else if (wert.length < minLaenge) {
    maengel.push(
      `  ${name} ist mit ${String(wert.length)} Zeichen zu kurz, ` +
        `mindestens ${String(minLaenge)} sind noetig`,
    );
  }
}

if (maengel.length > 0) {
  console.log("FEHLER: die .env ist noch nicht vollstaendig:");
  console.log(maengel.join("\n"));
  console.log("");
  console.log("Zufallswert fuer SESSION_SECRET erzeugen:");
  console.log('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"');
  process.exit(1);
}
