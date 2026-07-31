# Verificación T6.6 — Trending Sound Advisor

- **Tarea**: T6.6 · Trending Sound Advisor (`planning.md`, Verificación RE-SCOPEADA al catálogo fake tras el SPLIT 2026-07-31; la lectura VIVA se retiene en T6.6-live ⛔)
- **Fecha**: 2026-07-31
- **Ejecutor**: verifier (agente escéptico, contexto fresco) · agent-browser 0.27.x · sesión `t6.6`
- **Sistema**: base sha `79f8c7b` + T6.6 SIN COMMITEAR (árbol de trabajo). Ficheros del diff bajo prueba:
  - Modificados: `apps/web/scripts/e2e-stack.ts`, `apps/web/src/components/library/library-browser.tsx`, `apps/web/src/components/library/publishing-panel.tsx`, `apps/web/src/lib/api-client.ts`, `packages/db/src/index.ts`, `packages/db/src/repos/batch.repo.ts`, `packages/test-utils/src/fake-apis.ts` (+ `docs/dev-loop/journal.md`, `planning.md`, `*/package.json`).
  - Nuevos: `apps/web/e2e/sound-advisor.spec.ts`, `apps/web/src/app/api/variants/[id]/native-sound/route.ts`, `apps/web/src/components/library/sound-advisor.tsx`, `apps/web/test/integration/api/variant-native-sound.test.ts`, `packages/core/src/publishing/*`, `packages/test-utils/src/fixtures/creative-center.ts`.
  - Superficies levantadas: (a) stack e2e Playwright propio (Postgres testcontainer + web :3100 + fake HTTP con `CREATIVE_CENTER_BASE_URL`→fake que sirve el catálogo real-shape); (b) para el observable `sourceOk=false`: `next dev` en :3002 contra una BD fresca `ugc_t66` (migrada+sembrada al primer boot), con `CREATIVE_CENTER_BASE_URL=http://127.0.0.1:4444` (servidor 404 dedicado, «producción sin sesión de TikTok»).

## Verificación esperada (literal de planning.md, re-scopeada al catálogo fake)
> para una variante destino orgánico, el Advisor lista los sonidos del catálogo (fake in-test) con su flag comercial derivado del dato (`if_cml`); elegir uno no-CML marca `audio_source=native_trending` y el checklist bloquea Spark (coherencia con T6.2). Cuando la fuente no responde (producción sin T6.1), `sourceOk=false` se propaga y la UI avisa (no muestra una lista vacía indistinguible de un filtro sin resultados). La lectura de sonidos REALES vivos se verifica en T6.6-live.

## Pasos ejecutados
1. **Gate previo** (`pnpm gate` desde raíz) → verde: lint, typecheck, format:check, knip, readme:status:check, check:contrast, e2e:wired:check, `test` (248 files / 2627 tests), `test:e2e:phases` (4 passed). Evidencia: `gate.txt`.
2. **Orphan guard** (`check-orphan-workers.mjs --strict`) → limpié 1 orphan testcontainer ANTES del gate; 0 workers vivos.
3. **Unit+integration focalizados** (creative-center, mood, publishing, variant-native-sound) → 50/50 passed. Evidencia: `unit-integration.txt`.
4. **E2E permanente `sound-advisor.spec.ts`** contra el stack real + fake catalog → 6/6 passed (filtro comercial orgánico/both, mood chips, guía Business, SELECCIÓN→native_trending→Spark bloqueado en vivo, export headroom). Evidencia: `e2e-sound-advisor.txt`.
5. **Observable `sourceOk=false` (LO QUE EL E2E NO CUBRÍA)**: BD fresca `ugc_t66`, variante aprobada+compuesta ORGÁNICA sembrada (persona Maya, ULIDs válidos), CC apuntado a un 404. Login humano (agent-browser, password de bootstrap elegido por el verifier), `/library` → abrir variante → observar el Advisor. `01-sourceok-false-warning.png`, `02-advisor-panel-text.txt`, `browser-console-sourceok.txt`.
6. **Control negativo** (revertir la coherencia Spark en `packages/core/src/contracts/publishing.ts`, correr e2e SELECCIÓN → ROJO, restaurar, verificar árbol byte-idéntico). `negctrl-e2e-red.txt`.
7. **Contraste** del chip de mood activo (medido por token, ver Notas).

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Variante orgánica: Advisor lista sonidos con flag comercial derivado de `if_cml` (no booleano a mano) | Unit+integration cruzan `commercial === if_cml` para cada track del fixture; e2e orgánico muestra badge CML (success) Y no-CML (warning). Fixture lleva el campo crudo `if_cml`, `verified_against_live:false` (esperado, T6.6-live) | unit-integration.txt, e2e-sound-advisor.txt, fixtures/creative-center.ts | ✅ |
| 2 | Sugerencias por mood (chips filtran) | e2e: chip «Chill» reduce la lista < total; «Todos» la restaura | e2e-sound-advisor.txt | ✅ |
| 3 | Elegir no-CML → `audio_source=native_trending` → checklist BLOQUEA Spark (coherencia T6.2) en vivo | e2e SELECCIÓN: variante ai_bed OFRECE Spark (`data-allowed=true`); tras elegir cc-sound-0001 (`if_cml:false`) → `data-selected=true`, `data-allowed=false`, botón disabled, `spark-blocked-reason` con «licencia/comercial» | e2e-sound-advisor.txt | ✅ |
| 4 | Guía in-app del flujo nativo + restricción de cuentas Business | e2e: `native-sound-guide` visible, `native-sound-business-restriction` con «Business»/«personal/creator» | e2e-sound-advisor.txt | ✅ |
| 5 | Filtro comercial coherente: paid/both → solo CML | unit+integration+e2e: destino `both`/`paid` envía `commercialMusic=true` a la fuente, re-filtra por flag de cada item (defensa en profundidad), 0 badges no-CML | unit-integration.txt, e2e-sound-advisor.txt | ✅ |
| 6 | Fuente caída → `sourceOk=false` se propaga y la UI AVISA (no lista vacía indistinguible de filtro sin resultados) | Contra CC 404 en vivo: aviso `sound-source-unavailable` VISIBLE («No se pudo leer TikTok Creative Center…»); `sound-list-empty` AUSENTE del DOM; `sound-item` count 0. Witness externo del 404 en el log del servidor CC (`GET /popular_trend/sound/list?...commercialMusic=false → 404`). Unit cubre 404/500/no-JSON/forma-inesperada; integration cubre el 200+sourceOk:false del handler real | 01-sourceok-false-warning.png, browser-console-sourceok.txt, unit-integration.txt | ✅ |

**Anti-conflación `sourceOk` (el bug que el arnés persigue)**: verificado en las DOS capas deterministas + UI. Unit (`creative-center.test.ts`): 404 y 500 y no-JSON y `data.sounds` no-array y sin-`data` → `sourceOk:false`; y el caso ESPEJO «fuente OK pero filtro comercial vacía la lista» → `sourceOk:true, sounds:[]`, que NO debe colapsar. Integration (`variant-native-sound.test.ts` BUG2): 2xx forma inesperada → 200 + `sourceOk:false`. UI: fuente caída AVISA, no muestra el estado vacío. El diagnóstico opuesto no colapsa.

## Control negativo
**ROJO reproducido**: revertí `sparkEligibility` en `packages/core/src/contracts/publishing.ts` (fichero limpio/committeado en `9cf8c08`, NO en el diff bajo prueba) para que `native_trending` deje de bloquear Spark, y el e2e SELECCIÓN se puso ROJO:

```
✘  e2e/sound-advisor.spec.ts:228 › SELECCIÓN + COHERENCIA T6.2 (control negativo)
   Error: expect(locator).toHaveAttribute(expected) failed
     - unexpected value "true"
   > 255 |  await expect(spark).toHaveAttribute('data-allowed', 'false', { timeout: 15_000 });
   1 failed
```

Tras elegir el sonido no-CML y marcarse `native_trending`, Spark se quedó `data-allowed="true"` en vez de bloquearse → el test muerde de verdad. Salida cruda completa en `negctrl-e2e-red.txt`.

**Restauración verificada**: `publishing.ts` restaurado desde backup; `git status --porcelain` de ese fichero VACÍO (clean); el árbol completo `porcelain` coincide byte-a-byte con el snapshot de inicio (`tree-before.txt`) salvo mis propios artefactos bajo `docs/verifications/T6.6/`. El diff bajo prueba quedó intacto.

## Coste real
$0 — sin APIs de pago. T6.6 lee una web (o su fake/404); no toca fal ni Anthropic. Orphan guard corrido antes; los únicos gastos simulados del gate (fal/Anthropic fakes) viajan al servidor fake local, jamás a un proveedor real. Estimado del planning: $0. Sin recalibración.

## Veredicto
**PASS** — la Verificación re-scopeada se cumple LITERAL sobre el sistema real: flag comercial derivado de `if_cml` (cruzado en unit/integration, no hardcode), filtro comercial coherente en orgánico y paid/both, mood chips, guía Business, y la cadena SELECCIÓN→`native_trending`→Spark bloqueado EN VIVO (e2e). El anti-conflación de `sourceOk` está probado en las tres capas y OBSERVADO en la UI (aviso presente, estado-vacío ausente, 0 sonidos), con witness externo del 404. El control negativo muerde ruidosamente y el árbol quedó intacto.

Notas / rarezas (aunque PASS):
- **Hallazgo ruteado al DS (NO FAIL de T6.6, cua.md ¶111)**: el chip de mood ACTIVO usa `text-accent` sobre `bg-accent-soft` (utilidades crudas del DS, no una primitiva). Ratio medido por token (accent `#5457e5` sobre accent-soft `#5457e526` compuesto sobre `--surface`): **light 4.41:1**, **dark 3.00:1** — por debajo de 4.5:1 AA de texto normal. Es EXACTAMENTE el par `--accent`/`--accent-soft` ya en CUARENTENA por el propio `check:contrast` del gate y en la memoria `ds-contrast-slots-galeria` (T3.8), con decisión de recalibración del usuario DIFERIDA. Los badges CML/no-CML del Advisor (success/warning sobre *-soft) SÍ pasan AA (5.26–7.28:1, verificados por `check:contrast`). El chip es texto `micro font-semibold`; el defecto viene del token, no del código de T6.6 → se REPORTA con la tabla de ratios y se enruta a la misma decisión DS pendiente, no bloquea.
- **Procedencia del fixture**: `verified_against_live:false` — el implementer no pudo grabar de la fuente viva (login-walled en el sandbox). Esperado y aceptado por el SPLIT; la lectura viva es T6.6-live (⛔, dep T6.1). Lo verificado aquí es que el flag DERIVA del dato del fixture, con el fixture llevando el campo crudo `if_cml`.
- **Deuda menor para el implementer**: el e2e permanente `sound-advisor.spec.ts` NO cubre el render del aviso `sound-source-unavailable` (solo el camino con catálogo). Lo cubrí manualmente con CC 404 en vivo (PASS), pero convendría añadir un caso `sourceOk=false` al spec permanente para congelar la regresión (hoy protegida solo por unit/integration + esta verificación manual).
- La lista se pide con `commercialMusic=false` en orgánico (visto en el witness del 404), coherente con §14 pt 2.
