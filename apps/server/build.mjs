import { readFileSync } from "node:fs";
import { build } from "esbuild";

const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

/**
 * Der Server wird gebuendelt statt nur transpiliert: ein Einstiegspunkt, keine
 * Endungsfragen, kein tsc-Ausgabebaum im Abbild.
 */
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/index.js",
  sourcemap: true,
  // Eine Wahrheit fuer die Fassung: die package.json dieses Pakets.
  define: { __APP_VERSION__: JSON.stringify(version) },
  //
  // Fastify bleibt extern, weil es Plugins dynamisch nachlaedt und Buendeln dort mehr
  // kaputt macht als es spart.
  //
  // **Native Module muessen extern bleiben.** Sie suchen ihre .node-Datei ueber
  // `__dirname` relativ zu ihrem eigenen Ort; gebuendelt zeigt dieser Ort ins Leere, und
  // Node bricht beim Start mit ERR_AMBIGUOUS_MODULE_SYNTAX ab. Im Entwicklungsbetrieb
  // faellt das nie auf, dort laeuft der Server ueber tsx: erst der Containerlauf findet es.
  // Das betrifft `better-sqlite3` und `@node-rs/argon2`.
  external: ["fastify", "@fastify/*", "better-sqlite3", "@node-rs/argon2"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});

console.log("Server gebaut: dist/index.js");
