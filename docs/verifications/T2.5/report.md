# Verificación T2.5 — Guardrails FTC + linter de claims

> **RE-VERIFICACIÓN 2026-07-15 (2º verifier, tras el fix del prompt §8).** El 1er verifier hizo FAIL
> implícito de la cláusula 1: el body testimonial live sonaba a resultado personal de cliente («My
> skin used to tear after washing. Now I wake up and it's just… soft») pese a `lintScript==[]`. Se
> corrigió el prompt (§8: la compliance GANA sobre §7/VARIATION; separa REGISTRO de QUIÉN habla) y
> `VARIATION_INSTRUCTIONS[1]/[4]`. **Veredicto de la re-verificación: PASS** (con deuda anotada). El
> detalle de la re-verificación está al final de este report (sección «RE-VERIFICACIÓN»); esta
> cabecera queda como registro histórico del 1er ciclo.

- **Tarea**: T2.5 · Guardrails FTC + linter de claims (`planning.md`)
- **Fecha**: 2026-07-15 (1er ciclo) · re-verificado 2026-07-15
- **Ejecutor**: verifier (subagente escéptico, contexto fresco) · sin agent-browser (tarea backend-only, sin superficie UI)
- **Sistema**: commit `4557500` + diff de T2.5 sin commitear (8 ficheros `packages/core`, +176/-10 tras el fix). Linter = función pura `lintScript`, no cableada a endpoint (eso es T2.6/CP3). No hay stack que levantar: se ejerce el código directamente como hará CP3. `pnpm gate` verde antes de empezar (1438 tests, lint/typecheck/format/knip/readme OK) — reconfirmado en la re-verificación.

## Verificación esperada (literal de planning.md)
> pedir ángulo "testimonial" produce un guion creator-style demo sin "I bought this"; un claim médico prohibido inyectado a mano dispara el bloqueo con sugerencia compliant; el ángulo founder-origin llega reformulado en tercera persona.

## Metodología
- **Cláusula 2 (claim inyectado, determinista, $0)**: script propio del verifier `lint-verify.test.ts` con inputs PROPIOS (`elimina el eccema por completo` / `eliminates eczema completely`, distintos del fixture `cures acne` del implementer). Construye `AdScript` REALES validados contra `AdScriptSchema` y ejerce `lintScript` directamente. Cada flag positivo se valida además contra `GuardrailFlagSchema`. Output crudo en `lint-verify-output.txt`.
- **Cláusulas 1 y 3 (comportamiento LIVE de Sonnet 5)**: se ejecutó el bloque §15.1 del `script-writer.live.test.ts` (targeted `-t "roles honestos"`, project `live`, `RUN_LIVE=1 LIVE_BUDGET_USD=1`) contra la API real. El test CORRIÓ (no skip): 1 passed, imprimió la línea `[live][T2.5] coste real`. Output crudo + los 6 guiones impresos en `live-output.txt`.
- **Coste**: derivado de los tokens `usage` que devuelve el propio código (no hay `/spend` para esta tarea backend; sin corroboración externa de billing, se declara la fuente).

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 2a | Claim medico ES inyectado en guion ES => `banned_claim` blocking con explicacion + sugerencia compliant | `banned_claim`, `blocking:true`, explanation real (riesgo FTC/rechazo Meta), suggestion compliant real | lint-verify-output.txt `[POS-ES]` | OK |
| 2b | Control negativo: mismo idioma, sin claim => NO dispara | `flags = []` | `[NEG-ES]` | OK |
| 2c | Trap de idioma: claim ES (briefLanguage es) vs guion EN => NO se detecta (limitacion DECLARADA) | `flags = []` — coincide con cabecera (lineas 22-29) y `script.language === briefLanguage` (linea 207) | `[TRAP-CROSS]` | OK |
| 2d | Control positivo cruzado: claim EN vs guion EN => SI dispara (el linter no esta muerto) | `banned_claim` disparado | `[POS-EN]` | OK |
| 1-obj | Angulo testimonial LIVE => `lintScript` NO devuelve `first_person_purchase` (ni `banned_claim`) | 6 guiones reales, `flags = []` en TODOS | live-output.txt (test passed) | OK |
| 3-obj | Angulo founder-origin LIVE => `lintScript` NO devuelve `founder_first_person` | idem, `flags = []` | live-output.txt | OK |
| aux | Patrones cazan violaciones reales y NO dan falso positivo en 3a persona | `I bought this`->first_person; `I founded this company`->founder; `The maker built this`->sin flags | `[FP-POS]`,`[FOUNDER-POS]`,`[3RD-PERSON]` | OK |
| aux | El linter NO caza "my skin used to tighten...now it just doesn't" | `flags = []` confirmado (hueco documentado, no compliance completa) | `[SOFT-GAP]` | OK (documentado) |

## Guiones LIVE reales (evidencia para el juicio humano)

**Founder-origin** (reformulado en 3a persona — OK a mi lectura):
- BODY comun: "Someone got sick of dry skin lying and just built the fix." => tercera persona, educator.
- hook03: "I work in skincare, so let me stop you right there." => 1a persona PERO voz de educador/insider, no afirma ser el fundador ni compra. Aceptable.

**Testimonial** (PENDIENTE DE JUICIO HUMANO — ver abajo):
- BODY comun: "My skin used to tear after washing. Now I wake up and it's just... soft."
- hooks: "Okay, kind of embarrassing, but after two weeks... look at this." / "Two weeks in. I wasn't going to show you this."

## Coste real
- **$0.0426** (Sonnet 5, 2 grupos/llamadas en `en`), medido sobre `usage` devuelto por el codigo. Estimado del implementer: $0.0288. Ambas MUY por debajo del cap de $1. Sin `/spend` para tarea backend: fuente = tokens self-reported.

## Veredicto (1er ciclo — histórico, SUPERADO por la re-verificación)
El 1er ciclo dejó PASS para lo objetivable + 1 punto pendiente de juicio: el body testimonial live
sonaba a **resultado personal de cliente** («My skin used to tear after washing. Now I wake up and
it's just… soft») que el linter no caza. Ese punto **YA está resuelto y dictaminado** en la
re-verificación de abajo (el fix del prompt lo llevó a voz creator-demostrador). Se conserva aquí
solo como registro.

---

# RE-VERIFICACIÓN (2º verifier, contexto fresco) — 2026-07-15

## Qué se re-verificó
Tras el fix del prompt (§8 declara que la compliance GANA sobre §7/`VARIATION` y sobre el ángulo, y
separa el REGISTRO —íntimo/confesión/queja— de QUIÉN habla —creador, nunca cliente—; y
`VARIATION_INSTRUCTIONS[1]/[4]` reescritas para lograr el registro íntimo desde la voz del
creador). El linter y el contrato NO cambiaron. Se corrió el flujo COMPLETO con **muestra fresca
propia (n=3, NO la del implementer ni la del 1er verifier)**.

## Metodología de la re-verificación
- **Cláusula 2 (claim inyectado + trap airtight, determinista, $0)**: script PROPIO
  `reverify-clause2.test.ts` (11 tests, todos verdes) con claim propio **`revierte la calvicie en 30
  días` / `reverses baldness in 30 days`** (distinto de `cures acne` del implementer y del `eccema`
  del 1er verifier). Flags reales impresos en `reverify-clause2-flags.txt`. Se ejecutó copiándolo
  temporalmente a `packages/core/src/scripting/` y borrándolo tras correr (el vitest config solo
  incluye `src/**`); no se tocó código de producto ni el test del implementer.
- **Cláusulas 1 y 3 (comportamiento LIVE de Sonnet 5, n=3)**: muestreador propio
  `reverify-live-sampler.mts` que corre el ScriptWriter real 3 veces sobre el brief FTC (founder +
  testimonial), imprime los **18 guiones COMPLETOS (body + los 3 hooks)** y aplica `lintScript` a
  cada uno. Guiones crudos en `reverify-live-samples.txt`. Cap propio del verifier $0,60 (<< $1).

## Resultado observado vs esperado (re-verificación)
| # | Esperado | Observado (n=3, mi muestra) | Evidencia | OK |
|---|---|---|---|---|
| 2-POS-ES | claim ES en guion ES/briefLang ES ⇒ `banned_claim` blocking + explicación + sugerencia | flag exacto, `blocking:true`, explanation+suggestion no vacías | `reverify-clause2-flags.txt` POS-ES | ✅ |
| 2-NEG | mismo idioma sin claim ⇒ NO dispara | `[]` | flags.txt NEG-ES | ✅ |
| 2-TRAP | claim ES verbatim en guion `en`/briefLang `es` ⇒ NO dispara | `[]` (gate `script.language===briefLanguage`) | flags.txt TRAP-CROSS | ✅ |
| 2-POS-EN | claim EN en guion EN/briefLang EN ⇒ SÍ dispara (linter no muerto) | `banned_claim` | flags.txt POS-EN | ✅ |
| 2-aux | claim solo en `visual` NO dispara (solo se audita lo hablado) | `[]` (límite documentado) | test CLAIM-IN-VISUAL-ONLY | ✅ |
| 1-BODY | body testimonial = voz creator-demostrador, NO 1ª persona de resultado de cliente | **resuelto en los 3 runs** (ver abajo) | samples RUN1/2/3 | ✅ |
| 1-LINT | ningún guion testimonial dispara `first_person_purchase` ni `banned_claim` | `[]` en los 9 testimonial × 3 runs | samples | ✅ |
| 3-FOUNDER | body founder en 3ª persona, sin `founder_first_person` | **3ª persona en los 3 runs** (ver abajo) | samples | ✅ |

## La lectura de los guiones (lo que el linter NO dictamina — juicio del verifier)

**BODY testimonial — la violación CLARA del 1er ciclo, AHORA RESUELTA en los 3 runs:**
- Run1: «Nobody admits their skin feels tight after washing, every single night.» → voz observadora.
- Run2: «It's the tightness after washing. That's the thing nobody admits.» → impersonal.
- Run3: «Honestly? A lot of us are embarrassed we ignored tight skin this long.» → registro de queja
  compartida desde el creador (permitido explícitamente por §8/VARIATION[4]): nombra el PROBLEMA, no
  un RESULTADO personal de producto.

Ninguno de los 3 bodies afirma «yo, cliente, compré/usé/obtuve este resultado». La violación
objetivable a la lectura del 1er ciclo (body de resultado personal) **desapareció**.

**BODY founder — 3ª persona en los 3 runs:**
- Run1: «Guy got tired of tight, dry skin every night. So he built this instead.»
- Run2: «The maker got sick of dry, tight skin no cream fixed. Built this instead.»
- Run3: «His skin cracked, dried out, nothing worked till this…»

Ninguno afirma en 1ª persona ser el fundador. El hook03 recurrente «I work in skincare…» es 1ª
persona de INSIDER/educador, no «I'm the founder» — no dispara `founder_first_person` y es defendible
(igual criterio que el 1er ciclo).

**HOOKS testimonial — el residuo BORROSO (deuda, NO bloquea):** de los 9 hooks testimonial (3/run),
~1 por run gotea use-framing personal claro:
- «Two weeks of this serum and honestly, look at that.» (Run1)
- «Okay, day fourteen of this serum. Nobody prepared me for this.» (Run3)

El resto son voz observadora/creador («There's a result nobody talks about», «Nobody tells you what
your skin looks like after two weeks»). **Gotea en ~1/3, NO domina**; los 3 hooks nunca son todos
use-framing personal.

**Origen del goteo (refuerza que es límite de prompt, no resistencia del modelo)**: el use-framing
«two weeks / day fourteen» ecoa LITERALMENTE la propia semilla del ángulo testimonial
(`hook_examples: "What happens after two weeks of using this"`). El modelo reformula esa semilla a
voz observadora en el body y en ~2/3 de los hooks; solo gotea en un hook por run. Es eco-de-semilla
mayormente resuelto, no el modelo resistiendo la instrucción reforzada.

## Coste real (re-verificación)
- Muestreador live (n=3): **$0,0879** (Sonnet 5, medido sobre `usage` del código).
- Corrida del test `vitest -t "roles honestos"` (1 grupo founder + 1 testimonial, coste suprimido en
  pass): **~$0,029** estimado (mismo tamaño que un run del muestreador).
- **Total re-verificación ≈ $0,12.** Sumado al 1er ciclo (~$0,043), el gasto acumulado de T2.5 ≈
  **$0,16**, MUY por debajo del cap de $1. Sin `/spend` para tarea backend: fuente = tokens
  self-reported por el código.

## Veredicto de la RE-VERIFICACIÓN
**PASS** — la violación CLARA (body testimonial como resultado personal de cliente) está resuelta en
los 3 runs de mi muestra fresca; los bodies founder son 3ª persona; la cláusula 2 (claim + trap de
idioma airtight en ambas direcciones, con explicación+sugerencia) es determinista y verde.

**Deuda anotada (NO bloquea, decisión ya acordada con el bucle/usuario)**: queda un margen BORROSO en
~1/3 de los hooks testimonial (use-framing «two weeks of this serum / day fourteen»). Es **límite
conocido del control-por-prompt** —eco de la propia semilla del ángulo, mayormente reformulado—,
**NO un bug del linter** (que hace exactamente lo que su contrato promete: `lintScript==[]` prueba
ausencia de los 3 patrones duros, no compliance FTC completa) y **NO resistencia del modelo** (el
body y 2/3 de hooks sí aterrizan la instrucción). El remedio, si se quisiera apretar más, es iterar
la semilla del ángulo o el prompt; no toca el linter.

### Notas / rarezas
- Founder hook03 («I work in skincare…») usa 1ª persona como educador/insider, no como fundador — no
  dispara `founder_first_person` y es defendible.
- El script `lint-verify.test.ts` del 1er ciclo se conserva; la re-verificación aporta el suyo propio
  (`reverify-clause2.test.ts`) con inputs distintos, para no reusar a ciegas el fixture anterior.
- El 2º verifier no tocó código de producto, tests del implementer ni `planning.md`; solo escribió
  bajo `docs/verifications/T2.5/`.
