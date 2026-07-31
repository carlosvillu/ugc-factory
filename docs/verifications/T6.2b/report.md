# Verificación T6.2b — Música propia (own_license): upload de audio + sustitución del bed generado

- **Tarea**: T6.2b · Música propia (own_license): upload de audio + sustitución del bed generado (`planning.md`)
- **Fecha**: 2026-07-31
- **Ejecutor**: verifier (agente escéptico, contexto fresco) · Playwright + Vitest (no CUA de navegador: la Verificación es backend/composición, sin UI)
- **Sistema**: árbol de trabajo SUCIO sobre commit `ef84af8` (el diff de T6.2b sigue sin commitear; 18 ficheros +639/-67 + 5 untracked). Stack e2e: testcontainer Postgres 16 + `next build && next start` (:3100) + worker + fake de APIs in-process (fal/Anthropic FINGIDOS, $0). Migración `0027_cooing_klaw.sql` aplicada por el harness.

## Verificación esperada (literal de planning.md)
> **Verificación**: subir una pista propia y usarla en un lote produce el master con esa música y `own_license` persistido; sin bed propio, la variante sigue generando su bed con N7e (no se rompe el flujo normal).
>
> **Playwright/test permanente**: subir una pista propia y usarla en un lote produce el master con esa música y `own_license` persistido; el plan de generación de esa variante **NO emite N7e**. **Control negativo**: revertir la condición → N7e vuelve a generarse y el bed propio se ignora (ROJO).

## Pasos ejecutados

### Gate previo (regla de oro: suite verde ANTES del gate CUA)
1. `node scripts/check-orphan-workers.mjs --strict` → limpio (0 huérfanos) al arrancar.
2. Gate estático (env `DOCKER_HOST`=colima + `TESTCONTAINERS_RYUK_DISABLED=true`): lint / typecheck / format:check / knip / readme:status:check / check:contrast / e2e:wired:check → **todos EXIT 0** (evidencia `gate-*.txt`).
3. `pnpm test` (unit+integration, mismo env) → **245 files, 2588 tests, 2588 passed, EXIT 0** (`gate-test.txt`).
4. `test:e2e:phases` (f1/f2/f4) → **4 passed (47.6s), EXIT 0**, 0 líneas `[WebServer]` (reuse del stack) (`gate-e2e-phases.txt`). Gate completo 9/9.

### Mitad A — flujo con bed propio (own_license), e2e VIVO
El spec permanente `apps/web/e2e/phases/f6-own-license-music.spec.ts` corrió contra el stack REAL levantado en :3100 (reuse del stack manual — 0 líneas `[WebServer]` en la corrida buena, prueba de que no se relanzó). Recorre, sobre datos reales y usando el sistema como cliente:
1. Sembrar proyecto + análisis + brief + lote PREMIUM con guion v1.
2. `POST /api/assets` con `kind=music_bed` (WAV real de fixture) → asset `music_bed` creado.
3. `PUT /api/variants/:id/music-bed {assetId}` → respuesta `ownMusicBedAssetId` + `audioSource='own_license'`.
4. Aprobar CP3 (`POST /api/steps/:id/approve`) → arranca el run de generación (`nextRunId`).
5. Cadena N6→N7a/b/c/d/f→N8 corre hasta componer el máster.
6. Aserciones SQL contra la BD del stack (no logs del propio código). → **2 passed (13.1s), F6_EXIT=0** (`mitadA-f6-attempt4.txt`).

### Mitad B — el flujo normal NO se rompe
Cubierta por: (a) test de integración PREMIUM de `buildVariantGenerationPlan` (rama else → `n7eConfig` presente con endpoint `fal-ai/ace-step` + `durationSeconds`); (b) `n7e-music.test.ts` «POR VARIANTE (T4.11): tras el bed, la ad_variant tiene audio_source=ai_bed» — el executor N7e SÍ marca `ai_bed` cuando NO hay bed propio; (c) e2e de fase f4-generation (generación normal completa con N7e), corrida VERDE en el gate.

### Control negativo (ejecutado por el verifier, no por palabra del implementer)
Revert temporal SOLO de la condición de salto en `packages/services/src/build-variant-generation-plan.ts` (eliminar el `else` → `n7eConfig` se configura SIEMPRE, aunque haya bed propio), corrido en AISLAMIENTO tras terminar la suite completa (para no contaminar el gate), capturado el ROJO, restaurado y re-verificado VERDE. Ver sección `## Control negativo`.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Subir pista propia (audio) por API crea asset `music_bed` | `POST /api/assets kind=music_bed` (WAV) → atado por `PUT` → `audioSource='own_license'` | mitadA-f6-attempt4.txt | ✅ |
| 2 | El máster se compone con ESA música | N8 compuso máster (`master_asset_id` no-null) y su `parent_asset_ids` CONTIENE el bed subido (linaje deriva del asset del usuario, vía `spec.music.asset`→`collectSpecParentAssetIds`) | mitadA-f6-attempt4.txt | ✅ |
| 3 | `own_license` persistido | `ad_variant.audio_source='own_license'` tras todo el run | mitadA-f6-attempt4.txt | ✅ |
| 4 | El plan NO emite N7e para la variante con bed propio | 0 filas `step_run` con `node_key LIKE 'N7e%'` para esa variante (aserción NO vacua: `waitN7Succeeded` exige N7a/b/c/d/f todos presentes y `succeeded` primero) | mitadA-f6-attempt4.txt | ✅ |
| 5 | Sin bed propio la variante sigue generando con N7e (flujo normal intacto) | Plan PREMIUM emite `n7eConfig`; executor N7e marca `audio_source='ai_bed'`; f4-generation e2e verde | gate-test.txt, gate-e2e-phases.txt | ✅ |
| 6 | Control negativo ROJO al revertir el salto | Al configurar N7e siempre, el test «BED PROPIO ... OMITE n7eConfig» FALLA en `expect(plan.n7eConfig).toBeUndefined()` | control-negativo-RED.txt | ✅ |

## Control negativo
**ROJO reproducido.** Revertido el salto de N7e en `build-variant-generation-plan.ts` (quitado el `else`, `n7eConfig` se asigna incondicionalmente aunque la variante tenga `ownMusicBedAssetId`), el test de integración `BED PROPIO (own_license): el plan OMITE n7eConfig y declara providedMusicBedAssetId` se pone **ROJO**:

```
FAIL |services:integration| test/integration/build-variant-generation-plan.test.ts > BED PROPIO (own_license): el plan OMITE n7eConfig y declara providedMusicBedAssetId
AssertionError: expected { …(3) } to be undefined
- Expected: undefined
+ Received: { "durationSeconds": 30, "mood": "upbeat, energetic, background", "musicEndpoint": "fal-ai/ace-step" }
 ❯ test/integration/build-variant-generation-plan.test.ts:322:28  expect(plan.n7eConfig).toBeUndefined();
 Test Files  1 failed (1) | Tests  1 failed | 7 passed (8)
```
(salida cruda íntegra: `control-negativo-RED.txt`)

Restaurado el fichero (`git diff` sin el marcador de revert; el `else` de vuelta en línea 192) y re-corrido el mismo file → **8 passed (8)**. El control negativo pinea el SALTO DE N7e EN SÍ en el test del builder — no solo el máster resultante — porque con «el bed propio gana» en el ensamblador (`assemble-composition-spec.ts:229`, `ownMusicBedAssetId ?? n7e?.assetId`), revertir el salto dejaría el máster igualmente correcto y una aserción solo-sobre-el-máster quedaría verde por accidente. Los otros 7 tests (incluido el money-gate de tier `test`) siguen verdes al revertir: N7d lanza antes de llegar a N7e, así que el salto es específico, no un apagado global de gates.

### Rareza documentada (no bloquea el PASS)
La Verificación pide del control negativo «N7e vuelve a generarse **y el bed propio se ignora** (ROJO)». La PRIMERA mitad (N7e vuelve a generarse) SÍ se reproduce y es la que muerde en el test. La SEGUNDA mitad («el bed propio se ignora») NO es reproducible **por diseño**: la implementación hace que el bed propio GANE en el ensamblador (sustitución, no error — `ownMusicBedAssetId ?? n7e?.assetId`), así que aunque se revierta el salto y N7e genere un bed IA, el máster SEGUIRÍA llevando la música del usuario (el bed IA se ignora en N8, no el propio). La cabecera del propio spec f6 lo declara. Por eso el control negativo correcto pinea el salto en el BUILDER (donde sí se puede ver el rojo), y ahí muerde. El requisito sustantivo del control negativo (que exista un test que se ponga rojo al revertir la condición de salto) SE CUMPLE.

## Coste real
**$0** (vs estimado $0). T6.2b no genera nada vía fal ni Anthropic: la composición del máster con música propia la hace N8/FFmpeg (executor existente), y toda la suite corre contra fakes in-process. Ninguna llamada a API de pago. Guard anti-workers-huérfanos corrido antes de empezar. Los workers vivos detectados durante la verificación son los del propio stack e2e levantado a propósito (FAL_BASE_URL → fake, $0), no rogue.

## Veredicto
**PASS** — subir una pista propia y usarla en un lote produce el máster con esa música (bed en `parent_asset_ids` del máster) y `own_license` persistido, sin emitir N7e para esa variante; el flujo normal (sin bed propio) sigue generando su bed con N7e y marcando `ai_bed`; el control negativo pinea el salto de N7e y se pone ROJO al revertir.

Notas / rarezas (aunque el veredicto es PASS):
- La 2.ª mitad del control negativo de planning («el bed propio se ignora») es inejecutable por diseño (el bed propio GANA en el ensamblador); documentado arriba, no bloquea.
- El spec f6 NO está en `test:e2e:phases` (el gate corre f1/f2/f4 por ruta), igual que f5-export — convención del proyecto; sí está cableado al runner (proyecto `chromium`) y correrá en `pnpm test:e2e` completo. `check-e2e-wired` solo exige cableado para specs TRACKEADOS: al commitear el diff, f6 debe seguir cableado (lo está).
- Footgun de entorno reconfirmado: bajo Colima el webServer de Playwright necesita `TESTCONTAINERS_RYUK_DISABLED=true` (además de NO exportar `DOCKER_HOST`); sin RYUK off, Ryuk falla al montar el docker.sock. Verificado corriendo contra un stack manual reusado.
