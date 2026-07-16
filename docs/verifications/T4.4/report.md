# Verificación T4.4 — N7a: product shots, ruta packshot-IA

- **Tarea**: T4.4 · N7a: product shots — ruta packshot-IA (`planning.md`)
- **Fecha**: 2026-07-16
- **Ejecutor**: verifier (escéptico, contexto fresco) · smoke stepless (superficie backend, sin agent-browser) · sesión `t4.4`
- **Sistema**: commit base `4f9ceee` + diff de T4.4 sin commitear (código bajo verificación) · docker compose dev (Postgres 16) + migraciones (0017 incl.) + `pnpm seed:gallery` (model_profile flux-2). El smoke corrió contra el código del diff (git status: el verifier solo tocó `docs/verifications/T4.4/`).

## Verificación esperada (literal de planning.md)
> el flujo sin fotos produce packshots 9:16 **razonables a juicio humano** con el flag `synthetic_product=true` persistido. Smoke STEPLESS (sin `step_run_id`), molde `smoke-generate.ts` de T4.1. El bucle genera los 2–3 shots en vivo y los presenta al usuario para su juicio.

## Pasos ejecutados
1. `pnpm gate` (lint + typecheck + format:check + knip + readme:status + test) → **verde**: 168 files, 1806 tests passed.
2. Levantado el stack: docker compose dev + `pnpm db:migrate` (0017_adorable_richard_fisk = `ALTER TABLE generation ADD COLUMN synthetic_product boolean DEFAULT false NOT NULL`) + `pnpm seed:gallery` (model_profile=16, flux-2 `01KXN3Z0KV42NPXW91DFR0GHW7`).
3. Verificado a priori en BD: columna `synthetic_product` (boolean, NOT NULL, default false); perfil flux-2; brief real.
4. Brief REAL `01KXH974GCA1F6Z1NNQMBFBRWC` = **Allbirds "Men's Cruiser - Shadow Blue (Natural White Sole)"** (Calzado, descripción rica) — producto reconocible.
5. Smoke STEPLESS contra **fal REAL**: `BRIEF_ID=… pnpm --filter @ugc/web smoke:packshot` → 2 shots. Salida en `smoke-output.txt`.
6. Verificación INDEPENDIENTE de las filas (no me fío del "OK ✓" del script): `generation`, `asset`, `cost_entry` por psql + PNGs reales por `sips`/`shasum`.
7. Confirmado que el executor de producción (`apps/worker/src/executors/generation.ts`) recorre la MISMA ruta que el smoke: `buildPackshotPrompt` → `runGenerate` con `image_size: portrait_16_9`, `num_images: 1` en bucle, `syntheticProduct: true`.

## Resultado observado vs esperado
| # | Esperado (objetivo) | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Smoke stepless produce 2 shots reales vía fal (ai_packshot, sin step_run_id) | 2 generaciones `completed`, `step_run_id` NULL, model_profile = flux-2, `fal_request_id`/`response_url` poblados (prueba externa de llamada real) | generations.txt, smoke-output.txt (`fal_generation_finalized`) | OK |
| 2 | Shots 9:16 VERTICAL (height>width) | BD: 576×1024, `portrait=t`. PNG real (sips): 576×1024 los dos. BD == fichero | assets.txt | OK |
| 3 | `synthetic_product=true` persistido en TODAS | `synthetic_product=t` en las 2 generaciones | generations.txt | OK |
| 4 | Cada shot descargable (PNG en storage, checksum == BD) | On-disk shasum == `asset.checksum` (`4d1fc0…`, `910899…`). Ruta `GET /api/assets/:id/download` existe | assets.txt | OK |
| 5 | Un `cost_entry` por shot (provider fal) | 2 cost_entry, provider='fal', 1¢ c/u | cost-entries.txt | OK |
| Esc | Los 2 shots DISTINTOS (seed=i funciona) | Checksums distintos BD y disco (`4d1fc0…` ≠ `910899…`); imágenes visualmente distintas (2 ángulos) | assets.txt, shots | OK |
| Esc | `synthetic_product` NO contamina `content_hash` | Test integración `packages/services/test/integration/generate.test.ts:157-198` lo ancla (mismo hash con/sin flag); gate verde | gate verde | OK |

**Fidelidad smoke↔producción**: el executor N7a real usa idéntica ruta. El smoke NO es una ruta paralela.

## IDs de la ejecución
- generation 1: `01KXP1QA1QCCM4JWJEXYJZQXXA` → asset `01KXP1QEANE9PZF4AGQZ570BWR` (shot-1.png)
- generation 2: `01KXP1QEAYDTGM5EAP3KDQ79FQ` → asset `01KXP1QJ58JPA6ACBQ8GSQH32C` (shot-2.png)

## JUICIO HUMANO PENDIENTE (no es mi PASS/FAIL)
El juicio humano de **"¿son packshots 9:16 razonables del producto Allbirds Men's Cruiser - Shadow Blue (Natural White Sole)?"** queda para el USUARIO. Los 2 PNGs están en `docs/verifications/T4.4/shot-1.png` y `shot-2.png`. Constato objetivamente que son imágenes reales de producto (zapatilla de punto azul-grisáceo con suela blanca sobre fondo neutro, dos ángulos) — NO placeholders ni errores; lo "razonable" lo marca el usuario.

## Coste real
- fal (`fal-ai/flux-2`, text-to-image): **2 shots × 1¢ = 2¢ ($0,02)**.
- Registrado en 2 `cost_entry` provider='fal' (1¢ c/u) — fuente de `/spend`.
- vs estimado tarea $0,25 / cap $0,75: muy por debajo. Sin recalibración.
- No verifiqué la cifra en la UI de `/spend`: tarea backend stepless sin superficie web; la evidencia de coste es el `cost_entry` en BD (fuente de verdad de /spend).

## Veredicto
**PASS** (objetivo) — los 5 puntos objetivos + los 2 chequeos de escepticismo (distinctness, content_hash) se cumplen contra el sistema real con fal real. El juicio subjetivo de "razonables" queda explícitamente para el usuario.

**Rarezas / notas**:
- `DATABASE_URL` del `.env` usa `localhost:55432` (puerto host); psql de verificación por `docker exec` al postgres del contenedor (user/db `ugc`). Sin impacto en la feature.
- El smoke genera N shots como N generaciones de `num_images:1` (no una con `num_images:2`), decisión documentada en `generation.ts`. Coincide con el executor de producción.

## Juicio humano (usuario, 2026-07-16) — PASS

El usuario revisó los 2 packshots (`shot-1.png`, `shot-2.png`) del producto *Allbirds Men's Cruiser - Shadow Blue*: veredicto **razonable / OK**. Cita: «son dos imágenes de unas zapatillas en un fondo blanco, están bien generadas […] es una imagen muy simple de una zapatilla en un fondo blanco sin nada más […] sí, por mi parte, OK». Es exactamente lo que la ruta packshot-IA debe producir (producto limpio, aislado, fondo neutro). La cláusula de "packshots 9:16 razonables a juicio humano" queda satisfecha.
