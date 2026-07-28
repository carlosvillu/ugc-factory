# Verificación T5.23 — flake de infra e2e que contamina `pnpm gate` (f4-generation sobre stack REUSADO/warm)

- **Tarea**: T5.23 · defecto de infra de test e2e — f4-generation verde sobre stack reusado (`planning.md`)
- **Fecha**: 2026-07-28
- **Ejecutor**: verifier · sesión backend (script/psql/e2e, sin agent-browser: superficie = suite Playwright)
- **Sistema**: diff uncommitted sobre commit `92e0eaf` · stack e2e A MANO (`apps/web/scripts/e2e-stack.ts`, testcontainer pg16 en :33144 + `next dev` :3100 + worker) reusado por Playwright (`reuseExistingServer:!CI`, `CI` UNSET verificado)
- **Coste real**: $0 (fake-fal / fake-anthropic / fake-firecrawl — NUNCA API de pago)

## Verificación esperada (literal de planning.md)
> Arrancar un stack A MANO (`apps/web/scripts/e2e-stack.ts`, para que Playwright lo REUSE) y correr `test:e2e:phases` **>=5 veces consecutivas contra ESE MISMO stack vivo** -> `f4-generation` VERDE las 5. **Control negativo**: revertir el fix -> la corrida 2 sobre el mismo stack vuelve a ROJO. **Un stack FRESCO por corrida OCULTA el bug** (f4 pasa con o sin fix) — el escenario que muerde es el stack REUSADO/warm.

## Entorno (premisa del bug)
- `CI` **UNSET** -> `reuseExistingServer:!CI` activo -> Playwright REUSA el stack manual (no arranca uno fresco por corrida) -> `retries:0`. Verificado con `env | grep '^CI='`.
- `TESTCONTAINERS_RYUK_DISABLED=true` prefijado en el stack manual y en cada corrida.
- Stack manual vivo y estable durante las 5 corridas (`{"ok":true,"db":true}` en :3100; BD del testcontainer PERSISTE entre corridas -> los packshot N7a `completed` de la corrida previa sobreviven — el escenario que muerde).
- **Warm REAL confirmado**: 215 `generation_dedup_hit` totales; por corrida (ventanas de `stack.log`): run1=11 (intra-run), run2=64, run3=46, run4=45, run5=49 — cross-run desde la corrida 2.

## Pasos ejecutados
1. `shasum` baseline de los 2 ficheros del diff antes de tocar nada -> `0220a249...` (f4 spec) / `1e004c18...` (fake-apis).
2. Stack A MANO en background con stdout->`stack.log`; espera a `.runtime.json` + health :3100 (listo ~3s; DB en :33144).
3. `pnpm test:e2e:phases` x **5 corridas consecutivas contra el mismo stack vivo** (sin reiniciarlo). Log por corrida `warm-run-N.log`.
4. Diagnóstico del rojo por `error-context.md` (snapshot a11y en el momento del fallo), no por inferencia.
5. Teardown ordenado del stack + barrido de testcontainers. `shasum` post-run: byte-idénticos al baseline.

## Resultado observado vs esperado
| Corrida | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 (fresh DB) | f4 verde | **VERDE** (f4 16.3s; 4 passed) | warm-run-1.log | OK |
| 2 (warm, 64 hits) | f4 verde | **ROJO** `:311` `getByRole('complementary',{name:/N6/})` `toBeVisible` timeout 15s | warm-run-2.log, warm-run-2-FAIL-N6-panel.png | FAIL |
| 3 (warm, 46 hits) | f4 verde | **ROJO** `:326` `getByRole('complementary',{name:/N7d/})` `toBeVisible` timeout 15s | warm-run-3.log, warm-run-3-FAIL-N7d-panel.png | FAIL |
| 4 (warm, 45 hits) | f4 verde | **VERDE** (f4 17.8s; `RUN4_EXIT=0`) | warm-run-4.log | OK |
| 5 (warm, 49 hits) | f4 verde | **ROJO** `:311` `getByRole('complementary',{name:/N6/})` `toBeVisible` timeout 15s (`RUN5_EXIT=1`) | warm-run-5.log, warm-run-5-FAIL-N6-panel.png, run5-test-results/error-context.md | FAIL |

**f4-generation warm: 2/5 verde, 3/5 ROJO.** La cláusula «VERDE las 5» NO se cumple. f1/f2 verdes las 5 (no contaminan). El bug ORIGINAL (`waitForFailedStep` vacío, `un sub-step de generación debe fallar de forma determinista`) NO reapareció en ninguna corrida -> el mecanismo nonce+doom-keyed (elementos 1/2/4) SI funciona; lo que NO cierra es el reorden del bloque de paneles (elemento 3).

## Causa raíz OBSERVADA (no inferida)
El `error-context.md` de la corrida 5 (rojo `:311`) muestra el snapshot a11y en el fallo: el canvas contiene **múltiples `article "N9 · CP4 QA esperando aprobación"`** (varias variantes en `waiting_approval`) y **NINGUN `complementary`** (el `StepPanel` de N6 NO está montado). Es exactamente la precedencia de checkpoint de `run-shell.tsx:84-99`: en cuanto una variante pausa en CP4, `QaPanel` gana el único slot y `StepPanel` DEJA DE MONTARSE -> el inspector de N6/vídeo es inalcanzable -> timeout de 15s. Sobre stack warm la dedup de N7b-e (215 hits) acelera el pipeline lo bastante para que CP4 abra ANTES de que el bloque de paneles (paso 6, movido por el fix) clique N6. El reorden del elemento 3 NO adelantó el bloque lo suficiente en warm.

Contradicción con la medición del implementer (anotada en journal): «el primer vídeo es inspeccionable a ~6-8,5s y CP4 no pausa hasta ~69-93s (medido 5/5 warm)». Las corridas f4 aquí terminan en 38-45s (rojo) / 16-18s (verde) — nada alcanzó 69s, y CP4 estaba abierto al fallar en `:311`/`:326`. La medición «CP4 no pausa hasta ~69-93s» y el «5/5 warm» del implementer son irreproducibles en esta máquina.

## Control negativo
El control negativo prescrito (revertir el doom-keyed -> global one-shot para reproducir el rojo de `waitForFailedStep`) NO se ejecutó porque la Verificación FALLO por sus propios términos: no hay verde 5/5 que validar, y el fix ya NO entrega verde. El «rojo» que la verificación produjo por sí sola es la evidencia directa del fallo:

```
Error: expect(locator).toBeVisible() failed
Locator: getByRole('complementary', { name: /\bN6\b/ })
Expected: visible
Timeout: 15000ms
Error: element(s) not found
    at e2e/phases/f4-generation.spec.ts:311:73
RUN5_EXIT=1
```

(corrida 5, warm, 49 dedup hits — `warm-run-5.log`; idéntico patrón en corrida 2 `:311` y corrida 3 `:326`). Snapshot a11y del fallo: CP4 (`N9 esperando aprobación`) abierto, sin `complementary` montado -> `StepPanel` no monta por precedencia de checkpoint.

Evidencia POSITIVA de que los mecanismos del fix que SI tocan la dedup/doom funcionan: el assert de línea-base T5.21 (`un sub-step de generación debe fallar de forma determinista`, el `waitForFailedStep` vacío que era el bug original) **NO reapareció** en 4 corridas warm que arrastraron 45-64 `generation_dedup_hit` cada una — el nonce rompe la dedup cross-run y el doom keyed re-arma el fallo determinista por corrida. El rojo que persiste es de OTRO mecanismo (elemento 3, el reorden de paneles), no del que el control negativo prescrito habría validado.

### Byte-identidad (no toqué código de producto/test)
Post-run `shasum -a 256` == baseline:
- `apps/web/e2e/phases/f4-generation.spec.ts`: `0220a2492e2687f8d396f6e4bed633aca62f127c7beeb992711add01430ff09b` OK
- `packages/test-utils/src/fake-apis.ts`: `1e004c189c2d417852c0974401ff96b6e7b18bad6920b5a536140c9be75b3d07` OK

## Coste real
$0 — el stack sirve fal/anthropic/firecrawl FALSOS (puertos efímeros locales). Ninguna API de pago tocada.

## Veredicto
**FAIL** — sobre el mismo stack REUSADO/warm, `f4-generation` dio ROJO en 3 de 5 corridas consecutivas (`:311` N6 x2, `:326` N7d x1), incumpliendo la cláusula «VERDE las 5». El fallo es el `toBeVisible` del panel de nodo (`complementary`) que la precedencia de checkpoint de `run-shell.tsx:84-99` deja sin montar cuando CP4 abre — el 3.er defecto estructural que el reorden del elemento 3 pretendía cerrar y NO cierra en warm.

### Qué debe arreglar el implementer (accionable)
- **NO re-tocar** elementos 1/2/4 (URL run-única, doom keyed-por-corrida, guarda del prompt de N7a): verificados EFECTIVOS — el `waitForFailedStep` vacío (bug original) no reapareció en 5 corridas warm con 45-64 dedup hits.
- **Elemento 3 (reorden del bloque de paneles) es insuficiente**: sobre stack warm el pipeline llega a CP4 (`N9 waiting_approval`) ANTES de que el bloque de inspección de paneles clique N6, y `run-shell.tsx:84-99` da precedencia estricta al `QaPanel` -> `StepPanel` nunca monta -> `getByRole('complementary',{name:/N6|N7d/})` timeout 15s (3/5 warm). La medición del implementer «CP4 no pausa hasta ~69-93s» es irreproducible aquí (f4 termina en 38-45s con CP4 ya abierto). El fix del panel debe hacer la inspección INMUNE a que CP4 esté abierto (p. ej. no depender del slot único compartido con precedencia de checkpoint), no solo adelantar el bloque en el tiempo — la ventana no es fiable en warm.

## Rarezas
- La deuda de producto ya anotada por el implementer (`run-shell.tsx:84-99`: un usuario real no puede inspeccionar el panel de ningún nodo mientras haya un checkpoint pendiente) es la causa raíz de este flake — el fix de test la rodea, pero en warm el rodeo no es fiable.
- Segunda afirmación del implementer contradicha por la ejecución: «5/5 warm» (medido 2/5 verde) y «CP4 no pausa hasta ~69-93s» (CP4 abierto a los ~38-45s).
