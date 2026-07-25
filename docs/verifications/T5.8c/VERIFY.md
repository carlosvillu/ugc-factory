# T5.8c · Componer escenas multi-clip — VERIFICACIÓN

**Veredicto: PASS**
**Fecha**: 2026-07-25 · **SHA base**: `d5c0e7e` (diff uncommitted) · **Coste real: $0** (0 llamadas a fal; estimado $0)

## Texto verificado (planning.md:784, literal)

> una variante cuyo body tiene una escena con narración >8s (p.ej. objetivo conversion) compone su máster N8
> concatenando sus 2+ clips de vídeo y recortando a la narración (sin `FitError`); ninguna generación de clip
> queda pagada-sin-usar (la fuga cerrada); el control negativo sigue disparando `FitError`.

## Resultado por cláusula

| # | Cláusula | Esperado | Observado | OK |
|---|---|---|---|---|
| 1 | **Compone su máster N8** concatenando 2+ clips y recortando a la narración, sin `FitError` | el executor N8 completo (assemble→concat→fit→normalize→composeMaster) produce un `final_video` | `n8-compose.test.ts` (executor REAL contra Postgres): escena de body con 2 clips → **1 fila `kind='final_video'`** compuesta. A nivel de media (ffmpeg REAL): 2 clips 6s+6s → escena 12,0s ≥ narración 8,68s → `plan.kind === 'trim'`, salida 8,68s | ✅ |
| 2 | Fuga cerrada: ningún clip pagado sin usar | todos los clips en el output y en el linaje | `parent_asset_ids` del asset fitteado = `[brollA, brollB]` (ambos clips pagados, en orden de `clipIndex`, leído por SQL en la BD); y los **píxeles** de clip1/clip2 PRESENTES en el output (sonda de color propia) | ✅ |
| 3 | El control negativo sigue disparando `FitError` | 1 clip corto vs narración larga → throw, sin máster | Unit+media: `FitError` (déficit 2,68s ≥ 0,5s). Executor N8: `rejects.toThrow(/FitError/)` **y 0 filas `final_video`** (fallo duro, no degradación silenciosa) | ✅ |

Artefacto principal de la cláusula 1 (la que dice «compone su máster N8»): `apps/worker/test/integration/n8-compose.test.ts`,
ejecutado en verde y aislado en el árbol del usuario contra Postgres real (`outputs/05-n8-integration.txt`, 5/5 passed).

## Lo que comprobé con mis propias manos

### A. Invariantes (regla 5) — LEÍDOS, no aceptados

`fit-segment.ts` aparece con 51 líneas cambiadas, lo que exigía lectura completa. **Es un refactor puro**: se extrae
`INTERMEDIATE_ENCODE_ARGS` (constante compartida con el concat) desde el array inline de `buildFitArgs`. Verificado:

- `MAX_HOLD_DEFICIT_S = 0.5` (`fit-segment.ts:65`) — sin cambios.
- Los 4 `throw new FitError` (líneas 210, 221, 255, 262) — presentes.
- `planFit`: los tres brazos (`trim` / `hold` si déficit <0,5 / `error` si ≥0,5) byte-equivalentes al original.
- Dedup `dedupSalt` = `bodySceneIndex:clipIndex` — no aparece en el diff.
- Máster VIDEO-LED: `compose-master.ts` sigue con `masterDuration = ffprobe(concat)` + `-t <dur>`, sin `-shortest`.

### B. Superficie de consumo del contrato (el riesgo real del cambio de shape)

`videoAsset: Ulid` → `videoAssets: array(Ulid).min(1)` puede recrear el bug en forma *type-legal* si algún consumidor
hace `[0]` en silencio. Barrí TODOS los sitios de lectura en código de producción (no-test):

- `compose-master.ts` / `compose-variant.ts` → pasan por `requireSingleVideoAsset`, que **lanza `ComposeError` si ≠1**
  en vez de tomar el primero. Es la aserción correcta: el spec FINAL debe traer 1 (el concat ocurre antes, en N8).
- `compose-variant.ts` (executor N8) → el único `[0]` (`firstVideoAssetId`) se usa **solo para derivar el `kind`**;
  la composición itera TODOS (`Promise.all` sobre `videoAssets`) y el linaje es `[...segment.videoAssets]`.
- `collectSpecParentAssetIds` → `ids.push(...segment.videoAssets, …)`.

**No hay ningún `[0]` silencioso.**

### C. La suite media EJECUTÓ de verdad (no skip)

El gate verde no dice nada de esto: la suite media está tras `describe.skipIf(!mediaToolsAvailable)`. Forcé
`REQUIRE_MEDIA=1 RUN_MEDIA=1` (que convierte la ausencia de toolchain en ERROR) y leí el detalle por test:

```
✓ concat-scene-clips.test.ts > escena troceada: 2 clips concatenados CUBREN la narración → el fitter RECORTA, sin FitError
✓ concat-scene-clips.test.ts > CONTROL NEGATIVO: UN SOLO clip corto contra la MISMA narración → FitError SIGUE mordiendo
✓ concat-scene-clips.test.ts > 3 clips: el concat escala a cualquier troceo §7.5 y preserva el ORDEN temporal
Test Files 1 failed | 5 passed (6) · Tests 1 failed | 30 passed (31)
```

Los 3 tests de T5.8c corrieron con ffmpeg/ffprobe/c2patool reales. Salida cruda: `outputs/01-media-suite.txt`.

### D. Sonda de píxeles PROPIA (lo que el test del implementer NO prueba)

El test `3 clips … preserva el ORDEN temporal` crea clips rojo/verde/azul pero **solo asserta la DURACIÓN** — los
colores son decorativos. Un concat que repitiera 3 veces el clip 0 pasaría ese test. Escribí mi propia sonda
(`outputs/verifier-pixel-probe.sh`) que muestrea el color medio de un frame por tercio:

```
scene.mp4 duracion: 12.000000
t=2s  (esperado ROJO ): 254 0 0
t=6s  (esperado VERDE): 1 128 1
t=10s (esperado AZUL ): 0 0 254
fitted.mp4 duracion: 10.500000        ← fit a narración 10,5s (> los 8s de tope de clip)
t=2s  (ROJO,  clip0): 254 0 0
t=6s  (VERDE, clip1): 1 128 1
t=10s (AZUL,  clip2): 0 0 254
```

**Esto convierte «concatenado» de aserción en observación**: los píxeles de los clips 1 y 2 aterrizan en el vídeo de
escena y SOBREVIVEN al fitter. La fuga de dinero está cerrada a nivel de píxel, no solo de fila de BD.

⚠ **Alcance de la sonda**: replica a mano los flags de `buildSceneConcatArgs` (concat filter, `-an`,
`INTERMEDIATE_ENCODE_ARGS`) en vez de invocar el builder de producción. Valida por tanto **el FICHERO que produce esa
cadena**, no la procedencia de los args; esa procedencia la cubren el unit de `buildSceneConcatArgs` y el test media
que sí llama a `concatSceneClipsFile` (sección C).

### E. Los 4 controles negativos, reintroducidos POR MÍ

Ejecutados en un `git worktree` desechable (nunca en el árbol del usuario). Todos ROJOS:

| # | Bug reintroducido | Resultado |
|---|---|---|
| 1 | `pickSceneClips` devuelve solo `clipIndex 0` | 🔴 `n8-compose.test.ts`: `expected [ '01KY…GR' ] to deeply equal [ '01KY…GR', …(1) ]` — el 2º clip pagado desaparece del linaje |
| 2 | Bypass del concat (copiar solo clip0) | 🔴 `concat-scene-clips.test.ts`: **`expected 6 to be greater than or equal to 11.85`** — el fallo EXACTO del run real de T5.9 |
| 3 | `planGeneration(bodyScenes, …)` (dimensionado pre-fix) | 🔴 `n7d-broll.test.ts`: `expected […] to have a length of 2 but got 1` |
| 4 | Aserción de contigüidad desactivada | 🔴 `assemble-composition-spec.test.ts`: el set `[0,2]` compone un segmento en vez de lanzar |

**Integridad del árbol**: `git status --short` y `git rev-parse HEAD` idénticos antes y después; el worktree se eliminó.
Checksums post-verificación en `outputs/04-shasums-post.txt`.

### F. Mapeo filtrado↔absoluto (hueco que ningún fixture de 1 escena caza)

`sizeScenesToNarration` recibe `absoluteIndices`; `deriveMeasuredNarrationByScene` keyea por `sceneIndex` ABSOLUTO. Un
off-by-one dimensionaría la escena EQUIVOCADA y la cláusula 1 fallaría en producción con los tests en verde. Escribí un
test propio con guion `hook·body·cta·body` (body ordinales 0,1 en absolutos 1,3) donde **solo** el body absoluto 3 narra
largo (8,68s) y el absoluto 1 narra corto (5,0s):

- `segmentSceneIndices` → `[1, 3]` ✅
- solo el body absoluto 3 crece a 8,68s; el absoluto 1 queda en 6s (no encoge) ✅
- troceo: 1 clip al body corto, **2 clips al largo**, Σ ≥ 8,68s ✅
- control con mapeo desplazado `[0,1]` → la escena larga se queda en 1 clip (el bug) ✅

### G. Gate completo

`pnpm gate` → **exit 0**: 232 ficheros, **2426 tests**, 4 e2e de fase, 0 errores de lint. `outputs/03-gate.txt`.

## Rarezas / hallazgos (no bloquean)

1. **[AJENA a T5.8c, ya conocida]** `compose-variant.test.ts` falla en la suite media del host:
   `expect(info).toContain('Validated')` → c2patool 0.27.1 devuelve `signingCredential.untrusted`. **No la causa este
   diff**: el assert viene intacto del commit `ea14228` (T5.5) y el diff solo migra el shape del campo. Ya está
   documentada en `journal.md:2392` como version-drift del host (la imagen del worker lleva 0.9.12). Deuda viva:
   robustecer ese assert frente a versiones de c2patool.
2. **[HALLAZGO ACCIONABLE — test que no prueba su propio título]** En
   `apps/worker/test/media/concat-scene-clips.test.ts`, el test **`3 clips: el concat escala a cualquier troceo §7.5 y
   preserva el ORDEN temporal`** NO verifica el orden: crea clips rojo/verde/azul y solo asserta la DURACIÓN
   (`expect(d).toBeGreaterThanOrEqual(6 - 0.2)`), así que los colores son decorativos. **Seguiría verde si el concat
   invirtiera el orden, repitiera el clip 0 tres veces o descartara clips** — justo la clase de regresión que T5.8c
   existe para impedir, en el sitio donde vive su cláusula titular. No bloquea el PASS (mi sonda D prueba que el
   producto HOY es correcto), pero el test permanente no muerde.
   **Fix propuesto al implementer**: muestrear el color medio de un frame por tercio y assertar rojo→verde→azul, como
   hace `outputs/verifier-pixel-probe.sh` (`ffmpeg -ss <t> -frames:v 1 -vf scale=1:1 -f rawvideo -pix_fmt rgb24`).
3. **[Deuda declarada, verificada]** `scene.t` queda STALE tras el sizing. Comprobé que el docblock dice verdad:
   `PlannedClip.t` no tiene NINGÚN consumidor fuera del propio `scene-planner.ts`.
4. **[Degradación silenciosa, aceptable]** Sin dep N7b el mapa de narración medida viene vacío y el troceo cae a la
   estimación (comportamiento pre-T5.8c). Las aristas N7d→N7b/N7f→N7b son condicionales a `n7bConfig !== undefined`,
   igual que N7c→N7b; en un plan premium realista N7b está siempre presente.
5. **Límite conocido y documentado**: la aserción de contigüidad no caza una COLA TRUNCADA (`[0,1]` de 3 planificados).
   El implementer lo declara en el docblock con su razón (un clip que falla hace fallar su step). Correcto.

## Coste real

**$0.** Cero llamadas a APIs de pago. Toda la verificación es determinista: media FAKE (`testsrc2`/`color` de lavfi)
+ ffmpeg/ffprobe REALES. Nada en el flujo empujó hacia fal.

## Evidencia

- `outputs/01-media-suite.txt` — suite media con `REQUIRE_MEDIA=1`, detalle por test
- `outputs/02-pixel-probe.txt` — sonda de píxeles del verifier (orden y supervivencia al fit)
- `outputs/verifier-pixel-probe.sh` — el script de la sonda (reproducible)
- `outputs/03-gate.txt` — `pnpm gate` completo, exit 0
- `outputs/04-shasums-post.txt` — checksums post-verificación (integridad del árbol)
- `outputs/05-n8-integration.txt` — `n8-compose.test.ts` aislado en verde (5/5, executor N8 real contra Postgres)
