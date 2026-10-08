import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { api } from "./lib/api.js";
import type { Ich } from "./lib/ich.js";
import { Rahmen } from "./layout/Rahmen.js";
import { Anmeldung } from "./seiten/Anmeldung.js";
import { Ansprechpartner } from "./seiten/Ansprechpartner.js";
import { Api } from "./seiten/Api.js";
import { Besucher } from "./seiten/Besucher.js";
import { BesucherDetail } from "./seiten/BesucherDetail.js";
import { CsvImport } from "./seiten/CsvImport.js";
import { Dashboard } from "./seiten/Dashboard.js";
import { Einstellungen } from "./seiten/Einstellungen.js";
import { Monitoring } from "./seiten/Monitoring.js";
import { ExponatDetail } from "./seiten/ExponatDetail.js";
import { Exponate } from "./seiten/Exponate.js";
import { Nutzer } from "./seiten/Nutzer.js";
import { Scan } from "./scan/Scan.js";

/**
 * Der Anmeldezustand kommt aus `GET /api/auth/ich`, bei jedem Start.
 *
 * **Kein localStorage-Zwischenspeicher mit sofortigem Rendern.** Der zeigte den Stand von
 * gestern: ein deaktivierter Nutzer saehe die Verwaltung aufblitzen, bevor der Server ihn
 * abweist, und eine geaenderte Rolle griffe erst nach dem Neuladen.
 */
export function App() {
  const [ich, setzeIch] = useState<Ich | null>(null);
  const [geprueft, setzeGeprueft] = useState(false);

  const pruefe = useCallback(() => {
    api<Ich>("/api/auth/ich")
      .then((daten) => {
        setzeIch(daten);
      })
      .catch(() => {
        /*
         * 401 ist hier kein Fehler, sondern die Antwort "nicht angemeldet". Jeder andere
         * Fehler endet ebenso bei der Anmeldung: ohne diese Auskunft laesst sich die
         * Oberflaeche nicht sinnvoll zeigen, und ein halb geladener Zustand waere
         * schlimmer als die Maske.
         */
        setzeIch(null);
      })
      .finally(() => {
        setzeGeprueft(true);
      });
  }, []);

  useEffect(() => {
    pruefe();
  }, [pruefe]);

  // Bis die Auskunft da ist, wird nichts gezeigt. Sonst blitzt die Anmeldung auf, obwohl
  // die Sitzung gueltig ist.
  if (!geprueft) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-grund">
        <p className="text-sm text-text-hinweis">Wird geladen …</p>
      </div>
    );
  }

  return (
    <BrowserRouter>
      {ich === null ? (
        <Routes>
          <Route path="/anmeldung" element={<Anmeldung aufAngemeldet={pruefe} />} />
          {/*
            Die Anmeldemaske haengt an **keiner** anderen Route. Ein direkter Aufruf von
            /anmeldung aus einem Lesezeichen muss genauso gehen wie der Weg ueber /.
          */}
          <Route path="*" element={<Navigate to="/anmeldung" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/anmeldung" element={<Navigate to="/" replace />} />
          {/*
            Der Scan läuft im Vollbild, **außerhalb** des Rahmens: er hat eine eigene
            Kopfzeile, und die Reiter wären am Stand nur im Weg.
          */}
          <Route path="/exponate/:id/scan" element={<Scan ich={ich} />} />
          <Route
            element={
              <Rahmen
                ich={ich}
                aufAbmelden={() => {
                  setzeIch(null);
                }}
              />
            }
          >
            {/* Ein Betreuer hat kein Dashboard; fuer ihn ist die Exponatliste die Startseite. */}
            <Route
              path="/"
              element={ich.rolle === "admin" ? <Dashboard /> : <Navigate to="/exponate" replace />}
            />
            <Route path="/besucher" element={<Besucher />} />
            <Route path="/besucher/neu" element={<BesucherDetail ich={ich} />} />
            <Route path="/besucher/import" element={<CsvImport />} />
            <Route path="/besucher/:guid" element={<BesucherDetail ich={ich} />} />
            <Route path="/exponate" element={<Exponate ich={ich} />} />
            <Route path="/exponate/:id" element={<ExponatDetail ich={ich} />} />
            <Route path="/ansprechpartner" element={<Ansprechpartner />} />
            <Route path="/nutzer" element={<Nutzer />} />
            <Route path="/api" element={<Api />} />
            <Route path="/monitoring" element={<Monitoring />} />
            <Route path="/einstellungen" element={<Einstellungen ich={ich} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
    </BrowserRouter>
  );
}
