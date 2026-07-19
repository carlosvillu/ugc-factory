# Verificación T4.4b — N7a: product shots con referencias reales (RE-VERIFICACIÓN tras el fix)

- **Tarea**: T4.4b · N7a product shots con referencias reales (`planning.md:582`)
- **Fecha**: 2026-07-19 (re-verificación; el ciclo anterior dio FAIL por bug de money-path, ya arreglado)
- **Ejecutor**: verifier (contexto fresco) · backend + juicio humano · driver `docs/verifications/T4.4b/drive-reference-route-v2.ts`
- **Sistema**: commit `7c21a08` (working tree con el diff de T4.4b) · Postgres 16 dev (`ugc-postgres-dev`, healthy) · fal REAL (FAL_KEY de `.env`, accesible) · seedream v4.5/edit primario
- **Veredicto código (objetivo)**: **PASS** — la ruta de referencias produce 3 shots reales 9:16, con coste NO-CERO por shot y `synthetic_product=false`. El bug del ciclo anterior (0 shots + fuga de dinero) está MUERTO.
- **Juicio humano (recognizability)**: **PENDIENTE del usuario** — evidencia visual preparada. No lo doy yo (regla de parada CLAUDE.md: "a juicio humano").

## Verificación esperada (literal de planning.md:587)
> con fotos reales de un producto propio, los shots muestran **el producto real reconocible** (label/forma a juicio humano) en escenario UGC 9:16.

## Resultado por punto
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Los shots (2-3) del producto real se generan | **3 shots** completed (antes: 0) | drive-output-v2.txt, DB | OK |
| 2 | Escenario UGC **9:16** | 3 outputs descargados = **2304x4096 px, ratio 0.5625 = 9:16 exacto**. inputs.image_size=portrait_16_9 (antes: undefined) | 01/02/03-shot-*.png, DB | OK |
| 3 | synthetic_product=false | false en las 3 filas completed | DB | OK |
| 4 | Coste NO-CERO (era la fuga) | 3 cost_entry del run, cada 4c (MIN 4, sin filas a 0), unit images, atribuidos al step | DB cost_entry | OK |
| 5 | Producto reconocible (JUICIO HUMANO) | Forma/color fieles (tarro dorado+ambar, Retinol+5X); sub-label degradado | 01-shot-1.png vs 00-input-hero-1.png | **PASS (juicio del usuario)** |

## Juicio humano recibido (2026-07-19)
El bucle envió al usuario las 4 imágenes (input 220px + 3 shots 9:16) vía AskUserQuestion. **Respuesta del usuario: «Sí, reconocible — cerrar T4.4b»** — juicio humano genuino sobre estos 3 shots concretos, con aceptación explícita del sub-texto degradado como riesgo del input 220px (no fallo de código). Con esto la cláusula 5 queda satisfecha y las 5 cláusulas están en PASS.

## VEREDICTO FINAL: PASS (5/5 cláusulas)
Código/money-path PASS (objetivo, verifier) + producto reconocible PASS (juicio humano, usuario).

## El bug anterior esta MUERTO
Driver live contra fal real, queries ESCOPADAS a los generationId del run:
```
generation rows (THIS run) = 3  (todas completed, synthetic_product=false, image_size=portrait_16_9)
cost_entry fal del step = 6 filas MIN 4 MAX 4 centimos
  (6 = 3 del run stale-seed + 3 de este run; TODAS 4c, NINGUNA 0)
```
Parser tolerante derivado de promptAdapter==='image-edit' acepta el width:null,height:null real de seedream; coste rutado por cost.unit==='image' -> falPerImageCostOf (4c/img). Antes: parser estricto rechazaba width:null -> throw ANTES de recordCost -> 0 shots + 0 cost_entry. Confirmado no-cero, sin fuga. El asset queda con width/height=null (el 9:16 se prueba sobre el FICHERO, no la fila asset). Blindaje: los mocks ahora emiten width:null,height:null EXPLICITO (n7a-references.test.ts:110, finalize-download.test.ts:199 webhook/sweeper); ambos caminos de finalize cubiertos.

## 9:16 — hallazgo de setup (re-seed) + rareza a vigilar
Primer run (DB stale) salio CUADRADO 2048x2048 con image_size=undefined: el model_profile seedream de la DB de dev tenia capabilities:{refImages:10} SIN aspects/aspectParam/aspectValues. El seed FILE (model-profiles.json, Modified en el diff de T4.4b) SI los declara; la DB estaba sembrada antes del diff. `pnpm seed:gallery` (upsert) actualizo las capabilities -> probe $0 confirmo adaptToPayload emite image_size:portrait_16_9 (adapter-probe.txt) -> segundo run: 2304x4096 = 9:16 exacto. Re-seedear es setup legitimo (el seed es parte del diff, como una migracion).
**RAREZA ACCIONABLE**: el 9:16 solo surte efecto si el rollout re-corre seed:gallery. Un entorno desplegado que NO re-seedee seguira emitiendo shots CUADRADOS. El deploy debe garantizar el re-seed. (Pipeline de deploy no verificado, fuera de alcance.)

## Control negativo (planning:352)
n7a-references.test.ts verde live (6/6). Asserts genuinos: hero 403 -> PermanentStepError, 0 generaciones, 0 cost_entry (:250,264,268,271); cada cost_entry del step lleva 4c atribuidos (:313,334).

## Coste real de fal
- Run 1 (DB stale, cuadrado): 3 x 4c = 12c (descartado como evidencia).
- Run 2 (autoritativo, 9:16): 3 x 4c = 12c (evidencia final).
- Probe adapter: $0.
- **Total sesion ~24c ($0,24)**. Estimado ~$0,30, cap x3 $0,90 -> bajo cap. Cuadre BD: cost_entry del step = 6 x 4c = 24c = gasto real de fal en 2 pasadas. /spend leeria estas filas; no levantada (la Verificacion literal no nombra /spend; cost_entry en Postgres es la fuente autoritativa). F4 acumulado holgado bajo ~5 euros.

## Para el JUICIO HUMANO (preparado, pendiente del usuario)
Comparar 00-input-hero-1.png (input real, 220px) vs 01/02/03-shot-*.png (outputs 9:16 del route real):
- Forma/color FIEL: tarro esferico tapa dorada reflectante + cuerpo ambar/amarillo translucido, en los 3 shots sobre fondo UGC luminoso vertical.
- Marca "Retinol" LEGIBLE (script negro + logo gota/piramide) y "5X" naranja presente; mejor de lo esperado para 220px.
- Sub-texto DEGRADADO (Overnight Mask / descriptor vitamina C garabateado): riesgo del input 220px que el usuario YA acepto; NO es FAIL de codigo, es observacion para el juicio.
- Shot 3 encuadra el producto mas pequeno. Aceptable.
Demuestra que el endpoint es CAPAZ de "producto real reconocible en 9:16" via el route completo. Juicio final del usuario.

## Evidencia en docs/verifications/T4.4b/
01/02/03-shot-*.png (shots 9:16, 2304x4096), 00-input-hero-1.png (input), drive-output-v2.txt (salida cruda), drive-reference-route-v2.ts (driver verifier-side, queries escopadas), adapter-probe.txt (probe $0), producto/retinol-hero-{1,2,3}.avif (input del usuario).

## Que debe cerrar el bucle / usuario
1. Juicio humano: el producto es reconocible en los 3 shots? Si OK -> cerrar T4.4b [x].
2. Garantizar re-seed en deploy: el 9:16 depende de seed:gallery re-aplicado.

## Notas / rarezas
- Asset con width/height=null (parser tolerante sin dims): CORRECTO; el 9:16 se asserta sobre el fichero descargado, no la fila asset.
- No se ejercio el fallback nano-banana-2 (seedream primario funciono); su output width:null iria por el mismo parser tolerante.
