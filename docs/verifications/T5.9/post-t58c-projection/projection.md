# T5.9 · re-proyección de coste POST-T5.8c ($0 gastado) — 2026-07-24

**VEREDICTO: $52,14 proyectados > techo $40 autorizado → PARADA DE GASTO. No se arrancó el lote.**

Aritmética hecha por el COORDINADOR (regla T1.8: no se traslada al usuario un número sin comprobarlo),
sobre el modelo de coste verificado contra `model_profile` y los presets REALES de `strategy/presets.ts`.

## Entradas (verificadas en código, no supuestas)
- `conversion` (`presets.ts:76-80`): hook 10s, body 16s en **máx 2 escenas** (→8s/escena), cta 4s. maxSeconds 34.
- Tarifas (`model_profile`): avatar omnihuman 16¢/s · b-roll/CTA veo3.1 i2v 20¢/s, enum [4,6,8] · kf 1,2¢/MP.
- Desbordamiento TTS real sobre la estimación `words/2.5`: **+45%** (medido en el run real de T5.9).
- Avatar N7c anima **solo el hook** (`generate-avatar.ts:43`, `findIndex(segment==='hook')`) — verificado,
  no cubre el anuncio entero.
- B-roll: body COMPARTIDO por ángulo (`sharedBodyKey`) → 4 sets (2 ángulos × 2 idiomas).

## Desglose
| Nodo | Cálculo | Coste |
|---|---|---|
| N7c avatar | 12 var × 14,5s × 16¢/s — **NO deduplica** (audio idioma-específico) | **$27,84** |
| N7d b-roll | 4 sets × 24,0s × 20¢/s (cada escena de body: narración 11,6s → **2 clips** → 12s facturados) | **$19,20** |
| N7f cta | 4 sets × 6s × 20¢/s (narración 5,8s → cuantiza a 6) | **$4,80** |
| kf + voz + bed | medido ~$0,22 en el run real | **$0,30** |
| **TOTAL** | | **$52,14** |

## Por qué sube respecto a la proyección pre-fix (~$33)
T5.8c hace lo correcto y por eso cuesta más: antes se pagaban N clips por escena troceada y se usaba 1
(fuga); ahora se pagan y **se usan todos**, y además el troceo se dimensiona contra la narración MEDIDA
(11,6s reales por escena de body ⇒ 2 clips de 8+6, no 1 topado a 8). El b-roll pasa de ~$5,60 a $19,20.
El avatar sube por el hook de `conversion` (10s×1,45=14,5s) frente al de `hook_test` (4s).

## Nota: el techo NO se puede salvar bajando el objetivo
`hook_test` (12s) SÍ cabría, pero **incumple la cláusula (a)**, que exige variantes de **15–30s**.
La duración y el coste están acoplados: satisfacer 22.1 obliga a `conversion`, y `conversion` cuesta $52.

## Opciones (decisión de producto, del usuario)
1. **Subir el techo a ~$55** y correr las 12 variantes como pide la cláusula.
2. **Recortar la matriz de verificación** (p.ej. 6 variantes = 2 áng × 3 hooks en UN idioma, o 2×1×es+en):
   la cláusula pide «≥6 variantes», así que 6 la satisfacen literalmente → ~$26, dentro de $40.
3. Revisar si el avatar (2/3 del coste) admite un endpoint más barato para la verificación.

**Recomendada: (2)** — satisface el literal de la Verificación, cabe en el techo YA autorizado, y no
inventa producto para pasar un test.

## DECISIÓN (usuario, 2026-07-24): opción 2 — matriz de verificación de 6 variantes
~$26 proyectados, dentro del techo $40 ya autorizado. La cláusula pide «≥6 variantes aprobadas», así que
6 la satisfacen LITERALMENTE (no se rebaja la vara). La matriz del PRODUCTO sigue siendo 12: lo que se
recorta es el tamaño del RUN DE VERIFICACIÓN.
