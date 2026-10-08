import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5273,
    /*
     * Im Entwicklungsbetrieb liefert Vite die Oberflaeche und reicht alles an den Server
     * weiter, was zur API gehoert. Damit ist der Ursprung derselbe, und das
     * Sitzungscookie kommt ohne CORS und ohne `SameSite=None` aus.
     *
     * `/connector` steht schon hier, obwohl es die Routen erst ab Auftrag 2 gibt: sonst
     * faengt der SPA-Rueckfall von Vite diese Pfade ab und liefert HTML an einen Aufruf,
     * der JSON erwartet.
     */
    proxy: {
      "/api": "http://localhost:3220",
      "/connector": "http://localhost:3220",
    },
  },
});
