#!/usr/bin/env bash
# Helpers de verificación T0.8 (verifier — NO es código del implementer).
set -euo pipefail
BASE=http://localhost:3000
PROJ=01JXVERIF0PROJECT00000T08A
EV="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
COOKIE=$(cat "$EV/.cookie")

PSQL() { docker exec -i ugc-postgres-dev psql -U ugc -d ugc "$@"; }

# api_post <path> <json-body>  -> stdout = response body
api_post() {
  curl -s -H "cookie: $COOKIE" -H 'content-type: application/json' -X POST "$BASE$1" -d "${2:-}"
}

# steps_by_state <runId> : imprime status|count ordenado
steps_by_state() {
  PSQL -tAc "SELECT status, count(*) FROM step_run WHERE run_id='$1' GROUP BY status ORDER BY status;"
}

# step_table <runId> : node_key | status | id | supersedes_id
step_table() {
  PSQL -c "SELECT node_key, status, id, supersedes_id FROM step_run WHERE run_id='$1' ORDER BY node_key, id;"
}

# step_id <runId> <nodeKey> [status] : id del step (opcionalmente filtrado por status)
step_id() {
  local extra=""
  [ -n "${3:-}" ] && extra=" AND status='$3'"
  PSQL -tAc "SELECT id FROM step_run WHERE run_id='$1' AND node_key='$2'$extra ORDER BY id LIMIT 1;"
}

# wait_step <runId> <nodeKey> <status> <timeoutSec>
wait_step() {
  local rid="$1" nk="$2" want="$3" to="${4:-30}"
  for i in $(seq 1 "$to"); do
    got=$(PSQL -tAc "SELECT status FROM step_run WHERE run_id='$rid' AND node_key='$nk' ORDER BY id DESC LIMIT 1;")
    if [ "$got" = "$want" ]; then echo "OK $nk=$want (${i}s)"; return 0; fi
    sleep 1
  done
  echo "TIMEOUT: $nk esperaba '$want', quedó en '$got' tras ${to}s"; return 1
}

# step_id_status <runId> <nodeKey> : status del step más reciente de ese node_key
step_id_status() {
  PSQL -tAc "SELECT status FROM step_run WHERE run_id='$1' AND node_key='$2' ORDER BY id DESC LIMIT 1;"
}

# nonterminal_count <runId> : cuántos steps en estados NO terminales
nonterminal_count() {
  PSQL -tAc "SELECT count(*) FROM step_run WHERE run_id='$1' AND status IN ('awaiting_deps','pending','queued','submitting','running','waiting_approval');"
}
