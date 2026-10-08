import { expect, test as setup } from "@playwright/test";

/**
 * Legt das Abnahmekonto fuer das Selbstbedienungs-Tablet an und meldet es an.
 *
 * **Ein festes Konto, das wiederverwendet wird.** App-Nutzer sind nach Entwurf nicht
 * loeschbar, damit ein Zuruecksetzen niemanden aussperrt; wuerde jeder Lauf ein neues
 * anlegen, wuechse die Nutzerliste bei jedem Durchgang. Existiert das Konto schon, wird
 * nur sein Passwort neu gesetzt.
 */

export const SITZUNG_KIOSK = "e2e/.sitzung-kiosk.json";

const EMAIL = "tablet-abnahme@namur.de";
/** Mindestens 12 Zeichen, sonst weist der Server es ab. Kein Geheimnis, nur ein gueltiges. */
const PASSWORT = "tablet-abnahme-2026";

const ADMIN_EMAIL = process.env["ADMIN_EMAIL"];
const ADMIN_PASSWORT = process.env["ADMIN_PASSWORT"];

interface Nutzer {
  id: string;
  email: string;
  rolle: string;
}

setup("Kiosk-Konto anlegen und anmelden", async ({ request }) => {
  if (ADMIN_EMAIL === undefined || ADMIN_PASSWORT === undefined) {
    throw new Error("ADMIN_EMAIL und ADMIN_PASSWORT fehlen; sie kommen aus der .env.");
  }

  const alsAdmin = await request.post("/api/auth/anmelden", {
    data: { email: ADMIN_EMAIL, passwort: ADMIN_PASSWORT },
  });
  expect(alsAdmin.status(), "Anmeldung des Admins").toBe(200);

  const alle = (await (await request.get("/api/nutzer")).json()) as Nutzer[];
  const vorhanden = alle.find((n) => n.email === EMAIL);

  if (vorhanden === undefined) {
    const angelegt = await request.post("/api/nutzer", {
      data: { name: "Tablet Abnahme", email: EMAIL, rolle: "kiosk" },
    });
    expect(angelegt.status(), "Kiosk-Konto anlegen").toBe(201);
    const { id } = (await angelegt.json()) as { id: string };
    // Gleich ein bekanntes Passwort setzen; das erzeugte sieht dieser Lauf nur einmal.
    expect(
      (await request.post(`/api/nutzer/${id}/passwort`, { data: { passwort: PASSWORT } })).status(),
    ).toBe(200);
  } else {
    expect(vorhanden.rolle, "das Abnahmekonto hat die falsche Rolle").toBe("kiosk");
    expect(
      (
        await request.post(`/api/nutzer/${vorhanden.id}/passwort`, {
          data: { passwort: PASSWORT },
        })
      ).status(),
    ).toBe(200);
  }

  // Die Admin-Sitzung ablegen, danach als Tablet anmelden: sonst traegt der Zustand beide.
  await request.post("/api/auth/abmelden");

  const alsKiosk = await request.post("/api/auth/anmelden", {
    data: { email: EMAIL, passwort: PASSWORT },
  });
  expect(alsKiosk.status(), "Anmeldung des Tablets").toBe(200);

  await request.storageState({ path: SITZUNG_KIOSK });
});
