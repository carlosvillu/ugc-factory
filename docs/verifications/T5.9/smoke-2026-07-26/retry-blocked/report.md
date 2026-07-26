# RETRY N7d — STOP-AND-REPORT (retry inejecutable, $0 gastado)

> Objetivo del brief: re-disparar el clip N7d que 403'd en el smoke-test para desbloquear N8 → primer
> máster + C2PA. **Gasto autorizado: ~$1,20 de fal real, SOLO para ese re-disparo.**
> **Resultado: el re-disparo es estructuralmente imposible sobre el estado actual del run. $0 gastado.
> Ninguno de los 3 desenlaces del brief aplica: es la 4ª rama (stop-and-report), la que el brief
> reservó para "fila ausente / run inexistente".**

- **Sistema**: HEAD `95869b0` (rama `docs/f5-cost-reprojection`), árbol limpio. Stack DEV: `ugc-postgres-dev`
  :55432 (persistente, mismo run del smoke). Worker/web NO se llegaron a necesitar: el gate de existencia
  (PASO 0, $0, solo lectura de BD) ya cierra la decisión antes de cualquier gasto.
- **Ejecutor**: verifier, contexto fresco.
- **Coste real**: **$0**. No se ejecutó ningún `POST /api/steps/[id]/retry` porque la transición es ilegal
  (ver abajo); no se re-submitó ninguna generación. Autorización de $1,20 **intacta**.

## PASO 0 — Gate de existencia: el N7d NO está `failed`, está `cancelled`

El brief asumía que N7d seguía en `failed` (retry vivo). No es así. El smoke-test terminó cancelando el run
(`POST /api/runs/:id/cancel → {"ok":true,"cancelled":3}`, smoke-report §Higiene línea 136). Ese cancel barrió
los 3 steps no-terminales — N7d, N8 y N9 — a `cancelled`.

Query (widened, no solo `N7d%` — evidencia en `01-step_run-state.txt`):
    SELECT node_key, status, retry_count, error FROM step_run
    WHERE run_id = '01KYFG1CTF31HSV8EATF966VPR' ORDER BY node_key;

| node_key | status | retry_count |
|---|---|---|
| N6, N7a, N7b, N7c, N7e, N7f | succeeded | 0 |
| **N7d** | **cancelled** | 0 |
| **N8** (composición) | **cancelled** | 0 |
| **N9** | **cancelled** | 0 |

(La tabla `run` no existe con ese nombre en el schema; el estado del run se infiere de sus steps: todos
terminales ⇒ run terminal.)

## Por qué el retry es inejecutable (verificado en código, no supuesto)

`POST /api/steps/[id]/retry` → `retryStep` (core) → `applyTransition(stores, id, 'retry')` →
`nextStatus(from, 'retry')`. La tabla de transiciones (`transitions.ts:105-145`) declara el evento `retry`
**solo** como arista `failed → queued`. `cancelled` es **estado terminal sin aristas de salida** (comentario
explícito `transitions.ts:143-144`: "succeeded/rejected/skipped/**cancelled**/expired/superseded no vuelve a
moverse"). Por tanto:

- `nextStatus('cancelled','retry') = null` → `IllegalTransitionError` → la tx hace rollback (nada tocado) →
  el route lo mapea a **409 invalid_transition** (`retry/route.ts:11-12`).
- **No se encola job, no se re-submite a fal, $0.** Disparar el retry solo devolvería un 409; no habría
  diagnóstico nuevo ni gasto.

## Lo que el brief pidió comprobar, comprobado

- **Check de existencia (PASO 0)**: fila N7d presente pero en `cancelled`, no `failed` → **rama stop-and-report.**
- **Dedup a 0¢ del clip 1/2**: MOOT — ningún retry se dispara. (De haber path, la única recuperación real es
  re-disparar el run entero **re-pagando** los clips ya generados, como dice el propio smoke-report §Hallazgo B
  líneas 110-114 — no un retry granular a 120¢. El brief y el smoke-report se contradecían aquí; gana el
  smoke-report: el retry granular a 120¢ nunca fue posible sobre este run porque N7d ya no está `failed`.)
- **T5.17 `detail` en vivo**: el error jsonb de N7d NO tiene `detail`/`status` (solo `message`+`permanent`),
  porque este run falló en `62c1d85` (pre-T5.17). T5.17 está en el código de `95869b0`, pero su `detail` solo
  puede poblarse en un fallo NUEVO de fal (= re-submit = gasto). No es re-diagnosticable retroactivamente.

## Desenlace y decisión de gasto

- **Desenlace: ninguno de los 3 del brief** (los 3 presuponen que el retry se dispara). Es la 4ª rama que el
  brief reservó para "fila ausente / run inexistente": aquí la fila existe pero en un estado no-reintentable,
  que colapsa al mismo stop-and-report.
- **Único camino al máster**: re-disparar la variante/run entero. Coste medido de una variante premium
  completa = **~$3,96** (smoke-report), NO los ~$1,20 autorizados. Es una **decisión de gasto NUEVA** que
  requiere OK fresco del usuario. El brief lo prohíbe explícitamente (PASO 0, "NO regeneres la variante entera").
- **$1,20 autorizados: intactos. Coste real de esta verificación: $0.**

## Veredicto

**FAIL por inejecutable** (el re-disparo tal como el brief lo describe no puede ejecutarse sobre el estado
actual del run) — **sin gasto**. No es un fallo del retry ni del producto: es que el run ya fue cancelado
como higiene del smoke-test, y `cancelled` es terminal. El desbloqueo de N8 → primer máster queda pendiente
de una decisión de gasto nueva (~$3,96 de re-run), que el usuario debe autorizar.

## Evidencia
- `00-head.txt` — HEAD `95869b0` + rama, árbol limpio.
- `01-step_run-state.txt` — estado de los 9 step_run del run + jsonb completo del error de N7d.
- Este `report.md`.

## Addenda (verificación ampliada tras revisión)

- **`regenerate` NO es un atajo aquí.** `POST /api/steps/[id]/regenerate` (`regenerate/route.ts` +
  `regen-checkpoint.ts`) opera sobre el step **N9 en `waiting_approval`** de CP4, exige un `cta` nuevo y
  CLONA una variante YA COMPUESTA para re-componer con el CTA cambiado (dedup de los N7 no afectados). Aquí
  N9 está `cancelled` y N8 nunca compuso: no hay variante aprobada ni CTA que regenerar → el endpoint no
  aplica (y erraría sobre el N9 cancelado). No ofrece un path granular más barato que el re-run completo.
- **Barrido cross-run ($0, `02-failed-n7-sweep.txt`)**: **0 filas** con `status='failed'` en cualquier
  `N7%`, y **0 steps `failed` en toda la BD dev**. No existe NINGÚN N7d reintentable en ningún run (ni el
  run del global-403 previo). El stop-and-report es definitivo, no local a este run.
- **El ~$3,96 es un SUELO solo-fal, no un techo.** Es el coste fal medido de una variante premium; un re-run
  completo además re-ejecuta la generación de guiones (Anthropic) aguas arriba, que NO está en esa cifra.
- **El 409 invalid_transition es DERIVADO de la tabla de transiciones (`transitions.ts`), no observado en
  vivo**: `TRANSITIONS` no tiene clave `cancelled:` en absoluto, así que `nextStatus('cancelled','retry')`
  es `null` por construcción. No se arrancó web+worker para observar el 409 porque no cambia el veredicto ni
  el gasto ($0).
- **ESTO NO ES UNA VERIFICACIÓN DE T5.9.** T5.9 sigue SIN marcar y SIN FAIL: este encargo era el re-disparo
  puntual de N7d, no la cláusula de T5.9. El "FAIL por inejecutable" se refiere al ENCARGO de retry, no a la
  tarea T5.9.
