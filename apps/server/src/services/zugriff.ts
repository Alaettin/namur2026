import type { FastifyRequest } from "fastify";
import type { Kontext } from "../kontext.js";
import { notFound, unauthorized } from "../errors.js";
import { findeExponat, istBetreuer } from "./exponate.js";

/**
 * Darf dieser Nutzer dieses Exponat sehen?
 *
 * **An einer Stelle entschieden.** Stuende die Regel in jeder Route einzeln, genuegte eine
 * vergessene Zeile, damit ein Betreuer ein fremdes Exponat bearbeitet; und das faellt
 * niemandem auf, weil die Oberflaeche es ihm gar nicht erst anbietet.
 *
 * **404 statt 403.** Ob es ein Exponat mit dieser Kennung gibt, ist fuer einen fremden
 * Betreuer keine Auskunft, die ihm zusteht. Ein 403 bestaetigte die Existenz.
 */
export function verlangeExponatZugriff(ctx: Kontext, req: FastifyRequest, exponatId: string): void {
  const nutzer = req.nutzer;
  if (nutzer === null) throw unauthorized();

  // Wirft 404, wenn es das Exponat ueberhaupt nicht gibt. Fuer Admin und Betreuer gleich.
  findeExponat(ctx.db, exponatId);

  if (nutzer.rolle === "admin") return;
  if (istBetreuer(ctx.db, exponatId, nutzer.id)) return;

  throw notFound("exponat-unbekannt", "Unknown exhibit.");
}

/**
 * Nur Admins duerfen Exponate und ihre Inhalte aendern.
 *
 * Ein Betreuer sieht sein Exponat und scannt daran, er legt aber keine Dokumente an und
 * aendert keine Kennungen: beides wirkt sich auf das Modell in Axon aus.
 */
export function verlangeExponatBearbeiten(
  ctx: Kontext,
  req: FastifyRequest,
  exponatId: string,
): void {
  verlangeExponatZugriff(ctx, req, exponatId);
  if (req.nutzer?.rolle !== "admin") {
    // Auch hier 404 und nicht 403: dieselbe Begruendung wie oben.
    throw notFound("exponat-unbekannt", "Unknown exhibit.");
  }
}
