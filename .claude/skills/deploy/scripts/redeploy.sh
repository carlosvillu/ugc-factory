#!/usr/bin/env bash
# Redeploy de UGC Factory al VPS: sincroniza el código, reconstruye, levanta y
# VERIFICA. Si la verificación falla, el script falla — un deploy no está hecho
# porque los contenedores arranquen, sino porque la app responda desde fuera.
#
# Uso:  ./redeploy.sh            # rsync del árbol local (el modo por defecto)
#       ./redeploy.sh --git      # git pull en el VPS (cuando el repo esté pusheado)
#
# POR QUÉ RSYNC ES EL DEFAULT: el bucle de desarrollo NO hace `git push` (el repo
# es público y publicar es decisión del humano; settings.json lo deniega). Así que
# `git pull` en el VPS traería código VIEJO sin avisar: verías un deploy "correcto"
# que no contiene tus cambios. Rsync despliega lo que REALMENTE tienes delante.
# Cuando el humano haya pusheado, --git es el camino canónico del PRD.
set -euo pipefail

VPS="${UGC_SSH:-developer@80.190.75.149}"
REMOTE_DIR="${UGC_REMOTE_DIR:-/home/developer/projects/ugc-factory}"
COMPOSE="docker-compose.prod.yml"
MODE="${1:---rsync}"

cd "$(git rev-parse --show-toplevel)"
SKILL_DIR=".claude/skills/deploy"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

# ── Aviso de trabajo sin commitear ───────────────────────────────────────────
# No bloquea (desplegar para probar es legítimo), pero que nadie despliegue algo
# que luego no puede reproducir desde el repo sin haberlo decidido.
if [ -n "$(git status --porcelain)" ] && [ "$MODE" = "--rsync" ]; then
  printf '\033[33m⚠ Hay cambios sin commitear. Se desplegarán igualmente (rsync envía el árbol tal cual).\033[0m\n'
  git status --short | head -10
fi

step "1/4 · Sincronizando código con el VPS"
if [ "$MODE" = "--git" ]; then
  ssh "$VPS" "cd $REMOTE_DIR && git pull --ff-only"
else
  # --delete mantiene el remoto idéntico al local (ficheros borrados aquí
  # desaparecen allí). Se excluye lo que NO debe viajar: dependencias y builds
  # (se reconstruyen dentro de la imagen), el .git, y CRÍTICAMENTE el .env y
  # secrets/ — los secretos de producción (env + clave/cert C2PA) viven SOLO en
  # el VPS y un rsync con --delete los machacaría/borraría. secrets/ no existe en
  # el árbol local (gitignored); sin este exclude, --delete lo borraría del VPS.
  rsync -az --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.next' \
    --exclude 'dist' \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude 'secrets' \
    --exclude 'test-results' \
    --exclude 'playwright-report' \
    ./ "$VPS:$REMOTE_DIR/"
fi

# Huella de lo desplegado. Con rsync (y sin `git push`), sin esto NO HAY FORMA de
# saber qué código corre en producción: verías contenedores verdes sin poder
# afirmar si contienen tus cambios. `verify.sh` lee este fichero y lo compara con
# tu HEAD, así que la deriva local↔producción deja de ser invisible.
SHA=$(git rev-parse --short HEAD)
DIRTY=$([ -n "$(git status --porcelain)" ] && echo '+sin-commitear' || echo '')
ssh "$VPS" "cat > $REMOTE_DIR/.deployed" <<EOF
sha=$SHA$DIRTY
at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
by=$(git config user.email 2>/dev/null || echo desconocido)
EOF

# ── Permisos de la clave de firma C2PA (T5c.9, mordió el 2026-08-15) ──────────
# La clave vive SOLO en el VPS (excluida del rsync), así que su modo/owner no
# viajan con el código. El worker corre como uid=1000(node) y monta secrets/c2pa
# read-only: si la clave quedó 600 propiedad de OTRO UID (p.ej. al generarla o
# restaurarla como el usuario del host, uid 1001), c2patool muere en phase:"sign"
# con «Reading private key … Permission denied (os error 13)» y NINGÚN vídeo llega
# a /library — un fallo que se LEE como «falta la clave» pero es de permisos.
# Normalizarlo aquí (host, cada deploy) hace el fix self-healing y quita el chmod
# manual. Guardado con `[ -f ]`: no-op si no hay clave.
ssh "$VPS" "[ -f $REMOTE_DIR/secrets/c2pa/es256_private.key ] && chmod 644 $REMOTE_DIR/secrets/c2pa/*.key $REMOTE_DIR/secrets/c2pa/*.pem || true"

step "2/4 · Reconstruyendo imágenes y levantando servicios"
# --build reconstruye; up -d recrea solo lo que cambió. Los jobs en curso
# sobreviven al restart porque su estado vive en Postgres (pg-boss re-entrega).
ssh "$VPS" "cd $REMOTE_DIR && docker compose -f $COMPOSE up -d --build"

step "3/4 · Esperando a que web esté 'healthy'"
# El healthcheck del compose ya sabe cuándo la app está viva (incluye margen para
# migraciones on-boot). Sondear el estado del contenedor es más fiable que dormir
# un número mágico de segundos.
for i in $(seq 1 30); do
  state=$(ssh "$VPS" "docker inspect --format '{{.State.Health.Status}}' ugc-factory-web-1" 2>/dev/null || echo "starting")
  case "$state" in
    healthy)   printf '  web: healthy (tras %ss)\n' "$((i * 5))"; break ;;
    unhealthy) printf '\033[31m  web: UNHEALTHY — abortando\033[0m\n'
               ssh "$VPS" "cd $REMOTE_DIR && docker compose -f $COMPOSE logs --tail 40 web"
               exit 1 ;;
    *)         printf '  web: %s… (%ss)\n' "$state" "$((i * 5))"; sleep 5 ;;
  esac
  [ "$i" = "30" ] && { printf '\033[31m  timeout esperando healthy\033[0m\n'; exit 1; }
done

step "4/4 · Verificando desde fuera"
# La única prueba que vale: ¿responde la app en internet? Si esto falla, el
# deploy NO está hecho, por muy verdes que estén los contenedores.
exec "$SKILL_DIR/scripts/verify.sh"
