---
name: dev-loop
description: Bucle de desarrollo autónomo de UGC Factory — ejecuta tareas de planning.md de forma continua (seleccionar → implementar → gate local → review → verificar → cerrar → commit) con subagentes implementer/verifier de contexto fresco y paradas definidas. Usar SIEMPRE que el usuario pida avanzar, continuar o retomar el desarrollo, ejecutar la siguiente tarea del planning, o pregunte por el estado del desarrollo. Argumentos: task <ID> | phase | until-blocked (default) | status.
argument-hint: "[task <ID> | phase | until-blocked | status]"
---

# dev-loop — el bucle de desarrollo de UGC Factory

Protocolo vinculante para avanzar `planning.md`. Fue diseñado sobre hallazgos verificados del estado del arte (2026): una tarea por agente con contexto fresco, evaluador separado del implementador (sesgo de auto-aprobación documentado), verificación e2e real conduciendo el sistema, guardrails deterministas y circuit breakers. No lo "optimices" sobre la marcha: si un paso estorba, o el trabajo está mal planteado o esta skill necesita una actualización deliberada (anotada en el journal) — nunca saltárselo en silencio.

## Alcance según argumento

| Invocación | Comportamiento |
|---|---|
| `/dev-loop` o `until-blocked` | Encadenar tareas hasta una parada natural (ver Paradas) |
| `/dev-loop task T0.5` | Ejecutar exactamente esa tarea (si es elegible) y parar |
| `/dev-loop task` | Ejecutar solo la siguiente tarea elegible y parar |
| `/dev-loop phase` | Encadenar hasta cerrar el E2E de la fase actual (incluido) y parar |
| `/dev-loop status` | Solo informar: bootstrap + próxima tarea + bloqueos. Sin ejecutar nada |

## Bootstrap (siempre, antes del primer ciclo)

1. `git log --oneline -5` y `git status` (árbol limpio; si hay restos de una sesión anterior, entiéndelos antes de seguir — el journal explica).
2. Leer el **Estado global** y las tareas de la fase en curso en `planning.md`; calcular la siguiente tarea elegible: todas sus `Depende de` marcadas `[x]`, sin ⚠ pendiente del usuario.
3. Tail de `docs/dev-loop/journal.md` (últimas ~3 entradas): bloqueos abiertos, rarezas, decisiones.

## El ciclo por tarea

### 1 · SELECT
Elige la tarea por el grafo `Depende de` (la numeración es orientativa — regla de trabajo 1). Comprueba STOP-CHECK **antes** de empezar (⚠, juicio humano, gasto). Anota en el journal: `⏳ T<ID> iniciada`.

### 2 · BRIEF
Compón el brief del implementer (acotado — el agente lee lo que necesite, no le pegues el PRD):
- **Enumera TODOS los bullets de la entrada de la tarea en `planning.md`**, no solo Entrega/Subtareas/Verificación: también `Mockup`, `Playwright permanente` (regla 10 — DoD bloqueante), `Deuda heredada`, notas de desviación, etc. Un entregable declarado que se te escape del brief bloquea el cierre y obliga a completarlo tarde (pasó en T0.4: el brief omitió el harness+specs Playwright, afloró en CLOSE). Antes de escribir el brief, además: **grep de guards `hasta T<ID>` / `DESHABILITADO` en `package.json` y scripts** — señalan trabajo de infra que ESTA tarea debe activar (T0.4 tenía `test:e2e` = "DESHABILITADO hasta T0.4").
- Texto **literal** de esos bullets + los `§` del PRD que la tarea cite.
- Lista de references a leer ANTES de codificar, según las tablas de decisión de las skills `backend`/`frontend`/`testing` (p. ej. "vas a tocar tabla+repo → backend/references/db.md + testing/references/db-integration.md"; "deja spec Playwright → testing/references/e2e.md").
- Contexto vivo: tail del journal si afecta, decisiones de tareas anteriores relevantes.
- Recordatorio de sus reglas duras (están en su definición de agente, pero el brief las repite en 1 línea).

### 3 · IMPLEMENT
Lanza el subagente **`implementer`** (uno NUEVO por tarea, `run_in_background: false`). Su entregable: código + tests de la misma tarea + suites del paquete en verde + informe estructurado. Si devuelve dudas de diseño que cambian el alcance → STOP-CHECK.

### 4 · GATE LOCAL
Desde la raíz: `pnpm gate` (= lint + typecheck + format:check + knip + test unit+integration; lo crea T0.1) y `pnpm test:e2e` si la tarea tocó superficie web. En rojo → devuelve el fallo al implementer vía SendMessage (mantiene su contexto). Sin CI remota, **este es el gate de merge** (decisión 2026-07-07).

### 5 · REVIEW (dos pases obligatorios: `code-review` → `simplify`)

**Solo si la tarea produjo diff de CÓDIGO.** En tareas de solo-docs/skill (sin superficie de runtime que revisar) se saltan ambos pases — espeja la condicionalidad de `test:e2e`. La edición del propio arnés y el trabajo de mockups son ejemplos que se saltan.

Ambos pases MUTAN código (`simplify` auto-aplica; los fixes de `code-review` mutan), así que corren **antes de VERIFY y antes del commit**: el invariante duro es que *lo que VERIFY bendice == lo que se commitea*. Un `simplify` después de un PASS invalidaría la verificación en silencio. Secuencia:

`Gate verde (4) → code-review → fix correctness → re-gate → simplify → re-gate (inspeccionar diff) → VERIFY (6)`

**Cada comando se ejecuta UNA vez por cierre**, no a punto fijo: nada de bucle code-review↔simplify. Si un pase abre trabajo grande, es una decisión consciente, no una iteración automática.

**5a · `code-review`** — sobre el diff de la tarea, con effort proporcional al riesgo: **low** para diffs pequeños/mecánicos (<~200 líneas sin lógica nueva), **medium** por defecto, **high** solo para el orquestador, dinero (spend/fal) y seguridad (auth/webhooks/cifrado). Caza bugs (correctness, robustez, seguridad). Hallazgos de correctness/robustez confirmados → tríalos: **arréglalos si están en alcance** (al implementer vía SendMessage; re-gate tras el fix); **deuda de journal solo si quedan fuera de alcance o son genuinamente diminutos**. `code-review` NO caza bugs por simplicidad — eso es 5b.

**5b · `simplify`** — sobre el diff resultante (tras aplicar los fixes de 5a). Es **solo calidad** (reuso, simplificación, eficiencia, altitud); NO caza bugs. Sus cleanups se **auto-aplican**; aquí la deuda se INVIERTE respecto a 5a: lo aplicado se QUEDA si el re-gate sigue verde, y solo lo residual minúsculo que quede fuera va a deuda (no al revés).
- **Re-gate tras `simplify` es no negociable, e INSPECCIONA su diff — no lo aceptes a ciegas.** El gate tiene huecos conocidos (no corre `build` — así se coló el bug del bundle del worker en T0.2) y el código tiene mecanismos load-bearing no obvios (p.ej. los 3 timeouts distintos del ping, `pingDb` standalone) que un pase de "calidad" puede fundir en un bug. Rechaza cualquier cambio de `simplify` que toque un mecanismo documentado como load-bearing.
- Un cambio de `simplify` que ponga el gate en rojo se revierte o se arregla hacia delante — JAMÁS se acomoda debilitando un test (regla 5).

Nota sobre la naturaleza de cada pase (para no dar forma equivocada a la regla): un hallazgo de reuso/simplificación lo absorbe `simplify`; un bug de robustez (p.ej. una fuga de conexión en una ruta de error) lo caza `code-review` y NO desaparece por pasar `simplify` — se arregla o se anota como deuda en 5a.

### 6 · VERIFY
Lanza el subagente **`verifier`** (contexto fresco, escéptico) con: el ID de la tarea, el texto LITERAL de su Verificación, el resumen del implementer y el diff (`git diff --stat`). El verifier ejecuta la Verificación de verdad contra el sistema levantado (protocolo en `testing/references/cua.md`), persiste la evidencia en `docs/verifications/<ID>/` y devuelve **PASS/FAIL + coste real**.
- **FAIL** → informe al implementer (SendMessage), fix, re-gate (4), re-verify con el flujo COMPLETO (regla de oro 2 de cua.md). Máx. 2 FAIL consecutivos → parada (circuit breaker).
- El implementer JAMÁS ejecuta este paso; tú (bucle) tampoco: quien implementa no se evalúa.

### 7 · CLOSE
Solo con PASS:
1. Marca en `planning.md`: subtareas `[x]` y heading `#### T<ID> · … [x] <fecha> — PASS, ver docs/verifications/T<ID>/` (+ coste si relevante). El hook `guard-planning` bloqueará si falta el report — es la doble condición de cierre.
2. Si la tarea cerraba una deuda `[verificar]`: anota el resultado en PRD.md y planning.md (regla 3).
3. Entrada en `docs/dev-loop/journal.md` (formato abajo).
4. Commit: `T<ID>: <resumen imperativo en inglés>` (incluye evidencia y planning.md). Solo en verde. Sin push.

### 8 · STOP-CHECK
Para (informa al usuario con el resumen de lo hecho + estado + siguiente paso) si:
- La siguiente tarea tiene **⚠** sin resolver, o su Verificación exige **juicio humano** ("revisión humana", "a juicio humano") — en ese caso prepara lo automatizable y pide el juicio.
- Acabas de cerrar el **E2E de fase** (TD.7, T1.10b, T2.6, T4.11, T5.9…) → resumen de fase y esperar OK.
- **Gasto**: la verificación de la siguiente tarea puede superar el cap (estimado del planning ×3, mín. $1) o no hay estimación y usará APIs de pago.
- **Circuit breaker**: 2 FAIL consecutivos del verifier en la misma tarea, o 2 tareas seguidas sin poder cerrarse, o detectas que no hay progreso real entre ciclos (mismo error dos veces).
- **Cambio de alcance mayor** (el PRD necesita un ajuste que altera decisiones de producto). Los menores se editan en la misma sesión y se anotan (regla 6).
Si no aplica ninguna → siguiente ciclo (según alcance del argumento).

## Presupuesto por tarea

Cap = coste estimado en el planning ×3 (mín. $1). Antes de una verificación con APIs de pago: estima; si supera el cap → parada de gasto. El coste real observado va SIEMPRE al report y al journal; si difiere >25 % del estimado, recalibra en la misma tarea (regla 5). La suite de tests jamás gasta (skill testing); solo verificaciones y `test:live` presupuestado.

## Journal — `docs/dev-loop/journal.md`

Append cronológico, una entrada por evento (tarea cerrada, bloqueo, parada, decisión). Formato:

```markdown
## 2026-07-07 · T0.3 cerrada — PASS
- Coste: $0 · Ciclos verifier: 1 · Commit: <sha-corto>
- Rarezas/decisiones: <1-3 líneas: lo no obvio que la siguiente sesión debe saber>
- Deuda anotada: <o "—">
```

El journal es la memoria del bucle entre sesiones: escribe para el agente que retomará esto sin tu contexto.

## Mejora continua del arnés

Si un ciclo revela una carencia del arnés (brief insuficiente, gate con hueco, regla ambigua): corrige la skill/agente en la MISMA sesión, con una línea en el journal («arnés: <qué cambió y por qué>»). El arnés evoluciona deliberadamente, nunca por deriva.
