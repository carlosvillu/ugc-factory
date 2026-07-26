# Verificación T5.17 — El error de fal descarta el `body` que diagnostica la causa (saldo/credencial/input)

- **Tarea**: T5.17 · El error de fal descarta el `body` que diagnostica la causa (`planning.md`)
- **Fecha**: 2026-07-26
- **Ejecutor**: verifier (agente escéptico, contexto fresco) · backend-only (sin agent-browser: la Verificación asera contra `step_run.error` en BD, no contra UI)
- **Sistema**: working tree sin commitear sobre `62c1d85` (rama `docs/f5-cost-reprojection`); Postgres 16 real vía Testcontainers (colima, `TESTCONTAINERS_RYUK_DISABLED=true`). Diff bajo verificación en `baseline-diff.patch` (375 líneas). Código que corre = el del diff (byte-idéntico tras cada control negativo).

## Verificación esperada (literal de planning.md)
> Con el fake de fal devolviendo 403 con un `body` de causa conocida, el `step_run.error` persistido incluye el `detail` del body (el operador puede leer «Exhausted balance» / «invalid api key» / el error de validación); sin el fix, ese detalle NO está. La causa del fallo es diagnosticable desde la evidencia que el producto guarda, no solo desde un probe externo.

## Superficie y por qué
Backend puro. La Verificación asera contra `step_run.error` (columna jsonb `error`), la evidencia PERSISTIDA. El sistema real es el consumer (`step-execute.ts`) + `transition()` + Postgres real, conducido vía Testcontainers, leyendo el jsonb crudo por `SELECT error FROM step_run`. NO se asera contra `GET /api/steps/[id]`: ese endpoint aplana `error` a `message` string (`route.ts:29 errorMessageOf`) y el `detail` structured no llega a la UI hoy — deuda declarada, no defecto de T5.17.

## Pasos ejecutados
1. **Baseline**: `git diff > baseline-diff.patch`. Confirmado 401/403/422 en `FAL_PERMANENT_STATUSES` (`_shared.ts:47`).
2. **Baseline verde**: `n7-provider-error-detail.test.ts` → 2/2 PASS (`01`, exit 0). Unit `fal-client.test.ts` → 29/29 PASS (`02`, exit 0).
3. **Test propio del verifier** (fixtures propios; `zzz-t517-verifier.test.ts.txt`): conduce por el consumer REAL las causas que el implementer NO cubría end-to-end — 401 «Invalid API key» y 422 validación (array) + 422 signed-URL — y VUELCA el jsonb crudo (`03-raw-jsonb-dump.txt`). 3/3 PASS (`03-verifier-extended.txt`, exit 0).
4. **Control negativo A**: revertido SOLO el cómputo de `detail` en `toProviderError` (`const detail = undefined`) → integración del implementer ROJO 2/2 en `expect(err?.detail).toBeDefined()` (`04-ctrlneg-A-implementer.txt`); test propio ROJO 3/3 (`04-ctrlneg-A-verifier.txt`); unit ROJO 4/25 en los casos de detail (`04-ctrlneg-A-unit.txt`). Restaurado → byte-idéntico.
5. **Control negativo B**: eliminada SOLO la línea de redacción → unit ROJO 1/29, exactamente el caso signed-URL, con `SECRET123` filtrado (`05-ctrlneg-B-unit.txt`). Restaurado → byte-idéntico (`06-restore-check.txt`).
6. **No-regresión T5.16**: `n7-permanent-provider-error.test.ts` + `n7-retry-budget.test.ts` → 7/7 PASS (`07`). El propio test de detail prueba 403→1 submit (permanente, no re-paga) y 429→>1 submit (sigue retryable).
7. **Gate completo**: `pnpm gate` (`08-gate.txt`, última línea `REAL_EXIT=`).

## Evidencia persistida (jsonb crudo de `step_run.error`, de `03-raw-jsonb-dump.txt`)
- **401**: `detail = "{\"detail\":\"Invalid API key provided.\"}"`, `status = 401`, `permanent = true`. El `message` re-inyecta «Causa (fal): {…Invalid API key…}» vía `_shared.ts`.
- **422**: `detail` serializa el ARRAY entero (`msg:"invalid voice id"`), sin `[object Object]`, `status = 422`.
- **422 signed-URL**: el jsonb crudo NO contiene `SECRET123` en NINGUNA parte; queda `x.mp3?<redacted>`.

## Prueba anti-verde-decorativo (anti-T1.9)
Seam = cliente fal REAL (`makeFalClient`) con `fetch` inyectado (no un doble que lanza `FalProviderError`). El body servido NO trae `.message` → el SDK real hace `message = statusText` (`Forbidden`/`Unauthorized`), el síntoma exacto del bug. En el jsonb, el `403: Forbidden` NO nombra la causa; la causa SOLO aparece por el nuevo campo `detail`. Controles negativos A/B confirman que los asserts muerden en el punto que el fix toca.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | 403 → `step_run.error` incluye `detail` («Exhausted balance») | `detail` con «Exhausted balance», `status=403`, `permanent=true` | 01 | OK |
| 2 | «invalid api key» (401) diagnosticable | `detail` «Invalid API key provided.» en jsonb crudo | 03 | OK |
| 3 | «error de validación» (422) diagnosticable | `detail` array serializado, sin `[object Object]` | 03 | OK |
| 4 | Sin el fix, el detalle NO está | Revert → `detail` undefined, ROJO en 3 superficies | 04 | OK |
| 5 | Clasificación T5.16 intacta | 403→1 submit; 429→>1 submit; 7/7 no-regresión | 01/07 | OK |
| 6 | Seguridad: signed URL no persiste `sig` | `SECRET123` ausente; redacción; control negativo filtra | 03/05 | OK |
| 7 | Gate completo verde | ver `08-gate.txt` última línea | 08 | OK |

## Control negativo
Reproducido por el verifier (no confiando en el informe del implementer), restaurando el árbol byte-idéntico tras cada uno.

**(A) Revertir la captura de `detail` en `toProviderError`** (`const detail = undefined` en `fal-client.ts`) → el detalle desaparece del `step_run.error` persistido en las 3 superficies:
- Integración `n7-provider-error-detail.test.ts` → ROJO 2/2: `AssertionError: expected undefined to be defined` en `expect(err?.detail).toBeDefined()` (`04-ctrlneg-A-implementer.txt`).
- Test propio del verifier (401/422) → ROJO 3/3 (`04-ctrlneg-A-verifier.txt`).
- Unit `fal-client.test.ts` → ROJO 4/25 en los casos de detail (`04-ctrlneg-A-unit.txt`).
Restaurado el fix → verde de nuevo, árbol byte-idéntico al baseline.

**(B) Eliminar la línea de redacción de query-strings en `normalizeErrorBody`** → el secreto de la signed URL se filtra al jsonb persistido:
- Unit → ROJO 1/29, exactamente el caso signed-URL: `SECRET123` presente en el `detail` persistido (`AssertionError: expected '…?sig=SECRET123…' not to contain 'SECRET123'`) (`05-ctrlneg-B-unit.txt`).
Restaurado → verde, byte-idéntico (`06-restore-check.txt`).

Ambos controles muerden en el punto exacto que el fix toca. Un test que nadie ha visto fallar no se sabe si muerde; estos se vieron rojos.

## Coste real
$0 — ninguna API de pago (fake de fal / msw; NUNCA fal real). Coincide con el estimado ($0).

## Veredicto
**PASS** — el `detail` del body de fal (403/401/422) sobrevive en `step_run.error` por el camino real del consumer para las tres causas de la Verificación; sin el fix desaparece (control negativo reproducido en 3 superficies); T5.16 no regresó; y el `sig` de una signed URL reflejada no se persiste.

### Notas / Rarezas (aunque PASS)
1. **Deuda declarada (no defecto)**: `GET /api/steps/[id]` aplana `error` a `message` string; el campo `detail` structured NO llega a la UI hoy. El operador lee la causa porque `_shared.ts` la RE-INYECTA en el `message` («Causa (fal): …»). Persistir `detail` en BD (lo que pide la Verificación) está OK; exponerlo structured en la UI es deuda propia (`[[t517-observability]]`).
2. **Redacción más estrecha que la Entrega (no bloquea)**: `normalizeErrorBody` solo redacta query-strings de URLs `https?://…?…`. Una credencial reflejada FUERA de query-string (p.ej. `{"detail":"auth failed for key abc:def"}`) se persistiría verbatim. No bloquea: la Verificación no menciona secretos y el brief pide solo la redacción de signed-URL, que el código SÍ hace; el propio comentario lo marca como deuda (`sanitizeCausedBy` completo). Orden correcto: redacta antes de recortar a 2 KB.
3. Metodología: `git checkout` de un fichero sin commitear los DESCARTA (ocurrió una vez); `baseline-diff.patch` fue la red de seguridad para restaurar byte-idéntico tras cada control negativo.
