#!/usr/bin/env bash
# Vuelve producción a un commit anterior. Es el camino de vuelta cuando un deploy
# rompe algo — el escenario que una skill de deploy existe para cubrir.
#
# Uso:  ./rollback.sh              # vuelve al commit ANTERIOR al desplegado
#       ./rollback.sh <sha>        # vuelve a un commit concreto
#       ./rollback.sh --status     # qué hay desplegado ahora mismo
#
# ─────────────────────────────────────────────────────────────────────────────
# LEE ESTO ANTES DE USARLO — el rollback de CÓDIGO no deshace la BASE DE DATOS.
#
# Las migraciones se aplican al arrancar web y son de ida. Volver a un commit
# anterior NO revierte una migración ya aplicada: te deja código viejo hablando
# con un schema nuevo. Suele funcionar (las migraciones aditivas —columnas y
# tablas nuevas— son invisibles para el código viejo), pero NO si la migración
# borró o renombró algo que el código viejo todavía usa.
#
# Si el deploy roto incluía una migración DESTRUCTIVA, el rollback de código no
# basta y hay que restaurar el dump (ver §Restaurar en SKILL.md) — asumiendo que
# se pierde todo lo ocurrido desde ese backup. Por eso el script te obliga a
# mirar si hubo migraciones nuevas antes de seguir.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

VPS="${UGC_SSH:-developer@80.190.75.149}"
REMOTE_DIR="${UGC_REMOTE_DIR:-/home/developer/projects/ugc-factory}"
cd "$(git rev-parse --show-toplevel)"

deployed=$(ssh "$VPS" "cat $REMOTE_DIR/.deployed 2>/dev/null" || true)
dep_sha=$(printf '%s\n' "$deployed" | sed -n 's/^sha=//p' | sed 's/+sin-commitear//')

if [ "${1:-}" = "--status" ]; then
  printf '\033[1mDesplegado en producción\033[0m\n'
  if [ -z "$deployed" ]; then
    echo "  (sin huella: el último deploy no dejó .deployed)"
  else
    printf '%s\n' "$deployed" | sed 's/^/  /'
    [ -n "$dep_sha" ] && git log --oneline -1 "$dep_sha" 2>/dev/null | sed 's/^/  → /'
  fi
  printf '\033[1mTu HEAD local\033[0m\n  '
  git log --oneline -1
  exit 0
fi

if [ -z "$dep_sha" ]; then
  echo "✗ No hay huella de qué está desplegado (.deployed no existe en el VPS)." >&2
  echo "  Sin saber de dónde vienes, un rollback es a ciegas. Pasa un SHA explícito:" >&2
  echo "    ./rollback.sh <sha>" >&2
  exit 1
fi

TARGET="${1:-$(git rev-parse --short "$dep_sha^" 2>/dev/null || true)}"
[ -z "$TARGET" ] && { echo "✗ No pude resolver el commit anterior a $dep_sha" >&2; exit 1; }
git rev-parse --verify "$TARGET" >/dev/null 2>&1 || { echo "✗ '$TARGET' no es un commit válido" >&2; exit 1; }

printf '\033[1m▶ Rollback\033[0m\n'
printf '  desde: %s  %s\n' "$dep_sha" "$(git log --oneline -1 "$dep_sha" 2>/dev/null | cut -c11-)"
printf '  hasta: %s  %s\n' "$(git rev-parse --short "$TARGET")" "$(git log --oneline -1 "$TARGET" | cut -c11-)"

# ¿El tramo que vamos a deshacer traía migraciones? Es la pregunta que decide si
# esto es seguro o si hace falta restaurar la BD.
migs=$(git diff --name-only "$TARGET" "$dep_sha" -- packages/db/drizzle 2>/dev/null | grep -c '\.sql$' || true)
if [ "${migs:-0}" -gt 0 ]; then
  printf '\n\033[31m⚠ CUIDADO: el tramo que deshaces incluye %s migración(es) de BD.\033[0m\n' "$migs"
  git diff --name-only "$TARGET" "$dep_sha" -- packages/db/drizzle | grep '\.sql$' | sed 's/^/    /'
  echo "  Ya están APLICADAS en producción y esto NO las revierte. Si alguna borró o"
  echo "  renombró algo que el código viejo usa, la app fallará igualmente."
  echo "  Lee la cabecera de este script antes de continuar."
  printf '\n  Escribe SI para continuar de todos modos: '
  read -r answer
  [ "$answer" = "SI" ] || { echo "  Abortado."; exit 1; }
else
  echo "  (sin migraciones de BD en el tramo: rollback de código limpio)"
fi

# Backup antes de tocar nada. Es barato y es la red de seguridad si el rollback
# tampoco arregla las cosas.
printf '\n\033[1m▶ Backup de seguridad antes del rollback\033[0m\n'
ssh "$VPS" "$REMOTE_DIR/scripts/vps-backup-db.sh"

# Despliega el árbol del commit destino SIN mover tu working tree: `git archive`
# empaqueta ese commit y se descomprime en el VPS. Así tu copia local queda
# intacta (no te cambia de rama ni pierdes cambios sin commitear).
printf '\n\033[1m▶ Desplegando %s\033[0m\n' "$(git rev-parse --short "$TARGET")"
git archive --format=tar "$TARGET" | ssh "$VPS" "tar -x -C $REMOTE_DIR"
ssh "$VPS" "cat > $REMOTE_DIR/.deployed" <<EOF
sha=$(git rev-parse --short "$TARGET")
at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
by=rollback desde $dep_sha
EOF
ssh "$VPS" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml up -d --build"

printf '\n\033[1m▶ Verificando\033[0m\n'
exec "$(git rev-parse --show-toplevel)/.claude/skills/deploy/scripts/verify.sh"
