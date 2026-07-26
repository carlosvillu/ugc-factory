# T5.18 — VERIFICACIÓN: PASS

> **Cancelar un lote a medias no debe atrapar los assets pagados.** Verificación LITERAL de
> planning.md T5.18:
> *«tras un fallo parcial + cancel, un usuario puede llegar a un MÁSTER COMPUESTO SIN re-pagar
> los assets ya generados (o el producto le AVISA…). Ningún camino deja assets pagados
> irrecuperables en silencio.»*

- **Diff bajo prueba** (sin commitear en el working tree; por delante los commits de T5.19 docs):
  `packages/core/src/orchestrator/checkpoint-ops.ts` (helper `idsToPreserveOnCancel` + `cancelRun`)
  y `packages/db/test/integration/checkpoint.test.ts`. HEAD = `cb5959b`.
  sha del fichero con-fix: `6c2ab285739fe0d8a0da160187480c8e1fed6cb023187f8776aac58a4eb12e78`.
- **Fix (opción a, decisión del usuario)**: `cancelRun` NO barre a `cancelled` el step `failed`
  recuperable NI su cierre transitivo aguas abajo (la cadena hacia el máster N8→N9). Sobreviven
  (failed / awaiting_deps) para que un retry granular del `failed` desemboque en el máster.
- **Ejecutor**: verifier, contexto fresco. Runtime **$0** (fake-fal, NUNCA fal real).
- **Superficie**: camino REAL, sistema entero vivo (Postgres testcontainer + web:3100 + worker +
  orquestador + pg-boss + SSE + ffmpeg real), fal FAKE. Se conduce por HTTP (routes reales de
  approve/cancel/retry) y se asevera sobre la BD del stack y sobre el **fichero del máster en disco**.
  NO se cierra sobre el vitest (que simula la ejecución con `transition('succeed')`).

## Gate previo

`pnpm gate` (con `DOCKER_HOST` al socket colima + `TESTCONTAINERS_RYUK_DISABLED=true`) **VERDE**
con el diff aplicado: **237 test files / 2494 tests passed** (vitest) + **4 e2e phase tests passed**
(`test:e2e:phases`). Log en `scratchpad/gate3.log`. (Entorno: Docker corre por **colima**, no Docker
Desktop; sin el socket correcto testcontainers falla con «no working container runtime», y sin
Ryuk-disabled el reaper falla al montar el socket colima — ambos son problemas de entorno, no de código.)

## Cómo se reprodujo la forma del smoke-test a $0

El fake de fal DOOMEA el **primer submit de IMAGEN del proceso** (fallo determinista por corrida,
`fake-apis.ts` `doomedRequestId`). En un run de generación aislado ese submit es el de **N7a**
(keyframes) → N7a queda `failed` mientras sus hermanos generan y «pagan». El fix es **node-agnóstico**
(preserva CUALQUIER `failed` + su downstream), así que `N7a failed` ejercita EXACTAMENTE el mismo
código que el `N7d failed` del smoke real. El spec corre AISLADO (config propia bajo
`docs/verifications/T5.18/`, un stack fresco → el doom cae en NUESTRO N7a). Routes reales por HTTP,
NUNCA atajos por API en el paso verificado.

## Secuencia conducida y resultado por punto

| Paso | Esperado | Observado | OK |
|---|---|---|---|
| Fallo parcial | N7a `failed`; N7b/N7c/N7e `succeeded` (pagados); N7d/N7f/N8/N9 `awaiting_deps` | idéntico (`01-states-after-partial-failure.txt`) | OK |
| cost_entry en fake mode | >=1 fila (si no, (B) inrespondible) | 80c total (N7c 80c + N7b/N7e 0c); Snapshot #1 | OK |
| **CANCEL** (route real) | preserva failed + downstream; para lo vivo | `{"ok":true,"cancelled":0}` — no había step vivo; TODO preservado | OK |
| Estados tras cancel | N7a sigue `failed`; N7d/N7f/N8/N9 siguen `awaiting_deps` (NO cancelled); 0 vivos | idéntico (`04-states-after-cancel.txt`) | OK |
| cancel no factura | Snapshot #2 == #1 | 80c == 80c | OK |
| **RETRY** N7a (route real, body vacío) | **200** (no 409) | `HTTP 200: {"ok":true}` (`06-retry-response.txt`) | OK |
| Cadena hasta el máster | N7a re-genera; N7d/N7f generan; **N8 `succeeded`** | todos `succeeded`; N9 `waiting_approval` (CP4) (`07-...`) | OK |
| **(A) Máster COMPUESTO en disco** | fichero .mp4 real | `masters/…/master.mp4` — h264 1080x1920 (9:16), 5.4s, 30fps, 162 frames, +aac (`11-master-ffprobe.txt`) | OK |
| **(B) SIN re-pagar** | los hermanos succeeded NO re-facturan | ver abajo | OK |

### (A) — el máster se COMPUSO (no solo «alcanzable»)

`ad_variant.master_asset_id = 01KYG3WX9DZZEYHNH5VYXS5736` → `asset.storage_key =
masters/01KYG3WK3T5NCXYQDJ06RC1EM4/master.mp4` → **fichero real en disco** (138 631 bytes, copiado a la
evidencia como `master.mp4`). `ffprobe`: **h264 1080x1920 (SAR 1:1, DAR 9:16), 5.4 s, 30 fps, 162
frames, + stream aac**. Máster COMPUESTO por el pipeline ffmpeg real, alcanzado por cancel→retry→compose.
checksum `cc31d585…`.

### (B) — SIN re-pagar (la mitad que nadie había verificado)

Delta `cost_entry` entre **Snapshot #2** (tras cancel, 80c) y **Snapshot #3** (tras componer, 242c):

| Fila nueva | Concepto | Re-pago? |
|---|---|---|
| N7a fal 1c (gen …QV3) | keyframe shot 1 — **primera generación exitosa** (la doomed nunca facturó) | **NO** — nunca se había generado |
| N7a fal 1c (gen …QW9) | keyframe shot 2 — idem | **NO** |
| N7d fal 80c (gen …RB8) | b-roll — **primera** generación (estaba awaiting_deps, nunca corrió) | **NO** — trabajo nuevo |
| N7f fal 80c (gen …RAW) | CTA — **primera** generación (idem) | **NO** — trabajo nuevo |

**Lo que importa para (B)**: los hermanos ya `succeeded` y PAGADOS antes del retry — **N7c (80c),
N7b (0c), N7e (0c)** — NO generan ningún `cost_entry` nuevo: sus filas en #3 son **idénticas** a #2
(mismos `generation_id`). El retry factura SOLO trabajo que no existía. **Ningún asset ya pagado se
re-facturó.**

**Caveat honesto (alcance de (B) por esta forma)**: el fallo cayó en **N7a**, que antes del retry tenía
**1 sola** `generation` (la doomed, 0c) — no había una sub-generación YA completada+pagada DENTRO del
step fallido. Por tanto la re-facturación **intra-step** (el caso del smoke: N7d con clip 1/2 pagado +
clip 2/2 caído) **no se ejercita end-to-end aquí**. Esa mitad queda cubierta por (1) el **rastreo de
código**: la dedup de producción hace early-return con `costCents:0` ANTES de `recordCost`
(`generate-broll.ts` → `resolveProductionDedup`), y `content_hash = (resolvedPrompt, modelProfileId,
inputs)` es estable entre retries porque `uploadInputCached` devuelve el `fal_url` persistido sin TTL —
un retry PLANO (sin patch de config) reusa a 0c via `generation_dedup_hit`; y (2) el vitest de
integración de T5.18. Lo que SÍ se demostró end-to-end y es la médula de la Verificación —**los assets
ya pagados NO se re-facturan al recuperar el máster**— está probado con evidencia de BD.

## Control negativo

_Reproducido por el verifier, no confiando en el informe del implementer._

Con el **fix DESACTIVADO** (`cancelRun` revertido al barrido pre-fix sobre TODO no-terminal; edición
aislada en el working tree, restaurada byte-idéntica después), re-conducido el mismo journey hasta el
cancel:

- `cancel → {"ok":true,"cancelled":5}` → **N7a/N7d/N7f/N8/N9 → `cancelled`** (`NEG-01-states-after-cancel.txt`):
  camino al máster ROTO.
- **`POST /api/steps/[N7a]/retry` → 409 invalid_transition** (`NEG-02-retry-response.txt`): `cancelled`
  es terminal sin arista de `retry`. Sin ruta a N8.

⇒ el control negativo se ve **ROJO** por el camino real: sin el fix, cancelar atrapa los assets pagados
exactamente como describe el Origen del bug. Fichero restaurado byte-idéntico (`shasum` = `6c2ab285…`).

## Coste real

**$0.** Todo el journey (primario + control negativo) corrió contra el fake-fal local; ninguna llamada
a fal real. Los `cost_entry` (80/162/242c) son contabilidad SIMULADA del fake con el pricing real de los
`model_profile` sembrados — **no es gasto**. (Estimado del planning: $0.)

## Rarezas / notas

- El `cancelled:0` del cancel PRIMARIO es correcto: al alcanzar la forma del fallo parcial el run ya
  estaba quiescente (N7a failed, hermanos succeeded, downstream awaiting_deps) → no había NINGÚN step
  vivo que barrer. La rama «SÍ cancela el step vivo» del invariante «run detenido» NO se ejercita en
  este e2e; esa mitad la cubre el vitest de integración (un `queued` de otra rama → `cancelled`).
- La forma del fallo cayó en **N7a** (no N7d como el smoke) porque el doom apunta al primer submit de
  IMAGEN. El fix es node-agnóstico → cobertura equivalente del camino al máster; lo único no cubierto
  end-to-end es la re-facturación intra-step (ver caveat de (B)).

## Evidencia (toda en `docs/verifications/T5.18/`)

- Estados: `01-states-after-partial-failure.txt`, `04-states-after-cancel.txt`, `07-states-after-compose.txt`
- Coste: `02-cost-snapshot-1-before-cancel.txt`, `05-cost-snapshot-2-after-cancel.txt`,
  `09-cost-snapshot-3-after-compose.txt`, `02b-n7a-generation-count-before-retry.txt` (=1),
  `10-cost-delta-clause-B.txt`
- Cancel/retry: `03-cancel-response.txt`, `06-retry-response.txt` (200)
- Máster: `08-master-asset.txt`, `11-master-ffprobe.txt`, `master.mp4`
- Control negativo: `NEG-01-states-after-cancel.txt` (N8 cancelled), `NEG-02-retry-response.txt` (409)
- Runs/specs/configs: `run-1.log` (PASS), `run-neg.log`, `t518-cancel-retry-compose.spec.ts`,
  `t518-negative-control.spec.ts`, `playwright.t518.config.ts`, `playwright.neg.config.ts`
