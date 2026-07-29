# Cómo reproducir la verificación de T5.19

Entorno: Colima. Prefijar `DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" TESTCONTAINERS_RYUK_DISABLED=true`.

## Parte A (seed-de-cero + gate + control negativo)
1. Postgres up: `docker compose -f docker-compose.dev.yml up -d`
2. Crear scratch DB de cero: `psql -U ugc -d postgres -c "CREATE DATABASE ugc_t519;"`
3. Migrar + sembrar de cero:
   `DATABASE_URL=postgres://ugc:ugc@localhost:55432/ugc_t519 ASSETS_DIR=/tmp/ugc-t519-assets pnpm db:migrate`
   `DATABASE_URL=... ASSETS_DIR=... pnpm seed`
4. Medir entropía de los bytes sembrados de Maya (función de producción):
   `cd packages/db && SCRATCH_ASSETS=/tmp/ugc-t519-assets pnpm exec tsx <partA/entropy-probe.ts>`
5. Gate en su sitio:
   `pnpm --filter @ugc/core exec vitest run reference-fixtures --reporter=verbose`
   `pnpm --filter @ugc/db exec vitest run --config vitest.config.integration.ts persona-seed --reporter=verbose`
6. Control negativo: sobrescribir los 3 fixtures con `makeSyntheticReferenceImage(seed, 2752)` (longEdge 2752 para
   que solo falle el floor de entropía, no el assert ≥2K), correr ambos tests (ROJO), restaurar byte-exact
   desde backup, re-correr (VERDE). Shasums antes/después deben coincidir con los originales.

## Parte B (clip N7c real)
1. Bootear web-only contra el scratch DB (siembra model_profiles + secrets + Maya con fotos):
   `DATABASE_URL=postgres://ugc:ugc@localhost:55432/ugc_t519 ASSETS_DIR=/tmp/ugc-t519-assets pnpm --filter @ugc/web dev`
2. `n7c-gen.ts` (mover a packages/services para resolver deps): N7b TTS corto (~3s) → gate coste (dur×16c<100c) → N7c OmniHuman.
3. Si 422 file_download_error: probar `n7c-sizetest.ts` (recomprime la ref a <1MB manteniendo longEdge≥2048).
