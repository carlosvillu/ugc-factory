# Verificación T5.25 — Gate por fases (sin timeout) + guard de contenedores pg huérfanos

- **Tarea**: T5.25 · defecto de ARNÉS (`planning.md`)
- **Fecha**: 2026-07-29
- **Ejecutor**: verifier (contexto fresco) · sin agent-browser (tarea de arnés, sin superficie UI) · Docker = Colima
- **Sistema**: commit `823ab48` + diff staged (10 ficheros, ~923 inserc.) · `ugc-postgres-dev` Up healthy · e2e con APIs externas FALSAS (fake local, $0)

## Verificación esperada (literal de planning.md)
> en esta máquina, cerrar una tarea con superficie web+generación sin que el gate muera por timeout; y un guard que detecte los contenedores pg huérfanos antes de que saturen.

Dos cláusulas: (1) `gate:phases` corre a un veredicto AGREGADO sobre superficie web+generación sin morir por timeout, reportando qué fases corrieron/pasaron y sin poder mentir; (2) el guard detecta testcontainers pg huérfanos ANTES de saturar, SIN contar `ugc-postgres-dev`.

## Pasos ejecutados

### Cláusula 1 — gate:phases
1. Estado heredado (corrida del implementer) -> `--report` sin correr nada: correctamente FAIL/STALE porque yo habia creado un fichero de evidencia untracked (el ancla de frescura lo detecta). Guardado en `inherited-state.json`.
2. `--reset` + corrida COMPLETA limpia (sin escribir NADA en el arbol durante la corrida, output a scratchpad) -> **9/9 PASS, `RESULTADO: PASS`, exit 0**, tree hash `edb8200a`, en UNA sola invocacion de 21:20:19->21:24:09 (~3m50s). No murio por timeout. (`gate-phases-clean.txt`)
3. La fase `test:e2e:phases` incluyo `next build` + el sub-DAG N7 de f4 generando (superficie web+generacion) -- todo contra el fake local de fal (`http://127.0.0.1:53555/fal-cdn/...`), CERO llamadas a `queue.fal.run`/`api.anthropic.com`.
4. Controles de que el agregado NO puede mentir (todos exit medido SIN pipe): (a) fase FAIL->FAIL, (b) record borrado->PENDING, (c) treeHash alterado->STALE, (d) git inalcanzable->lanza ruidoso. `--only lint` no puede declarar verde (8 PENDING, exit 1). Ver `## Control negativo`.

### Cláusula 2 — guard de contenedores (Docker real, Colima)
5. Solo `ugc-postgres-dev` vivo -> `node scripts/check-orphan-workers.mjs` = "0 huerfanos", exit 0. `--clean-containers` NO toco la BD dev: `StartedAt` identico antes/despues (`18:33:55.986620152Z`).
6. Arranque 2 testcontainers etiquetados (`org.testcontainers=true`, postgres:16) -> guard cuenta 2 (dev DB excluida) -> `--strict` con esos 2 y sin worker = exit 0 (contenedores son tier AVISO) -> `--clean-containers` = 2/2 eliminados -> 0 -> `ugc-postgres-dev` sigue Up healthy, mismo `StartedAt`.
7. Tier worker de `--strict` via decoy cmdline-matching `src/main.ts` (NO worker real -- evita riesgo de gasto fal): con decoy vivo `--strict` = exit 1; tras `pkill` = exit 0.
8. Extra en el mundo real: durante la corrida limpia del gate, la higiene pre-flight aviso de 1 testcontainer residual (warn tier) sin contar la BD dev -- el guard funcionando en vivo.

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | gate:phases llega a veredicto agregado sin morir por timeout | 9/9 PASS, RESULTADO PASS, exit 0, ~3m50s en 1 invocacion | gate-phases-clean.txt · green-state-9pass.json | OK |
| 2 | El agregado reporta que fases corrieron/pasaron (no exit sueltos) | Tabla de 9 fases con glifo PASS + hash del arbol | gate-phases-clean.txt | OK |
| 3 | web+generacion (next build + N7 f4) cubierta | Fase test:e2e:phases PASS, N7 genero contra fake fal (127.0.0.1) | gate-phases-clean.txt | OK |
| 4 | Agregado no puede mentir: FAIL/PENDING/STALE/git-loud muerden, exit!=0 | (a)FAIL (b)PENDING (c)STALE (d)git-throw + --only, todos exit 1 | nc-a/b/c/d + nc-git | OK |
| 5 | Guard NO cuenta ugc-postgres-dev; --clean no la toca | "0 huerfanos", StartedAt invariante 18:33:55.986620152Z | guard-evidence.txt | OK |
| 6 | Guard SI cuenta testcontainers, --clean los borra, vuelve a 0 | 2 contados -> 2/2 borrados -> 0, dev DB intacta | guard-evidence.txt | OK |
| 7 | --strict = SOLO workers (contenedores no lo disparan; worker si) | 2 contenedores->exit 0; decoy worker->exit 1 | guard-evidence.txt | OK |
| 8 | scripts:unit verde | 25/25 (2 files) | scripts-unit.txt | OK |

## Control negativo

Los cuatro modos por los que el agregado podria MENTIR MUERDEN, cada uno con exit medido SIN pipe (medir con pipe robaria el exit -- verificado y evitado):

- **(a) fase FAIL** -> `FAIL test`, `RESULTADO: FAIL`, `NC_A_FAIL_EXIT=1` (`nc-a-fail.txt`)
- **(b) record borrado -> PENDING** -> `PENDING e2e:wired:check <- NO ha corrido`, `RESULTADO: FAIL`, `NC_B_PENDING_EXIT=1` (`nc-b-pending.txt`)
- **(c) treeHash alterado -> STALE** -> `STALE lint`, `RESULTADO: FAIL`, `NC_C_STALE_EXIT=1` (`nc-c-stale.txt`)
- **(d) git inalcanzable -> FAIL-LOUD** (no falso-verde): `Error: gate:phases requiere git para el anclaje de frescura del arbol ... se aborta antes que fingir un verde no verificado`, `GIT_BROKEN_EXIT=1` (`nc-git-unreachable.txt`)
- **`--only lint`** (una sola fase no puede declarar verde): lint PASS pero 8 PENDING, `RESULTADO: FAIL`, `NC_D_ONLY_EXIT=1` (`nc-d-only-lint.txt`)

Ademas, `scripts:unit` (25/25) cubre a nivel de funcion pura: `aggregate` (FAIL/PENDING/STALE/edicion-de-arbol), `treeState` LANZA con git inalcanzable (no devuelve centinela), `envForPhase` (ryuk-only NUNCA lleva DOCKER_HOST / colima-export SI), y `parseContainerIds` DESCARTA `ugc-postgres-dev`. Control negativo del guard con Docker real (dos caras) en `guard-evidence.txt`: un testcontainer etiquetado SI se cuenta y `--clean-containers` lo borra; un postgres:16 SIN etiqueta (simula la BD dev) NO se cuenta ni se borra -> `StartedAt` de `ugc-postgres-dev` invariante.

## Coste real
$0 — infra de arnes, cero APIs de pago. La fase e2e (N7 de f4 generando) viajo al fake local de fal (`http://127.0.0.1:53555/fal-cdn/...`); grep confirmo CERO llamadas a `queue.fal.run`/`api.anthropic.com`. Techo DURO fal $8,98 intacto. El unico "gasto" fueron contenedores postgres locales del control negativo, todos limpiados.

## Veredicto
**PASS** — `gate:phases` llega a un veredicto agregado (9/9 PASS, exit 0) sobre superficie web+generacion en una sola invocacion sin morir por timeout, y su agregado no puede saltarse/tragarse una fase (FAIL/PENDING/STALE/git-loud + --only, todos exit 1); el guard cuenta testcontainers pg huerfanos y los limpia con `--clean-containers` SIN tocar `ugc-postgres-dev` (StartedAt invariante), con `--strict` reservado a workers.

**Notas / rarezas (no bloquean):**
- **Restriccion de orden documentada**: `treeState()` hashea CADA untracked (incluido `docs/verifications/<ID>/`), asi que escribir la evidencia DESPUES de la corrida verde vuelve STALE el agregado en disco. El verde de la Clausula 1 se capturo a tree hash `edb8200a` ANTES de escribir evidencia; el estado en disco tras cerrar mostrara STALE por esto. No es defecto: el orden del dev-loop (implementer gatea -> verifier escribe evidencia) lo hace funcionar, y el runner errando hacia STALE es fail-loud, no falso-verde. Un futuro verifier debe correr `gate:phases` ANTES de escribir en `docs/verifications/`.
- **Resumibilidad NO estresada**: la corrida entera cupo en 1 invocacion (~3m50s), lejisimos del timeout. El path resumible existe pero no se ejercito -- verosimilmente porque la saturacion de 51 contenedores (que mato 6 gates) ya no esta: las dos clausulas se refuerzan (el guard mantiene la maquina ligera -> el gate cabe en el timeout).
- El header de `gate-phases.mjs` afirma que `next build` excluye su mutacion del hash; en ESTE arbol `git status --short` no mostro ningun fichero tracked mutado por el build, asi que la afirmacion se sostiene aqui (no se pudo forzar un contraejemplo).
