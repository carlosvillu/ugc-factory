---
name: testing
description: Estrategia de testing unificada de UGC Factory — todas las capas (packages/core, packages/db, apps/web, apps/worker, API+BD, E2E, media/FFmpeg, APIs de pago) y el gate CUA de cierre de tarea. Usar SIEMPRE que se escriba o modifique código del proyecto, se añadan tests, se configure Vitest/Playwright/Testcontainers/msw/CI, se vaya a marcar una tarea de planning.md como completada, se ejecute una verificación de tarea (CUA con agent-browser o script), o se toque cualquier cosa relacionada con test, spec, coverage, mock, fixture, golden file o pipeline de CI. También cuando el usuario pida "verifica", "testea", "comprueba que funciona" o cierre de tarea.
---

# Estrategia de testing — UGC Factory

Esta skill define CÓMO se testea todo el proyecto. Es la fuente de verdad única: si un test nuevo no encaja en lo que describe este documento y sus references, o el test está mal planteado o esta skill necesita una actualización deliberada (nunca las dos cosas en silencio).

## Principios

1. **La "Verificación" del planning es la vara.** Cada tarea de `planning.md` termina con una verificación observable en el mundo real. Los tests automatizados existen para que esa verificación no regresione después; el gate CUA/script existe para ejecutarla de verdad la primera vez. "El código compila" o "los tests unitarios pasan" NUNCA cierran una tarea por sí solos.
2. **Los tests nacen con el código, en la misma tarea.** No hay fase de "añadir tests después". Una subtarea sin sus tests está a medias, y el planning prohíbe dejar el sistema a medias.
3. **Postgres real para todo lo transaccional.** El orquestador (`SELECT FOR UPDATE`, `NOTIFY`, encolado transaccional) es el corazón del sistema y no se puede mockear con fidelidad. Integración = Testcontainers, siempre. Mockear la BD para testear el orquestador es testear el mock.
4. **La suite nunca gasta dinero.** `pnpm test` corre offline: APIs de pago mockeadas con msw + fixtures grabados de respuestas reales. Las llamadas reales viven solo en `pnpm test:live` (opt-in, presupuestado) y en las verificaciones de tarea.
5. **Evidencia o no ocurrió.** Toda verificación de cierre de tarea deja rastro en `docs/verifications/<TASK-ID>/` (report.md + screenshots/outputs). Marcar `[x]` en planning.md sin carpeta de evidencia es un error de proceso.
6. **Forma de trofeo, no pirámide clásica.** El grueso del valor está en integración (orquestador + API contra BD real) y en los E2E/CUA que prueban el sistema como bloque. Unit se reserva para lógica pura con sustancia (contratos, compilador, linters, validadores). No se escriben unit tests de pegamento trivial para inflar cobertura.
7. **Determinismo antes que reintentos.** Un test flaky se arregla o se borra, no se reintenta hasta que pase. Nada de `sleep`/`waitForTimeout` fijos: polling con timeout explícito, esperas por condición observable.
8. **CUA acepta; Playwright conserva.** Toda tarea que añada o modifique comportamiento operable en navegador declara en `planning.md` su `Playwright permanente` (fichero + comportamientos) y lo entrega en la misma tarea. La sesión CUA demuestra que la feature funciona en el mundo real al cerrarla, pero no sustituye el spec determinista que debe detectar regresiones futuras.
9. **EL ARNÉS NUNCA PUEDE SER MÁS CÓMODO QUE LA REALIDAD.** Es el anti-patrón que más caro nos ha salido: **ocho incidentes**, en ocho capas distintas, y en todos la suite estaba **verde mientras la funcionalidad estaba rota**. Las seis formas que adopta:
   - **Un doble emite lo que le conviene al test, no lo que emite el productor REAL.** T1.8/T1.9: el fixture traía el precio ya formateado (`"34,90 €"`), pero Firecrawl emite `String(amount)` → `"34.9"`. El cross-check comparaba strings → **todo análisis por URL habría corrompido el precio de todos los anuncios**, con 848 tests en verde. T1.10b: el fake de Anthropic devolvía imágenes SIEMPRE, incluso sin imágenes de entrada → el único warning que CP1 debe resolver era **inobservable**.
   - **El arnés FIJA A MANO lo que producción DERIVA.** T1.13: el stack E2E ponía `INTERNAL_API_URL`, que era exactamente la variable cuyo cálculo estaba roto → **el test que debía cazar el bug era el que lo tapaba**, y el fallo sobrevivió a F0 y F1 enteras. T1.11: un `Request` construido a mano **no lleva `content-length`** (lo pone la capa de fetch al enviar), así que el test del techo de tamaño solo ejercitaba la rama que ningún cliente real usa.
   - **Se mide el componente AISLADO de la condición en la que vive.** T1.12: los tonos se calibraron contra una superficie idealizada (blanco puro) con margen cero → pasaban en el laboratorio y **fallaban a 3,9:1 sobre las superficies reales** donde los badges se pintan. *(Es el mismo error que el bug que se estaba arreglando, un nivel más abajo.)*
   - **EL TEST HACE EL CHEQUEO POR SU CUENTA, en vez de pedírselo al código que corre en producción.** Es la forma más traicionera: el test es correcto, pasa, y **vigila una puerta por la que el dato no entra**. T2.1: el test barría hooks Y CTAs buscando placeholders desconocidos con su propio `findPlaceholders`; el **validador** —el único código que `pnpm seed` ejecuta antes de escribir en la BD— solo miraba los hooks. Una CTA con `{producto_inventado}` daba `ok: true`, se sembraba, y el renderizador habría escupido la llave literal dentro del anuncio. *La regla: **un test que reimplementa la comprobación no prueba que la comprobación exista**; asserta sobre la SALIDA de la función que corre en producción (`validateSeeds(...)`), no sobre una reimplementación de su lógica.* Si te descubres reescribiendo en el test lo que el código ya hace, pregúntate por qué no se lo estás preguntando a él.

   - **EL RUNTIME DEL TEST ES MÁS PERMISIVO QUE EL DE PRODUCCIÓN.** No miente ningún doble ni mira mal ningún assert: **el test se ejecuta en un sitio donde el código funciona, y producción lo ejecuta en uno donde no**. T2.0: el barrel `@ugc/core/persona` re-exportaba código con **sharp** (binario nativo) y `api-client.ts` —módulo de CLIENTE— lo importaba; Turbopack intentaba resolver `child_process` para el navegador y **la app ENTERA dejaba de compilar** (cayeron 28 specs de F0 sin relación con personas). **Los 1042 tests estaban VERDES**: `pnpm test` corre en **Node**, y en Node importar sharp funciona perfectamente. *El único test que compila la app de verdad PARA UN NAVEGADOR es el E2E, y fue el único que lo vio.* La regla: **cuando el código va a correr en dos runtimes (Node y bundler; servidor y navegador; local y VPS), un test que solo ejercita el cómodo no prueba el otro** — y no basta con "acordarse": hazlo comprobable (T2.0 dejó `client-bundle-honesty.test.ts`, que recorre el grafo de imports desde los `'use client'` y falla en el gate, en segundos, sin navegador). *(Sub-lección cara: el guard nació mirando solo `import` y no `export … from` — pero un barrel **re-exporta**, que es EL mecanismo del bug. Al reinyectarlo para el control negativo, **el guard siguió verde**. Un guard que no se pone rojo cuando el bug vuelve no es un guard: es decoración.)*

   - **EL CASO DE PRUEBA CAE JUSTO DONDE EL BUG SE ESCONDE (el punto fijo).** El test es correcto, mide lo que dice medir, ejercita el camino real… y aun así **no puede fallar**, porque el punto elegido es uno donde la fórmula rota y la correcta **dan el mismo resultado**. T2.2: el estimador escala el coste con `recipe × (segundos / 30)`, y la Verificación del planning manda componer una matriz de `conversion` — que son **exactamente 30 s**. Ahí el factor es **1**, así que el estimador reproduce la receta **por identidad, no por cálculo**: el verifier saboteó el escalado a `(s/30)²` —que preserva la identidad en el ancla— y **sus 63 comprobaciones, incluida la cuenta a mano contra el Apéndice B, se quedaron enteras en VERDE**. *Una verificación que solo mide en el punto fijo de la función no verifica la función.* La red real la ponían las sondas **lejos del ancla** (12 s y 45 s), que existían porque el control negativo del implementer las obligó a existir. **La regla: cuando lo que pruebas es una LEY (una fórmula, un escalado, una proporción), un solo punto nunca basta — y menos si es el punto donde la ley es trivial. Elige al menos uno lejos del ancla, donde una ley equivocada dé un número distinto.** Ojo: esto se aplica también a las **Verificaciones del `planning.md`**, no solo a los tests — la de T2.2 era, por construcción, incapaz de cazar un escalado roto.

   **Las seis preguntas, antes de dar por bueno un test:** (a) *¿Este doble emite lo que emite el productor real?* → **ve a leer el productor**, no lo supongas. (b) *¿El arnés está fijando algo que en producción se calcula?* → si sí, el test no prueba el cálculo. (c) *¿Estoy midiendo en el entorno real o en uno idealizado?* (d) *¿Estoy ejerciendo el camino que recorre el dato de verdad, o uno paralelo que he construido en el test?* (e) *¿El test corre en el MISMO runtime que producción?* → si el código viaja a un navegador, un bundler o una VPS, Node en tu portátil no es ese sitio. (f) *Si lo que pruebo es una LEY, ¿la estoy midiendo en un punto donde una ley equivocada daría lo mismo?* → entonces no la estás midiendo.
   Y la prueba de fuego, que es barata y no es opcional en un fix de bug: **CONTROL NEGATIVO — reintroduce el bug y comprueba que el test se pone ROJO.** Un test que no has visto fallar no sabes si muerde. **Y mira QUÉ se pone rojo**: en T2.1 el control negativo puso en rojo el test que barría por su cuenta, mientras el validador seguía diciendo `ok: true` — el rojo estaba en el sitio equivocado, y solo mirarlo lo reveló. *(No existe un mecanismo de código único que cace las seis: viven en capas distintas y cada guard puntual es frágil por su cuenta. La defensa es este principio, aplicado por el implementer al escribir y por los pases de review y el `verifier` al cerrar.)*

## Las seis suites

| Suite | Comando | Qué cubre | Dónde corre |
|---|---|---|---|
| Unit | `pnpm test:unit` | Lógica pura: contratos Zod, compilador de prompts, linter FTC, validadores, golden files | Local + CI (cada push) |
| Integración | `pnpm test:integration` | Orquestador, pg-boss, migraciones, repos, API routes contra Postgres real (Testcontainers) | Local + CI (cada push) |
| E2E | `pnpm test:e2e` | Playwright: flujos de navegador completos con app levantada y APIs externas mockeadas/demo | Local + CI (cada push) |
| Media | `pnpm test:media` | FFmpeg/ffprobe/ASS/C2PA en el contenedor del worker (desde F5) | Contenedor worker + CI (job propio) |
| Live | `pnpm test:live` | Clientes de APIs de pago contra APIs reales, con guard de presupuesto (`LIVE_BUDGET_USD`, default $0,50) | Solo local, opt-in explícito |
| CUA | (flujo agéntico, no runner) | Verificación de cierre de tarea con `agent-browser` reproduciendo el flujo humano | Solo local, al cerrar cada tarea |

`pnpm test` = unit + integración. Es el gate mínimo antes de cualquier commit.

## Tabla de decisión: ¿qué tests escribo?

Localiza lo que estás construyendo y lee el reference indicado ANTES de escribir los tests:

| Vas a escribir… | Tests que exige | Reference |
|---|---|---|
| Setup inicial de testing (T0.1–T0.3), nuevo paquete, scripts pnpm | Bootstrap de configs y `@ugc/test-utils` | `references/stack-setup.md` |
| Contratos Zod, lógica pura de `packages/core`, linters, validadores de seeds, compilador de prompts, adapters, generador ASS | Unit table-driven + fixtures válidos/inválidos + golden files | `references/unit-core.md` |
| Schema Drizzle, migraciones, repos, índices, constraints | Integración con Testcontainers (template database) | `references/db-integration.md` |
| Máquina de estados, `transition()`, dependencias, checkpoints, invalidación, pg-boss, timeouts, executors, dedupe | Integración exhaustiva contra Postgres real + concurrencia | `references/orchestrator.md` |
| API routes de Next (CRUD, mutaciones de checkpoint, SSE, webhooks, auth, downloads) | Handler-level contra BD real; server-level para SSE/auth/streaming | `references/api.md` |
| Componentes React, hooks, canvas React Flow, editores de checkpoint, formularios | Testing Library + jsdom si hay lógica; además el spec Playwright permanente declarado por la tarea para el comportamiento operable | `references/frontend.md` + `references/e2e.md` |
| Un flujo de usuario completo, un E2E de fase (T1.10b, T2.6, T4.11, T5.9) | Playwright spec con seeds, auth fixture y esperas por SSE | `references/e2e.md` |
| Tools MCP (T8.5: `analyze_url`, `create_batch`, `get_batch_status`…) | Integración handler-level de cada tool contra Postgres real + test del contrato long-poll; gate vía cliente MCP real (ver cua.md) | `references/api.md` + `references/cua.md` |
| Cliente de fal/Anthropic/Firecrawl/TikTok/Meta, o cerrar una deuda `[verificar]` | Mocks msw + fixtures grabados; live test presupuestado si aplica | `references/external-apis.md` |
| Normalización, concat, mezcla de audio, captions ASS, C2PA, QA report | Tests media con assets sintéticos + asserts ffprobe/ebur128 | `references/media-composition.md` |
| Workflow de CI, un job nuevo, caching | GitHub Actions según el layout definido | `references/ci.md` |
| Cerrar una tarea del planning | Gate CUA (si hay UI) o script observable + evidencia | `references/cua.md` |

Si el código toca varias filas (lo normal: un endpoint nuevo = contrato + repo + handler + quizá UI), aplica cada fila a su parte. La pregunta correcta nunca es "¿qué test escribo?" sino "¿en qué capas tiene comportamiento esta pieza?".

## Definition of Done de una tarea del planning

Una tarea se marca `[x]` solo cuando TODO esto es cierto:

1. Subtareas implementadas y `pnpm test` en verde (unit + integración, incluyendo los tests nuevos de la tarea).
2. Los tests nuevos cubren la "Entrega" de la tarea: cada comportamiento prometido tiene al menos un test que fallaría si se rompiera.
3. Si la tarea tocó superficie web, su línea `Playwright permanente` de `planning.md` está satisfecha: el fichero existe, cada comportamiento nombrado tiene un assert que fallaría al romperse y `pnpm test:e2e` queda en verde. Un CUA PASS sin este spec es FAIL de DoD.
4. **La "Verificación" literal del planning ejecutada de verdad**:
   - Con superficie UI → sesión CUA con `agent-browser` siguiendo `references/cua.md`.
   - Solo backend → script/curl observable contra el sistema levantado (compose + pnpm dev), no contra mocks.
5. Evidencia persistida en `docs/verifications/<TASK-ID>/` (report.md con plantilla de `references/cua.md` + capturas/outputs; coste real anotado si hubo APIs de pago).
6. Si la tarea cerraba una deuda `[verificar]`, el resultado está anotado en PRD.md y planning.md (regla de trabajo 3 del planning).
7. Sin regresión del E2E de la fase anterior (regla de trabajo 2).
8. `planning.md` actualizado: `[x]` + fecha + resultado (+ coste real si aplica).

Un fallo en el paso 4 significa que la tarea NO está completa, aunque toda la suite esté en verde: arregla y repite la verificación.

### Rojos FANTASMA del gate (antes de depurar tu código, descarta estos)

Dos fallos conocidos que **no son de tu código** y que han hecho perder tiempo ya varias veces. Si el gate o el E2E se ponen rojos de forma inexplicable, comprueba PRIMERO:

1. **¿Tienes un `pnpm dev` vivo?** → **mátalo y repite.** `sse-contract.test.ts` arranca **su propio** `next dev`; con uno ya escuchando choca (*«Another next dev server is already running»*) y **el gate FALLA con los 1090 tests en verde**. El gate NO es hermético frente a un dev server en marcha (lo descubrió el verifier de T2.0 durante una sesión CUA, que por definición tiene la app levantada).
2. **¿`pnpm test:e2e` sale con código ≠0 pero reporta TODOS los tests verdes?** (o falla con `routes.d.ts`, o «next dev murió durante el arranque») → **basura de `.next`**: `rm -rf apps/web/.next` y repite el ciclo COMPLETO.

Ninguno de los dos se arregla reintentando a ciegas ni relajando un test. Y si el rojo NO es uno de estos, es tuyo: no lo trates como flake (regla de oro 5 del dev-loop).

## Mapa fase → foco de testing

| Fase | Foco dominante | Piezas nuevas de testing |
|---|---|---|
| F0 | Orquestador (integración exhaustiva) + harness completo | Testcontainers, `@ugc/test-utils`, CI, primeros E2E del canvas, primer CUA en T0.4 (login) y después T0.11/T0.13 |
| F1 | Contratos Zod + mocks de scraping/Anthropic | Fixtures grabados de Firecrawl/Anthropic, test de seguridad anti-injection (T1.8), CUA de CP1 |
| F2 | Lógica de matriz/guiones + linter FTC | Validadores de seeds en CI, CUA de CP2/CP3 |
| F3 | Compilador (golden files) + galería | Golden files carácter a carácter, tests de índices GIN, `fal:verify` |
| F4 | FalClient (mocks + live) + idempotencia | Primeros live tests presupuestados, webhooks firmados, dedupe |
| F5 | Media/FFmpeg | Suite `test:media` en el contenedor del worker, job de CI de media |
| F6–F7 | Clientes TikTok/Meta (mocks) + métricas derivadas | Fixtures de APIs de plataformas, OAuth handler-level, tests de reglas kill/scale con snapshots inyectados |
| F8 | Operación: restore drill, retención, MCP, observabilidad | Integración del job de retención (T8.2), suite de tools MCP (T8.5), verificación operativa de backup/restore contra el VPS (T8.1, ver cua.md) y alertas (T8.8) |

## Convenciones núcleo (el detalle vive en los references)

- **Ubicación**: unit co-locados `src/**/*.test.ts` · integración `test/integration/**/*.test.ts` por paquete · E2E `apps/web/e2e/**/*.spec.ts` · live `**/*.live.test.ts` · media `apps/worker/test/media/**/*.test.ts`.
- **Contrato con planning**: cada tarea web nombra el spec exacto que crea o amplía y los comportamientos que quedan protegidos. Reusar un spec es válido cuando amplía el mismo flujo; una línea genérica como “añadir E2E” no lo es.
- **Utilidades compartidas**: todo helper de test reutilizable vive en `packages/test-utils` (`@ugc/test-utils`) — `startPostgresContainer()`, `createTestDatabase()`, factories de dominio (`makeProject()`, `makeRun()`, `makeStep()`…), `seedFixtures()`. No dupliques harness por paquete.
- **Factories, no fixtures de BD gigantes**: los datos de test se construyen con factories con defaults sensatos y overrides explícitos de lo que importa al caso.
- **Golden files**: en `test/golden/` junto a su suite; se regeneran solo con `UPDATE_GOLDEN=1` y el diff se revisa a mano antes de commitear.
- **Fixtures HTTP grabados**: `packages/test-utils/fixtures/http/<provider>/…`, sanitizados de secretos, regrabados al detectar drift.
- **Nombres de test**: describen el comportamiento y el porqué de fallar (`"rechaza transición running→pending sin tocar la BD"`), no el nombre del método.
- **CI**: lint+typecheck, unit, integración, E2E y validadores de seeds son gate de merge. CUA y live NUNCA corren en CI.

## References

| Archivo | Léelo cuando… |
|---|---|
| `references/stack-setup.md` | Montes o toques la infraestructura de testing (T0.1+), crees un paquete, añadas scripts |
| `references/unit-core.md` | Escribas unit tests de lógica pura, contratos, golden files, validadores |
| `references/db-integration.md` | Toques schema/migraciones/repos o necesites el harness de Testcontainers |
| `references/orchestrator.md` | Toques la máquina de estados, pg-boss, executors, checkpoints, timeouts |
| `references/api.md` | Escribas o modifiques API routes, SSE, webhooks, auth |
| `references/frontend.md` | Escribas componentes/hooks de apps/web |
| `references/e2e.md` | Escribas specs de Playwright o el E2E de una fase |
| `references/cua.md` | Vayas a cerrar CUALQUIER tarea del planning (gate obligatorio) |
| `references/external-apis.md` | Toques un cliente de API externa o una deuda `[verificar]` |
| `references/media-composition.md` | Toques el worker de render, captions, C2PA, QA (F5+) |
| `references/ci.md` | Toques `.github/workflows/` o decidas qué corre dónde |
