# Imagen de producción de apps/web (T0.13). Contexto de build = RAÍZ del repo:
#   docker build -f apps/web/Dockerfile .
# Next standalone (§18): el stage de build exporta NEXT_OUTPUT=standalone
# (next.config.ts gatea `output: 'standalone'` por esa env para no romper
# `next start` local) y el runtime ejecuta el server.js trazado.
#
# Migraciones — camino A del planning (mínimo, cero código): el runner de
# @ugc/db bajo el bundle de Turbopack no puede resolver su carpeta drizzle/
# (require.resolve devuelve un id virtual), así que la imagen COPIA el SQL
# committeado a /app/packages/db/drizzle y fija UGC_DB_MIGRATIONS_DIR. Así se
# conserva la migración on-boot con advisory lock de T0.3 (instrumentation.ts),
# validada empíricamente en docs/verifications/T0.14/prod-web-fixed.log.

FROM node:24-slim AS base
# pnpm anclado a la versión del packageManager del repo; via npm y no corepack
# (corepack está deprecado y desaparece de las imágenes oficiales de node).
RUN npm install -g pnpm@10.19.0

FROM base AS build
WORKDIR /app
# El .dockerignore de la raíz poda node_modules/.next/dist/.env*/docs.
COPY . .
# Instalación filtrada: web + sus dependencias del workspace (core, db, services,
# test-utils como devDep). El store se cachea entre builds (BuildKit).
# --ignore-scripts: el `prepare` del package.json raíz (lefthook install) exige
# git y un .git que la imagen no tiene (hooks = máquina de desarrollo); los
# binarios nativos (tailwind oxide, esbuild, sharp) llegan por
# optionalDependencies de plataforma, sin postinstall.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @ugc/web...
ENV NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @ugc/web build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    # Camino A: la ruta de las migraciones va EN la imagen (ver cabecera).
    UGC_DB_MIGRATIONS_DIR=/app/packages/db/drizzle
# standalone = server.js + node_modules trazados, con el layout del monorepo
# (apps/web/server.js) porque outputFileTracingRoot es la raíz del repo.
COPY --from=build /app/apps/web/.next/standalone ./
# Los estáticos NO entran en standalone: se copian a mano (docs de Next).
# (No hay carpeta public/ en apps/web — si algún día aparece, copiarla aquí.)
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
# SQL de migraciones committeado (camino A). El trace de standalone ya lo
# arrastra hoy (Turbopack detecta la lectura), pero el COPY explícito hace el
# contrato de UGC_DB_MIGRATIONS_DIR independiente de ese detalle del tracer.
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
# Punto de montaje del volumen de assets (web lo monta ro; §18). Se crea con
# owner node por si web fuera el primero en inicializar el volumen compartido:
# la propiedad del dir de la imagen es la que hereda el volumen nombrado.
RUN mkdir -p /data/assets && chown node:node /data/assets
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
