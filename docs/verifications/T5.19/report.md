# Verificación T5.19 (re-VERIFY tras fix ronda 2) — reference_image de la Persona como fotos IA descargables por N7c + gate de entropía

- **Tarea**: T5.19 · references de la Persona como fotos IA + gate de entropía (`planning.md:931`)
- **Fecha**: 2026-07-29
- **Ejecutor**: verifier (contexto fresco, escéptico) · scripts stepless `pnpm exec tsx` + `vitest run` + `psql`/`ffprobe`
- **Sistema**: diff STAGED sobre HEAD `a695457` (rama `docs/f5-cost-reprojection`); árbol de PRODUCTO limpio (`git diff --name-only` vacío tras la verificación — probes borrados, fixtures restaurados byte-exact). Docker = Colima. Postgres 16 `ugc-postgres-dev` :55432. Scratch DB `ugc_t519rv` sembrada DE CERO (0 tablas → migrate → seed, sin inserciones manuales) + `ASSETS_DIR=/tmp/ugc-t519rv-assets`. La BD dev `ugc` NO se tocó.
- **Historial**: VERIFY #1 = FAIL (preservado en `report-fail-1.md`); investigación de causa raíz en `investigation-2026-07-26.md`. Esta re-verificación re-corre AMBAS partes COMPLETAS (no delta: Parte A se midió antes sobre PNG; ahora los fixtures son JPEG con otros bytes).

## Verificación esperada (literal de planning.md)
> con la BD sembrada de cero (sin inserciones manuales), las reference_image de la Persona son fotografías (superan el gate) y un clip de avatar N7c generado con ella muestra un sujeto humano coherente con el `descriptor` de la Persona (juicio humano de 1 clip, sobre la generación que autorice el gasto). El gate de entropía queda VERDE y en su sitio.

Conjunción de dos partes: A (seed-de-cero + gate + control negativo, offline, $0) y B (1 clip N7c real + JUICIO HUMANO del usuario, pendiente).

## Control negativo
Sobrescribí los 3 fixtures commiteados de Maya con el dibujo abstracto de sharp (`makeSyntheticReferenceImage`, PNG dentro del `.jpg`) y AMBAS suites permanentes cayeron ROJO — el floor de entropía y el assert de formato muerden el defecto EXACTO que la tarea cierra:

```
FAIL |core:unit| reference-fixtures.test.ts > el floor separa las dos clases...
AssertionError: el fixture maya-frontal-headshot.jpg tiene entropia 1.408 < floor 5: expected 1.4084184658058803 to be greater than 5
AssertionError: expected 'png' to be 'jpeg'   (los fixtures de foto son JPEG >=2K DESCARGABLES)

FAIL |db:integration| persona-seed.test.ts > ...materializa FOTOS...(T5.19, Test B)
AssertionError: Maya batch-capable pero su reference tiene entropia 1.460 < floor 5: es un placeholder abstracto, N7c la animaria como sujeto alucinado: expected 1.4602638409228348 to be greater than 5
```

Unit: 5 tests failed. Integration Test B: 1 test failed. Tras restaurar los 3 fixtures desde el indice (`git checkout-index -f`), shasum byte-exact con los commiteados (88d8ac0f... / 33181b0a... / 83ca8ebb...) y `git status` los muestra `A` (staged-new, SIN modificacion de worktree). Re-corridas: unit 10/10 verde, integration 5/5 verde. El control muerde y el restore es limpio. Evidencia: `partA-rv/negative-control.txt`, `partA-rv/post-restore-green.txt`.

## PARTE A — seed-de-cero, fotos, gate VERDE + control negativo → PASS

### Pasos ejecutados
1. `CREATE DATABASE ugc_t519rv` vacia (0 tablas) -> migrate (24 tablas) -> seed con override de `DATABASE_URL`/`ASSETS_DIR`. Seed de cero real: log `persona=11 (imagenes de referencia nuevas: 23)`; Maya <- 3 fotos IA 1536x2752; 10 placeholder <- sharp. `partA-rv/seed-from-zero.txt`.
2. Medi los BYTES QUE EL SEED ESCRIBIO EN DISCO para Maya (NO los fixtures — el seed re-codifica), con `referenceImageEntropy` + `REFERENCE_PHOTO_ENTROPY_FLOOR` de produccion. `partA-rv/entropy-measured.txt`, `partA-rv/maya-persisted-assets.txt`.
3. Gate permanente en su sitio: unit `reference-fixtures.test.ts` 10/10 + integration `persona-seed.test.ts` Test B 5/5, ambos por nombre. `partA-rv/unit-reference-fixtures.txt`, `partA-rv/integration-testB.txt`.
4. Control negativo (arriba) -> ROJO -> restore byte-exact -> VERDE.
5. Techo 1 MiB + orientacion EXIF ejercitados en produccion: (a) test integracion de la ruta CRUD `personas.test.ts` 19/19 (incl. Orientation=6 -> dims transpuestas 2048x2752); (b) probe directo sobre `normalizeReferenceImage` con foto 24MP (72 MB) -> 881 KB / 2048x1365 / entropia 5.82. `partA-rv/route-integration.txt`, `partA-rv/ceiling-exercise.txt`.

### Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| A1 | BD de cero -> refs de Maya son fotos que superan el gate | entropia 7.101 / 6.897 / 6.399 > floor 5.0 sobre los BYTES PERSISTIDOS (305541/290262/193634 B, JPEG 1536x2752); placeholder 1.41 < floor | `partA-rv/entropy-measured.txt` | OK |
| A2 | Gate de entropia VERDE y en su sitio | unit 10/10 verde; integration Test B 5/5 verde (por nombre) | `partA-rv/unit-reference-fixtures.txt`, `partA-rv/integration-testB.txt` | OK |
| A3 | Control negativo (revertir a sharp) -> ROJO -> restaurado VERDE | ROJO (unit 5 fail, integ 1 fail: entropia 1.41/1.46<5, format png!=jpeg) -> restore byte-exact -> verde | `partA-rv/negative-control.txt`, `partA-rv/post-restore-green.txt` | OK |
| A4 | Techo `REFERENCE_MAX_BYTES` (1 MiB) ENFORZADO en produccion, dims post-normalizacion | 24MP->881 KB manteniendo >=2K, entropia 5.82; EXIF6->dims transpuestas; dims devueltas == dims del fichero (sin mentira) | `partA-rv/ceiling-exercise.txt`, `partA-rv/route-integration.txt` | OK |

Parte A: PASS. El defecto del FAIL #1 (fixture inconsumible por 422) queda estructuralmente cerrado: los bytes que el seed persiste son ~190-305 KB (30x bajo el techo de 1 MiB que causaba el file_download_error), siguen >=2K y siguen siendo fotos.

### Delta importante (documentado, no blocker): persistido != fixture
El seed corre `normalizeReferenceImage` sobre el fixture antes de persistir (mozjpeg NO garantiza bytes identicos). Por eso el asset persistido de Maya frontal (7a3deb12..., 305541 B) DIFIERE del fixture commiteado (88d8ac0f..., 306129 B). Ambos son JPEG 1536x2752, ~300 KB, misma clase, ambos muy bajo el techo -> ninguno reproduce el 422. La medida de A1 se hizo sobre los BYTES PERSISTIDOS (lo que N7c animaria en produccion), no sobre el fixture.

### Rareza de contrato (no blocker, REPORTAR): dims NULL en 2 de 3 sitios
La brief afirmaba "los 3 sitios persisten normalized.width/height". VERIFICADO: solo `generate-persona-images.ts` pasa width/height a `createAsset`. El seed (`persona-seed.ts`) y el upload CRUD (`route.ts`) NO los pasan -> las columnas `asset.width/height` quedan NULL ahi (confirmado en `maya-persisted-assets.txt`: width/height vacios para las 3 refs de Maya). La ruta CRUD SI devuelve las dims normalizadas en el JSON de respuesta (y su test lo verifica), pero no las persiste en la fila. Es benigno para la Verificacion (el consumo de N7c no depende de esas columnas, y el guard >=2K relee del fichero), pero la afirmacion de la brief es inexacta y queda anotada para T5.x.

## PARTE B — clip N7c real -> sujeto humano coherente · PASS-PENDIENTE-DE-JUICIO-HUMANO

- No se gasto un clip nuevo (re-VERIFY = $0). Se reusa el clip confirmatorio de la ronda 2: `n7c-clip-maya-CONFIRM/maya-avatar-clip.mp4` (h264 1088x1920 9:16, 2.28 s, aac 24kHz, 1.96 MB — `partB-rv/confirm-clip-ffprobe.txt`).
- Provenance verificada: `n7c-clip-maya-CONFIRM/reference-frontal.jpg` = 88d8ac0f... = byte-exact con el fixture commiteado `maya-frontal-headshot.jpg`. El clip se genero contra los BYTES COMMITEADOS de la reference.
- request_id 019faeb9-c374-7790-bd4a-cbed705338cb: localizado en la BD dev `ugc`, status=submitted, cost_actual=NULL, image_url = ...1785342835842.jpeg (JPEG en fal storage, NO el PNG de 6 MB del FAIL #1 -> el fetcher de fal SI lo descargo, el clip completo). El submit hizo timeout -> la fila quedo colgada sin finalizar (ver Coste).
- A ojo del verifier el frame (`n7c-clip-maya-CONFIRM/frame-1s.png`) es una mujer ~30, rasgos mixtos, estetica natural, camiseta neutra, hablando — sujeto humano COHERENTE con el descriptor de Maya (`seed-data.ts:331`: "mujer de 30 años, rasgos mixtos, estetica natural y cercana, sonrisa espontanea"), y claramente NO un chibi. Pero el juicio de "coherente con el descriptor" es del usuario.

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| B1 | 1 clip N7c con la reference de Maya (bytes commiteados) | Clip h264 9:16 2.28 s generado contra la ref byte-exact con el fixture | `partB-rv/confirm-clip-ffprobe.txt`, `n7c-clip-maya-CONFIRM/` | OK |
| B2 | Sujeto humano coherente con el descriptor de Maya | Mujer ~30, rasgos mixtos, natural, hablando — humano, NO chibi | `n7c-clip-maya-CONFIRM/frame-1s.png` | JUICIO HUMANO |

Parte B: PASS-pendiente-de-juicio-humano. El clip existe, es un humano coherente, contra los bytes commiteados. El bucle debe pedir el juicio final al usuario.

## Coste real
- Esta re-VERIFY: $0 (reuse el clip CONFIRM existente; cero llamadas fal; scratch `ugc_t519rv` con SUM(amount_cents)=0).
- Ledger observado (reconciliacion T5.19): recorded ~ $0,77 = fotos IA del implementer $0,27 + clip del FAIL #1 (scratch `ugc_t519`: TTS 1c + N7c 49c = $0,50). MAS ~$0,36 NO REGISTRADOS: el clip CONFIRM (019faeb9-c374...) quedo submitted/cost_actual=NULL en la BD dev `ugc` (submit timeout; unica fila colgada NULL-cost desde 2026-07-26). => gasto real T5.19 ~ $1,13.
- Recalibracion (actionable para CLOSE, no puedo editar planning.md): `planning.md:937` proyecta ~$1,26 asumiendo que la re-VERIFY gastaria otro clip (~$0,49). NO se gasto (clip reusado) -> el real es ~$1,13, no $1,26. La linea de coste de planning debe bajarse a ~$1,13 y anotar los ~36c colgados. Techo DURO $8,98 intacto; abort $1,00 nunca disparado.

## Confirmacion del gate (por fases, deuda T5.25)
El padre corrio el gate por fases: lint/typecheck/format/knip exit 0; `pnpm test` = 2515 passed; `test:e2e:phases` = 4 passed; persona e2e = 6 passed; unica fase roja = readme:status:check (responsabilidad del CLOSE del padre por editar planning.md, NO defecto de T5.19). Yo re-corri los suites tocados por el fix, todos verdes: core 1285/1285, services generate-persona-images 4/4, db persona-seed 5/5, web personas route 19/19.

## Veredicto
PASS (Parte A PASS + Parte B PASS-pendiente-de-juicio-humano). El deliverable commiteado satisface la Verificacion: seed de cero -> las 3 references de Maya son fotos JPEG >=2K bajo el techo de 1 MiB que superan el floor de entropia (7.1/6.9/6.4 > 5.0); el gate permanente esta VERDE y muerde (control negativo ROJO byte-exact demostrado); el techo 1 MiB + orientacion EXIF estan enforzados en produccion; y el clip N7c contra los bytes commiteados completa y muestra un sujeto humano coherente (frame). El 422 del FAIL #1 queda estructuralmente imposible (persistido ~300 KB, 30x bajo el techo). El bucle debe recabar el juicio humano del usuario sobre el clip antes de marcar [x].

### Rarezas / notas (aunque PASS)
- Persistido != fixture (mozjpeg re-encode): documentado arriba, benigno (misma clase, bajo el techo).
- `asset.width/height` NULL en seed y CRUD (2 de 3 sitios): la brief lo afirmaba de los 3; inexacto. Benigno, anotado para T5.x.
- El clip CONFIRM se genero contra los bytes del FIXTURE (306129), mientras que produccion anima los bytes PERSISTIDOS re-codificados (305541). Difieren, pero ambos ~300 KB / 1536x2752 / bajo el techo -> ninguno reproduce el 422; el valor probatorio del clip transfiere.
- ~$0,36 del clip CONFIRM colgados en la BD dev (submitted/NULL) — NO gastar para "arreglar" el ledger; solo anotar para la reconciliacion de T7.6.
- ~1 MB de JPEG en repo publico (3x ~200-300 KB) — el fix de tamano retiro la deuda previa de ~16 MB de PNG.
- Scratch DBs `ugc_t519rv` (mia) y `ugc_t519` (FAIL #1) creadas solo para verificacion, aisladas; la BD dev `ugc` intacta.
