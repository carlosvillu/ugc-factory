# T1.8 · BriefSynthesizer (N3) — VERIFICACIÓN: **FAIL**

- **Fecha**: 2026-07-11
- **Verifier**: contexto fresco, sistema real (BD dev `ugc-postgres-dev`, secretos T0.14, API real de Anthropic)
- **SHA / working tree**: diff de T1.8 SIN commitear sobre `a197fbb` (working tree = el código verificado)
- **Coste real**: **$0** — ver §Coste (ninguna llamada de síntesis llegó a facturarse)

---

## Veredicto en una línea

**El BriefSynthesizer NO produce NI UN SOLO brief contra la API real de Anthropic.** Toda llamada
a `messages.parse` con `output_config: zodOutputFormat(ProductBriefSchema)` es rechazada con
**HTTP 400 `invalid_request_error`**, de forma **determinista** (2/2 sondas, distintos `request_id`):

```
400 {"type":"error","error":{"type":"invalid_request_error","message":
"Schemas contains too many parameters with union types (19 parameters with type arrays or anyOf).
This causes exponential compilation cost. Reduce the number of nullable or union-typed parameters
(limit: 16 parameters with unions)."},"request_id":"req_011CcvTQytdhXexpSDKVczvu"}
```

El `catch {}` desnudo de `packages/core/src/analyze/brief-synthesizer.ts:190` **se traga ese 400** y
lo reclasifica como `status: 'parse_error'` — que es exactamente por qué el fallo llegó hasta aquí
sin que nadie lo viese. El propio tier live del implementer lo reproduce: **3 de sus 4 tests live
FALLAN** con `expected 'parse_error' to be 'synthesized'`, en <1 s cada uno (demasiado rápido para
ser una síntesis real).

---

## Gate previo

`pnpm gate` en VERDE antes de verificar: lint + typecheck + format:check + knip + test →
**81 ficheros, 785 tests, todos pasan**. El fallo NO es de la suite hermética: es que la suite
hermética mockea la API y por tanto nunca vio el 400.

---

## Resultado por observable

| # | Observable (literal de la Verificación) | Esperado | Observado | OK |
|---|---|---|---|---|
| 1 | 2 URLs reales + 1 texto libre → 3 briefs | 3 briefs | **0 briefs**: toda síntesis 400ea antes de mirar el contenido | ✗ |
| 2 | Los briefs validan contra Zod | válidos | **N/A** — no hay brief que validar | ✗ |
| 3 | `evidence` con citas literales en el markdown | citas reales | **N/A** — no hay brief | ✗ |
| 4 | 5–10 ángulos distintos | 5–10 | **N/A** — no hay brief | ✗ |
| 5 | Coste <$0,15/brief **en `/spend`** | filas `anthropic`/`tokens` <15 cts | **CERO filas** de T1.8 en `cost_entry`. La única fila `provider='anthropic'` de la BD (1 ct, 7008 tokens, 12:05) es de **T1.7** (Haiku). Un 400 no factura → no hay gasto que registrar | ✗ |
| 6a | System prompt ≥ mínimo cacheable | >4096 tok | **8727 tokens** (`count_tokens` real contra `claude-sonnet-5`) — **supera el mínimo** | ✓ |
| 6b | 2ª llamada: `cache_read_input_tokens > 0` | >0 | **INVERIFICABLE**: el prompt es lo bastante grande para cachear, pero ninguna llamada COMPLETA jamás, así que `cache_read` no se puede observar | ✗ |
| 7 | Texto adversarial no corrompe el brief | brief íntegro | **N/A** — el 400 ocurre antes de que el modelo lea nada | ✗ |

**Solo O6a pasa.** Y pasa en el vacío: el prompt cachea… si alguna llamada llegase a salir.

---

## Causa raíz

`ProductBriefSchema` (T1.1, `packages/core/src/contracts/product-brief.ts`) tiene **24 campos
`.nullable()`** (más uniones/enums opcionales). Al serializarse a JSON Schema para el structured
output, la API cuenta **19 parámetros con `anyOf`/type-array** y **rechaza el schema: el límite
es 16**.

Por qué T1.7 sí funcionó y T1.8 no: `VisualAnalysisSchema` tiene **6** `.nullable()` — muy por
debajo del límite. El contrato de T1.8 es un orden de magnitud más rico, y ahí es donde revienta.

Es un **límite de la plataforma**, no un fallo de red ni de credencial: la key es válida (el
`count_tokens` de la misma key devuelve 8727 tokens sin problema), el error es de **schema**, y por
tanto es **independiente del contenido del user message** — las 2 URLs reales del enunciado darían
el mismo 400. Por eso NO se gastó ni un céntimo en Firecrawl ni en síntesis: el fallo está aguas
arriba de cualquier URL, y demostrarlo con tráfico real habría sido quemar dinero para obtener el
mismo 400.

---

## Qué debe arreglar el implementer (accionable)

1. **Bajar de 16 los parámetros con unión del schema que viaja en `output_config`.** Opciones (a
   decidir con el PRD §13.2 / Apéndice A delante, puede ser cambio de alcance):
   - Sustituir `.nullable()` por campos **opcionales** o por centinelas (`""`, `[]`) donde la
     semántica lo aguante, y re-nullificar tras el parse.
   - Enviar a la API un **schema reducido** (el de extracción) y conservar el `ProductBriefSchema`
     completo solo como red de validación local del `safeParse` — la separación ya está insinuada en
     el comentario de `brief-synthesizer.ts:206-213`.
   - Trocear la síntesis, si el schema no se puede adelgazar (contradice la Entrega "una llamada",
     así que sería cambio de alcance → preguntar al usuario).
2. **Dejar de tragarse el error.** `catch {}` (brief-synthesizer.ts:190) mapea un **400 duro de la
   API** al mismo `status: 'parse_error'` que un output malformado. Son dos mundos: uno es "el
   modelo respondió raro" (recuperable, se pagaron tokens) y el otro es "nuestra petición es
   inválida" (nunca va a funcionar, no se paga nada). El error debe **propagarse o loguearse con su
   mensaje**; si no, un fallo total del paso se disfraza de degradación tolerable. Esta es la razón
   por la que el bug llegó a verificación.
3. **La suite hermética no puede volver a certificar esto.** Los mocks devuelven briefs bonitos y
   nunca ejercitan la validación de schema del servidor. El tier live existe justo para esto — y
   estaba **rojo**: hay que correrlo (o al menos el `count_tokens` + una síntesis) ANTES de dar la
   tarea por hecha.

---

## Coste

| Concepto | Importe |
|---|---|
| `count_tokens` (×3, incl. el del tier live) | ~$0 (no facturable) |
| Síntesis Sonnet 5 | **$0** — todas rechazadas con 400 antes de procesar tokens |
| Firecrawl | **$0** — no se llegó a ingerir (fallo aguas arriba) |
| **TOTAL** | **$0** (vs estimado $0,60; cap $1,80) |

Que el coste sea $0 **es en sí un hallazgo**: el bound "<$0,15/brief" de la Verificación es hoy
**inmedible**, porque no existe ninguna llamada completada que medir.

---

## Evidencia

- `docs/verifications/T1.8/probe.ts` — sonda del verifier: reproduce el camino EXACTO del producto
  (`messages.parse` + `zodOutputFormat(ProductBriefSchema)` + `thinking:disabled` + `claude-sonnet-5`
  + `cache_control`) contra la API real y **muestra el error que el `catch` oculta**.
- `docs/verifications/T1.8/probe-output.txt` — salida cruda: `SYSTEM PROMPT TOKENS: 8727` + el 400.
- `docs/verifications/T1.8/test-live-output.txt` — salida cruda de `pnpm test:live` del implementer:
  **3 failed | 1 passed**. El único que pasa es el `count_tokens`; los 3 que hacen síntesis real
  fallan.

## Rarezas para la siguiente sesión

- **`.env.test.local` creada por mí** (gitignored) con la `ANTHROPIC_API_KEY` real copiada de `.env`.
  Es lo que `pnpm test:live` necesita; queda ahí para el siguiente ciclo.
- El tier live (`pnpm test:live`, guard `LIVE_BUDGET_USD`) **funciona y es correcto**: fue lo que
  cazó el fallo. El problema no es el arnés live, es que nadie lo ejecutó en verde.
- La única fila `anthropic` del ledger es de T1.7. `/spend` está sano; simplemente no hay nada de
  T1.8 que mostrar.
