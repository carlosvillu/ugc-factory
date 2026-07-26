# Verificación T5.12 — `product.category` no canónica revienta N6 (lotería por análisis)

- **Tarea**: T5.12 · `product.category` no canónica revienta N6 (`planning.md`)
- **Fecha**: 2026-07-25 (ciclos 1–2) · **2026-07-26 (ciclo 3 — PASS)**
- **Ejecutor**: verifier (contexto fresco) · ciclos 1–2 sin UI; **ciclo 3 con sesión CUA `agent-browser`**
- **Sistema**: ciclos 1–2 en HEAD `360f15a` + diff sin commitear; **ciclo 3 en HEAD `b593298` (árbol limpio)** · Postgres `ugc-postgres-dev` (`postgres://ugc:ugc@localhost:55432/ugc`)

## Verificación esperada (literal de planning.md)
> la URL real de CeraVe produce un lote que pasa N6 **sin edición manual de la categoría**, en 3 análisis consecutivos (el determinismo es la cláusula: no vale que funcione una vez).

---

# CICLO 3 — RE-VERIFICACIÓN (2026-07-26, saldo de Anthropic ya recargado)

- **Ejecutor**: verifier (contexto fresco) · HEAD `b593298` · sesión CUA `agent-browser --session t512`
- **Sistema**: web en `localhost:3001` + worker, Postgres `ugc-postgres-dev`, `FAL_BASE_URL=http://127.0.0.1:9`
- **Coste real del ciclo 3**: **$0,99** (cap = estimado $0,50 ×3 = **$1,50**) · **$0 de fal**

## VEREDICTO CICLO 3: **PASS** — la cláusula literal se ejecutó ENTERA

**Los 3 análisis consecutivos de la URL real de CeraVe pasaron N6 sin edición manual de la categoría.**
El prerequisito externo que bloqueaba los ciclos 1–2 (saldo agotado) está resuelto: probe con la clave de
la app → **HTTP 200** (`msg_011CdPgFsVnGkxXu1MswKYNW`), frente al `HTTP 400 credit balance too low` del
ciclo 1. Evidencia: `ciclo3-anthropic-probe.txt`.

### 1. LA TABLA DE LA LOTERÍA — las 3 categorías que emitió el LLM

Ejecutados **por UI, como un humano** (login → `/analyses/new` → CP1 → CP2 → CP3), uno detrás de otro,
sin rerolls ni descartes:

| # | run de análisis | `content_hash` | **categoría EMITIDA** | ¿canónica? | brief | N6 |
|---|---|---|---|---|---|---|
| **1** | `01KYEH5P7VE970PYDR1N26VNNC` | `5bc2e141ef3a` | **`Skincare`** | ❌ NO | v1, `edited_by_user=f` | ✅ **succeeded** |
| **2** | `01KYEHFQV32M0E007E31S72VMA` | `cafa4d1dcb58` | **`Cuidado de la piel`** | ❌ NO | v1, `edited_by_user=f` | ✅ **succeeded** |
| **3** | `01KYEHQ6STR1Y8MRDK3GHS8XSZ` | `ed1a85e4b184` | **`Cuidado de la piel`** | ❌ NO | v1, `edited_by_user=f` | ✅ **succeeded** |

**La lotería es REAL y se manifestó dentro de la propia tanda**: la MISMA URL, el MISMO día, con el mismo
idioma, emitió **dos etiquetas distintas** (`Skincare` en el run 1, `Cuidado de la piel` en los runs 2 y
3). **Ninguna de las tres fue canónica** — es decir, **las 3 habrían MATADO el lote antes del fix**, y aun
así **las 3 pasaron N6**. Ese es exactamente el punto de la cláusula: la robustez NO depende de que el LLM
acierte.

Los 3 `content_hash` son **distintos entre sí** ⇒ 3 análisis genuinamente independientes, no uno cacheado
tres veces. (El único caché por URL es `url_analysis_manual_cache_key`, restringido a `source='manual'`;
`brief-synthesizer.ts:304` **no fija `temperature`** ⇒ default 1.0, que es EL mecanismo de la lotería.)

### 2. «Sin edición manual» — probado en NEGATIVO, no por mi palabra

En los 3 runs pulsé **«Aprobar y continuar»**, NUNCA «Guardar cambios y continuar» (los dos botones que
ofrece CP1). Prueba dura en BD:

```
 brief                      | version | edited_by_user | category
 01KYEH8W20E0N29T0JJHAAEQ4A |    1    |       f        | Skincare
 01KYEHJMR7FB7RDJ4J9G5RF04R |    1    |       f        | Cuidado de la piel
 01KYEHTB561G2NVC21ZTJ63QQX |    1    |       f        | Cuidado de la piel
```

**Una sola fila por análisis, `version=1`, `edited_by_user=false`.** Contraste con el HISTÓRICO pre-fix
(`ciclo3-historico-loteria.txt`), donde el verifier de T5.9 tuvo que crear una **v2 con
`edited_by_user=t`** para poder continuar:

| brief | version | edited_by_user | category | fecha |
|---|---|---|---|---|
| `01KYA2RJT3…` | 1 | f | `Skincare` | 2026-07-24 |
| `01KYA2YKCH…` | **2** | **t** | `beauty` | 2026-07-24 ← **edición MANUAL** |
| `01KYCNNZXA…` | 1 | f | `Cuidado de la piel` | 2026-07-25 |
| `01KYCNQK7K…` | **2** | **t** | `beauty` | 2026-07-25 ← **edición MANUAL** |

Capturas: `ciclo3-screens/run{1,2,3}-01-cp1-*-sin-editar.png` (el campo «Categoría» con el valor del LLM
tal cual, antes de aprobar).

### 3. La degradación quedó OBSERVABLE en las dos mitades — en producción

Para las 3, N6 `succeeded` con `degradedFacet` persistido en `output_refs` **y** el `logger.warn` REAL del
worker (level 40), que en el ciclo 1 era **código muerto**:

| # | categoría | `degradedFacet` (BD) | `logger.warn` del worker |
|---|---|---|---|
| 1 | `Skincare` | `{facet:vertical, value:Skincare, templateSlug:lifestyle-broll-curiosity}` | ✅ emitido |
| 2 | `Cuidado de la piel` | `{facet:vertical, value:…, templateSlug:demo-pain-point}` | ✅ emitido |
| 3 | `Cuidado de la piel` | `{facet:vertical, value:…, templateSlug:demo-pain-point}` | ✅ emitido |

```
{"level":40,…,"name":"worker","facet":"vertical","unmatchedValue":"Skincare",
 "templateSlug":"lifestyle-broll-curiosity",
 "msg":"N6: category no reconocida por el catálogo — selección DEGRADADA ignorando la vertical"}
```

**Esto cierra el HALLAZGO 1 del ciclo 1 con evidencia de producción**, no de test: el warn sale del worker
compuesto por `boss.ts`, no de un logger inyectado.

Firma pre-fix que **NO** se reprodujo (`ciclo3-firma-bug-prefix.txt`, run histórico
`01KYCKRP17XNW99TK57WMN6FVZ`): `N6 failed — No hay ningún template de galería que case con las facetas […]`
con N7a–N7f en `awaiting_deps`.

### 4. Coste real y contención de fal

| Proveedor | Entradas | Coste |
|---|---|---|
| anthropic | 13 | **99¢** |
| firecrawl | 4 | 0¢ (plan por créditos) |
| **fal** | **0** | **$0** |

**Total $0,99**, dentro del cap $1,50 (regla de oro 6: estimado $0,50 ×3). Proyecté 24,5¢/análisis ANTES
de gastar (`ciclo3-proyeccion-coste.txt`) y el primero midió **26¢**: la proyección fue fiable.

**Desglose honesto de las 13 llamadas** (el lector debe poder cuadrar la aritmética): los 99¢ cubren **5
análisis**, no 3 — los **3 de la cláusula** más **2 intentos abortados por método MÍO**, ambos ANTERIORES
al run 1 y por causas ya documentadas como no-producto:

1. lote en tier `test` (`01KYEGF2C9EVZT4FN12Y3HZ3Q8`, 26¢) → CP3 no arranca generación en tier no-premium
   (§5.2), así que N6 nunca corrió;
2. lote premium (`01KYEGX8YBSECNZZ33WMDGX809`) → CP3 dio 500 por persona sin imagen (§5.3), con rollback
   limpio.

**Ningún run de la cláusula fue descartado**: los 3 que cuentan son los **3 últimos y consecutivos**, y
los 3 pasaron. Los abortos ocurrieron ANTES de empezar la tanda, por errores de configuración míos, no
por resultados que no me gustaran — no hay rerolls.

**$0 de fal por construcción**: `FAL_BASE_URL=http://127.0.0.1:9` (puerto muerto), honrado por los 6
executors N7. Verifiqué el env EN los procesos worker vivos, no solo en el comando. Tras confirmar N6 en
el run 3 **paré el worker** para que N7 no siguiera reintentando (80 retries): el fallo de N7 es
**contención deliberada mía**, no un defecto del producto.

### 5. Hallazgos colaterales (ninguno bloquea el PASS)

1. **Riesgo de dinero real, ajeno a T5.12 — workers huérfanos.** Encontré **3 procesos worker de sesiones
   previas** (pids 62639/62640/74864, del 25/07) **sin `FAL_BASE_URL`**: si hubieran tomado un job N7
   habrían pegado a **fal real**. Los maté antes de gastar. Merece una nota de higiene en el journal.
   (`ciclo3-contencion-fal.txt`)

2. **Solo el tier `premium` llega a N6.** Empecé en tier `test` para abaratar y CP3 aprobó los guiones
   **sin arrancar la generación**: `isTierGenerationReady` es `false` para test/standard porque su b-roll
   sigue siendo `[endpoint pendiente F4]`. Es comportamiento DOCUMENTADO de T4.11, no un defecto — pero
   significa que **N6 solo se ejerce en premium**, y conviene que el bucle lo sepa al planificar
   verificaciones. (`ciclo3-analisis1.txt`)

3. **Money-gate correcto: persona sin imagen.** Con `personaMode=rotate`, CP3 dio 500 con
   `PermanentStepError: la Persona … no tiene imagen de referencia (avatar)` porque la rotación eligió
   «Vera Verify T5.9» (0 `reference_image_ids`). El **rollback fue limpio** (N5 volvió a
   `waiting_approval`). Lo resolví fijando en CP2 una persona con imágenes — **preparación de escenario**,
   no atajo en el paso verificado. (`ciclo3-incidencia-persona.txt`)

4. **Rareza de UI (menor, la anoto y no la juzgo)**: los selectores de persona de CP2 son
   `button[role=radio]` cuyo nodo accesible expuesto es un `<span>` interno; el click por ref del agente
   no los activaba y tuve que pulsarlos por DOM. Para un agente son poco operables; para un humano con
   ratón no hay problema. **No afecta a la cláusula** (la persona es preparación de escenario).

5. **Gate: gotcha ampliado.** `pnpm gate` dio rojo en `sse-contract.test.ts` con
   `Another next dev server is already running` **pese a que `lsof -ti:3000` no devolvía nada**: el
   ocupante era un **contenedor Docker ajeno** (`docker-api-1`). Tras pararlo, gate **VERDE** (incl. 4 e2e
   de fase). **Lo restauré** al terminar. Receta ampliada: si `lsof:3000` sale vacío, mirar
   `docker ps --filter publish=3000`. (`ciclo3-gate.txt`)

6. Por eso mismo la web sirvió en **:3001**, no en :3000.

### 6. Qué comprobé con mis manos en este ciclo vs qué arrastro

**Con mis manos (ciclo 3)**: gate verde; probe de saldo; **los 3 análisis end-to-end por UI**; las 3
categorías emitidas; `version`/`edited_by_user` de los 3 briefs; los 3 `content_hash`; N6 `succeeded` ×3;
`degradedFacet` ×3; `logger.warn` del worker real ×3; coste real por proveedor; contención de fal
verificada en los procesos.

**Arrastrado de los ciclos 1–2 (el diff no lo toca)**: determinismo del selector a $0 (6 etiquetas × 4
idiomas × 5 permutaciones); no-regresión de especificidad (oráculo pre-fix, 12.636 contextos, 0
divergencias); `no_candidates` vivo para `kind`/`hookAngle`/`platform`; control negativo doble del
cableado del logger.

### Coste ciclo 3: **$0,99** de anthropic (13 llamadas) · **$0 de fal** · cap $1,50 — **no se superó**.

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
