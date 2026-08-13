# Verificación T5c.1 — Aprobar CP3 debe NAVEGAR al run de generación (hoy descarta el `nextRunId`)

- **Tarea**: T5c.1 · Aprobar CP3 debe NAVEGAR al run de generación (`planning.md`)
- **Fecha**: 2026-08-13
- **Ejecutor**: verifier (contexto fresco) · sin agent-browser (verificación por unit jsdom + phase-e2e Playwright contra fake fal) · sesión N/A
- **Sistema**: working tree sobre commit `e182a38` (rama `feat/t5b1b-i-n6-per-scene`) — el fix vive en el working tree (uncommitted); phase-e2e con webServer Playwright + Colima + fake fal (`127.0.0.1/fal-cdn`), seeds del propio spec

## Verificación esperada (literal de planning.md)
> aprobar CP3 en un tier que genera → el navegador aterriza en `/runs/<run-generación>` mostrando N6→N7. Coherencia (corregida 2026-08-13, regla 6): el patrón es **navegar al aprobar CUANDO la aprobación arranca un run**. CP2-approve navega (arranca N5) y CP3-approve navega (arranca la generación, tier-ready); CP4-**approve** NO navega y es correcto (no arranca run — su `router.push` está en el path de **regenerar**, no en el de aprobar). El enunciado original «los tres paneles navegan igual al aprobar» era falso: lo confirmó el inventario de T5c.1 (`qa-panel.tsx:272` approve descarta la respuesta; el push es `qa-panel.tsx:294-296`, path regenerate). Test e2e/unit del panel que fije que se consume `nextRunId`.

## Camino de verificación ($0 — regla 5 / memoria techo-gasto-fal-hard)
Un lote premium real cuesta $6-7,4 de fal; la tarea es $0. El camino de $0 prueba la navegación REAL:
- **Unit del panel** (`scripts-panel.test.tsx`, 2 tests T5c.1): fija consumo de `nextRunId` + `router.push` con `next/navigation` mockeado. jsdom, $0.
- **Phase-e2e** (`f4-generation.spec.ts:95`): tier premium contra el **fake de fal** (no fal real), aprueba CP3 en un navegador real y asserta vía `expect.poll` que la URL aterriza en `/runs/<generationRunId>` (run localizado por BD, `node_key='N6'`) mostrando el sub-DAG N6→N7.
No se lanzó ningún lote premium contra fal real. Coste real = **$0**.

## Pasos ejecutados
1. Higiene: `node scripts/check-orphan-workers.mjs --strict` → **sin workers vivos ✓** (25 contenedores postgres:16 huérfanos de runs previos reportados como rareza; no bloquean).
2. `git status` / `git diff --stat`: 6 ficheros, +132/-25; el fix (scripts-panel.tsx, api-client.ts docstrings, unit, e2e) + docs. El código bajo prueba es el del diff.
3. Diff leído íntegro: `scripts-panel.tsx` importa `useRouter`, captura `const { nextRunId } = await runActions.approve(...)` y `if (nextRunId !== undefined) router.push('/runs/${nextRunId}')`. `api-client.ts` solo docstrings (schema `ApproveResponseSchema` intacto).
4. Coherencia CP2/CP3/CP4 leída en código: CP2 `matrix-panel.tsx:291-293` approve→push; CP3 `scripts-panel.tsx:163-167` approve→push (guard `!== undefined`); CP4 `qa-panel.tsx:272` approve SIN push, el push es `qa-panel.tsx:296` dentro de `regenerate()`. **Coincide con el texto corregido.**
5. Unit: `pnpm exec vitest run scripts-panel.test.tsx` → **10 passed** (incluye los 2 T5c.1). Salida en `unit-scripts-panel.txt`.
6. Control negativo: reversión manual del `router.push` (guard) → **1 test RED** (`push` nunca llamado); restaurado exacto y re-verde. Salida en `control-negativo-unit.txt`.
7. Phase-e2e: `playwright test e2e/phases/f4-generation.spec.ts` (TESTCONTAINERS_RYUK_DISABLED=true, sin DOCKER_HOST) → **2 passed** (setup + f4:95, 44.6s). Salida en `phase-e2e-f4-generation.txt`. Confirmado **0 hits a endpoint fal real** (todo a `127.0.0.1/fal-cdn`).

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Aprobar CP3 en tier que genera navega a `/runs/<run-generación>` en un navegador real | `expect.poll` sobre `page.url()` == `/runs/<generationRunId>` (run localizado por BD `node_key='N6'`) pasa; la URL aterriza en el run de generación | phase-e2e-f4-generation.txt (test :95 passed) | ✅ |
| 2 | El run de generación muestra el sub-DAG N6→N7 | El spec asserta los nodeKeys N6 + N7a-e por variante contra BD tras aterrizar | phase-e2e-f4-generation.txt | ✅ |
| 3 | Unit fija consumo de `nextRunId` + navegación | `expect(push).toHaveBeenCalledWith('/runs/01J...GENRUN0')` pasa | unit-scripts-panel.txt | ✅ |
| 4 | Sin `nextRunId` (tier no listo, T5c.2) NO navega | `expect(push).not.toHaveBeenCalled()` con approve sin nextRunId pasa | unit-scripts-panel.txt | ✅ |
| 5 | Coherencia: CP2 navega, CP3 navega, CP4-approve NO navega (push en regenerate) | Confirmado en código: matrix:291-293 push, scripts:163-167 push, qa:272 approve sin push / qa:296 push en regenerate | grep del código | ✅ |
| 6 | $0 (sin fal real) | 0 hits a endpoint fal real; todo a fake `127.0.0.1/fal-cdn` | phase-e2e-f4-generation.txt | ✅ |

## Control negativo
RED reproducido: revertido a mano el `if (nextRunId !== undefined) { router.push(...) }` de `scripts-panel.tsx` (sustituido por `void nextRunId`), el test unit T5c.1 falla con salida ROJA (FAIL, 1 failed): `expect(push).toHaveBeenCalledWith('/runs/01J000000000000000GENRUN0')` — `push` nunca se llamó.

```
FAIL  src/components/checkpoints/scripts-panel.test.tsx > ScriptsPanel (CP3) > T5c.1: aprobar en un tier que GENERA navega al run de generación (nextRunId)
 ❯ src/components/checkpoints/scripts-panel.test.tsx:311:20
    expect(push).toHaveBeenCalledWith('/runs/01J000000000000000GENRU…
 Test Files  1 failed (1)
      Tests  1 failed | 9 passed (10)
```

El test que fija la navegación MUERDE el comportamiento del fix. El otro test T5c.1 (NO navega sin `nextRunId`) sigue verde correctamente. Fichero restaurado exacto desde backup (`git diff HEAD --stat` idéntico al original) y unit re-verde (10 passed). Salida completa en `control-negativo-unit.txt`.

## Coste real
**$0** — sin APIs de pago. La phase-e2e corre contra el fake de fal (`127.0.0.1:.../fal-cdn`): los `costCents:80` que emite el worker son la contabilidad SIMULADA del fake, no gasto real; 0 hits a un endpoint fal real. Estimado del planning: $0. Sin desviación.

## Veredicto
**PASS** — el fix consume `nextRunId` y navega al run de generación (N6→N7) al aprobar CP3 en un tier que genera, y NO navega sin él; probado por unit (con control negativo rojo) y por phase-e2e que observa el aterrizaje REAL de la URL en un navegador contra fake fal. La coherencia CP2/CP3/CP4 del texto corregido coincide con el código real.

Notas (rarezas, PASS igual):
- El implementer editó `planning.md` (1 línea: la Verificación corregida bajo regla 6). Normalmente el implementer no toca planning.md; aquí es la corrección de coherencia descrita en el brief, no un laundering del checkbox. Se documenta; el CLOSE del bucle es quien marca `[x]`.
- 25 contenedores postgres:16 huérfanos de Testcontainers vivos bajo Colima (Ryuk off). No bloquean la verificación; el guard `check-orphan-workers` los reporta con limpieza opt-in (`--clean-containers`). Recomendable limpiar antes del próximo gate completo para no saturar recursos.
- `docs/recap/` sin trackear en el árbol (ajeno a esta tarea).
