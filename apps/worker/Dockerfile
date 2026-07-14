# Imagen de producción de apps/worker (T0.13). Contexto de build = RAÍZ del repo:
#   docker build -f apps/worker/Dockerfile .
# El worker se bundlea con tsup (decisión de la casa, architecture.md §7): los
# paquetes @ugc/* exportan TS fuente que Node no puede ejecutar, así que van
# inlineados en dist/main.js. Las dependencias REALES (pg, pg-boss, pino, y las
# transitivas de los paquetes inlineados: zod, drizzle-orm) quedan external y se
# instalan en un node_modules PLANO (node-linker=hoisted) para que el bundle las
# resuelva desde /app/node_modules.
#
# F0: ffmpeg/libass/c2patool NO se instalan aún — ningún executor de F0/F1 los
# usa. Entrarán en la imagen en F5 (composición); ver DEPLOY.md.

FROM node:24-slim AS base
RUN npm install -g pnpm@10.19.0

FROM base AS build
WORKDIR /app
COPY . .
# --ignore-scripts: el `prepare` raíz (lefthook install) exige git/.git que la
# imagen no tiene; esbuild (tsup) y sharp traen sus binarios por
# optionalDependencies de plataforma, sin postinstall.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @ugc/worker...
RUN pnpm --filter @ugc/worker build

FROM base AS prod-deps
WORKDIR /app
COPY . .
# node_modules PLANO y solo de producción, acotado al subárbol del worker.
# hoisted ⇒ layout npm clásico: los imports externos del bundle (zod,
# drizzle-orm, pino, pg, pg-boss) resuelven subiendo hasta /app/node_modules.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    echo 'node-linker=hoisted' >> .npmrc && \
    pnpm install --prod --frozen-lockfile --ignore-scripts --filter @ugc/worker...

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/dist ./dist
COPY apps/worker/package.json ./package.json
# El volumen nombrado de assets se inicializa (primer uso) con la propiedad de
# este directorio de la imagen: sin el chown quedaría root y el worker (USER
# node) no podría escribir — y escribir assets es SU papel (§18: worker rw).
RUN mkdir -p /data/assets && chown node:node /data/assets
USER node
# Daemon sin superficie HTTP: docker stop → SIGTERM → graceful shutdown de
# pg-boss (main.ts); exec-form para que node sea PID 1 y reciba la señal.
CMD ["node", "dist/main.js"]
