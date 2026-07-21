# Verificación T5.5b — Segment fitter (recorte a la narración + hold del último frame)

- **Tarea**: T5.5b · Segment fitter — recorte a la narración + hold del último frame (`planning.md`)
- **Fecha**: 2026-07-21
- **Ejecutor**: verifier (contexto fresco) · sin agent-browser (tarea backend/módulo puro, sin superficie UI) · imagen `ugc-worker:t5.1` (amd64)
- **Sistema**: commit de trabajo sobre `38ed0ad` con ficheros nuevos untracked (`packages/services/src/fit-segment.ts`, `fit-segment.test.ts`, `apps/worker/test/media/fit-segment.test.ts`) + barrel `index.ts` aditivo. NO hay compose/pnpm dev que levantar: el fitter es file-in/file-out con ffmpeg local (patrón T5.2/T5.3). La Verificación literal corre en la imagen del worker (ffmpeg 5.1.9).

## Verificación esperada (literal de planning.md)
> en la imagen: (a) un clip de 5,0 s con narración de 3,4 s → sale exactamente 3,4 s (ffprobe, trim al final); (b) un clip de 3,2 s con narración de 3,5 s (déficit 0,3 s <0,5) → sale 3,5 s con el último frame holdeado (los últimos 0,3 s son frames idénticos, muestreo de píxeles); (c) déficit >0,5 s → lanza (no tapa un desajuste grosero).

## Régimen de verificación (dos capas, ambas reproducidas por el verifier)

1. **Gate raíz** (`pnpm gate`) VERDE reproducido en local: 217 files, 2292 tests. Incluye los unit del boundary del umbral (`packages/services/src/fit-segment.test.ts`: 0,49→hold / 0,50→error, y el control negativo con runner-count=0 sin ffmpeg).
2. **Tier MEDIA en la imagen `ugc-worker:t5.1`** (amd64): reproducido DESDE CERO por el verifier — copia del repo a `/tmp/build`, `pnpm install --frozen-lockfile --ignore-scripts`, `RUN_MEDIA=1 REQUIRE_MEDIA=1 pnpm test:media`. Corrieron **27 tests, 5 files, todos verdes** (evidencia `media-run.log`).
   - La suite del implementer (`fit-segment.test.ts`, 4 tests) — reproducida, no confiada.
   - **UNA suite INDEPENDIENTE escrita por el verifier** (`verifier-fit-segment.test.ts`, 3 tests) con **duraciones propias distintas** (6,0/2,7 · 4,0/4,25 · 4,0/4,8) — un fixture hardcodeado a las duraciones del implementer (5,0/3,4/3,2/3,5/3,0) fallaría estos. Añade los discriminantes de honestidad que a la suite del implementer le faltan. Ejerce el MISMO producto (`fitSegmentFile` vía `@ugc/services`), no ffmpeg a mano.

## Auditoría de honestidad de cada discriminante (principio 9)

### (a) TRIM — ¿recorte al FINAL o al arranque?
La duración ≈3,4 s NO discrimina un `-t` (recorte al final) de un `-ss` (recorte del arranque): ambos dan la misma duración. La suite del implementer solo mide duración + `plan.kind`. El test del verifier muestrea frames: compara el frame en t=0,5 s de la salida contra el mismo instante de la fuente, y contra el instante donde caería un `-ss` (6,0−2,7+0,5 = 3,8 s).
- Observado (caso 6,0→2,7): `MAD(out@0.5, src@0.5)=0.462` (≈0 → arranque PRESERVADO) y `MAD(out@0.5, src@3.8)=6.570` (grande → el clip SÍ tiene movimiento, luego el ≈0 es NO trivial). Trim al final confirmado observacionalmente.

### (b) HOLD — ¿frames idénticos, no negros, y el ÚLTIMO frame?
Un `tpad=stop_mode=add` rellenaría con NEGRO y la duración cuadraría igual; un fitter no-op dejaría movimiento en la cola. El test del verifier comprueba cuatro cosas sobre la cola holdeada (4,0–4,25 s de un clip `testsrc2` en movimiento):
- `MAD(tail1, tail2)=0.000` → cola CONGELADA (frames idénticos).
- `MAD(moving, tail)=3.454` → el clip se movía y la cola no (freeze real, no no-op).
- `luma(tail)=126.48` (>20) → NO es negro (descarta black-pad).
- `MAD(tail, srcLast@3.95)=0.277` (≈0) → la cola ES el ÚLTIMO frame de la fuente, no un frozen cualquiera.

### (c) ERROR — ¿muerde de verdad y sin tocar ffmpeg?
- El test del verifier (déficit 0,8 s) comprueba el throw de `FitError` Y que NO se escribió el fichero de salida (`fileExists(out)===false`) — evidencia de sistema de ficheros de que el runner NUNCA corrió. El unit del gate lo refuerza con runner-count=0 sobre un mock.

## Resultado observado vs esperado
| # | Esperado (literal) | Observado | Evidencia | OK |
|---|---|---|---|---|
| a | clip 5,0 s + narración 3,4 s → exactamente 3,4 s, trim al final | implementer: dur 3,4 s; verifier (6,0→2,7): dur 2,700, trim-al-final por frames (MAD start 0,46 vs counter 6,57) | media-run.log | OK |
| b | clip 3,2 s + narración 3,5 s (déficit 0,3) → 3,5 s, últimos 0,3 s frames idénticos (muestreo píxeles) | implementer: dur 3,5 s, cola frozen no-negra; verifier (4,0→4,25): dur 4,267, MAD(tail)=0, MAD(tail,srcLast)=0,277, luma 126 | media-run.log | OK |
| c | déficit >0,5 s → lanza (no tapa desajuste grosero) | implementer (0,7): FitError; verifier (0,8): FitError + NO output file; unit gate: runner-count=0 | media-run.log + gate | OK |
| + | audio embebido se preserva (no -an) | implementer test (d): stream de audio presente en la salida del trim | media-run.log | OK |
| + | boundary del umbral 0,49→hold / 0,50→error, PURO sin ffmpeg | unit `fit-segment.test.ts` verde en el gate | pnpm gate (2292 tests) | OK |
| + | sin regresión de otras piezas media | normalize (6), compose-variant (7), compose-master (7) verdes en la misma corrida | media-run.log | OK |

## Coste real
$0 — cero SDKs de pago. El diff no importa fal/anthropic/firecrawl/openai (grep confirmado; solo comentarios mencionan "fal"). Inputs 100 % sintéticos `lavfi` (`testsrc2`, `sine`). Barrel `index.ts` aditivo. vs estimado $0 → sin desviación.

## Veredicto
PASS — los tres casos de la Verificación literal pasan de verdad contra ffmpeg real en la imagen del worker, con los discriminantes de honestidad reforzados por una suite independiente del verifier (duraciones propias): (a) trim al final con arranque preservado por muestreo de píxeles, (b) hold del ÚLTIMO frame (idéntico, no negro, no no-op), (c) throw sin escribir output. Gate raíz verde (217/2292) incluye el boundary del umbral y el control negativo.

Notas / rarezas (aunque PASS):
- Las duraciones de salida no clavan el nominal al milisegundo (2,700→2,700, 4,25→4,267): es el alineado a frame del re-encode (30 fps → cuanto ~0,033 s), dentro de la tolerancia +-0,1 s que la propia Verificación implica y que los tests asertan.
- El módulo NO se cablea al DAG (eso es T5.5d, por diseño); T5.5b entrega solo la pieza reutilizable. Fuera de alcance.
- La suite media NO forma parte de `pnpm gate` (gated por RUN_MEDIA), por diseño del patrón T5.2/T5.3: corre en la imagen amd64. Reproducida por el verifier, no confiada.
