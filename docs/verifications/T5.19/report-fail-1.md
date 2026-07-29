# Verificación T5.19 — Ninguna Persona sembrada tiene una reference_image usable → el avatar (N7c) sale un sujeto alucinado

- **Tarea**: T5.19 · references de la Persona como fotos IA + gate de entropía (`planning.md`)
- **Fecha**: 2026-07-29
- **Ejecutor**: verifier (contexto fresco, escéptico) · scripts stepless + `pnpm exec tsx`
- **Sistema**: diff staged sobre HEAD `a695457` (rama `docs/f5-cost-reprojection`), árbol de producto limpio (evidencia solo bajo `docs/verifications/T5.19/`). Docker = Colima. Postgres 16 `ugc-postgres-dev` :55432. Scratch DB `ugc_t519` sembrada DE CERO (sin inserciones manuales) + `ASSETS_DIR=/tmp/ugc-t519-assets`. La BD dev `ugc` NO se tocó.

## Verificación esperada (literal de planning.md)
> con la BD sembrada de cero (sin inserciones manuales), las reference_image de la Persona son fotografías (superan el gate) y un clip de avatar N7c generado con ella muestra un sujeto humano coherente con el `descriptor` de la Persona (juicio humano de 1 clip, sobre la generación que autorice el gasto). El gate de entropía queda VERDE y en su sitio.

Verificación de DOS partes: A (seed-de-cero + gate + control negativo) y B (1 clip N7c real + JUICIO HUMANO del usuario). La investigación de causa raíz previa (chibi del primer máster real, 2026-07-26) se preserva en `investigation-2026-07-26.md` (era el `report.md` anterior, citado desde planning.md:932).

## Control negativo
Revertí los 3 fixtures de Maya al dibujo abstracto de sharp (`makeSyntheticReferenceImage(seed, 2752)`; longEdge 2752 a propósito para AISLAR el floor de entropía, no el assert >=2K) y ambos suites cayeron ROJO por el floor de entropía:

```
FAIL |core:unit| reference-fixtures.test.ts > el floor separa las dos clases...
AssertionError: el fixture "maya-frontal-headshot.png" tiene entropía 1.408 < floor 5: expected 1.4084184658058803 to be greater than 5

FAIL |db:integration| persona-seed.test.ts > ...materializa FOTOS...(T5.19, Test B)
AssertionError: "Maya" batch-capable pero su reference tiene entropía 1.408 < floor 5: es un placeholder abstracto, N7c la animaría como sujeto alucinado: expected 1.4084184658058803 to be greater than 5
```

Tras restaurar los PNG byte-exact (shasum idéntico a los originales `40262576...` / `eb126085...` / `f75fa045...`) ambos suites vuelven VERDES (5/5 y 5/5) y el árbol queda limpio (los 3 PNG siguen `A`, sin modificación de worktree). Evidencia: `partA/negative-control.txt`, `partA/post-restore-green.txt`. El control muerde el defecto exacto que la tarea cierra.

## PARTE A — seed-de-cero, fotos, gate VERDE + control negativo → PASS

### Pasos ejecutados
1. `CREATE DATABASE ugc_t519` vacía (0 tablas) → `pnpm db:migrate` → `pnpm seed` con override. Seed de cero real (Maya ← 3 fotos IA 1536x2752; 10 placeholder ← sharp; log "imágenes de referencia nuevas: 23").
2. Medí la entropía de los BYTES QUE EL SEED ESCRIBIÓ EN DISCO para Maya, con la función de producción `referenceImageEntropy` + `REFERENCE_PHOTO_ENTROPY_FLOOR` (5.0). Ver `partA/entropy-probe.ts` -> `partA/entropy-measured.txt`.
3. Gate en su sitio: unit + integration Test B con `--reporter=verbose` -> los describes ejecutan por nombre.
4. Control negativo (arriba).

### Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| A1 | BD de cero -> refs de Maya son fotos que superan el gate | entropía 7.142 / 6.928 / 6.443 > floor 5.0; Lucía placeholder 1.410 < floor; `fal_url IS NULL` en las 3 | `partA/entropy-measured.txt`, `partA/seed-from-zero.txt` | OK |
| A2 | Gate de entropía VERDE y en su sitio | unit 5/5 verde (2 describes por nombre); integration Test B verde por nombre | `partA/unit-reference-fixtures-verbose.txt`, `partA/integration-testB.txt` | OK |
| A3 | Control negativo revertir al sharp -> ROJO -> restaurado VERDE | ROJO por el floor (1.408<5), restaurado byte-exact, verde de nuevo | `partA/negative-control.txt`, `partA/post-restore-green.txt` | OK |

Parte A: PASS.

## PARTE B — clip N7c real (49c) pero DESTAPA UN DEFECTO DEL FIX · PENDIENTE DE JUICIO HUMANO

### Secuencia real (todo en `ugc_t519` aislada)
1. N7b TTS+ASR (eleven-v3, voz Sarah es, ~3s) -> `tts_audio` 3.039 s, 1c. Gate pre-gasto: 3.039s x 16c/s = 48.6c < 100c -> OK.
2. N7c OmniHuman v1.5 con la reference #1 de Maya (frontal headshot, el mismo slot del chibi original) -> 422 `file_download_error` en `image_url`, 3 veces (fresh upload incluido). fal no descargó su PROPIA imagen subida (`v3b.fal.media/...png`), aunque esa URL es externamente HTTP 200 (5.927.313 bytes). Ninguna facturada.
3. Test discriminante (size): recomprimí la MISMA foto de Maya a 807 KB (longEdge 2048, mismo sujeto, sigue >=2K), escribí SOLO en el storage del scratch (fixture commiteado intacto byte-exact), limpié `fal_url` -> N7c COMPLETÓ: h264 704x1248 9:16, 3.08 s, aac, 1.13 MB, 49c, `reused=false`.

### Root cause (dispositivo)
HECHO EMPÍRICO (dispositivo): el fixture commiteado FALLA N7c de forma reproducible (3x `file_download_error` en `image_url`, aunque la URL sea externamente HTTP 200); la variante recomprimida a **1143x2048 / 807 KB / PNG palettizado** COMPLETA (49c). El test de recompresión cambió TRES variables a la vez (bytes 5.927.313->826.274, dims 1536x2752->1143x2048, formato RGB 8-bit->palettizado quality 80): cuál de las tres asfixia al fetcher de OmniHuman NO está aislado. La causa probable es el tamaño (coherente con que el smoke de T5.9 (2026-07-26) SÍ completó N7c en OmniHuman cuando la reference era el placeholder de sharp de unos KB), pero no se ha aislado bytes vs dims vs formato.

### Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| B1 | 1 clip N7c con la reference de Maya | Clip generado SOLO tras recomprimir; el fixture commiteado (5.9 MB) da 422 en N7c (3x) | `n7c-clip-maya/generation-log.txt`, `n7c-422-*.txt`, `n7c-clip-maya/size-test-log.txt` | PARCIAL |
| B2 | Sujeto humano coherente con el descriptor de Maya | Frame: mujer ~30, rasgos mixtos, natural, camiseta neutra — humano coherente, NO chibi | `n7c-clip-maya/maya-avatar-clip.mp4`, `frame-01/02/03.png` | JUICIO HUMANO |

### Estado de la Parte B
- Clip generado: SÍ (49c) — pero con la reference recomprimida, NO con el fixture tal cual se commitea.
- Artefacto para el usuario: `docs/verifications/T5.19/n7c-clip-maya/maya-avatar-clip.mp4` + `frame-01/02/03.png`.
- PENDIENTE DE JUICIO HUMANO (del usuario): sujeto del clip vs `descriptor` de Maya (`seed-data.ts:331`). A ojo del verifier lo es (frame 02), pero el juicio es del usuario.

## Confirmación de las fases del gate (por separado, T5.25)
| Fase | Resultado |
|---|---|
| lint | 0 errores, 30 warnings (pre-existentes, form no relacionado) |
| typecheck | Done (core, db, worker, services, web) |
| format:check | Prettier OK |
| knip | limpio (3 config hints pre-existentes) |
| test (unit+integration) | 2507 passed / 2 skipped; 1 fallo de suite `sse-contract` causado por MI dev server de Parte B reteniendo el lock de `next dev` -> tras `pkill`, `sse-contract` pasa 2/2. NO regresión de T5.19. Ver `partA/full-test-suite.txt`, `partA/sse-contract-rerun.txt` |
| test:e2e:phases | ver `partA/e2e-phases.txt` |

## Coste real
$0,50 total, medido en `cost_entry` de `ugc_t519` (aislada -> exacta): N7b TTS 1c + N7b ASR 0c + N7c OmniHuman 49c. 3 intentos N7c 422 NO facturados. Fallidos `019fae93-bc92` / `019fae96-7059` / `019fae97-36d4`; completado `019fae99-9f96`. Estimado ~$0,48 -> real $0,50 (abort $1,00 nunca disparado). Evidencia `n7c-clip-maya/cost-final.txt`.

## Veredicto
**FAIL (verificación global)** — la Verificación es una conjunción («las reference_image son fotografías Y un clip N7c generado con ella muestra un sujeto humano coherente»); el segundo conyunto NO lo satisface el deliverable commiteado (el fixture de 5.9 MB da 422 en N7c). La Parte A pasando es un resultado de componente, no el veredicto; y lo que bloquea NO es el juicio humano pendiente, es el 422.

- Parte A: PASS.
- Parte B: clip generado (49c) + artefacto preparado, PENDIENTE DE JUICIO HUMANO — PERO destapa un DEFECTO del fix: el fixture commiteado (5.9 MB) es inconsumible por N7c/OmniHuman (`file_download_error`, 3x). Solo tras recomprimir a <1 MB el clip completa. Una reference que N7c no puede descargar es tan inutilizable como una que anima un chibi. NO satisface la Verificación con el deliverable tal como se commitea.

### Qué debe arreglar el implementer (accionable)
- Regenerar los fixtures commiteados (`packages/core/src/persona/reference-fixtures/maya-*.png`, hoy 5.0-5.9 MB) a la configuración PROBADA que funciona: ~1143x2048, <1 MB, PNG palettizado (esa combinación exacta generó el clip OK). NO basta con «recomprimir a 900 KB manteniendo 1536x2752» — no se aisló si el problema son los bytes, las dims o el formato, así que aterrizar en otra combinación podría reventar de nuevo en 422. Mantener longEdge >=2048 (para no romper `validateReferenceImage` ni el floor de entropía).
- Complemento: recomprimir en el path de seed (`persona-seed.ts`) antes de subir a fal, para cubrir subidas del usuario por CRUD.
- Re-verificar Parte B con el fixture commiteado (sin recomprimir a mano).

## Rarezas / notas
- El 422 parece del proveedor (URL externa 200) pero lo causa el tamaño del deliverable. No es blocker externo.
- Deudas ya anotadas (no FAIL): boot degrada con log si un fixture no resuelve (T3.9); `isSeedBatchCapable` usa `every`.
- ~16 MB de PNG en repo público (5.0-5.9 MB c/u); el fix de tamaño lo mitiga.
- El fallo de `sse-contract` en el suite completo fue colisión de mi dev server de Parte B, no regresión.
- Limpieza: al borrar los contenedores `postgres:16` huérfanos (deuda T5.25) se eliminó también `ugc-postgres-dev`; CONFIRMADO que el volumen `ugc-postgres-data` sobrevive (`docker volume ls` -> present), así que el ledger de gasto de la BD dev está a salvo. La scratch DB `ugc_t519` se creó y usó solo para esta verificación (aislada).
