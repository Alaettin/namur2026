import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { appNutzer } from "../db/schema.js";
import { hashePasswort, normalisiereEmail } from "../auth/passwort.js";
import type { ServerEnv } from "../env.js";

/**
 * Legt den ersten Admin an, wenn es noch keinen gibt.
 *
 * **Nur dann.** Existiert bereits ein Admin, passiert nichts, auch nicht das Setzen des
 * Passworts: sonst holte jeder Neustart ein weggeworfenes Startpasswort zurueck, und wer
 * die Umgebungsvariable einmal lesen konnte, haette dauerhaft einen Zugang.
 *
 * Gezaehlt werden **alle** Admins, auch deaktivierte. Ein deaktivierter Admin ist eine
 * Entscheidung, keine Luecke, und ein Bootstrap daneben waere ein zweiter Weg hinein.
 *
 * Es gibt keine Selbstregistrierung. Ohne diesen Weg kaeme nach dem ersten Start niemand
 * in die Verwaltung.
 */
export async function bootstrapAdmin(
  db: Db,
  env: ServerEnv,
  melde: (text: string) => void,
): Promise<void> {
  if (env.bootstrapAdmin === null) return;

  const vorhanden = db
    .select({ id: appNutzer.id })
    .from(appNutzer)
    .where(eq(appNutzer.rolle, "admin"))
    .all();
  if (vorhanden.length > 0) return;

  const email = normalisiereEmail(env.bootstrapAdmin.email);
  db.insert(appNutzer)
    .values({
      id: randomUUID(),
      name: "Administrator",
      email,
      passwortHash: await hashePasswort(env.bootstrapAdmin.passwort),
      rolle: "admin",
      aktiv: true,
      angelegt: Date.now(),
      zuletztAngemeldet: null,
    })
    .run();

  // Die E-Mail ins Protokoll, das Passwort nicht. Wer das Protokoll liest, soll wissen,
  // dass und fuer wen ein Konto entstanden ist.
  melde(`Erster Admin angelegt: ${email}`);
}
