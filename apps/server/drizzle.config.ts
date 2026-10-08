import { defineConfig } from "drizzle-kit";

/**
 * Eine Datenbank, ein Schema, ein Migrationsordner.
 *
 * Der AXON Connector hat zwei (Steuer-DB plus eine Datei je Mandant), weil er Mandanten
 * kennt. Hier gibt es keine, und zwei Konfigurationen waeren nur Ballast.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
});
