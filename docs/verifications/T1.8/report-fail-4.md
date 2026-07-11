# Verificación T1.8 — BriefSynthesizer (N3) · CICLO 4

- **Tarea**: T1.8 · BriefSynthesizer (N3) (`planning.md`)
- **Fecha**: 2026-07-11
- **Ejecutor**: verifier (contexto fresco, escéptico)
- **Sistema**: working tree de T1.8 sobre `a197fbb` · docker `ugc-postgres-dev` (Postgres 16, healthy) + `pnpm dev` (web:3001 + worker, migraciones aplicadas, secretos T0.14 desde BD)
- **Criterio**: el **NUEVO** (bound `<$0,25/brief`, PRD O1 revisado 2026-07-11; techo de reintento ≤$0,40)
- **Coste real de este ciclo**: **$0,00** (la única llamada de pago **no llegó a facturar**: la cuenta de Anthropic está sin saldo)
- **Ciclos anteriores**: FAIL #1 (`report-fail-1.md`), FAIL #2 (`report-fail-2.md`), FAIL #3 (`report-fail-3.md`)

---

## VEREDICTO CICLO 4: **FAIL — BLOQUEO EXTERNO (sin saldo en Anthropic)**

**No es un defecto del código. El implementer no tiene nada que arreglar.** Es una **parada del bucle
por prerequisito externo** (CLAUDE.md: «Prerequisito externo ⚠ … presupuesto real»). Se marca FAIL
porque **NO PUEDO CERTIFICAR UN PASS**, no porque haya encontrado un bug.

```
POST https://api.anthropic.com/v1/messages
400 {"type":"invalid_request_error",
     "message":"Your credit balance is too low to access the Anthropic API.
                Please go to Plans & Billing to upgrade or purchase credits."}
```

Confirmado **de forma independiente al código** con un `curl` directo de 8 tokens contra la API
(`req_011CcvmKMLQbgfY71qgQnfra`): mismo 400. No es una clave mal configurada ni un bug del cliente:
**la cuenta no tiene crédito.**

### Por qué esto BLOQUEA el PASS y no se puede rescatar con evidencia heredada

El hallazgo central de este ciclo, y la razón de que no valga reutilizar el ciclo 3:

| fichero | mtime | vs. corrida de pago del ciclo 3 (20:09–20:12) |
|---|---|---|
| `packages/core/prompts/brief-synthesizer.ts` | **20:30:09** | **POSTERIOR** |
| `packages/core/src/analyze/brief-synthesizer.ts` | **20:33:23** | **POSTERIOR** |

**El prompt que hoy se despacha NUNCA se ha ejercitado en vivo.** Los 19 cts en frío que medí en el
ciclo 3 son contra un prompt **que ya no existe**: después se añadieron las reglas **6.3.b** («no
infles el brief») y **6.3.c** («`assets.images` no es un vertedero»). Eso mueve las dos partidas del
coste, en direcciones opuestas y **ninguna de las dos es razonable a priori**:

- el prefijo del system **CRECE** (hoy 42.965 chars) → **más `cache_write`** → el coste **EN FRÍO
  puede SUBIR** (y el frío es justamente el número que la nota 5 del planning declara «el honesto»);
- la 6.3.c **poda el eco de `assets`** → el **output puede BAJAR** (y el output fue el **78 %** del
  coste en el ciclo 3).

Sin una generación real no hay forma analítica de saber dónde cae el neto respecto a 25 cts. **No
hay atajo: o se mide, o no se certifica.**

Y por el mismo motivo **NO arrastro como PASS las observables de calidad (O1–O4)**: dependen de lo
que el MODELO emite bajo el prompt vigente. Reutilizar los briefs del ciclo 3 sería **certificar el
prompt viejo** — exactamente el tipo de auto-indulgencia que el mandato escéptico prohíbe. La 6.3.c
ataca el contenido de `assets.images`: asumir que la salida no cambió sería una suposición, no una
verificación.

---

## Gate previo

`pnpm gate` **VERDE**: lint + typecheck + format:check + knip + test → **81 ficheros, 809 tests, 0
fallos**. El tier `live` es opt-in (`RUN_LIVE`): el gate no gasta.

---

## Resultado por observable (las 7 de la Verificación, criterio NUEVO)

| # | Observable (literal) | Estado ciclo 4 | Detalle |
|---|---|---|---|
| 1 | 2 URLs reales + 1 texto libre → briefs | **NO VERIFICABLE** | La única llamada de pago devolvió `api_error` por falta de saldo. **0 briefs producidos** contra el prompt vigente |
| 2 | Los briefs **validan contra Zod** | **NO VERIFICABLE** | Sin brief que validar. *(No se hereda del c3: depende del prompt, que cambió)* |
| 3 | `evidence` con citas **literales en el markdown** | **NO VERIFICABLE** | Idem |
| 4 | **5–10 ángulos distintos** | **NO VERIFICABLE** en vivo | El **prompt** ya pide 5–6 sin contradicción (verificado a $0), pero **no se ha observado la salida real** |
| 5 | **Coste <$0,25/brief en `/spend`** | **NO VERIFICABLE** | **ES LA CLÁUSULA QUE FALTA.** El coste EN FRÍO contra el prompt nuevo **no se ha podido medir**: la llamada no facturó |
| 6 | 2ª llamada: `cache_read_input_tokens > 0` | **NO VERIFICABLE** en vivo | El camino de `cache_control: ephemeral` sigue en el código (verificado a $0), pero hacen falta 2 llamadas reales para observarlo |
| 7 | Página adversarial **no corrompe el brief** | **NO VERIFICABLE** en vivo | `ANTI_INJECTION_BLOCK` sigue **verbatim del Apéndice A** (verificado a $0), pero la resistencia se observa contra la API real |

**0 de 7 observables re-verificadas en vivo este ciclo.** No por hallazgos negativos: por bloqueo.

---

## Lo que SÍ se verificó (a coste $0) — y sale VERDE

Todo esto es trabajo real de este ciclo contra el **código vigente**, y confirma que los fixes del
implementer son correctos *hasta donde se puede ver sin gastar*:

### 1. La contradicción del prompt: **RESUELTA**

La cacé en el ciclo 3 (§4 decía «entre 5 y 10 ángulos» mientras §6.3 decía «5; 6 máximo»).
Comprobado sobre el **string EXPORTADO** (`BRIEF_SYNTHESIZER_SYSTEM_PROMPT`, 42.965 chars), que es
lo que de verdad viaja a la API:

```
contradiccion[/entre\s+5\s+y\s+10\s+ángulos/i] = ausente OK
contradiccion[/5\s*[-–]\s*10\s+ángulos/i]      = ausente OK
contiene "5 ángulos" = true · "6 como máximo" = true · 6.3.b = true · 6.3.c = true
```

**Una sola verdad (5–6) en todo el prompt.** Las apariciones de «5 y 10» que quedan en el fichero
(líneas 247/259) son **comentarios de bloque** (`*`-prefixed), no forman parte del string. El guard
del implementer ahora es **regex insensible a mayúsculas** (`brief-synthesizer.test.ts:752-753`) —
el assert anterior era `not.toContain('Entre 5 y 10 ángulos')`, sensible a mayúsculas, y **por eso
no cazó** la contradicción en minúscula. El fix ataca la causa raíz del fallo del guard, no solo el
síntoma.

### 2. El REINTENTO sigue **ACOTADO** (re-ejecutado contra el código VIGENTE)

**No se hereda del ciclo 3**: `brief-synthesizer.ts` cambió a las 20:33, después de aquella
comprobación. Re-ejecutado contra el **servicio real** (`runSynthesizeBrief`, el que escribe
`cost_entry`) con un servidor HTTP local haciendo de Anthropic (`retry-check-c3.ts` →
`retry-check-c4.txt`). $0.

| escenario | llamadas | resultado | veredicto |
|---|---|---|---|
| **A) `parse_error` → `parse_error`** | **2** | `status=parse_error`; `usage` SUMA los dos (2000 in / 200 out) | ✓ reintenta |
| **B) `api_error` (400)** | **1** | `status=api_error`, **NO reintenta** | ✓ correcto |
| **C) `parse_error` → OK** | **2** | `status=synthesized`, brief recuperado; `usage` suma ambos | ✓ absorbe la deriva |

**El `cost_entry` SUMA los dos intentos en la BD** (no solo en memoria): 2 filas × `quantity = 2200`
tokens (2 × 1.100), no 1.100. **El contador no miente.** Es exactamente lo que exige la nota 4.

**Confirmación incidental en vivo**: el propio 400 por falta de saldo **no disparó reintento** (1
sola llamada, 427 ms). La rama `api_error` se comportó bien contra la API real. *(Es el mismo camino
que ya probé con el servidor falso — no cuenta como crédito parcial hacia la medición de coste.)*

### 3. Los caminos críticos de coste siguen intactos

- `thinking: { type: 'disabled' }` presente (si se omite, Sonnet 5 corre adaptive thinking y se
  factura a precio de OUTPUT — rompería cualquier bound).
- `cache_control: { type: 'ephemeral' }` sobre el system, presente.
- `ANTI_INJECTION_BLOCK` **verbatim del Apéndice A del PRD** (561 chars), interpolado en el prompt.

### 4. Los comentarios de coste del módulo: **corregidos**

Ya no afirman que el markdown sea la palanca principal. Ahora reflejan lo medido: la palanca
dominante fue **el recorte del VISUAL ANALYSIS** (10.996 → 1.126 tok, −88 %), y el prompt caching es
**la menos importante** (~$0,0045, el 1 %). Coinciden con mis mediciones.

---

## El techo del REINTENTO (≤$0,40): **tampoco se puede certificar**

La comprobación del reintento prueba el **flujo de control** (reintenta lo que debe, no reintenta lo
que no, y suma el coste). **No prueba el techo en dólares**: ese techo es **≈2× el coste en frío
real**, y el coste en frío real es justo lo que no se ha podido medir.

Aritmética a tener presente cuando haya saldo: si el frío nuevo saliera por encima de **~20 cts**,
la rama de reintento (≈2×) **rozaría o superaría los $0,40**. En el ciclo 3, con 19 cts de frío, la
medí en **32–38 cts**. Es un cálculo gratuito en cuanto exista el número: **hay que rehacerlo, no
darlo por bueno.**

---

## Coste de este ciclo

| Concepto | Importe |
|---|---|
| Anthropic — 1 síntesis en frío (allbirds) | **$0,00** — `400 credit balance too low`, **no facturó** |
| Anthropic — probe `curl` de 8 tokens (diagnóstico) | **$0,00** — mismo 400 |
| Retry-check (servidor local falso) | $0 |
| Firecrawl — no se scrapeó (markdowns del ciclo 2) | $0 |
| **TOTAL** | **$0,00** |

**Verificado en la BD, no de memoria**: el baseline de `cost_entry` es **idéntico antes y después**
(`anthropic`: 11 filas / 120 cts) y el proyecto de esta corrida (`01KX97XBYYM27EKJTZ32NDSAPB`) tiene
**0 filas** en `cost_entry`. Un 400 sin `usage` no factura. *(Buena señal colateral: el registro de
costes no inventa filas para llamadas fallidas.)*

**Acumulado de T1.8: ~$5,15** (estimado: $0,60). Este ciclo **no añade gasto**.

---

## Qué falta EXACTAMENTE para cerrar T1.8 (accionable)

**No hay acción para el implementer.** La única acción es del **usuario**:

1. **Recargar saldo en Anthropic** (Plans & Billing). Es el prerequisito externo bloqueante.
2. Con saldo, **una sola corrida** basta para las 7 observables (~$0,20–0,40 estimado). El driver ya
   está escrito y listo: **`docs/verifications/T1.8/verify-brief-c4.ts`** (1 llamada fría, con
   VisualAnalysis realista, contra el servicio real que escribe `cost_entry`). Para el resto
   (2ª llamada caliente → `cache_read>0`, texto libre, adversarial) está
   **`verify-brief-c3.ts`** (`VERIFY_STAGE=1` / `VERIFY_STAGE=2`).
3. **El número que decide es el de la llamada FRÍA** contra el prompt vigente, leído de `cost_entry`.
   Bound: **<25 cts**. Expectativa razonable: ~19–21 cts (el prompt creció; el 6.3.c puede compensar
   por el lado del output). **Pero es una expectativa, no una medición.**

---

## Rarezas / notas para la siguiente sesión

- **La suite verde NO detecta este bloqueo.** `pnpm gate` pasa con 809 tests porque el tier `live` es
  opt-in (`RUN_LIVE`). Un sistema sin saldo en Anthropic tiene **la suite en verde y el producto
  muerto**: N3 no puede producir ni un brief. Es exactamente el escenario para el que existe el gate
  de verificación en vivo. **Ojo con dar por buena una tarea de IA solo porque el gate está verde.**
- **El implementer cambió el prompt DESPUÉS de la medición de coste del ciclo 3 y declaró coste $0
  ("no ejecutó live").** Es honesto en cuanto al gasto, pero deja el sistema en un estado donde **el
  número del PRD (O1) se decidió con mediciones de un prompt que ya no se despacha**. La decisión del
  bound (25 cts) sigue siendo razonable —el delta esperado es pequeño—, pero **conviene reconfirmarla
  con el primer brief real que salga**, y ajustar la nota 5 del planning si el frío real se desvía.
- **`/spend` no se pudo re-verificar en el navegador** con datos nuevos de este ciclo (no hubo gasto
  nuevo que mostrar). La página renderizaba correctamente en el ciclo 3 (`01-spend-c3.png`).
- **Sigue viva la deuda de DX del puerto**: el 3000 lo ocupa un proceso ajeno, Next arranca en 3001 y
  el RSC de `/spend` apunta a `INTERNAL_API_URL ?? http://localhost:3000` → 500 silencioso. Se
  arranca con `INTERNAL_API_URL=http://localhost:3001`. **No es un bug de T1.8** (ya anotado).
- **`/spend` muestra agregados por proveedor/día, no coste por brief.** La cláusula «coste
  <$0,25/brief en `/spend`» no es literalmente leíble en la UI: el per-brief sale de `cost_entry`.
  (Anotado para T7.7.)

---

## Historial de la tarea

| ciclo | veredicto | causa |
|---|---|---|
| 1 | FAIL | `output_config` de Anthropic → 400 determinista: **cero briefs** (`report-fail-1.md`) |
| 2 | FAIL | Briefs correctos, pero **25–37 cts/brief** (input sin acotar), medidos con `visualAnalysis: null` (`report-fail-2.md`) |
| 3 | FAIL | Recortes efectivos (37→16 cts) pero **16–19 cts/brief**: el bound de $0,15 seguía roto, y lo rompía el OUTPUT (78 %) → **no era un bug, era una tensión de diseño** (`report-fail-3.md`) |
| — | *(decisión del usuario)* | **El bound sube a $0,25** (PRD O1). Se mantienen Sonnet 5 y el contrato de T1.1 |
| **4** | **FAIL — BLOQUEO EXTERNO** | **Sin saldo en Anthropic**: la única llamada de pago no facturó. El coste EN FRÍO contra el **prompt nuevo (nunca ejercitado en vivo)** queda SIN MEDIR. Los fixes verificables a $0 salen **todos verdes** |

---

## Evidencia (ciclo 4)

- `verify-brief-c4.ts` — driver del verifier del ciclo 4 (1 llamada fría, servicio real, VisualAnalysis realista). **Listo para re-ejecutar en cuanto haya saldo**
- `verify-run-c4.txt` — salida cruda: el `api_error 400` por falta de saldo
- `briefs-c4.json` — resultado de la corrida (status `api_error`, 0 ángulos, `usage` null)
- `retry-check-c4.txt` — **el reintento re-verificado contra el código vigente** ($0): A/B/C verdes, `cost_entry` suma los dos intentos
- `cost-baseline-c4.txt` — `cost_entry` (la BD): sin cambios respecto al baseline → **$0 gastados**
- `dev-server-c4.log` — arranque del sistema (web:3001 + worker, migraciones, secretos desde BD)
- `report-fail-1.md`, `report-fail-2.md`, `report-fail-3.md` — reports de los FAIL anteriores (memoria del proyecto)
- Evidencia del ciclo 3 (briefs, calidad, `/spend`, count-tokens): **presente pero NO se arrastra como PASS** — mide el prompt anterior
