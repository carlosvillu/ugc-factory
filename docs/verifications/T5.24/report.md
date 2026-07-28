# Verificación T5.24 — El inspector de nodo (`StepPanel`) no remonta al conmutar de nodo → estado rancio

- **Tarea**: T5.24 · El inspector de nodo (`StepPanel`) no remonta al conmutar de nodo → estado rancio y panel que no monta (`planning.md`)
- **Fecha**: 2026-07-28
- **Ejecutor**: verifier (contexto fresco) · agent-browser 0.27.x · sesión `t5.24`
- **Sistema**: fix WIP en el árbol (uncommitted; HEAD `f32aa7b` NO lo contiene) · `apps/web/e2e/.runtime.json` regenerado · stack e2e A MANO (`scripts/e2e-stack.ts`, testcontainers pg16 + web:3100 + worker + fake external APIs) reusado warm por Playwright · Colima (`DOCKER_HOST=unix://~/.colima/default/docker.sock`, `TESTCONTAINERS_RYUK_DISABLED=true`)
- **Fichero bajo prueba**: `apps/web/src/components/run-canvas/run-shell.tsx` shasum `037bf2f7b7f5d72b2e5fead9ff697ffdeb8920cd` (baseline == restaurado)

## Verificación esperada (literal de planning.md)
> En un run con ≥2 nodos inspeccionables, seleccionar un nodo muestra su panel; conmutar la selección a otro nodo intercambia el panel al del segundo, sin arrastrar estado del primero. Toca superficie renderizada ⇒ `ds-reviewer` (5c) y `pnpm test:e2e` aplican.

Y el DoD bloqueante (regla 10): spec permanente que selecciona un nodo (panel A visible), conmuta a OTRO y afirma que el panel muestra el segundo, no el primero ni un panel a medias. Control negativo: revertir el `key` → la conmutación deja de remontar (panel rancio / no monta), spec ROJO.

## Pasos ejecutados

### A. Spec permanente `apps/web/e2e/run-canvas-node-switch.spec.ts` (regla 10, DoD)
- Corrido **5x consecutivas** contra el MISMO stack warm reusado → **5/5 VERDE, determinista** (el bug original era ~1/5 flaky; el spec asserta el estado rancio, no la flakiness). Logs: `spec-green-run{1..5}.log`.
- El spec: lanza un run del DAG de demo por API (prep de escenario, permitido), navega a `/runs/:id`, espera N1→`waiting_approval` y N0→`succeeded` (gates de estado ESTABLES), abre el editor JSON de N1 con un sentinela, conmuta a N0 (no-checkpoint) y afirma `output-editor` `toBeHidden` + `<textbox>` `toHaveCount(0)` + no botón "Editar"; al volver a N1, editor cerrado.
- Lectura crítica del spec (material no confiable, leído): asserta ESTADO LOCAL de `StepPanel` (`output-editor` + su `<textbox>`), NO lecturas del store — solo un remonte los limpia. No asserta el texto del sentinela (vive en `value`, que `getByText` no ve): elección correcta, evita un assert vacuo.

### B. Verificación de PRODUCTO por mano (agent-browser, la cláusula literal)
La cláusula («seleccionar un nodo muestra su panel; conmutar intercambia el panel, sin arrastrar estado») es un observable de producto → se ejecutó como un humano, sin atajos en el paso verificado:
1. Login por UI (`/login`, password) → `/`.
2. Run demo creado por API (prep) → `/runs/01KYN95RK9NXS10EM7X7MCWACB`. Canvas estable: N0 `completado`, N1 `esperando aprobación` (ambos inspeccionables). — `01-run-canvas.png`
3. Click N1 → Inspector "Ingesta" `demo.canvas.N1`, con botones Aprobar/Editar/Rechazar (su panel). — `02-panel-N1.png`
4. Click "Editar" → editor JSON de N1 abierto; relleno sentinela `{"RANCIO_DE_N1":true}`. — `03-N1-editor-abierto-sentinel.png`
5. Click N0 → Inspector conmuta a "Intake" `demo.canvas.N0` `completado`: **solo "Output del paso" / "Sin output todavía." — SIN "Editar output", SIN textbox, SIN el sentinela**. El estado rancio de N1 NO se arrastró. — `04-panel-N0-limpio.png`, `snapshot-N0-selected.txt`
6. Vuelta a N1 → panel remonta limpio: editor CERRADO (solo Aprobar/Editar/Rechazar). — `05-back-to-N1-limpio.png`
7. Consola del navegador limpia (solo React DevTools info + HMR connect, dev-only third-party; sin errores propios). — `browser-console.txt`

### C. Regresión suite completa
- `pnpm exec playwright test` (suite E2E ENTERA, warm stack) → **89 passed, 0 failed**, incluye `run-canvas-node-switch.spec.ts:43` (test 57 verde), `f4-generation.spec.ts:95` (verde), `gallery` (sin fallos), f5-export, spend, etc. — `full-e2e.log`.
- Triage pre-declarado: un fallo diff-independiente aparece con Y sin el key y no toca canvas/`StepPanel`. Los flakes documentados (`gallery.spec.ts:44`, `f4-generation.spec.ts:199`, T5.21/T5.22/T5.23) **no dispararon** esta corrida — 0 fallos, nada que triar.
- `typecheck` (todos los paquetes) y `eslint` sobre los 2 ficheros cambiados: verde. `SelectedStepPanel` no dispara knip (usado en `:98`).

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Seleccionar un nodo muestra su panel | Click N1 → Inspector `demo.canvas.N1` con sus acciones | 02-panel-N1.png | OK |
| 2 | Conmutar intercambia el panel al del 2o | Click N0 → Inspector `demo.canvas.N0` completado | 04-panel-N0-limpio.png | OK |
| 3 | Sin arrastrar estado del primero | Editor JSON + sentinela de N1 NO aparecen en N0 (remonte limpio) | 04 + snapshot-N0-selected.txt | OK |
| 4 | Spec permanente verde y determinista | 5/5 verde warm + 1 post-restore | spec-green-run{1..5}.log | OK |
| 5 | `pnpm test:e2e` sin regresiones nuevas | 89 passed, 0 failed | full-e2e.log | OK |
| 6 | ds-reviewer (5c) | Diff sin markup/className/token (wrapper+key+comentarios) → sin superficie DS que revisar | git diff | OK |

## Control negativo
Revertido el fix (call site `<SelectedStepPanel />`→`<StepPanel />` y borrado el wrapper `SelectedStepPanel`, dejando el árbol compilable) → el spec permanente se pone **ROJO 2/2 corridas** con la causa correcta (estado rancio de N1 arrastrado a N0). Salida cruda (`spec-negctrl-run1.log`, idéntica en run2): `expect(locator).toBeHidden() failed` / `Expected: hidden` / `Received: visible` en `:78` — 1 failed.

```
  x  2 [chromium] › e2e/run-canvas-node-switch.spec.ts:43:3 › ... @f5 (17.9s)
    Error: expect(locator).toBeHidden() failed
    Expected: hidden
    Received: visible
      - Expect "toBeHidden" with timeout 15000ms
    > 78 |       await expect(n0Panel.locator('[data-slot="output-editor"]')).toBeHidden();
      79 |       await expect(n0Panel.getByRole('textbox', { name: /editar output/i })).toHaveCount(0);
        at .../e2e/run-canvas-node-switch.spec.ts:78:68
  1 failed
```

El ROJO es una ASERCIÓN en `:78` (`Expected: hidden / Received: visible`) — el editor JSON a medias de N1 sigue VISIBLE sobre el panel de N0 —, NO un error de compilación ni un timeout de `waitStatus`. Es exactamente el defecto de remonte que el `key` cura.

### Restauración byte-idéntica
Tras medir, el árbol se restauró al estado WIP original (aplicando `run-shell.diff.orig` guardado). shasum tras restaurar `037bf2f7b7f5d72b2e5fead9ff697ffdeb8920cd` == baseline (`run-shell.sha.orig`); índice git `edd344f..1945860` == original; `git diff` del fichero vacío; spec re-verde post-restore (`spec-green-postrestore.log`).

**Nota (error del verifier corregido)**: en el primer intento de restaurar usé `git checkout HEAD -- run-shell.tsx`, que reverte al COMMITTED — pero HEAD `f32aa7b` NO contiene el fix (es WIP uncommitted). Lo detecté por shasum != baseline, y restauré correctamente re-aplicando el diff guardado. El árbol quedó verificadamente byte-idéntico al estado de entrada.

## Coste real
$0 — sin generación, sin APIs de pago. El DAG de demo usa executors sleep_ms locales; las APIs externas del stack son fakes locales. (vs estimado $0.)

## Veredicto
**PASS** — la conmutación nodo→nodo intercambia el panel al del segundo sin arrastrar el estado local (editor JSON) del primero, verificado por mano (screenshots 02→04→05) y por el spec permanente (5/5 warm, determinista); el control negativo (revertir el `key`) pone el spec ROJO en `:78` con la causa correcta (estado rancio visible). `pnpm test:e2e` completo verde (89/0), typecheck+lint verde. Sin superficie DS que revisar (diff = wrapper + `key` + comentarios).

Notas / rarezas:
- Consola del navegador limpia salvo React DevTools info + HMR (dev-only, third-party) — no bloquea.
- El diff toca UN solo call site de `StepPanel` (`run-shell.tsx:98`); grep confirma que no hay otro punto de montaje → el fix cubre toda la superficie donde el bug existía.
- Deuda pre-existente ANOTADA en journal (fuera de alcance T5.24): si un step sale de `waiting_approval` por SSE con su editor abierto, `editing` sobrevive intra-step (el `id` no cambia → ningún `key` por-step lo arregla). No lo introduce T5.24; candidata a tarea propia.
