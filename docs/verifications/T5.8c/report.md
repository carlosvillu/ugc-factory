# T5.8c · Componer escenas multi-clip (concatenar antes de recortar, §7.5) — report

- **Tarea**: T5.8c (`planning.md:778-784`)
- **Fecha**: 2026-07-24
- **Veredicto**: **PASS**
- **Coste real**: **$0** (estimado $0). Cero llamadas a APIs de pago: media fake (lavfi) + ffmpeg/ffprobe REALES.
- **Evidencia detallada**: `VERIFY.md` + `outputs/` (01-media-suite, 02-pixel-probe, 03-gate, 04-shasums-post, 05-n8-integration, verifier-pixel-probe.sh)

> El `report.md` lo materializa el coordinador: un guard del harness impide que un subagente escriba
> ficheros `report*`. El contenido y el veredicto son del verifier (agente `a6a7539664198c861`), sin
> modificación.

## Resultado por cláusula

| Cláusula | Observado | Estado |
|---|---|---|
| Compone máster N8 concatenando 2+ clips, recortando a la narración, sin `FitError` | `n8-compose.test.ts` (executor real contra Postgres): escena de body con 2 clips → **1 fila `kind='final_video'`**. Media con ffmpeg REAL: 12,0s ≥ 8,68s → `plan.kind === 'trim'`, salida 8,68s | **PASS** |
| Ninguna generación de clip queda pagada-sin-usar (fuga cerrada) | `parent_asset_ids` = `[brollA, brollB]` leído por SQL; y **píxeles** de clip1 y clip2 presentes en el output tras el fit (sonda propia del verifier) | **PASS** |
| El control negativo sigue disparando `FitError` | Executor: `rejects.toThrow(/FitError/)` **y 0 filas `final_video`**. Umbral `MAX_HOLD_DEFICIT_S = 0.5` intacto | **PASS** |

## Control negativo

El verifier **reintrodujo él mismo los 4 bugs** en un worktree desechable (no se fio del informe del
implementer), y verificó que el árbol del usuario quedó byte-idéntico después (`04-shasums-post.txt`):

1. `pickSceneClips` revertido a devolver solo `clipIndex 0` → `n8-compose.test.ts` **ROJO** (el 2º clip
   pagado desaparece del linaje `parentAssetIds`).
2. Concat bypaseado (copiar solo clip0) → media con ffmpeg REAL **ROJO**:
   `expected 6 to be greater than or equal to 11.85` — el fallo EXACTO del run de T5.9.
3. Dimensionado revertido a `planGeneration(bodyScenes, …)` → `n7d-broll.test.ts` **ROJO**
   (2 clips esperados, 1 obtenido).
4. Guard de contigüidad desactivado (`const broken = -1`) → **ROJO**:
   `AssertionError: promise resolved "{ segments: [ { …(3) } ], …(2) }" instead of rejecting`
   — o sea, sin el guard `assembleCompositionSpec` devuelve tan tranquilo un spec con clips `[0, 2]`:
   el camino al máster corrupto queda probado como ALCANZABLE.

Controles negativos PERMANENTES en la suite (no solo comprobaciones puntuales): `FitError` con 1 clip
corto (media + integración N8, que además comprueba que NO se compone máster), hueco `[0,2]`, duplicado
`[0,0]`, y un **control positivo** (set contiguo desordenado `[2,0,1]` → NO lanza y sale ordenado) para
que el guard no pueda "cumplirse" lanzando siempre.

## Invariantes verificados intactos (regla 5)

- `MAX_HOLD_DEFICIT_S = 0.5` y los 4 `throw new FitError` de `fit-segment.ts`: el verifier leyó el diff
  completo (51 líneas) y confirmó que es **refactor puro** (extracción de `INTERMEDIATE_ENCODE_ARGS`);
  los tres brazos de `planFit` intactos.
- Barrido de TODOS los sitios de lectura de `videoAssets` en producción: **no hay ningún `[0]` silencioso**
  (`requireSingleVideoAsset` lanza `ComposeError`).
- Dedup `dedupSalt` = `bodySceneIndex:clipIndex` sin cambios. Máster VIDEO-LED sin tocar.

## Rarezas anotadas (no bloquean el PASS)

1. **Accionable**: en `apps/worker/test/media/concat-scene-clips.test.ts`, el test «3 clips: … preserva el
   ORDEN temporal» **no verifica el orden** — crea clips rojo/verde/azul pero solo asserta duración.
   Seguiría verde si el concat invirtiera, repitiera o descartara clips. No bloquea (la sonda de píxeles
   del verifier prueba que el producto HOY es correcto), pero el test no muerde. Fix: muestrear color por
   tercio, como hace `verifier-pixel-probe.sh`.
2. **Ajena a T5.8c** (ya en el journal `:2392`): `compose-variant.test.ts` falla en el host por c2patool
   0.27.1 (`signingCredential.untrusted` en vez de `Validated`) con el cert autofirmado. El assert viene
   intacto de `ea14228` (T5.5); este diff solo migra el shape del campo.
3. Deuda declarada y **verificada cierta**: `PlannedClip.t` queda stale tras el sizing — sin ningún
   consumidor fuera de `scene-planner.ts` (documentado, no recalculado, por decisión del REVIEW).
4. Sin dep N7b el mapa de narración medida viene vacío y el troceo degrada a la estimación (comportamiento
   pre-T5.8c). Aristas condicionales igual que N7c→N7b; en un plan premium N7b siempre está.

## Consecuencia operativa NUEVA del guard de contigüidad

Un hueco por carrera de dedup en N7d hace que **N8 falle con `PermanentStepError`** en vez de componer un
máster corrupto. Es permanente A PROPÓSITO: los `output_refs` de N7d están persistidos, así que reintentar
N8 relee el mismo hueco. **La recuperación es re-ejecutar N7d, no reintentar N8.**

## Gate

`pnpm gate` VERDE sobre el árbol final: **exit 0**, 232 ficheros, **2426 tests**, 4 e2e de fase.
