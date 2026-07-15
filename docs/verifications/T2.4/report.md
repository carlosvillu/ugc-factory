# Verificación T2.4 — ScriptWriter (N5)  [RE-VERIFICACIÓN tras FAIL]

- **Tarea**: T2.4 · ScriptWriter (N5) (`planning.md`)
- **Fecha**: 2026-07-15
- **Ejecutor**: verifier (agente escéptico, contexto fresco) · vitest 4.1.10 · sin agent-browser (tarea 100% backend/core)
- **Sistema**: working tree SUCIO sobre commit `ff364df` (el diff de T2.4 sin commitear). Docker Desktop (Postgres 16 vía Testcontainers para la integración) + API REAL de Anthropic (Sonnet 5) para el tier live.

## Contexto: este es un RE-TEST tras un FAIL

La verificación anterior (mismo día) hizo **FAIL en la cláusula 4a**: la 2ª corrida live produjo un
guion `en` de **16 s embarcado como `scripted`** (fail-OPEN). El implementer aplicó 3 palancas:

1. **FAIL-CLOSED**: nuevo estado `over_budget` (`ScriptWriterStatus` + `STATUS_SEVERITY`). Si tras
   `MAX_SCRIPT_ROUNDS` el guion sigue > `maxSeconds`, `writeGroup` devuelve `over_budget` (NUNCA
   `scripted`); los guiones pagados se devuelven, el estado dice la verdad (`script-writer.ts:627-631`,
   `:640-642`). El path que embarcaba a 16 s como `scripted` está BORRADO.
2. **MIRA APRETADA**: `PROMPT_AIM_FACTOR = 0.8` en `wordBudgetFor` (`timing.ts:35,48`). El CHECK sigue
   en `maxSeconds` (`budgetViolation`).
3. **Reintentos 1->2**: `MAX_SCRIPT_ROUNDS = 3` (`script-writer.ts:91`).

## Verificación esperada (literal de planning.md)
> para la matriz de T2.2, los 12 guiones validan contra Zod; los de es suenan nativos (revisión humana); en hook-testing los bodies de las variantes del mismo ángulo son **textualmente idénticos** (diff vacío); `est_seconds` <= **techo del preset (§8.4: hook-test 15 s)** en todos —el techo del rango, no el objetivo—, **y un `est_seconds` de 17 s (fuera de rango) SÍ es rechazado por el validador**; **un hook de librería con `{pain}` renderizado contra un brief cuyo `pain` tiene 12 palabras produce un hook de <=12 palabras habladas** (el truncado al presupuesto se aplica de verdad); **el guion de una variante `language: 'en'` compuesta desde un brief en español está ÍNTEGRAMENTE en inglés — hook incluido** (no se cuela la semilla en español).

## Pasos ejecutados

1. **Leí el código del fix** (no me fié del informe): `writeGroup` (`script-writer.ts:617-644`)
   devuelve `over_budget` (no `scripted`) cuando `budgetViolation` muerde en la última ronda; el path
   viejo está BORRADO. El agregado `write` (`:678`) propaga el estado más severo vía `STATUS_SEVERITY`.
2. **Tests deterministas (offline, $0)** — `unit.txt`: `script-writer.test.ts` + `timing.test.ts` +
   `placeholders.test.ts` -> **37/37 pass**. Todos los load-bearing corrieron (NO skip), en verbose.
3. **Test integración (Docker + Postgres, msw-mockeado, $0)** — `integration.txt`:
   `write-scripts.test.ts` -> **2/2 pass**. Key `sk-ant-fake-for-tests` (mock msw): NO gasta.
4. **Test live (API REAL, gasta $)** — `live.txt`: `script-writer.live.test.ts`, SCOPED a ese único
   fichero (hay OTRO live, `brief-synthesizer.live.test.ts` de T1.8, que NO se corrió para no gastar).
   Ledger aislado, cap $0,30 -> **2/2 pass**. Ambos grupos (`en` y `es`) salieron `scripted`, todos <= 15 s.
5. **Guiones ES persistidos legibles** (FINALES post-fix, sobrescriben los previos):
   `guiones-es-para-juicio-humano.md`.

## El load-bearing del fix (cláusula 4a): el test FAIL-CLOSED determinista

`script-writer.test.ts:386-421` — leído ÍNTEGRO. El mock emite un body de 60 palabras (~24 s) en
**las 3 rondas de los 4 grupos = 12 llamadas** (assert `calls === 12`). Asserts:
- `res.status === 'over_budget'` (línea 414) — NO `scripted`.
- `res.scripts.every(s => s.estSeconds > maxSeconds) === true` (línea 418).
- warning `script_over_budget` presente (línea 421).

**Reintroducción mental del bug**: si el path viejo volviera (`scripted` en la última ronda
over-budget), la línea 414 se pondría ROJA. El bug de 16 s-como-`scripted` está **estructuralmente
muerto** — el PASS de 4a descansa sobre este test + el código leído (`:631`), no sobre una corrida
live verde (que solo prueba el happy path de un sorteo aleatorio, justo el flake del FAIL anterior).

## Resultado observado vs esperado

| # | Cláusula | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| 1 | 12 guiones validan Zod | Los 12 AdScript pasan `AdScriptSchema`; cost_entry sumado | 12/12 validan; usage sumado de 4 grupos en una fila | integration.txt | OK |
| 2 | los es suenan nativos | Juicio humano | 3 guiones ES reales FINALES persistidos, español idiomático | guiones-es-para-juicio-humano.md | PENDIENTE JUICIO HUMANO |
| 3 | bodies idénticos (diff vacío) | Un solo body por grupo | `bodies.size === 1` en el live `en` (real) Y en el unit (mock discriminante) | live.txt, unit.txt | OK |
| 4a | est_seconds <= 15 en TODOS (la que falló) | Todos <=15 O overshoot -> over_budget (nunca scripted a >15) | Live: 2/2 scripted, todos <=15 (es: 13/13/12 s). FAIL-CLOSED probado: mock siempre-over -> over_budget, nunca scripted | live.txt, unit.txt (:386-421) | OK CORREGIDO |
| 4b | 17 s rechazado; 13/15 pasan; + control FAIL-CLOSED | budgetViolation muerde a 17, no a 13/15; y siempre-over -> over_budget | 13->null, 15->null, 17->violación «dura 17s… techo 15s… NO CABE»; + test FAIL-CLOSED | unit.txt (:454, :386) | OK |
| 5 | truncado {pain} (12 palabras) -> hook <=12 | Renderizador trunca al presupuesto | truncateToWordBudget recorta; librería entera <=12; control negativo (sin truncar) rompe; hooks es reales <= MAX_HOOK_WORDS | unit.txt, live.txt | OK |
| 6 | guion en desde brief es ÍNTEGRO en inglés, hook incluido | Cero español en hook+body+cta | Live en PASS: language en, spanishWordsIn(hook)===[], spanishWordsIn(fullText)===[], <=15 s | live.txt | OK |

## Coste real

APIs de pago: Anthropic Sonnet 5, **2 llamadas live** (grupo `en` + grupo `es`).
- Grupo `en`: `in=1025 out=723 cache_w=3234 cache_r=0 => $0.0260` (línea impresa en `live.txt`).
- Grupo `es`: llamada comparable; el system prompt ya estaba cache-creado en la 1ª, la 2ª leyó de
  caché (más barata). Su línea de coste no se imprime (ese test solo vuelca los guiones).
- **Total estimado ~= $0,04–0,05** (bajo el reserve de $0,18 y la assertion `usd < 0.12` por grupo).
- **Acumulado T2.4**: ~$1,25 previos + ~$0,05 de esta ~= **$1,30 de $1,50** (cap x3). Dentro de
  presupuesto, sin spend-stop. Estimado planning ~$0,50 (excedido por las re-corridas del ciclo
  FAIL->fix->re-verify, no por una sola verificación).

## Veredicto

**PASS** (con la cláusula 2 explícitamente PENDIENTE DE JUICIO HUMANO) — el FAIL anterior (4a) está
corregido: el bug de «guion >15 s embarcado como `scripted`» es estructuralmente imposible (test
FAIL-CLOSED determinista lo prueba y el path viejo está borrado), y la corrida live salió limpia (2/2
`scripted`, todos <=15 s). Todas las cláusulas automatizables PASAN: 12xZod, diff-vacío, control
negativo 13/15/17, truncado `{pain}`, y pureza de idioma `en` (hook incluido).

**Cláusula pendiente**: «los es suenan nativos» requiere JUICIO HUMANO — guiones finales en
`guiones-es-para-juicio-humano.md`. El bucle debe pedir el juicio al usuario antes de marcar `[x]`.

**Rarezas / deuda a vigilar** (no bloquean):
- El test live del implementer sigue siendo estrictamente `scripted` + <=15 (líneas 153/170,
  214/220): si en una futura corrida el modelo hiciera overshoot en las 3 rondas, el status sería
  `over_budget` y la línea 153 se pondría ROJA — el test live FALLARÍA aunque el fix funcione (el
  fail-closed es el comportamiento CORRECTO y aceptado). Flaky-por-estrictez, no flaky-por-bug.
- Cambio de alcance heredado (ya en planning + PRD §8.4, 2026-07-15): la Verificación se relajó de
  `<= objetivo (12 s)` a `<= techo (15 s)`. El control negativo confirma que el techo relajado SÍ
  muerde (13/15 pasan, 17 rechaza). Bien fundamentado.
- Árbol de git SUCIO (diff de T2.4 sin commitear) — normal en verificación pre-commit del bucle.
