#!/usr/bin/env bash
# Backup diario de la BD de producción (T0.13). Lo ejecuta el cron de `developer`
# en el VPS (y se puede forzar a mano; ver DEPLOY.md §Backups):
#   ~/projects/ugc-factory/scripts/vps-backup-db.sh
#
# - pg_dump en formato CUSTOM (-Fc): comprimido y legible por `pg_restore --list`.
# - Corre DENTRO del contenedor postgres vía `docker compose exec -T` — no hace
#   falta publicar el puerto de Postgres ni tener pg_dump en el host.
# - Dumps fechados (UTC) en ~/backups/ugc-factory/; retención 14 días.
# - Cron tiene PATH mínimo: se fija explícito.
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin

PROJECT_DIR="${PROJECT_DIR:-$HOME/projects/ugc-factory}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/ugc-factory}"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.prod.yml"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/ugc-$STAMP.dump"

mkdir -p "$BACKUP_DIR"

# Volcado a fichero temporal + mv atómico: un pg_dump interrumpido a medias no
# deja nunca un .dump truncado que la retención conservaría 14 días.
TMP="$OUT.part"
trap 'rm -f "$TMP"' EXIT

# Credenciales: las mismas del .env del proyecto, leídas por el propio contenedor
# (POSTGRES_USER/POSTGRES_DB están en su entorno; no se duplican aquí).
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$TMP"

# Sanidad mínima: un dump -Fc legible empieza por la firma PGDMP y no está vacío.
if [ ! -s "$TMP" ]; then
  echo "backup FAILED: dump vacío" >&2
  exit 1
fi
mv "$TMP" "$OUT"
trap - EXIT

# Retención: borra dumps (y logs .part huérfanos) de más de 14 días.
find "$BACKUP_DIR" -name 'ugc-*.dump' -type f -mtime +14 -delete
find "$BACKUP_DIR" -name 'ugc-*.dump.part' -type f -mtime +1 -delete

echo "backup OK: $OUT ($(du -h "$OUT" | cut -f1))"
