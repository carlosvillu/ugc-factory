# T3.5 · Compilador de prompts (N6) — VERIFICACIÓN

- **Veredicto**: PASS
- **Fecha**: 2026-07-15
- **HEAD verificado**: 5e3ecbb (diff T3.5 staged en el índice)
- **Coste real**: $0 (motor puro determinista, sin BD/red/APIs de pago)
- **Superficie**: backend/core puro — script CLI + tests unit + golden files (sin CUA/UI; la inspección en canvas es T4.11, NO se exige aquí).

## Verificación LITERAL (planning.md, T3.5)
> golden files (3 combinaciones brief-fixture × template × persona comparadas carácter a carácter) en verde; un script CLI compila una variante real (con los templates de prueba de T3.2) e imprime el resolvedPrompt — grep confirma "no deformation" y el guard del vertical; un slot irresoluble produce error accionable (qué variable, de qué fuente). La inspección en canvas se verifica en T4.11.

## Resultado por punto

| # | Esperado | Observado | OK |
|---|----------|-----------|----|
| 1 | 3 goldens char-a-char en verde, sobre ficheros COMMITEADOS que el test LEE (no regenera) | vitest run compile-prompt.golden.test.ts -> 3/3 passed. expectGolden (test-utils/golden.ts:22,31) hace readFile + expect(actual).toBe(expected) (char-a-char, toBe); solo escribe si UPDATE_GOLDEN=1. git ls-files confirma los 3 .txt versionados+staged. grep -rn UPDATE_GOLDEN en scripts/config/CI -> NO se inyecta =1 en runs normales. | OK |
| 2a | CLI compila variante real e imprime resolvedPrompt; grep "no deformation" lo encuentra en el OUTPUT | pnpm compile:prompt (exit 0). grep "no deformation" -> linea 15: el literal COMPILER_FIDELITY_GUARD del compilador. Grep hecho por el verifier sobre stdout real (no sobre el codigo). | OK |
| 2b | El guard del vertical aparece en la salida | Linea guard packs: -> guard.general, guard.fidelity, guard.vertical.beauty, guard.platform.tiktok. grep "guard.vertical.beauty" -> hit. Template elegido: grwm-beauty-pain-point (beauty/pain_point/tiktok/grwm). | OK |
| 3 | Slot irresoluble -> CompileIssue que NOMBRA slot Y fuente | Probe propio del verifier (probe-unresolved.mts): brief sin pain_points -> { code: unresolved_slot, slot: "pain_point", source: "ProductBrief" }; script undefined -> hook.line<-AdScript y cta.line<-AdScript. Cada issue nombra variable exacta + fuente. | OK |

## Alcance (corte T3.5, verificado como correcto por diseno)
- Motor completo real: compilePrompt / selectTemplate / resolveSlot — probados por goldens + CLI + probe.
- Executor N6 ESQUELETO registrado: apps/worker/src/executors/index.ts:62 -> N6: makeN6Executor(). NO se penaliza ausencia de persistencia en generation (T4.1) ni DAG N6->N7 (T4.11) — fuera de alcance por decision del arquitecto.

## Trampas 10.4 verificadas contra el codigo (variable-sources.ts)
- rebuttal -> objection.counter (linea 145), NO .rebuttal. OK
- hook.line -> script.hook (linea 175); cta.line -> script.cta (linea 181) — de AdScript, NO de PlannedHook/brief. OK
- platform/aspect/duration via CampaignContext explicito. OK

## Gate
pnpm gate (DOCKER_HOST al socket) -> VERDE: lint + typecheck + format:check + knip + readme:status:check + test.
145 test files, 1607 tests passed. (evidencia: gate.txt). Warnings de knip (hint sobre src/golden.ts) y de playwright (expect-expect en un e2e ajeno) NO son fallos; exit 0.

## Discriminacion de contenido de golden (chequeo esceptico extra)
Los 3 combos comparten DEMO_BEAUTY_BRIEF (category=beauty). resolveGuardPacks (compile-prompt.ts:165) selecciona el vertical por category del brief, no por la faceta del template. Por tanto los 3 goldens llevan guard.vertical.beauty (probe probe-keys.mts), con el guard de plataforma variando correcto (tiktok/reels/tiktok). Comportamiento consistente con 9.5 y con los goldens; NO hay leak-bug. El vertical sigue al (unico) brief, como debe.

## Rarezas (aunque PASS)
- Comentario inexacto en el test (compile-prompt.golden.test.ts:38-39): afirma que el combo unboxing-saas va "sin guard vertical (saas no esta sembrado)". En realidad SI recibe guard.vertical.beauty porque usa el brief beauty (el vertical lo fija la category del brief, no el slug del template). Es una imprecision de COMENTARIO — no afecta al output (goldens matchean) ni a ninguna clausula de la Verificacion. Recomendado para el implementer: corregir el comentario (no bloquea T3.5).

## Evidencia
- docs/verifications/T3.5/report.md (este fichero)
- docs/verifications/T3.5/golden-run.txt (3/3 golden passed)
- docs/verifications/T3.5/cli-output.txt (pnpm compile:prompt completo, con "no deformation" y el guard vertical)
- docs/verifications/T3.5/gate.txt (pnpm gate verde, 1607 tests)
- docs/verifications/T3.5/probe-keys.mts (guardPackKeys por combo)
- docs/verifications/T3.5/probe-unresolved.mts (slot irresoluble -> slot+fuente)
