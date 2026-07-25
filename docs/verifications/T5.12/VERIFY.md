# Verificación T5.12 — `product.category` no canónica revienta N6 (lotería por análisis)

- **Tarea**: T5.12 · `product.category` no canónica revienta N6 (`planning.md`)
- **Fecha**: 2026-07-25
- **Ejecutor**: verifier (contexto fresco) · sin agent-browser (tarea sin superficie UI)
- **Sistema**: HEAD `360f15a` + diff de T5.12 sin commitear (11 ficheros) · Postgres `ugc-postgres-dev` (`postgres://ugc:ugc@localhost:55432/ugc`)

## Verificación esperada (literal de planning.md)
> la URL real de CeraVe produce un lote que pasa N6 **sin edición manual de la categoría**, en 3 análisis consecutivos (el determinismo es la cláusula: no vale que funcione una vez).

---

# CICLO 2 — RE-VERIFICACIÓN (2026-07-25, tras el fix del implementer)

## VEREDICTO CICLO 2: **FAIL** — causa 1 RESUELTA ✅ ; causa 2 (⚠ prerequisito externo) SIGUE VIVA

**El fix de mi bloqueante está CORRECTO y verificado con mis manos.** Lo único que impide el PASS es que la cláusula literal sigue siendo INEJECUTABLE por saldo — nada que el implementer pueda hacer.

### Lo que RE-VERIFIQUÉ en este ciclo

| # | Qué | Cómo lo comprobé | Resultado |
|---|---|---|---|
| 1 | **Cableado del logger** (mi bloqueante) | `boss.ts:134` ahora pasa `logger: deps.logger` al grupo `generation` | ✅ resuelto |
| 2 | **Test de composición real** — ¿mide lo que dice? | Auditado línea a línea + ejecutado | ✅ **sin costuras** (ver análisis abajo) |
| 3 | **Control negativo A** (eslabón `boss.ts`) | **Rompí `boss.ts` yo**: quité `logger: deps.logger` | ✅ ROJO: `AssertionError: expected [] to have a length of 1 but got +0` (mensaje EXACTO reportado) |
| 4 | **Control negativo B** (eslabón registry) | **Rompí `executors/index.ts` yo**: quité el spread de `makeN6Executor` | ✅ ROJO: mismo assert. **La cadena ENTERA está guardada, no medio eslabón** |
| 5 | **N7a–N7f reciben el logger** | Test propio con `expect(g.logger).toBe(logger)` — **identidad**, no solo `toBeDefined` | ✅ `generation.logger` ES el logger de `bootstrap`; el registry pasa `generation` por REFERENCIA a los 6 (`index.ts:90,96,102,109,114,122`) |
| 6 | **9 call sites** que logueaban al vacío desde T4.4 | `grep -c "deps.logger !== undefined"` en executors | ✅ 9 exactos (generation.ts 3, generate-avatar 2, music/broll/cta/voice 1 c/u) |
| 7 | **Pines de slug** (mi rareza del ciclo 1) | Leí ambos diffs | ✅ literales duros en LOS DOS: `demo-pain-point` (services) y `grwm-beauty-pain-point` (core) — coinciden con lo que YO medí de forma independiente en el ciclo 1 |
| 8 | **Gate completo** | `pnpm gate` ejecutado por mí | ✅ **exit 0 · 233 ficheros / 2449 tests + 4 e2e de fase** |

### Auditoría del test guardián (`apps/worker/test/integration/boss-wiring.test.ts`)

**Mide lo que dice medir. No encontré ninguna costura que falsee el resultado.** Razones concretas:

- El `vi.mock` **delega en la implementación ORIGINAL** (`real.makeExecutorRegistry(deps)`) y solo guarda la referencia; no sustituye comportamiento ni fabrica deps. Lo que se ejecuta es el executor que compuso `boss.ts`.
- Las deps son las REALES: `bootstrap` → `createBoss` contra **Postgres real + pg-boss real**. El test no inyecta `db`, `storage` ni `falKey`.
- **El único doble es el logger de ENTRADA del proceso** (`makeTestLogger`, pasado a `bootstrap`) — que es justo la salida bajo observación. Es la única forma de observar sin ser el sujeto observado.
- El assert es de **identidad de origen**, no de forma: filtra `logger.entries` del logger que se le dio a `bootstrap`. Si el warning saliera por cualquier otro logger, `entries` quedaría vacío.
- El guard `hasVerticalFacet` estrecha `obj: object` con `'facet' in obj` en vez de un cast — el assert sigue siendo real.
- **La prueba definitiva de que no es un test complaciente**: rompí los dos eslabones por separado y ambos lo ponen rojo (puntos 3 y 4). Un test que pasara por construcción no lo haría.

Única observación menor (no defecto): el test ejercita la costura **stepless** (fuentes por dep), no la ruta de BD. Es deliberado y está comentado — mide UNA cosa (el cableado del logger), y la ruta de producción ya la cubre `assemble-n6-sources.test.ts`. Correcto.

### Lo que ARRASTRO del ciclo 1 (verde, y el diff nuevo NO lo toca)

El diff de este ciclo solo añade el logger al grupo `generation`, el test nuevo y los dos pines de slug. **No toca `select-template.ts` ni `compile-executor-contract.ts`**, así que sigue vigente sin re-ejecutar:

- Determinismo a $0 (6 etiquetas / 4 idiomas × 5 permutaciones) ✅
- No-regresión de especificidad: **12.636 contextos, 0 divergencias** contra mi oráculo pre-fix ✅
- `no_candidates` vivo para `kind`/`hookAngle`/`platform` ✅
- Ruta de producción con Postgres real + guard packs sin `guard.vertical.*` ajena ✅
- `degradedFacet` persiste en `output_refs` (spread crudo, sin `safeParse`) ✅

### Causa 2 — sigue bloqueando (⚠ PREREQUISITO EXTERNO DEL USUARIO)

Saldo de Anthropic **agotado** (probado en el ciclo 1: HTTP 400, `req_011CdP33sFzuzmqf7DvdPdw4`). Los «3 análisis consecutivos» de la URL real de CeraVe **no son ejecutables**. **Esto NO es un fallo del fix**: es el mismo prerequisito que bloquea el reintento de T5.9. Recargar saldo → ejecutar la cláusula → PASS.

### Coste ciclo 2: **$0,00** (todo determinista y local; ninguna API de pago).

---

# CICLO 1 (2026-07-25) — histórico

## VEREDICTO CICLO 1: **FAIL** — por DOS causas independientes

Distinción explícita y deliberada (**no** «el fix no funciona»):

- **Causa 1 — DEFECTO ACCIONABLE YA (del implementer, $0, no necesita saldo)**: el `logger.warn` de la degradación es **código muerto en producción** (HALLAZGO 1). Media entrega («log estructurado») no existe fuera de los tests.
- **Causa 2 — PREREQUISITO EXTERNO ⚠ (del usuario, NO un fallo del fix)**: los «3 análisis consecutivos» de la URL real de CeraVe exigen el LLM de análisis y **el saldo de Anthropic sigue agotado** → la cláusula literal es INEJECUTABLE.

**El fix en sí se sostiene** en TODO lo verificable a $0, con evidencia más fuerte que la del implementer (12.636 contextos, oráculo pre-fix independiente).

Probe hecho ANTES de montar nada, con la MISMA key que usa la app (`.env`):
```
HTTP 400 — "Your credit balance is too low to access the Anthropic API."
request_id req_011CdP33sFzuzmqf7DvdPdw4
```
Evidencia: `anthropic-credit-probe.txt`. Coste del probe: **$0** (rechazado antes de consumir tokens).

**Lo que falta para PASS**: recargar saldo Anthropic y ejecutar 3 análisis reales de la URL de CeraVe → N6 sin edición manual de la categoría. Es exactamente el mismo prerequisito ⚠ que ya bloquea el reintento de T5.9.

## Gate previo (ejecutado por mí, no aceptado del informe)

`pnpm gate` — **VERDE**, exit 0: `lint → typecheck → format:check → knip → readme:status:check → check:contrast → e2e:wired:check → test → test:e2e:phases`. **232 ficheros / 2446 tests passed** + **4 e2e de fase passed**.

- Primer intento dio rojo en `sse-contract.test.ts` por el puerto 3000 ocupado (gotcha DOCUMENTADO). Tras `lsof -ti:3000 | xargs kill -9`: verde.
- Un exit 1 intermedio lo causó **mi propio fichero de verificación** dentro de `docs/` (vitest/knip lo recogían). Retirado del árbol → `pnpm test:e2e:phases` exit **0**. El árbol quedó limpio (solo el diff de T5.12).

## Resultado por punto — lo que comprobé CON MIS MANOS

| # | Cláusula / riesgo | Cómo lo verifiqué (independiente) | Resultado |
|---|---|---|---|
| 1 | **Determinismo** (la cláusula) a $0 | Oráculo propio + 6 categorías reales en 4 idiomas (`Cuidado de la piel`, `Cuidado bucal`, `Skin care`, `Higiene bucal`, `Hautpflege`, `スキンケア`) × **5 permutaciones** del catálogo (original/reversed/bySlugDesc/rotated/shuffled) | ✅ ganador ESTABLE en las 5 permutaciones y en las 6 etiquetas; las 3 «análisis consecutivos» (`beauty`/`Cuidado de la piel`/`Skin care`) resuelven template |
| 2 | **NO regresión de especificidad** (el riesgo real) | **Reimplementé el selector PRE-FIX como oráculo** y enumeré el cross-product COMPLETO del seed (kind × format × hookAngle × vertical × platform). **12.636 contextos** con match estricto | ✅ **0 divergencias**: mismo slug que el pre-fix en los 12.636, y `relaxedFacet` SIEMPRE `undefined` cuando la vertical casa |
| 3 | **Degradación no silenciosa** — `degradedFacet` en `output_refs` | Ejecuté el executor N6 real **SIN logger** (la composición real de `boss.ts`) y volqué el output emitido | ✅ `degradedFacet` presente: `{facet:'vertical', value:'Cuidado bucal', templateSlug:'grwm-beauty-pain-point'}` (`n6-executor-output-refs.json`) |
| 3b | **Degradación no silenciosa** — `logger.warn` | Leí la composición de `boss.ts` | ❌ **HALLAZGO: el warn NUNCA se emite en producción** (ver abajo) |
| 4 | **`no_candidates` sigue vivo** | Casos propios: `hookAngle` inexistente, `kind` inexistente, `platform` inexistente (incluso con vertical libre), y **el contexto ORIGINAL del test reescrito (sin platform)** | ✅ los 4 dan `no_candidates`; la relajación NO se desborda a otras facetas |
| 5 | **Ruta de PRODUCCIÓN** (`assembleN6Sources` → `resolveCompileInput`) | Integración con Postgres REAL: `assemble-n6-sources.test.ts` (5/5) + slug PINCHADO por mí (no autorreferencial) | ✅ `beauty`, `Cuidado de la piel` y `Cuidado bucal` → **el MISMO** `demo-pain-point`; la etiqueta libre no cambia el template compilado |
| 6 | **Sin compliance ajena** (assert que el implementer NO escribió) | Guard packs REALMENTE usados en el prompt compilado | ✅ degradado usa `general/fidelity/platform.tiktok` y **ningún `guard.vertical.*`** (`guard-packs-por-categoria.json`) |

## HALLAZGO 1 (bloqueante para el PASS, incluso con saldo) — el `logger.warn` es CÓDIGO MUERTO en producción

`executors/index.ts:82` cablea el logger de N6 así:
```ts
N6: makeN6Executor({ db: analysis.db,
  ...(generation.logger !== undefined ? { logger: generation.logger } : {}) }),
```
con el comentario *«reusa el del grupo `generation`, **ya cableado en boss.ts**»*.

**Ese comentario es falso.** El grupo `generation` en `apps/worker/src/boss.ts:123-131` es:
```ts
generation: { db, storage: makeLocalStorageAdapterFromEnv(),
  falKey: () => loadFalKey(db, getSecretsKeyFromEnv()),
  ...(process.env.FAL_BASE_URL !== undefined ? { falBaseUrl: ... } : {}) },
```
— **no hay `logger`**. `GenerationExecutorDeps` sí declara `logger?: Logger` (`generation.ts:76`), pero `boss.ts` nunca lo puebla, y `makeExecutorRegistry` es su ÚNICO call site de producción. `deps.logger` está disponible ahí mismo (se pasa en las líneas 69, 137, 145, 159 a otros consumers): simplemente se omitió en el grupo `generation`.

**Consecuencia**: `generation.logger === undefined` → el spread no añade nada → `deps.logger?.warn(...)` es un no-op. **La mitad «log estructurado» de la entrega no existe en producción.** El test del implementer no lo detecta porque **inyecta un logger falso** (`compile-prompt.test.ts`: `const logger = {...warn...}`), así que pasa en verde mientras producción queda muda.

**Fix accionable (1 línea)**: añadir `logger: deps.logger` al grupo `generation` de `boss.ts:123` (o pasar el logger directo a `makeN6Executor`). Y un test que cubra la COMPOSICIÓN real, no una dep inyectada a mano.

**Atenuante (verificado, no supuesto)**: la degradación **NO es totalmente silenciosa** — `degradedFacet` sí llega a `step_run.output_refs`. Comprobado en dos tramos: (a) el executor lo EMITE sin logger (`n6-executor-output-refs.json`); (b) la RUTA DE ESCRITURA lo conserva — `step-execute.ts:317` pasa `{ outputRefs: outcome.output }` a `transition`, que lo tipa como `unknown` y lo escribe por spread crudo (`transition.ts:309`), **sin `safeParse`** que pudiera descartar la clave. El rastro auditable sobrevive; lo que se pierde es la señal en el log.

**Confirmación empírica del cableado** (`grep -rn "makeExecutorRegistry" apps packages --include='*.ts'`): el ÚNICO call site de producción es `boss.ts:85`, y **nada en todo el repo puebla `generation.logger`**.

**Radio de impacto MÁS AMPLIO (pre-existente, NO causado por T5.12 — no es de esta tarea arreglarlo, pero el usuario debe saberlo)**: `generation.ts:231/344/362` usan el MISMO guard `...(deps.logger !== undefined ? …)`. Como `generation.logger` nunca se puebla, **los nodos N7a–N7e llevan tiempo logueando al vacío**. El implementer no rompió el cableado: se apoyó en una dep que **nunca estuvo cableada** y la documentó como «ya cableado en boss.ts».

**Por qué ningún test lo caza**: el único test de composición (`compile-prompt.test.ts:152`) pasa `generation: {} as never` — un stub sin logger. Y el test de la degradación inyecta un logger falso a mano. Ninguno ejercita la composición REAL.

## Auditoría de los 3 tests reescritos (regla 5) — CORRECTA, sin relajación de tapadillo

Confirmo el criterio del coordinador, verificado input por input:

1. `select-template.test.ts` «un vertical sin template → no_candidates» → ahora asierta degradación marcada. **El contrato viejo ERA el bug.** Ninguna aserción se pierde: `no_candidates` sigue asertado para `kind` y `hookAngle` (+ 2 casos que añadí yo).
2. `compile-executor-contract.test.ts` — el caso `automotive`+`grwm` se re-apunta a `hookAngle:'no_such_angle'`, conservando `no_template` + mensaje accionable. Verifiqué que con el input VIEJO el comportamiento nuevo es `ok:true`+degradado (cambio de significado deliberado, no un test que se cayó).
3. «honestidad de los backstops» — la reescritura **AÑADIÓ `platform:'tiktok'`** al contexto. Comprobé el **contexto original sin platform**: sigue dando `no_candidates` ✅. El comentario que lo justifica es honesto.

## Rarezas (no bloquean, pero van al acta)

- **`Cuidado bucal` (higiene oral) degrada a `grwm-beauty-pain-point`**, un template de *beauty*, en la ruta stepless con `format:'grwm'`. No inyecta compliance de beauty (verificado), pero el cuerpo del template es de belleza. En la ruta de PRODUCCIÓN el efecto desaparece (los 3 caen en `demo-pain-point`, el mismo que la canónica).
- El assert del implementer en `assemble-n6-sources.test.ts` es **autorreferencial** (`templateSlug: resolved.input.template.slug`): pasaría con cualquier ganador. Lo sustituí por un slug pinchado a mano y el resultado es correcto — pero el test tal cual no protege de un cambio de ganador.
- El fix no aborda la causa raíz (que el LLM emita categorías fuera del enum); mitiga el síntoma en el consumidor. Es una decisión defendible y explícitamente contemplada por la Entrega del planning.

## Coste real

**$0,00** (estimado ≤$0,50). Todo lo ejecutado fue determinista y local; el probe de Anthropic fue rechazado por saldo sin consumir tokens. **$0 de fal.** No se superó ni se acercó al cap.

## Evidencia

- `anthropic-credit-probe.txt` — saldo agotado (HTTP 400 + request_id)
- `oracle-no-regresion.ts.txt` + `oracle-runner.ts.txt` — mi oráculo pre-fix independiente
- `oracle-output.txt` — 17/17, incl. «contextos con match estricto comprobados: 12636»
- `n6-executor-output-refs.json` — `degradedFacet` emitido por el executor real SIN logger
- `guard-packs-por-categoria.json` — packs usados: sin `guard.vertical.*` en los degradados
