# T5.14 — Verificación · Confirmar CP3 con 0 aprobadas no vara el lote

**Veredicto: PASS**

> **Re-verificación 2026-07-26**: el gap de test permanente que este report señalaba (ningún spec conducía `POST /api/steps/:id/approve` para afirmar que el checkpoint NO se consume / el 2º POST no da 409) se CERRÓ. Un implementer añadió 3 tests a nivel de RUTA en `apps/web/test/integration/api/checkpoints.test.ts` (test-only; `git diff --stat -- apps/web/src` VACÍO — el fix de producción no se tocó). Validados por este verifier: verdes aislados, y el control negativo a nivel de ruta REPRODUCIDO por mí (revertir el guard → 1er POST 200, 2º POST 409 → ROJO; restaurado, `apps/web/src` limpio). Ver `## Control negativo` → sección (C) y evidencia `05-route-test-green.txt` / `06-route-control-negativo-RED.txt`.

## Verificación literal (planning.md §T5.14)

> «Con 0 variantes aprobadas, «Confirmar guiones» no deja el lote irrecuperable: o no se puede pulsar, o el lote sigue teniendo camino hacia delante. Ningún guion pagado queda varado sin salida.»

La implementación toma la PRIMERA rama de la disyunción («no se puede pulsar») + un guard server-side que rechaza el POST directo sin consumir el checkpoint. Ambas verificadas contra el sistema real levantado.

## Sistema bajo prueba

- **Commit / sha**: `9282620` (HEAD). Árbol limpio antes y después (las mutaciones de control negativo se revirtieron con `git checkout --`; verificado `git status`).
- **OJO**: HEAD `9282620` arrastra además T5.15 (`ffaddb4`) y su test-fix `dd59a10`, así que el sistema bajo prueba NO es el commit T5.14 (`18795fa`) en aislamiento. El único solapamiento con `scripts-checkpoint.test.ts` es 1 test de atomicidad cuyo mensaje se realineó en `dd59a10` (comportamiento idéntico). No afecta al veredicto de T5.14.
- **Stack**: E2E fake-stack (`apps/web/scripts/e2e-stack.ts`) — Postgres 16 (Testcontainer) + worker + web en `:3100`, APIs externas FALSAS (`startFakeExternalApis`, `*_BASE_URL` local). Healthcheck `{ok:true,db:true}`. Verificado en `_stack.log`: 0 referencias a `api.anthropic.com` / `fal.run` / `firecrawl.dev` -> ninguna llamada de pago.
- **Runtime de contenedores**: colima (`TESTCONTAINERS_RYUK_DISABLED=true`).

## Resultado por punto

| # | Esperado | Observado | OK |
|---|----------|-----------|----|
| 1 | Con 0 aprobadas, «Confirmar guiones» NO es pulsable | Botón `disabled=true` en navegador real, `data-slot="none-approved"` = «Aprueba al menos una variante para confirmar.», contador «0 / 6 aprobadas». Lote COMPLETO (`scripts-partial`=null, no es el caso T5.11). Sin errores en consola. | OK |
| 2 | Aprobar >=1 variante -> botón se habilita | Aprobar 1 variante limpia: `disabled=false`, motivo desaparece, «1 / 6 aprobadas» | OK |
| 3 | Estado DERIVADO (no one-shot) | Des-aprobar (volver a 0): `disabled=true` otra vez, motivo reaparece, «0 / 6 aprobadas» | OK |
| 4 | POST directo 0 aprobadas -> `validation_error` (400) tipado | `HTTP 400` + `{"code":"validation_error","message":"...no aprobaría NINGUNA variante..."}` | OK |
| 5 | Checkpoint NO se consume | Tras el POST: N5 sigue `waiting_approval`; 6/6 variantes siguen `planned`; 0 runs de generación | OK |
| 6 | Lote sigue operable (2º POST NO da 409) | 2º POST idéntico -> `HTTP 400` de nuevo (NO 409). Pre-fix: 200-mudo-luego-409; post-fix: 400-luego-400 | OK |

## Evidencia (rutas relativas a docs/verifications/T5.14/)

- `10-cp3-0approved-disabled.png` — CP3 en navegador real: «Confirmar guiones» deshabilitado, «0 / 6 aprobadas», motivo en rojo.
- `11-cp3-1approved-enabled.png` — tras aprobar 1: botón habilitado, sin motivo.
- `20-double-post-route.txt` — los DOS POST curl (400 + 400) + verificación en BD (N5 `waiting_approval`, variantes `planned`, 0 gen-runs). NOTA: la sección BD del fichero es post-hoc (append); el orden POST#1->BD->POST#2 se verificó en vivo en sesión (estado de BD idéntico en ambos momentos).
- `01-baseline-green.txt` — 15/15 integración verde en HEAD (3 tests nuevos T5.14 + 2 T2.6 reshaped).
- `02-control-negativo-guard-reverted-RED.txt` — control negativo del guard.
- `03-reshape-audit-blocking-mutation-RED.txt` — auditoría del reshape T2.6.
- `04-component-tests-green.txt` — 8/8 tests de componente verde (incluye 2 T5.14).
- `05-route-test-green.txt` — 38/38 de `checkpoints.test.ts` verde incluyendo los 3 NUEVOS tests a nivel de RUTA de T5.14.
- `06-route-control-negativo-RED.txt` — control negativo a nivel de ruta REPRODUCIDO por el verifier (salida ROJA pegada en §C).
- `_stack.log` — arranque del stack + prueba de que no hubo llamadas de pago. (grep confirmado: 0 secretos reales de .env presentes en el log.)

## Cómo se verificó el flujo UI (como humano, en el navegador)

Se condujo el sistema REAL hasta un CP3 de verdad (no se sembró un checkpoint pausado a mano): `/analyses/new` -> «Analizar» -> CP1 «Aprobar y continuar» -> CP2 tier **test** «Confirmar y crear 6 variantes» -> N5 guioniza (fake) -> CP3 `waiting_approval`. Sobre ese CP3 real se observó el arco disabled->aprobar->enable->des-aprobar->disable. **Se decidió NO pulsar «Confirmar guiones»** para no arrancar ningún run (en tier test no gastaría fal, pero se mantiene el flujo estrictamente en «no se puede pulsar»). El camino feliz (aprobar 1 -> confirma) lo cubre el control positivo de integración, verde.

> Nota de tooling (no es defecto del producto): el checkbox de aprobación es un patrón Base UI donde el `<input>` es un espejo 1x1 offscreen y el control real es `<button data-slot="approve-variant">`. El `click @eN` de agent-browser mapeaba al input espejo y no togglaba; se clicó el botón (que es lo que clica un humano) y el toggle fue correcto.

## Control negativo

Tres controles negativos reproducidos (A guard, B reshape T2.6, C ruta), todos con salida ROJA pegada más abajo.

**(A) Guard de decisión vacía — el fix muerde**

Se REVIRTIÓ el guard de T5.14 al bug original (`applyScriptVerdicts` ANTES del check + `return {}` en vez de `throw`). Resultado (`02-...RED.txt`): los 2 tests de rechazo de T5.14 ROJOS con el síntoma exacto del bug:

```
x T5.14: confirmar con 0 aprobadas se RECHAZA (validation_error) sin consumir el checkpoint ni transicionar nada
x T5.14: aprobar SOLO variantes con flag bloqueante (0 quedarían scripted) también se RECHAZA
AssertionError: promise resolved "{}" instead of rejecting
```

El `promise resolved "{}"` ES el 200-mudo de producción (la rama `return {}` que consumía el checkpoint). Restaurado (`git checkout --`) el árbol vuelve verde.

**Sobre «2º POST da 409» del DoD**: ningún test PERMANENTE la asserta directa (el de integración corre en el SEAM `applyDecidedVerdicts`, sin la transición de `approveStep`, y afirma el invariante equivalente: `variantStatus='planned'` + 0 runs + throw tipado). El «no consume checkpoint / 2º POST no 409» se verificó EN VIVO a nivel de ruta (tabla, puntos 5-6). No bloqueante: el control negativo pedido («revertir -> test ROJO») se cumple en sustancia.

**(B) Auditoría del reshape de los 2 tests T2.6 (la NOTA del brief) — sin pérdida de cobertura**

Se mutó el guard server-side de bloqueo (`approve: verdict.approved && !hasBlocking` -> quitando `&& !hasBlocking`). Resultado (`03-...RED.txt`): los DOS tests T2.6 reshaped ROJOS:

```
x BLOQUEO SERVER-SIDE: `approved:true` sobre un guion con flag bloqueante NO lo pasa a scripted
x BLOQUEO SERVER-SIDE por RE-LINT: un `editedScript` que INTRODUCE un claim prohibido no se aprueba
```

-> el invariante «variante bloqueada -> NO llega a `scripted`» SIGUE aserido sobre `variantIds[1]` en ambos reshaped. El «0 runs / nextRunId undefined» que se quitó lo recogen ahora los 2 tests NUEVOS de T5.14 (verdes en baseline, rojos bajo control (A)). **El reshape NO debilitó cobertura** (regla 5 respetada). La mutación se revirtió.

**(C) Control negativo a nivel de RUTA (re-verificación 2026-07-26) — el test nuevo muerde**

El nuevo `describe('CP3 · confirmar con 0 aprobadas NO vara el lote — a nivel ROUTE (T5.14)')` conduce el HANDLER REAL `POST /api/steps/:id/approve` (vía `call(approvePost, ...)`), no el seam `approveInTx`. Es el eslabón que faltaba: afirma que el guard corre DENTRO de la tx del route y su throw des-consume el checkpoint. Verde aislado: 38/38 (`05-route-test-green.txt`).

Reproducido por el verifier (NO se confió en el control del implementer): se revirtió el guard en `apps/web/src/server/script-checkpoint.ts` (throw → `return {}`, el bug original) y se corrieron los 3 tests T5.14 de ruta. Salida ROJA literal (`06-route-control-negativo-RED.txt`):

```
× ...POST con 0 aprobadas → 400 validation_error y el checkpoint NO se consume (step sigue waiting_approval)
   → expected 200 to be 400 // Object.is equality
× ...el lote sigue OPERABLE: un 2º POST idéntico vuelve a dar 400 (NO 409) — el checkpoint no se consumió
   → expected 409 to be 400 // Object.is equality
✓ ...control POSITIVO: aprobar AL MENOS UNA variante limpia → 200 y el lote avanza
 Test Files  1 failed (1)
      Tests  2 failed | 1 passed | 35 skipped (38)
```

Lectura: `expected 200 to be 400` = el 0-aprobadas vuelve al 200-mudo de producción; `expected 409 to be 400` = el 1er POST consume el checkpoint (N5→succeeded) y el 2º da 409 `invalid_transition` — EXACTAMENTE el síntoma del DoD («2º POST da 409»). El control positivo se mantiene verde. Guard RESTAURADO tras la prueba: `git diff --stat -- apps/web/src` VACÍO, y los 3 tests vuelven a verde. **Invariante «lo que VERIFY bendice == lo que se commitea» respetado**: lo único modificado es el fichero de test.

## Rarezas

- **Asimetría cliente/servidor (noted, no es hallazgo)**: `noneApproved` deriva de `approvedCount` (cliente), el guard del servidor de `scripted` (post-bloqueo). Un usuario que «aprobara solo una variante bloqueada» tendría el botón HABILITADO -> POST -> 400. NO deja el lote varado. Además es INALCANZABLE por humano: el checkbox de una tarjeta bloqueada está `disabled` hasta editar (`scripts-panel.test.tsx`, `script-editor.spec.ts:147-148`). Solo por POST directo, que recibe el 400. Cerrada.
- **Gap de test permanente — CERRADO (2026-07-26)**: el extremo «POST 0-aprobadas -> 400, N5 sigue `waiting_approval`, 2º POST 400 no 409» ya NO depende solo de la verificación en vivo: lo protege ahora un spec de regresión permanente a nivel de ruta en `apps/web/test/integration/api/checkpoints.test.ts` (3 `it`, validados y con control negativo reproducido — §C).

## Coste real

**$0** de APIs de pago. Todo el flujo corrió contra el fake-stack (`*_BASE_URL` local, 0 llamadas a endpoints reales — verificado en `_stack.log`). El «Coste real $0.07» que muestra la UI es contabilidad del ledger con costes SINTÉTICOS del fake, no gasto real. Se decidió NO pulsar «Confirmar guiones» para mantener el gasto en $0. (Estimado planning: $0 — coincide.)
