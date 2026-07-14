#!/usr/bin/env bash
# Fuerza un backup de la BD de producción AHORA y comprueba que el dump es
# restaurable. Lo segundo es el punto: un backup que nadie ha probado a leer no
# es un backup, es un fichero. `pg_restore --list` lo abre de verdad y enumera su
# contenido — si el dump está truncado o corrupto, falla aquí y no el día que lo
# necesites.
#
# El cron del VPS ya hace esto a diario (4:15 UTC). Este script es para forzarlo
# a mano: antes de una migración arriesgada, o para verificar que el cron funciona.
#
# Uso:  ./backup.sh           # hace el backup y lo verifica
#       ./backup.sh --list    # solo lista los backups existentes
set -euo pipefail

VPS="${UGC_SSH:-developer@80.190.75.149}"
REMOTE_DIR="${UGC_REMOTE_DIR:-/home/developer/projects/ugc-factory}"
BACKUP_DIR="/home/developer/backups/ugc-factory"

if [ "${1:-}" = "--list" ]; then
  printf '\033[1mBackups en el VPS (%s)\033[0m\n' "$BACKUP_DIR"
  ssh "$VPS" "ls -lh $BACKUP_DIR/*.dump 2>/dev/null || echo '  (todavía no hay ninguno)'"
  exit 0
fi

printf '\033[1m▶ Forzando backup en el VPS…\033[0m\n'
ssh "$VPS" "$REMOTE_DIR/scripts/vps-backup-db.sh"

printf '\n\033[1m▶ Verificando que el último dump es restaurable\033[0m\n'
# pg_restore --list corre DENTRO del contenedor de postgres (el host no tiene las
# herramientas de Postgres instaladas, y no hace falta que las tenga).
ssh "$VPS" bash -euo pipefail <<REMOTE
  latest=\$(ls -t $BACKUP_DIR/*.dump | head -1)
  echo "  dump: \$latest (\$(du -h "\$latest" | cut -f1))"
  tables=\$(docker compose -f $REMOTE_DIR/docker-compose.prod.yml exec -T postgres \
             pg_restore --list < "\$latest" 2>/dev/null | grep -c 'TABLE DATA' || true)
  if [ "\${tables:-0}" -gt 0 ]; then
    printf '  \033[32m✓ pg_restore lo lee sin error — %s tablas con datos\033[0m\n' "\$tables"
  else
    printf '  \033[31m✗ pg_restore NO pudo leer el dump (corrupto o vacío)\033[0m\n'
    exit 1
  fi
REMOTE
