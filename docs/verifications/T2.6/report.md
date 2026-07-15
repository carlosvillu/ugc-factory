# Verificación T2.6 — CP3: editor de guiones (+ puente N5→CP3) · E2E de cierre de fase F2

- **Tarea**: T2.6 · CP3: editor de guiones (+ puente N5→CP3) (`planning.md`)
- **Fecha**: 2026-07-15
- **Ejecutor**: subagente `verifier` · agent-browser 0.27.0 · sesión `t2.6`
- **Sistema**: working tree del diff T2.6 sobre commit `a18819b` (T2.5); docker compose dev (`ugc-postgres-dev` :55432) + `pnpm dev` en **PORT=3300** (el 3000 lo ocupa un contenedor ajeno `docker-api-1`; la app deriva su base URL del PORT, api-client §T1.13) + worker; secretos anthropic/fal/firecrawl reales en `app_setting`. Migración 0014 aplicada a la BD dev (columna `ad_script.origin_step_run_id` confirmada por `\d ad_script`).

## Verificación esperada (literal de planning.md)
> **Verificación (E2E de la fase)**: URL real → CP1 → CP2 (matriz 6 variantes) → CP3: editar el hook de una variante, aprobar todo → las 6 `ad_variant` quedan en estado **`scripted`** (valor literal en BD), con `ad_script` versionado (`edited_by_user` en la editada). Criterio O2: interacción total <5 min.
>
> **Playwright permanentes (DoD, regla 10)**: `apps/web/e2e/script-editor.spec.ts` (@f2 @checkpoint); `apps/web/e2e/phases/f2-scripts.spec.ts` (@f2 @phase).

## Prerequisitos ejecutados
- **`pnpm gate` verde** desde la raíz antes de tocar nada: 133 test files, **1483 tests passed**, exit 0.
- **Migración 0014 aplicada a la BD dev real** (`pnpm db:migrate` contra :55432). `\d ad_script` confirma `origin_step_run_id text` + índice parcial.

## Pasos ejecutados (journey LIVE, gasta dinero)
1. Login → dashboard. OK.
2. `/analyses/new`, URL real `https://www.oatly.com`, click Analizar → run `01KXJX967NK9QSXBSXQ8T2884Q`. N1/N2/N3 LIVE. N3 pausa en `waiting_approval` con brief real coherente de Oatly. Sin reload (SSE). `02-cp1-brief.png`.
3. Aprobar CP1 → N4 compone matriz → CP2 pausa: "MATRIZ PLANIFICADA · 6 VARIANTES", coste `$0.48–$2.73`, tabla con **6 filas**. `03-cp2-matrix.png`.
4. Confirmar CP2 → **la app NAVEGA a un run NUEVO** `01KXJXM1W5XH4KAC5T3T2M7JFM` (puente `nextRunId`), batch `01KXJXM1VFQQD6N80RW0NQ696C` + 6 variantes, N5 arranca (Sonnet LIVE) y pausa en CP3.
5. CP3 cargó **6 tarjetas de guion** con narración editable. `04-cp3-scripts.png`.
6. Editar el hook de UNA variante (hook01): narración escena 1 → benigna, 3ª persona, sin gatillos del linter. `05-...png`.
7. "Aprobar todas las aptas" → `6 / 6 aprobadas`. `06-...png`. → "Confirmar guiones".
8. N5 → `succeeded` por SSE (sin reload). `07-n5-succeeded.png`.

## Resultado observado vs esperado
| # | Cláusula | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| 1 | Journey + puente | URL real → CP1 → CP2 (6) → navega a run N5 → CP3 | Flujo LIVE completo con Oatly; navegación a run nuevo confirmada | 02–07 png | ✅ |
| 2a | 6 variantes `scripted` (literal BD) | 6 `ad_variant.status='scripted'` | Las 6, por SELECT directo | `db-variants-scripted.txt` | ✅ |
| 2b | `ad_script` versionado, `edited_by_user` en la editada | editada v1(f)+v2(t); resto v1 solo, sin v2 espuria | Exactamente eso; v2 con hook derivado de la narración editada (rebuild server-side) | `db-script-versions.txt` | ✅ |
| 3 | Bloqueo SERVER-SIDE real | POST directo `approved:true` sobre variante con flag `blocking` NO transiciona | POST autorizado con los 6 `approved:true` → 200 `ok:true`, pero la bloqueada quedó `planned` y las 5 limpias `scripted` | `clause3-*`, `db-clause3-serverguard.txt` | ✅ |
| 4 | O2 interacción <5 min | interacción (no espera generación) <5 min | ≤165 s, techo (incl. overhead verifier) | timings BD | ✅ |
| 5 | 2 specs con tags, pasan | ambos existen, tagueados, verdes | 11/11 @f2 passed (`f2-scripts` @f2 @phase, `script-editor` @f2 @checkpoint), 0 retry | `e2e-f2.txt` | ✅ |

### Cláusula 3 — bloqueo server-side (prueba fuerte)
Segunda corrida LIVE hasta un CP3 fresco (`01KXJYAD6RSX1HBQWNTEZ81X9M`, batch `01KXJYAD6A2Q9WES07VBBMW0RB`). Flag `banned_claim` `blocking:true` inyectado en el guion v1 de una variante (SQL, preparación de escenario). **POST directo autorizado** (cookie `ugc_session`) a `/api/steps/01KXJYAD6QEYT7MG9XS5DPQ2DX/approve` con `decision.kind='scripts'` y **los 6 veredictos `approved:true`**. Resultado: `ok:true` 200, y en BD la variante con flag quedó **`planned`** mientras las 5 limpias pasaron a `scripted`. El servidor deriva los flags y decide por-variante; el guard vive en el servidor, no en el botón.

### O2 — interacción
Wall-clock journey 1 = 988 s. Espera de generación (step_run): N1 22,8 + N2 24,3 + N3 265,1 + N4 43,5 + N5 466,8 = 822,5 s. No-generación = 165,5 s ≈ 2m45s, **techo** (incluye overhead de verifier entre clicks). Interacción real < 165 s < 5 min. Cumplido.

## Consola del navegador
Limpia: solo ruido dev-only benigno (React DevTools, HMR, Fast Refresh). Sin error/warn de código propio.

## Contraste (aserción obligatoria, superficie nueva scripts-panel)
- **`Alert tone="danger"`** (flag bloqueante, `bg-danger-soft` = `rgba(239,68,68,0.1)` + `text-text`): **DARK 16,0:1**, **LIGHT 13,58:1** → PASS holgado (verificado también en el specimen del DS). `12-ds-alert-danger.png`.
- `approve-blocked` 4,89/6,32 PASS; botones 14,58/6,54 (dark) 15,3/6,1 (light) PASS.
- `approved-count` (token global DS `text-text-3`): DARK **3,81:1** (bajo 4,5), LIGHT 4,83 PASS. Detalle en `contrast-measurements.txt`.

## Coste real
**$0,64** (Anthropic, 6 llamadas de DOS corridas; Firecrawl $0,00), aislado por SELECT sobre `cost_entry` de mis 4 runs (`db-cost-mine.txt`). Estimado $0,50; bajo el cap $1,50. El exceso leve es por correr el journey dos veces (limpio + cláusula 3). `/spend` muestra el acumulado ($1,70, incluye días previos).

## Veredicto
**PASS** — El E2E de fase F2 funciona sobre el sistema real: URL real → CP1 → CP2 (6) → puente N5→CP3 → editar hook → aprobar todo → **6 `ad_variant` en `scripted`** con `ad_script` versionado (`edited_by_user=true` en la editada, v1 en las otras sin v2 espuria). Bloqueo **server-side** real y por-variante. Los 2 specs existen, tagueados, verdes (0 retry). O2 cumplido. Consola limpia. Coste $0,64 < cap $1,50.

**Rarezas (no bloquean)**:
1. `text-text-3` en dark = 3,81:1 (bajo AA) en el contador "6/6 aprobadas". Token GLOBAL del DS (108 usos), NO introducido por T2.6. Se **rutea al DS** como observación; no es defecto de T2.6.
2. Medición inicial mía dio el `Alert danger` como fallo (3,42/2,8); fue artefacto (trató `danger-soft rgba(...,0.1)` como opaco). Compositing correcto: 16/13,58 pasa.
3. Journey en :3300 (el :3000 lo tiene otro proyecto del usuario, no tocado). App consistente con su PORT por diseño (T1.13).
