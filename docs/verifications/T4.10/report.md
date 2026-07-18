# Verificación T4.10 — Deduplicación de generación (RE-VERIFY tras fix del FAIL #1)

- **Tarea**: T4.10 · Deduplicación de generación (`planning.md`)
- **Fecha**: 2026-07-18
- **Ejecutor**: verifier (subagente) · 2º pase · fal REAL (flux-2, `square_hd`) · psql sobre BD dev + navegador en `/spend`
- **Sistema**: working tree del diff bajo verificación (git HEAD `79b89f5`) · gate VERDE (187 files, **1942 tests**, exit 0 — incluye el nuevo `generation-dedup.migration.test.ts`) · BD dev REAL `ugc-postgres-dev` (:55432), el MISMO volumen que dio `23505` en el 1er pase.

## Veredicto
**PASS** — El fix de la migración `0020` (backfill CTE que demota los perdedores de cada grupo de `content_hash` duplicado a `cancelled` ANTES del `CREATE UNIQUE INDEX`) hace que **`pnpm db:migrate` REAL aplique sin abortar sobre la BD dev poblada** — el comando exacto que fallaba en el 1er pase. Además el dedup muerde end-to-end con assets fal reales y el ahorro es visible en dólares en `/spend`.

## Los 3 puntos verificados

### (a) `pnpm db:migrate` REAL sobre la BD dev SUCIA — PASS
- **BEFORE** (BD dev, volumen reutilizado del 1er pase — verificado que conserva los duplicados, no throwaway limpia): 2 grupos de `content_hash` duplicados vivos-de-producción, **ambos all-`completed`** (ninguno en vuelo -> **sin nota de job fal huérfano**):
  - `01ec42a8…` (red apple / T4.1): `{01KXNFEBGC… (12:46), 01KXNHPHVT… (13:26)}` — cost_entry 1c c/u.
  - `83d55eec…` (b-roll / T4.8): `{01KXRN9GPR… (18:26), 01KXRNBN2Q… (18:27)}` — cost_entry 160c c/u.
  - Índice `generation_production_content_hash_key`: **AUSENTE** pre-migrate.
- **`pnpm db:migrate`** -> `migraciones aplicadas`, **sin `23505`**. Re-run = exit 0 (idempotente).
- **AFTER**:
  1. Índice `generation_production_content_hash_key` **existe**.
  2. Grupos duplicados vivos = **0 filas** (cada grupo quedó con exactamente 1 fila en scope).
  3. Winners = `completed` y son los `id` ASC correctos (`01KXNFEBGC…`, `01KXRN9GPR…`); losers = `cancelled` (`01KXNHPHVT…`, `01KXRNBN2Q…`).
  4. **cost_entry de los 2 losers SIGUEN existiendo** (1c y 160c) — demote es UPDATE, no DELETE.
  5. fal total intacto: **762c / 34 filas** antes y después -> el ledger de `/spend` no se corrompió.

### (b) Reúso con ASSET REAL (dedup muerde end-to-end) — PASS
Script propio del verifier (`verify-dedup-hd.ts`, `image_size: square_hd`, contra fal REAL) — 2 piezas únicas + 2 re-peticiones idénticas:
- pieceA/B (1er submit): `reused:false`, **cost=1c** c/u (square_hd factura >=1c), `completed`, assetId real.
- pieceA'/B' (misma prompt+model+inputs): **`reused:true`, `cost:0`, MISMA `generation.id` + MISMO `assetId`**.
- Assets REALES en disco: `01KXTE5V…png` (**1.373.507 B**) y `01KXTE60…png` (**689.563 B**) — no factory-clean.
- **BD**: exactamente **1 cost_entry(fal) por pieza única** (2 total para las 4 llamadas); **2 generaciones `completed`** con el NONCE (no 4); log `generation_dedup_hit` en cada reúso.

### (c) Ahorro en `/spend` por DÓLARES (no solo conteo) — PASS
- `square_hd` (1024²) hace que cada submit facture 1c (el 1er pase usó `square` 512² -> 0c, solo conteo).
- **Vista `/spend` real** (navegador, login con `AUTH_BOOTSTRAP_PASSWORD`, mono-usuario): fila **fal.ai = \$7.64** (= 764c), total \$9.65. Consola del navegador limpia (solo HMR/DevTools info). Screenshot: `41-spend-ui.png`.
- **Delta en dólares**: fal total 762c -> **764c** (+2c) por 2 piezas únicas + 2 reúsos. Los reúsos aportaron **\$0**. Si hubieran cobrado serían 4 submits -> 766c (\$7.66); la vista muestra \$7.64 -> **delta atribuible a los reúsos = 0**, exactamente lo que la cláusula pide.

## Resultado observado vs esperado

| # | Punto | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| a | migrate REAL | `pnpm db:migrate` aplica 0020 sobre BD dev poblada | `migraciones aplicadas`, sin 23505; idempotente | 20/21-*.txt | OK |
| a | índice | presente tras migrar | `generation_production_content_hash_key` existe | 21-migrate | OK |
| a | colapso | 1 fila por grupo, winner correcto | 0 dups; winners completed id-ASC; losers cancelled | 21-migrate | OK |
| a | ledger | cost_entry de losers sobrevive | 1c y 160c presentes; fal total 762c intacto | 21-migrate | OK |
| b | reúso | 2a idéntica reused:true cost:0 mismo gen+asset | ambas piezas; assets reales 1.37MB / 690KB | 30-reuse-hd | OK |
| b | cost_entry | 1 por pieza única, no por re-petición | 1 c/u (2 total), 2 gens completed (no 4) | 30-reuse-hd | OK |
| c | /spend \$ | delta dólares por reúsos = 0 | 762->764c (+2 por piezas únicas); fal.ai \$7.64 en UI | 41-spend-ui.png | OK |

## Coste real
**\$0.02** de fal (2 submits reales de flux-2 `square_hd` x 1c). Los 2 reúsos: \$0 (no submitearon). Estimado planning: ~\$5; cap \$15; acumulado F4 previo ~= \$7.69 -> ~= **\$7.71**.

## Statuses de los grupos duplicados de dev (nota de runbook)
Ambos grupos eran **all-`completed`** (filas viejas del smoke de T4.1 y T4.8), **ninguna en vuelo**. Por tanto la migración NO demotó ningún job fal en curso -> **no hay job huérfano que reconciliar**. (Si un futuro deploy de producción tuviera un grupo con una fila `submitted/in_queue/in_progress`, el backfill la demotaría a `cancelled` y quedaría un job fal potencialmente huérfano — intrínseco y documentado en el propio SQL; el sweeper de T4.3 lo maneja.)

## Rarezas (no bloqueantes)
- **`falOutputUrl` vacío en el resultado de reúso** (heredada del 1er pase, cosmética): el reúso devuelve `dedup.reused.asset.falUrl ?? ''` que es `''` (el `fal_url` de un asset de OUTPUT es null). El artefacto USABLE (PNG en `storage_key`) se comparte bien. No afecta al comportamiento verificado.
- **BD dev migrada de forma irreversible** (esperado): tras esta verificación, `01KXNHPHVT…` y `01KXRNBN2Q…` quedan `cancelled` — es el estado correcto post-T4.10.

## Ficheros de evidencia
- `10-gate.log` — gate VERDE 187/1942 con el fix.
- `20-before-devdb.txt` — snapshot BEFORE (grupos duplicados, ids, cost_entry, fal total).
- `21-migrate-devdb.txt` — **hallazgo primario del fix**: `pnpm db:migrate` REAL aplica sin 23505 + asserts AFTER.
- `30-reuse-hd.log` — corrida de reúso con fal real `square_hd` (todos los asserts OK).
- `41-spend-ui.png` — captura de `/spend` real mostrando fal.ai \$7.64.
- `verify-dedup-hd.ts` — script del verifier (2 piezas únicas + 2 reúsos, `square_hd`).
- (1er pase, conservados) `01-verify-run.log`, `02-counts.txt`, `03-migration-fail-devdb.txt`, `00-cost-entry-BEFORE.txt`, `verify-dedup.ts` — historia del FAIL #1.
