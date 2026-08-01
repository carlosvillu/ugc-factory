# T5b.1 — Verificación (verifier, contexto fresco)

- **Fecha**: 2026-08-01
- **SHA base verificado**: `2bedfe5dcc99d2bb1a035cd483eeac5af84be56e`
- **Tipo de tarea**: comment-only + prosa de planning + README regenerado. **Coste real: $0** (sin fal, sin generación real; verificación de CONTRATO/documentación).
- **Veredicto**: **PASS**

## Verificación LITERAL (copiada de planning.md:1025)

> Los comentarios de `generation-dag.ts` y `compile-prompt.ts` describen fielmente el consumo real de N6 (auditoría de canvas, no money-path); cada N7 `NO APLICA` tiene su razón anotada; el planning de T5b.1b recoge la decisión de mapeo. Control: un grep de `findDepBySchema.*N6` sigue devolviendo vacío (no se ha cableado nada aquí — eso es T5b.1b) y ningún comentario afirma lo contrario.

## Resultado por punto

| # | Esperado | Observado | OK |
|---|----------|-----------|----|
| 1 | Comentarios de `generation-dag.ts` (N6) y `compile-prompt.ts` describen el consumo REAL de N6: solo UI de auditoría de canvas (T4.11), no money-path; sin afirmar cableado inexistente | `generation-dag.ts:148-154` dice «hoy NINGÚN N7 lee el resolvedPrompt de N6 … alimenta SOLO la UI de auditoría del canvas (T4.11: run-canvas/step-assets.ts)»; `compile-prompt.ts:7-12` dice «QUIÉN LO CONSUME HOY: SOLO la UI de auditoría del canvas … NINGÚN N7 lo lee de sus deps». Cruzado contra realidad: el único lector de N6.resolvedPrompt es `apps/web/src/components/run-canvas/step-assets.ts:76` (`canon === 'N6' ? resolvedPromptOf(output)`), + preview panels | ✅ |
| 2 | Cada N7 `NO APLICA` con su razón anotada (tabla centralizada en `n7Node`) | `generation-dag.ts:167-174` lista los 6: N7a packshot→`buildPackshotPrompt(brief)` NO APLICA; N7b voz→`scene.narration` YA CORRECTO; N7c avatar→`cfg.prompt`→'.' NO APLICA; N7e música→`cfg.mood` NO APLICA; N7d/N7f→`DEFAULT_BROLL_PROMPT` ADAPTABLE (deuda T5b.1b) | ✅ |
| 3 | `planning.md` recoge una decisión de mapeo beat→escena TOMADA y justificada; el mecanismo `scene?` existe en código | `planning.md:1021-1023` DECISIÓN: solape temporal + N6 emite prompt por escena (opción a); descarta etiquetar beats con `segment`. Mecanismo verificado: `compile-prompt.ts:133-134` acepta `scene?` y filtra `template.beats.filter(b => b.tStart < scene.t + scene.seconds && b.tEnd > scene.t)` | ✅ |
| 4 | `grep findDepBySchema.*N6` en `.ts` de código = VACÍO | Empty (exit 1). Enumeración repo-wide de `N6OutputSchema`: solo definición (`step-outputs.ts:170`) + re-export (`contracts/index.ts:164`); ningún executor/servicio lo PARSEA para leer una dep | ✅ |
| 5 | `pnpm gate` verde (comment-only ⇒ igual de verde que antes, incl. e2e de fase) | `GATE_EXIT=0`. lint 0 errores (31 warnings pre-existentes), typecheck OK, format OK, knip hints, readme:status ✓, contrast OK, e2e:wired OK, test (unit+integration) OK, test:e2e:phases OK (f4-generation 4 passed 1.2m) | ✅ |

## Cruce contra el código real (item 1 y 2)

- **N6 lo consume SOLO el canvas** (item 1): repo-wide, el único lector de `N6.resolvedPrompt` es `run-canvas/step-assets.ts:76`, más los preview panels (`step-panel.tsx:180`, `step-asset-preview.tsx:72-82`) y las e2e de fase que inspeccionan el panel (`f4-generation.spec.ts`). El campo `resolvedPrompt` está SOBRECARGADO (cada nodo escribe SU propio prompt a `generation.resolved_prompt`), pero NINGUNO lo lee de N6.
- **N7a packshot** (NO APLICA): `apps/worker/src/executors/generation.ts:272` y `:379` → `buildPackshotPrompt(args.brief)` (símbolo en `packages/core/src/generation/packshot-prompt.ts:28`). Imagen de producto. Confirmado.
- **N7b voz** (YA CORRECTO): `apps/worker/src/executors/generate-voice.ts:7,134` → `narration: scene.narration` del `ad_script` REAL. Confirmado.
- **N7d/N7f b-roll/CTA** (ADAPTABLE/deuda): `packages/services/src/generate-broll.ts:222` → `input.prompt ?? DEFAULT_BROLL_PROMPT`; el servicio ya declara `prompt?` (`:92`); el executor nunca lo pasa (deuda T5b.1b). Confirmado.
- **Ninguna mentira residual sobre N6**: grep de «N7 consume N6» solo devuelve `cross-node-deps.ts:5`, enunciado DISTINTO y CIERTO (N7c←N7b audio, N7d←N7a keyframes — N7↔N7, no N6→N7).

## Verificación del mecanismo de mapeo (item 3)

`packages/core/src/gallery/compile-prompt.ts:120-135` — `compilePrompt` desestructura `scene` (L121) y filtra los beats por solape temporal (L133-134). La decisión (solape temporal, N6 emite por escena, forma (a)) está TOMADA y justificada en planning.md:1021-1023, con el descarte explícito de etiquetar beats con `segment`. `findDepBySchema` es símbolo real (`cross-node-deps.ts:34`) con llamadas genuinas para N7a/N7b/N7e — el control del item 4 NO es vacuo por typo.

## Integridad del alcance del implementer

- El diff de CÓDIGO es 100% comentarios: 71 líneas cambiadas (+/-) en `.ts`, CERO son no-comentario (verificado filtrando `//`, `*`, `/*`, `*/`, blanks).
- `planning.md`: el implementer añadió la prosa de la decisión de mapeo (legítimo para T5b.1). **La línea `- **Verificación**:` (L1025) NO fue modificada** (no aparece en el diff). **No se auto-marcó `[x]`** (exit 1). El único `-` en planning refina un paso de T5b.1b añadiendo especificidad, no ablanda nada.
- `git status` tras el gate: idéntico al diff de entrada (solo se añade `docs/verifications/T5b.1/`, propio del verifier).

## Control negativo

Ejecutado `grep -rn "findDepBySchema.*N6" --include="*.ts" .` sobre el código → **0 líneas, exit 1** (VACÍO). Un HIT aquí sería un cableado real de N6 en un executor — cableado no planificado — y el veredicto sería **FAIL**. La aparición del token `findDepBySchema.*N6` SOLO en `planning.md` (spec futura de T5b.1b) es legítima. **Vacuidad descartada**: `grep -rn "findDepBySchema" --include="*.ts" .` (sin el sufijo N6) SÍ devuelve hits reales (`cross-node-deps.ts:34,60,90`, `generation-dag.ts:234`, `step-outputs.ts:247`), luego el símbolo existe y el patrón matchearía un cableado real si lo hubiera — el vacío NO es un falso vacío por typo.

### A · Prueba de que el control discrimina de verdad
`findDepBySchema` es la primitiva de discriminación cross-node por schema (T0.8); N7a/N7b/N7e la usan para SUS deps N7. Si algún executor la usara sobre `N6OutputSchema`, el grep del control lo capturaría. Hoy no lo hace nadie.

### B · Consumidores reales de N6 (repo-wide)
`N6OutputSchema`: solo definido (`step-outputs.ts:170`) y re-exportado (`contracts/index.ts:164`), sin parser en executors/servicios. `N6.resolvedPrompt`: leído solo por canvas (`step-assets.ts:76` + preview panels) y por las e2e que inspeccionan el panel. Coherente con el comentario corregido.

## Coste real

**$0** — verificación de contrato/documentación. Sin llamadas a fal, sin generación de pago. El gate corrió con mocks (`fake-apis`, cache-hits, dedup-hits — coste 0).

## Rarezas

- `pnpm knip` emite 3 hints de configuración y lint 31 warnings — todos PRE-EXISTENTES y no bloqueantes (gate salió 0). No introducidos por este diff.
- El README aparece modificado por «drift pre-existente de la fila F5b»; `readme:status:check` pasa ✓, la tabla queda coherente con planning.md tras la regeneración. No es cambio de comportamiento.

## Evidencias

- `docs/verifications/T5b.1/report.md` (este fichero)
- `docs/verifications/T5b.1/gate-output.txt` (salida completa de `pnpm gate`, GATE_EXIT=0)
