# syntax=docker/dockerfile:1

# bookworm-slim statt alpine: glibc statt musl. `better-sqlite3` 13 ruft ohne Umweg
# `node-gyp rebuild` auf, es wird also **immer** uebersetzt. Die Werkzeuge dafuer kommen je
# Stufe dazu, in der Laufzeitstufe in derselben Schicht wieder weg.
FROM node:22-bookworm-slim AS base
# pnpm fest installiert statt ueber Corepack.
#
# Corepack fragt vor dem Herunterladen einer Paketverwaltung nach. Im Bau steht niemand am
# Terminal, und die Frage haelt den Lauf an, bis der Bauserver nach einer Stunde abbricht.
#
# Die Fassung muss zu `packageManager` in der package.json passen. Weicht sie ab, bricht
# `--frozen-lockfile` sofort und sichtbar ab, statt still etwas anderes zu bauen.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g pnpm@10.30.3
WORKDIR /app

# --- Bau ---
# Installieren und Bauen liegen bewusst in **einer** Stufe: pnpm verlinkt node_modules
# symbolisch in einen virtuellen Store, das ueberlebt ein Kopieren zwischen Stufen nicht.
FROM base AS build
# Wird mit der Stufe verworfen, deshalb ohne Aufraeumen.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++

# Erst die Manifeste, dann installieren, dann der Quelltext.
#
# Stuende `COPY . .` vor der Installation, entwertete jede Codeaenderung die Schicht, in der
# installiert und uebersetzt wird: aus einer Aenderung an einer .tsx-Datei wuerde ein
# Vollbau samt Uebersetzen von better-sqlite3. Solange der Cache greift, faellt das nicht
# auf, beim ersten kalten Bau laeuft es in das Zeitlimit.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @namur-hv/web build \
  && pnpm --filter @namur-hv/server build

# --- Laufzeit ---
FROM base AS runtime
ENV NODE_ENV=production
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
# Der Server ist gebuendelt, er braucht zur Laufzeit nur die externen Pakete. Dazu gehoeren
# better-sqlite3 und @node-rs/argon2: native Module lassen sich nicht buendeln.
#
# Uebersetzen und Aufraeumen in **einer** Schicht: waere das Entfernen eine eigene Zeile,
# steckten die rund 200 MB Werkzeuge weiterhin in der darunterliegenden.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && pnpm install --frozen-lockfile --prod --filter @namur-hv/server \
  && apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/apps/server/dist ./apps/server/dist
# Die Migrationen werden beim Start angewendet, ohne dass drizzle-kit vorliegt. Der Ordner
# muss deshalb ins Abbild.
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
# Das Frontend liefert der Server selbst aus. Der Pfad ist Teil der Zusage: index.ts sucht
# es genau eine Ebene ueber apps/server.
COPY --from=build /app/apps/web/dist ./apps/web/dist
# Der Standard-Avatar. Er wird beim ersten Start in die Ablage uebernommen; fehlt er hier,
# startet der Dienst zwar, aber jeder Besucher erscheint im Viewer ohne Bild. Der Pfad ist
# Teil der Zusage: `standardavatar.ts` sucht ihn unter PROJEKT_WURZEL, und die ist /app.
COPY --from=build /app/apps/server/assets ./apps/server/assets

# Das benannte Volume erbt Eigentuemer und Rechte dieses Pfads, wenn es leer angelegt wird.
# Ohne diesen Schritt scheitert der erste Schreibzugriff als Benutzer node mit
# SQLITE_CANTOPEN, was wie ein Treiberfehler aussieht.
RUN mkdir -p /data/dateien && chown -R node:node /data

# **Ohne diese Zeile ist der mkdir darueber reine Zierde.**
#
# Die Vorgabe in env.ts ist `./data`, seit dem 08.10.2026 aufgeloest gegen die
# Projektwurzel, im Abbild also `/app/data`. Der Container schriebe damit am gemounteten
# Volume vorbei: `/data` bliebe
# leer, und `/app` gehoert root, waehrend der Prozess als node laeuft. Der erste
# Schreibversuch scheitert, das Volume sieht unbenutzt aus, und beides zusammen liest sich
# wie ein Rechteproblem des Anbieters.
#
# Lokal faellt das nie auf: dort steht DATA_DIR in der .env daneben.
ENV DATA_DIR=/data

EXPOSE 3220
USER node
CMD ["node", "apps/server/dist/index.js"]
