#!/usr/bin/env bash
# CONTROL NEGATIVO GENUINO del guard de contenedores pg (T5.25). Un guard que nadie ha visto MORDER no
# vale (principio 9 de la skill testing). Demuestra las DOS CARAS del discriminador:
#   (a) un contenedor CON `label=org.testcontainers=true` SÍ se cuenta (es el huérfano a limpiar);
#   (b) un contenedor postgres:16 SIN esa etiqueta (simula `ugc-postgres-dev`, la BD de desarrollo)
#       NO se cuenta ni se limpia — esa cara es la que prueba que el footgun está muerto.
# Prueba el DELTA en ambos sentidos —no un conteo absoluto, que ninguna máquina real garantiza (puede
# haber un stack de dev a propósito). Nunca toca contenedores que este script no arrancó.
#
# USO:  bash scripts/negctl-orphan-containers.sh [N]
#
# Docker aquí es COLIMA: si DOCKER_HOST no está exportado, cae al socket de Colima (igual que el guard).
set -euo pipefail

export DOCKER_HOST="${DOCKER_HOST:-unix://$HOME/.colima/default/docker.sock}"
N="${1:-2}"
DEV_LIKE="negctl-dev-like"

# Cuenta con EL MISMO filtro que el finder del guard (label=org.testcontainers=true + ancestor).
guard_count() {
  docker ps --filter label=org.testcontainers=true --filter ancestor=postgres:16 --format '{{.ID}}' | grep -c . || true
}

echo "── control negativo (delta + dos caras): guard de contenedores pg huérfanos ──"
echo "socket: $DOCKER_HOST"

CIDS=()
cleanup() {
  docker rm -f "$DEV_LIKE" >/dev/null 2>&1 || true
  if [ "${#CIDS[@]}" -gt 0 ]; then
    docker rm -f "${CIDS[@]}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

COUNT0="$(guard_count)"
echo "baseline (testcontainers postgres:16 ya vivos): $COUNT0"

# ── CARA (b): un postgres:16 SIN la etiqueta de testcontainers (simula ugc-postgres-dev). ──────────
echo ""
echo "── arrancando 1 contenedor postgres:16 SIN la etiqueta (dev-like) → el guard NO debe contarlo ──"
docker rm -f "$DEV_LIKE" >/dev/null 2>&1 || true
docker run -d --name "$DEV_LIKE" -e POSTGRES_PASSWORD=negctl-not-a-secret postgres:16 >/dev/null
AFTER_DEV="$(guard_count)"
if [ "$AFTER_DEV" -eq "$COUNT0" ]; then
  echo "✓ dev-like NO cuenta: guard sigue en $AFTER_DEV = baseline($COUNT0) — ugc-postgres-dev quedaría a salvo"
else
  echo "✗ dev-like SÍ contó (guard=$AFTER_DEV, esperaba $COUNT0) — FOOTGUN VIVO: el guard reiniciaría la BD dev"
  exit 1
fi

# ── CARA (a): N testcontainers CON la etiqueta → el guard SÍ los cuenta. ───────────────────────────
echo ""
echo "── arrancando $N contenedor(es) CON label=org.testcontainers=true → el guard DEBE verlos ──"
for _ in $(seq 1 "$N"); do
  CID="$(docker run -d --label org.testcontainers=true -e POSTGRES_PASSWORD=negctl-not-a-secret postgres:16)"
  CIDS+=("$CID")
done
AFTER_TC="$(guard_count)"
EXPECTED=$((COUNT0 + N))
if [ "$AFTER_TC" -eq "$EXPECTED" ]; then
  echo "✓ testcontainers SÍ cuentan: guard=$AFTER_TC = baseline($COUNT0) + $N — MUERDE al aparecer"
else
  echo "✗ guard=$AFTER_TC, esperaba $EXPECTED — no refleja los testcontainers nuevos"
  exit 1
fi

# ── delta al limpiar: rm -f de LOS QUE ARRANCAMOS → vuelve al baseline. ────────────────────────────
echo ""
echo "── rm -f de los $N testcontainers → el guard DEBE volver al baseline ──"
docker rm -f "${CIDS[@]}" >/dev/null
CIDS=()
AFTER_RM="$(guard_count)"
if [ "$AFTER_RM" -eq "$COUNT0" ]; then
  echo "✓ tras rm -f: guard vuelve a $AFTER_RM = baseline($COUNT0) — MUERDE al desaparecer"
else
  echo "✗ tras rm -f: guard=$AFTER_RM, esperaba baseline $COUNT0"
  exit 1
fi

echo ""
echo "CONTROL NEGATIVO COMPLETO: (a) testcontainers suben/bajan el conteo; (b) el dev-like sin etiqueta"
echo "NUNCA se cuenta → ugc-postgres-dev queda excluido del conteo y de --clean-containers."