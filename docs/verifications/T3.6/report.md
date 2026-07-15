# Verificación T3.6 — Model adapters

- **Tarea**: T3.6 · Model adapters (`planning.md` l.524-527)
- **Fecha**: 2026-07-15
- **Ejecutor**: verifier (subagente escéptico, contexto fresco) · sin superficie web (unit de `packages/core`) · sin navegador
- **Sistema**: working tree sobre `bbbdcf0` (HEAD = T3.5); el diff de T3.6 está staged/unstaged sin commitear. Sin docker/pnpm dev: la Verificación es 100 % unit de core (funciones puras, sin red, sin BD, sin APIs de pago).

## Verificación esperada (literal de planning.md)
> golden files de payloads por adapter **más asserts semánticos** (los goldens solos son autorreferenciales): el payload de Kling incluye la imagen de referencia cuando `capabilities.refImages>0`, el de Seedance usa la sintaxis `@image/@video/@audio`, y aspect/duración usan los nombres y enums exactos del `model_profile`; un template que excede `maxDuration` produce el troceo de escenas esperado (§7.5) en el plan de generación, no un error en runtime.

## Pasos ejecutados y evidencia

1. Lectura del código (`families.ts`, `select-adapter.ts`, `types.ts`, `scene-planner.ts`) y de los tests → los asserts comprueban la PROPIEDAD, no solo igualdad de golden.
2. Corrida de los 25 tests de adapters (`02-adapters-verbose.txt`) → 25/25 verde.
3. Contraste contra el seed REAL (`gallery-seed/model-profiles.json`): Kling refImages:1, veo3.1 aspects ["9:16","16:9"], OmniHuman maxDuration:30 sin aspects, Seedream refImages:10, promptAdapter poblado como campo de datos.
4. SABOTAJE 1 (golden, OBLIGATORIO) (`03-golden-sabotage-RED.txt`): editado un byte del golden de Kling (9:16→9:17), SIN UPDATE_GOLDEN → ROJO con diff char-a-char. El golden MUERDE. Restaurado → verde.
5. SABOTAJE 2 (scene-planner) (`04-scene-planner-sabotage-RED.txt`): ceil(...) → Math.min(2, ceil(...)) (tope duro 2) → 3 tests ROJOS (incl. "25s/max10 ⇒ 3 clips"). Confirma que el test DEFIENDE la invariante §7.5. Restaurado → verde.
6. UPDATE_GOLDEN NO está en ningún script ni en el gate — solo en `expectGolden` y sus tests.
7. Gate global (`05-gate-global.txt`): lint + typecheck + format:check + knip + readme:status:check + 1632 tests (147 files) → VERDE sobre el working tree.

## Resultado observado vs esperado (cláusula por cláusula)

| # | Cláusula | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Golden POR adapter que el test LEE (no autorreferencial), regen solo con flag | 5 goldens leídos char-a-char (toBe); sabotaje 1 byte → rojo; UPDATE_GOLDEN=1 único regenerador, NO en scripts/gate | 02,03 | OK |
| 2a | Kling ref image con refImages>0; control negativo sin img / OmniHuman sin refImages ⇒ sin img | image_url con Kling+img; ausente sin img; ausente con OmniHuman+img | 02 | OK |
| 2b | Seedance @image/@video/@audio; sin refs ⇒ prompt íntegro | prompt="@image @video @audio <canónico>"; sin refs → sin tokens ni reference_*; fixture legítimo (input en prod, Seedance 404 en fal — T3.4) | 02 | OK |
| 2c | aspect/duración con enums EXACTOS; 1:1 rechazado con error tipado (no clamp/throw) | veo3.1 emite 16:9 tal cual+duración; 1:1 → aspect_unsupported nombrando [9:16,16:9]; OmniHuman sin aspects acepta cualquiera | 02 | OK |
| 2d | Escena > maxDuration → troceo §7.5 en el PLAN (retorno), NO error runtime; ≤max ⇒ 1 clip | ≤max→1 clip; >max→ceil(s/max) clips ≤max que suman s; nunca lanza. Sabotaje tope-2 lo caza | 02,04 | OK |
| 3 | Adapters POR familia con dispatch por promptAdapter (dato); ausente/desconocido ⇒ error tipado | 4 familias en ADAPTER_FAMILIES; dispatch lee profile.promptAdapter; missing_/unknown_prompt_adapter nombran endpoint; audio/tts/lipsync sin adapter = correcto (fuera de scope) | 02 | OK |

## Juicio sobre la reconciliación §7.5 (troceo)
El PRD §7.5 dice "escenas más largas se parten en 2 clips". El implementer usó ceil(seconds/maxDuration), NO tope literal de 2. FIEL AL SPEC: la regla primaria es la invariante "cada clip ≤ maxDuration"; "2 clips" describe el caso real del catálogo (ninguna escena §8.4 excede 2×maxDuration, OmniHuman 2×30=60s). Un tope-2 violaría la invariante para escenas > 2×maxDuration (25s/max10 → 2 clips de 12,5s). El sabotaje 2 lo demuestra: forzar tope-2 pone rojo el test que exige clips ≤ maxDuration.

## Rareza / hallazgo (NO bloquea la Verificación literal; requiere acción en el commit de cierre)
Los 5 goldens están staged en el índice con blob VACÍO (0 bytes); su contenido correcto vive solo en el working tree (unstaged):
  git cat-file -s :.../avatar-kling-ai-avatar.json → 0
  git diff --stat -- .../golden/ → 5 files changed, 34 insertions(+) (unstaged)
- Riesgo: si el commit se hace sobre el índice tal cual, los goldens se committean VACÍOS → en checkout limpio los tests dan `expected '{...}' to be ''` → gate ROJO. Es el riesgo "golden autorreferencial" que la cláusula 1 quiere prevenir. Lo reproduje al restaurar con git checkout (dejó 0 B) y el test dio rojo con "to be ''".
- Por qué NO es FAIL: el SISTEMA REAL (working tree) tiene los goldens con contenido y verifica todas las cláusulas; el gate global corre verde sobre él. El paso 5 de cierre de dev-loop stagea explícitamente los cambios, lo que auto-curaría el índice.
- Acción requerida (para quien commitea, NO el implementer): antes del commit, `git add` de los .json de golden (o git add -A) y confirmar `git cat-file -s :<golden> > 0`. El re-gate del paso 6 corre sobre el working tree y NO detectaría esto por sí solo.
T3.5 sí committeó sus goldens con contenido (4,5 KB c/u): el pipeline puede landear contenido, pero dependió del stage, no de una garantía del arnés.

## Coste real
$0 — sin APIs de pago. Unit de core puro, sin red. Ninguna llamada a fal/Anthropic/Firecrawl. (vs estimado $0.)

## Veredicto
**PASS** — Las 6 cláusulas se cumplen sobre el sistema real (working tree), con los dos sabotajes obligatorios probados y contraste contra el seed real. Reconciliación §7.5 con ceil fiel al spec. Gate global verde (1632 tests).
Advertencia de cierre (no bloquea el PASS): los 5 goldens están staged vacíos; el commit DEBE re-stagear su contenido o el gate quedará rojo en checkout limpio.
