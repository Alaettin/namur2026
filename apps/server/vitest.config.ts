import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    /*
     * Jede Testdatei legt ihre eigene SQLite-Datei an. Liefen sie in einem Prozess
     * nebeneinander, teilten sie sich Umgebungsvariablen und Ablageordner.
     */
    fileParallelism: false,
  },
});
