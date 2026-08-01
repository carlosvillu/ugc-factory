# Verificación T5b.1b-i — N6 emite un prompt de escena por cada escena body/cta (contrato retrocompatible, canvas intacto)

- **Tarea**: T5b.1b-i · N6 emite un prompt de escena por cada escena body/cta (`planning.md` L1029-1038)
- **Fecha**: 2026-08-01
- **Ejecutor**: verifier (contexto fresco) · sin agent-browser (tarea de contrato + compilador determinista, $0, sin superficie UI ni red)
- **Sistema**: working tree sobre commit `4eed4c1` · diff uncommitted (6 ficheros: contrato + executor + tests + golden). NO se levantó docker/`pnpm dev`: la Verificación es de contrato + comportamiento del compilador N6 (determinista, $0, sin red, sin fal) — se ejercita por tests contra el sistema real (motor de core + executor de worker) + gate completo incluido el e2e F4 con el fake de fal.

## Verificación esperada (literal de planning.md)
> Para una variante con guion de ≥1 escena body/cta, el output de N6 incluye un array con un prompt por escena, cada uno con los beats que solapan su ventana temporal (y su guard pack); `resolvedPrompt`/`resolvedBeats` siguen presentes con la MISMA forma; canvas de auditoría y F4 e2e verdes. Control negativo: un guion sin escenas body/cta → array vacío, sin romper el output.

## Pasos ejecutados
1. Leído el contrato `packages/core/src/contracts/step-outputs.ts` → `N6ScenePromptSchema` (sceneIndex absoluto, segment body|cta, t, seconds, resolvedPrompt, resolvedBeats, guardPackKeysUsed, noBeatsOverlap) y `scenePrompts: z.array(...).optional()` añadido a `N6OutputSchema` (los campos `resolvedPrompt`/`resolvedBeats` intactos, sin tocar). Exportado en `contracts/index.ts`.
2. Leído el executor `apps/worker/src/executors/compile-prompt.ts` → `compileScenePrompts` itera escenas body/cta, llama `compilePrompt({ ...compileInput, scene })` por cada una (el motor filtra beats a `[scene.t, scene.t+scene.seconds)`), arma el array, deriva `noBeatsOverlap = resolvedBeats.length === 0`. Emite `scenePrompts` SIEMPRE (incluido `[]`). Extracción `formatCompileIssues` (behavior-preserving).
3. Ejecutados los tests del executor N6 (`compile-prompt.test.ts`) → 13/13 passed. Asserts LEIDOS: verifican indice ABSOLUTO `[1,2]`, ventana temporal (bloque `Beats:` de body contiene `[3-10s]`/`[10-18s]` y NO `[0-3s]`; cta contiene `[18-22s]` y no `[3-10s]`), guard pack (`guard.vertical.beauty`), fidelity guard literal, backcompat (typeof string + Array), y validacion contra `N6OutputSchema.parse`. No es una version aguada.
4. Ejecutado el golden (`compile-prompt.golden.test.ts`) → 4/4 passed. El golden nuevo `grwm-beauty-tiktok-scene-body.txt` fija caracter a caracter que la seccion `Beats:` de la escena body contiene SOLO `[3-10s]`/`[10-18s]` (ventana `[3,18)`) y todo el guard pack §9.5.
5. **Control negativo (2 mutaciones)**: ver seccion `## Control negativo`.
6. Confirmado apps/web INTACTO (`git diff --name-only` no lista apps/web). El consumidor canvas `run-canvas/step-assets.ts:65` lee `resolvedPrompt` por presencia de campo (`'resolvedPrompt' in output`) → anadir `scenePrompts` no puede romperlo. El e2e F4 `phases/f4-generation.spec.ts:96,235,369` lee `resolvedPrompt` de N6/N7a.
7. `pnpm gate` completo (env Colima) → **exit 0**, 2633 tests passed, e2e F4 4 passed.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Variante body/cta → array 1 prompt por escena, beats por solape temporal + guard pack | 2 scenePrompts (body idx1, cta idx2); Beats de body `[3-10s]`/`[10-18s]`, no `[0-3s]`; guard `guard.vertical.beauty` | executor-tests.txt, golden-tests.txt, golden file | OK |
| 2 | `resolvedPrompt` (string) y `resolvedBeats` con la MISMA forma | test RETROCOMPAT: typeof string + Array, ambos no vacios; contrato no toca esos campos | executor-tests.txt; diff step-outputs.ts | OK |
| 3 | Canvas de auditoria verde | apps/web intacto; consumidor lee por presencia de campo (aditivo no rompe) | git diff --name-only; step-assets.ts:65 | OK |
| 4 | F4 e2e verde | e2e:phases f4-generation → 4 passed | gate.txt | OK |
| 5 | Control negativo: guion sin body/cta → array vacio, no rompe | test CONTROL NEGATIVO: `scenePrompts` `[]`, `node:'N6'`, `resolvedPrompt` sigue; y muerde (ver abajo) | control-negativo-clause-RED.txt | OK |
| 6 | `noBeatsOverlap` (fix code-review): escena drifteada fuera del grid → true | test escena cta t=25 (ventana [25,29) fuera del template 22s) → `noBeatsOverlap:true`, `resolvedBeats:[]`, sin seccion `Beats:`; body normal → false (contraste) | executor-tests.txt | OK |
| 7 | Docstring honesto (fix code-review): NO afirmar prompt 100% acotado | contrato y executor dicen "WINDOWING PARCIAL": solo `resolvedBeats`/bloque `Beats:` acotado; la PROSA del template body es GLOBAL | diff step-outputs.ts + compile-prompt.ts | OK |
| 8 | Gate verde | exit 0, 2633 passed | gate.txt | OK |

## Control negativo
Reintroducido el bug por DOS mutaciones transitorias en `compileScenePrompts`/`collectOutput` (restauradas; md5 `7ee06b046fcbc9d66dddf65d0d14af97` verificado identico tras cada una). (A) forzar `return []` siempre → 3 tests FAIL (`AssertionError: expected [] to have a length of 2 but got +0`). (B) omitir el campo cuando vacio (`...(scenePrompts.length>0 ? {scenePrompts} : {})`) → el test de la clausula LITERAL "guion sin body/cta → array vacio" FAIL (`AssertionError: expected undefined to deeply equal []`). Ambas confirman que los tests MUERDEN la Verificacion real, no una aguada. Detalle por mutacion abajo.

### A · array vacio forzado (los positivos muerden)
`compile-prompt.ts` `compileScenePrompts` → `return []` incondicional. Salida (`control-negativo-RED.txt`):
```
Tests  3 failed | 10 passed (13)
FAIL > ... con guion body+cta → un scenePrompt por escena ...
  AssertionError: expected [] to have a length of 2 but got +0
FAIL > ... escena cuya ventana NO solapa el grid ... → noBeatsOverlap:true ...
FAIL > ... el output completo valida contra N6OutputSchema ...
  AssertionError: expected [] to have a length of 2 but got +0
```
El test de control negativo (que espera `[]`) sigue GREEN — correcto: prueba la mutacion B, no esta.

### B · campo omitido cuando vacio (la clausula control-negativo muerde)
`collectOutput` → `...(scenePrompts.length > 0 ? { scenePrompts } : {})`. Salida (`control-negativo-clause-RED.txt`):
```
× CONTROL NEGATIVO: guion sin escenas body/cta → scenePrompts vacio, output no rompe
  AssertionError: expected undefined to deeply equal []
    expect(out.scenePrompts).toEqual([]);
Tests  1 failed | 12 passed (13)
```
La clausula LITERAL "array vacio observable, no ausente" esta protegida: el test distingue `[]` (emitido) de `undefined` (omitido).

## Coste real
$0 — sin APIs de pago. No se levanto generacion real (fal). El e2e F4 corre contra el fake de fal (`FAL_BASE_URL`); los `costCents:80` de sus logs son del fake, no dinero real. Estimado planning: $0. Sin desviacion.

## Veredicto
**PASS** — N6 emite `scenePrompts` (un prompt por escena body/cta, beats acotados a la ventana temporal + guard pack), `resolvedPrompt`/`resolvedBeats` intactos, control negativo `[]` observable y protegido por test, `noBeatsOverlap` y docstring honesto (los 2 fixes de code-review) presentes y verificados; gate exit 0 (2633 tests + e2e F4 4 passed).

Notas / rarezas (no bloquean):
- `noBeatsOverlap` se deriva como `resolvedBeats.length === 0`. Semanticamente correcto para el caso de la tarea (escena drifteada fuera del grid); un template sin beats tambien reportaria true legitimamente — no aplica al seed de galeria actual.
- `scenePrompts` es `.optional()` en el contrato (para `safeParse` de filas historicas), pero el executor SIEMPRE lo emite — no viola la clausula "MISMA forma", que es sobre `resolvedPrompt`/`resolvedBeats` (intactos).
- La rama `PermanentStepError` de `compileScenePrompts` (escena que no compila) no tiene test propio — fuera del alcance de esta Verificacion, pero es la rama en la que T5b.1b-ii se apoyara; queda anotada como deuda de test para la siguiente.
- El `content_hash` del dedup NO cambia (ningun N7 lee `scenePrompts` aun — eso es T5b.1b-ii). Confirmado: apps/web y N7 intactos.
