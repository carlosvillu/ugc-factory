# Verificación T5.5d — Wiring del executor N8 (composición) al DAG

- **Tarea**: T5.5d · Wiring del executor N8 (composición) al DAG (`planning.md:722`)
- **Fecha**: 2026-07-22
- **Ejecutor**: verifier (contexto fresco) · sin agent-browser (tarea backend/módulo puro, sin superficie UI) · imagen `ugc-worker:t5.1` (amd64) para la cláusula media
- **Sistema**: working tree sobre commit `138f59b` con el diff de T5.5d sin committear (NUEVOS `assemble-composition-spec.ts`+test, `compose-variant.ts` (N8 executor)+`n8-compose.test.ts`; MODIFICADOS `step-outputs.ts`, `generation-dag.ts`, `executors/index.ts`, N7c/d/e/f executors). Docker compose dev (Postgres 16) para las suites de integración. Sin `pnpm dev` (tarea sin superficie web).

## Verificación esperada (literal de planning.md)
> un run de generación mockeado (providers fake, patrón T4.11) con N7a-e completos → el nodo N8 de una variante produce y persiste su máster: `ad_variant.master_asset_id` no nulo, fila `asset` `kind='final_video'` con `parent_asset_ids` = los assets N7 de la variante, `qa_report` poblado; el `CompositionSpec` ensamblado tiene 1 segmento por escena del guion con el clip y la voz correctos. En la imagen: el máster real pasa el perfil de export (ffprobe).

Más las exigencias explícitas del brief: guion **hook·body·cta·body**; cta desde **N7f** (no avatar); mapeo de índices body/cta correcto; **simetría del throw** (cta sin N7f → `PermanentStepError`, no degradación).

## Pasos ejecutados

1. **Lectura del diff**. El ensamblador enruta hook→N7c, body→N7d (por `bodyOrdinal`), cta→N7f (por `ctaOrdinal`), con `PermanentStepError` si falta la dep de una escena presente. Los tests del implementer afirman cta contra el `assetId` que N7f emite (`cta-A`), no contra una fabricación de factory, y tienen el control negativo — sourcing honesto, NO principio 9.
2. **Suites del implementer (gate)**: `assemble-composition-spec` 12/12 · `n8-compose` (Postgres real) 3/3 · N7c/d/e/f + generation-dag units 37/37. Todo verde.
3. **Harness INDEPENDIENTE del verifier** (`verifier-harness.test.ts`, inputs propios, executor N8 real con fakes): seed hook·body·cta·body, dumpea spec ensamblado, fila `final_video`, `qa_report`, walk de linaje, y control negativo cta-sin-N7f.
4. **Cláusula media (ffprobe, "en la imagen")**: `worker:media` `compose-variant.test.ts` reproducida DESDE CERO en `ugc-worker:t5.1` (amd64): copia del working tree, `pnpm install --frozen-lockfile`, `RUN_MEDIA=1 npx vitest run --project worker:media compose-variant`. **7/7 verde** con ffmpeg 5.1.9 + c2patool 0.9.12 reales.

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | `ad_variant.master_asset_id` no nulo | apunta al `final_video` persistido | ad-variant-row.json | ✅ |
| 2 | fila `asset` `kind='final_video'` | 1 fila (+ 1 thumbnail) | final-video-row.json | ✅ |
| 3 | `parent_asset_ids` = los assets N7 | 9/9 N7 raw por WALK transitivo; parents DIRECTOS = normalizados (ver Rarezas) | lineage-walk.json | ⚠️ transitivo |
| 4 | `qa_report` poblado | score 100, 8 checks pass, métricas completas | qa-report.json | ✅ |
| 5 | 1 segmento por escena | hook·body·cta·body → 4 segmentos en orden | assembled-composition-spec.json | ✅ |
| 6 | clip y voz correctos | cta→N7f (`ctaClip`, NO avatar); body1→brollA+vo1; body2→brollB+vo3 (no cruzados) | assembled-composition-spec.json | ✅ |
| 7 | máster real pasa export profile (ffprobe) | composeVariant en imagen: máster firmado + qa pass + 4 QA negativos correctos | media-compose-variant-run.log | ✅ (nivel composeVariant) |
| 8 | cta sin N7f → lanza, no degrada | `PermanentStepError`; 0 masters creados | negative-control-cta-no-n7f.json | ✅ |

## Sobre el punto 3 (parent_asset_ids) — hallazgo investigado
`finalizeVariantMaster` fija parents desde `collectSpecParentAssetIds(finalSpec)`, y el finalSpec apunta a los **normalizados** (vídeo: N7 raw → fitted → normalizado; voz: N7b raw → normalizado; bed: directo). Los parents DIRECTOS son los normalizados, no los N7 raw.
- **Linaje NO roto**: cada salto registra su origen (normalizador `parentAssetIds:[source.id]`; fitted `[segment.videoAsset]`). Con bytes distintos el walk desde el máster alcanza **9/9** N7 raw. T5.7 funciona.
- **El colapso 3/9 era artefacto del fake**: MP4 fijo de 8 bytes → checksums idénticos → la caché normalize-once (T5.2) folda 4 vídeos en 1 y 4 voces en 1. Con bytes únicos (path embebido) → 9/9. Probado, no asumido.

## Coste real
$0 — providers fake; ffmpeg + c2patool locales/en imagen (sin fal/Anthropic/OpenAI). Coincide con el estimado ($0).

## Veredicto
**PASS** — N8 ensambla la CompositionSpec (1 seg/escena, cta desde N7f, índices no cruzados), encadena fitter→normalize→compose→persist, persiste el máster con linaje completo a los 9 N7 raw. La simetría del throw muerde (cta sin N7f lanza, no degrada al avatar — el bug de T5.5a no reaparece). El máster real pasa el perfil de export (ffprobe) a nivel composeVariant en la imagen.

**Boundary (cláusula media)**: "el máster real pasa el perfil de export (ffprobe)" se verifica contra `composeVariant` (encode→EXPORT_MASTER_PRESET→ffprobe QA + C2PA) con ffmpeg/c2patool REALES en `ugc-worker:t5.1`. El diff NO toca `composeVariant`, así que su cobertura media sigue vigente. El encadenado assemble→fit→normalize→compose→persist DEL EXECUTOR N8 se verifica con integración (Postgres real) + harness, ambos con ffmpeg fake — NO existe test media del executor N8 end-to-end (no se levantó N8-in-image con Testcontainers; el brief autoriza la división). Fitter (T5.5b) y normalize (T5.2) tienen su cobertura media real en sus tareas.

**Rarezas (aunque PASS)**:
- **Precisión de la Verificación (flag, NO FAIL)**: "parent_asset_ids = los assets N7" se cumple TRANSITIVAMENTE (el máster CAMINA a los N7 vía normalizados), no directo. Apuntar directo a los N7 raw rompería el patrón de linaje transitivo T5.2/T5.5b y el docblock de `finalizeVariantMaster` dice que T5.7 CAMINA este campo. Se sugiere afinar la redacción (regla 6) si el bucle lo estima.
- **Propiedad preexistente de la caché T5.2 (informativo, no de T5.5d)**: si dos segmentos produjeran normalizado byte-idéntico, la caché los foldaría. Irrelevante para clips reales distintos.

## Evidencia (docs/verifications/T5.5d/)
verifier-harness.test.ts · assembled-composition-spec.json · final-video-row.json · ad-variant-row.json · qa-report.json · n8-output.json · lineage-walk.json · parent-asset-ids-analysis.json · negative-control-cta-no-n7f.json · media-compose-variant-run.log
