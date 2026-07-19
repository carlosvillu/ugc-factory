# Imagen de producción de apps/worker (T0.13). Contexto de build = RAÍZ del repo:
#   docker build -f apps/worker/Dockerfile .
# El worker se bundlea con tsup (decisión de la casa, architecture.md §7): los
# paquetes @ugc/* exportan TS fuente que Node no puede ejecutar, así que van
# inlineados en dist/main.js. Las dependencias REALES (pg, pg-boss, pino, y las
# transitivas de los paquetes inlineados: zod, drizzle-orm) quedan external y se
# instalan en un node_modules PLANO (node-linker=hoisted) para que el bundle las
# resuelva desde /app/node_modules.
#
# F5 (T5.1): la imagen del worker de render ya trae el toolchain de composición
# — ffmpeg (con libass + libfreetype), ffprobe, las fuentes OFL vendorizadas
# (TikTok Sans, Poppins, Noto fallback) y c2patool (firma C2PA). Un HEALTHCHECK
# de capacidades asevera que todo eso está y responde. Ver DEPLOY.md.

FROM node:24-slim AS base
RUN npm install -g pnpm@10.19.0

# --- c2patool: binario Rust de GitHub releases (NO es un paquete apt) ---------
# c2patool se distribuye por target-triple. Upstream publica SOLO
# x86_64-unknown-linux-gnu (glibc) — no hay build aarch64-linux en ninguna
# release. El deploy (VPS) es x86_64, así que la imagen se construye SIEMPRE para
# amd64 (`docker build --platform linux/amd64 .`). El ARG TARGETARCH lo inyecta
# buildx; la rama arm64 falla a propósito y en voz alta para que un build
# native-arm64 nunca produzca una imagen silenciosamente rota.
#
# GLIBC: la runtime es node:24-slim = Debian bookworm = glibc 2.36. Los builds
# del monorepo `contentauth/c2pa-rs` (0.13.0…0.27.0) se compilan en Ubuntu 24.04
# y EXIGEN glibc 2.39 → NO arrancan en bookworm (verificado: el binario 0.27.0
# muere con «GLIBC_2.39 not found»). El último release del repo standalone
# `contentauth/c2patool` (v0.9.12, oct-2024, glibc floor 2.34) SÍ corre en
# bookworm. Se fija ese; subir a una versión del monorepo exigiría base trixie
# (fuera del alcance de T5.1). Deuda anotada para la tarea de firma C2PA.
FROM debian:bookworm-slim AS c2patool
ARG TARGETARCH
# Versión PINEADA (no "latest": evita drift y el "200 hoy, 403 mañana") +
# checksum del tarball verificado en local.
ARG C2PATOOL_VERSION=0.9.12
ARG C2PATOOL_SHA256_AMD64=caa336747d5364e21e0eb7a307c108b6680b237ff8b8aa5ed94ab8e43d64214c
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "$TARGETARCH" in \
      amd64) triple=x86_64-unknown-linux-gnu; sha=$C2PATOOL_SHA256_AMD64 ;; \
      *) echo "c2patool: upstream ships no linux binary for TARGETARCH='$TARGETARCH' (only amd64/x86_64-unknown-linux-gnu). The deploy target is amd64; build with --platform linux/amd64." >&2; exit 1 ;; \
    esac; \
    url="https://github.com/contentauth/c2patool/releases/download/v${C2PATOOL_VERSION}/c2patool-v${C2PATOOL_VERSION}-${triple}.tar.gz"; \
    curl -fsSL "$url" -o /tmp/c2patool.tar.gz; \
    echo "${sha}  /tmp/c2patool.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/c2patool.tar.gz -C /tmp; \
    install -m 0755 /tmp/c2patool/c2patool /usr/local/bin/c2patool; \
    /usr/local/bin/c2patool --version

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

# --- Render toolchain (T5.1) --------------------------------------------------
# ffmpeg de Debian bookworm trae libass (filtro 'ass', subtítulos ASS) y
# libfreetype (drawtext), y el filtro sidechaincompress (ducking de audio) —
# confirmado empíricamente en el build. ffprobe viene en el mismo paquete.
# fontconfig NO es solo para el check `fc-list`: libass y drawtext resuelven las
# fuentes POR NOMBRE vía fontconfig aguas abajo, así que es load-bearing.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      fontconfig \
    && rm -rf /var/lib/apt/lists/*

# Fuentes OFL vendorizadas en el repo (apps/worker/fonts/, con su OFL.txt al
# lado por compliance). Se copian al árbol de fontconfig junto con su OFL.txt
# (la imagen redistribuye los binarios de fuente ⇒ la licencia debe viajar
# DENTRO, no solo en el repo) y se refresca la caché.
COPY apps/worker/fonts/tiktoksans/TikTokSans.ttf /usr/share/fonts/truetype/ugc/
COPY apps/worker/fonts/poppins/*.ttf             /usr/share/fonts/truetype/ugc/
COPY apps/worker/fonts/notosans/NotoSans.ttf     /usr/share/fonts/truetype/ugc/
COPY apps/worker/fonts/tiktoksans/OFL.txt /usr/share/fonts/truetype/ugc/TikTokSans.OFL.txt
COPY apps/worker/fonts/poppins/OFL.txt    /usr/share/fonts/truetype/ugc/Poppins.OFL.txt
COPY apps/worker/fonts/notosans/OFL.txt   /usr/share/fonts/truetype/ugc/NotoSans.OFL.txt
RUN fc-cache -f /usr/share/fonts/truetype/ugc

# c2patool (firma C2PA), traído en su stage arch-aware y verificado por checksum.
COPY --from=c2patool /usr/local/bin/c2patool /usr/local/bin/c2patool

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/dist ./dist
COPY apps/worker/package.json ./package.json
COPY apps/worker/scripts/healthcheck-capabilities.sh ./scripts/healthcheck-capabilities.sh
# El volumen nombrado de assets se inicializa (primer uso) con la propiedad de
# este directorio de la imagen: sin el chown quedaría root y el worker (USER
# node) no podría escribir — y escribir assets es SU papel (§18: worker rw).
RUN mkdir -p /data/assets && chown node:node /data/assets
USER node

# Healthcheck de capacidades (entregable nombrado de T5.1): el worker no tiene
# superficie HTTP, así que "sano" = el toolchain de render está y responde
# (ffmpeg con sidechaincompress+ass, ffprobe, c2patool, las 3 familias de fuente
# vía fc-list). Exit!=0 con mensaje claro si falta algo — convierte un fallo
# latente (que solo afloraría en el primer render real) en señal de arranque.
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD ["/app/scripts/healthcheck-capabilities.sh"]

# Daemon sin superficie HTTP: docker stop → SIGTERM → graceful shutdown de
# pg-boss (main.ts); exec-form para que node sea PID 1 y reciba la señal.
CMD ["node", "dist/main.js"]
