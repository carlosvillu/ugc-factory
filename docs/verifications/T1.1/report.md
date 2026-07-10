# T1.1 · Contratos del análisis — VERIFICACIÓN: PASS

**Fecha**: 2026-07-10 · **Coste real**: $0 (solo tests + ajv local, sin APIs de pago) · **Base**: cab1ea2 + diff de T1.1

Verificación literal (planning.md): *"suite de tests con fixtures válidos e inválidos (brief sin ángulos, URL en modo manual, etc.) pasa; el JSON Schema generado se valida contra un validador draft 2020-12."*

Tarea de core PURO (contratos Zod + espejo JSON Schema + fixtures + tests) — no hay sistema que levantar. Verificada ejecutando la suite del paquete + un script INDEPENDIENTE del verifier (valores propios mutados, no la suite del implementer).

## Evidencia
- `verify.mts` — script independiente del verifier (importa los schemas de `@ugc/core`, muta sus propios fixtures).
- `verify-output.txt` — salida cruda: **19 OK / 0 FAIL**.
- Gate completo `pnpm gate` VERDE (534 tests, 51 files); `pnpm --filter @ugc/core test` VERDE (322 tests).

## Resultado por cláusula

| Cláusula | Caso (valores del verifier) | Esperado | Observado | OK |
|---|---|---|---|---|
| **1 · fixtures** | brief canónico | true | true | ✓ |
| | `angles: []` (sin ángulos) | false | false | ✓ |
| | 4 y 11 ángulos | false | false | ✓ |
| | 5 y 10 ángulos (límites del rango) | true | true | ✓ |
| | platform=manual + source_url no-null | false | false | ✓ |
| | platform=shopify + source_url=null | false | false | ✓ |
| | RawContent manual + url no-null | false | false | ✓ |
| **2 · espejo** | `Ajv2020.compile(productBriefJsonSchema)` | compila | function | ✓ |
| | `$schema` draft 2020-12 | igual | igual | ✓ |
| | additionalProperties:false en todo objeto | 17/17 | 17/17 | ✓ |
| | minItems/maxItems/minimum/maximum/… | 0 nodos | 0 nodos | ✓ |
| | divergencia 11 ángulos: espejo pasa / Zod rechaza | sí/sí | sí/sí | ✓ |

## Caza de falsos verdes (escepticismo activo)
1. **Trampa Zod-strip (v4)**: una clave extra en un brief válido NO cambia el veredicto (sigue `true`). Ningún caso inválido del implementer depende de "clave extra rechaza" (los `*-ausente` usan campo requerido `undefined` = rechazo legítimo). Sin falso verde.
2. **Espejo mentía (minimum/maximum de `review_count`)**: CONFIRMADO arreglado por code-review — 0 keywords prohibidos a cualquier profundidad; `PRUNED_KEYWORDS` los poda.
3. Rango de ángulos no desplazado: 5 y 10 pasan, 4 y 11 fallan → exactamente 5–10.
4. Bicondicional manual verificado en AMBAS direcciones y AMBOS contratos (ProductBrief.meta y RawContent).

**Ambas cláusulas PASAN → PASS global.**
