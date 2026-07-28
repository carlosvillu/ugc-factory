#!/usr/bin/env bash
# T5.22 verifier — negative controls of the freshness guard against a REUSED manual stack.
# Precondition: a manual e2e-stack.ts is already listening on :3100 (mode:built .runtime.json).
# Each experiment touches/creates a tracked source NEWER than builtAt, runs ONE spec so
# Playwright reuses the stack (reuseExistingServer) and runs globalSetup, and captures the throw.
set -uo pipefail
cd "$(dirname "$0")/../../../apps/web" || exit 1
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
export TESTCONTAINERS_RYUK_DISABLED=true
EV="../../docs/verifications/T5.22"
ONESPEC="e2e/auth.spec.ts"   # tiny spec; the guard fires in globalSetup BEFORE any spec runs

run_guard() {
  local label="$1"
  echo "----- experiment: $label -----"
  pnpm exec playwright test "$ONESPEC" --project=chromium 2>&1 | tee "$EV/guard-$label.log" | \
    grep -E "frescura del build|CONGELADO|fuente más nueva|Error|passed|failed|Running" | head -20
  echo "(exit: ${PIPESTATUS[0]})"
}

echo "=== builtAt of current manual stack ==="
python3 -c "import json,datetime;d=json.load(open('e2e/.runtime.json'));print('mode',d.get('mode'),'builtAt',datetime.datetime.fromtimestamp(d['builtAt']/1000))"

echo "=== A: touch apps/worker/src/main.ts (spawned worker process, frozen under reuse) ==="
touch ../worker/src/main.ts
run_guard "worker-main"

echo "=== B: touch packages/test-utils/src/fake-apis.ts (in-process fake, frozen under reuse) ==="
touch ../../packages/test-utils/src/fake-apis.ts
run_guard "fake-apis"

echo "=== C: NEW untracked file in apps/worker/src (tests --others) ==="
NEWF="../worker/src/__t522_probe_untracked.ts"
echo "// t522 verifier probe — untracked new source" > "$NEWF"
run_guard "untracked-new"
rm -f "$NEWF"
echo "=== cleaned untracked probe ==="
