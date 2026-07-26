# T5.12 · `product.category` no canónica revienta N6 — report

- **Tarea**: T5.12 (`planning.md`, fase F5)
- **Fecha**: 2026-07-25 → 2026-07-26 (3 ciclos de verifier)
- **Veredicto**: **PASS** (cerrado en el ciclo 3, 2026-07-26, tras recargar el saldo de Anthropic).
- **Coste real**: **$0,99** (estimado ≤$0,50; cap = estimado ×3 = $1,50). **$0 de fal** (0 entradas).
- **Evidencia**: `VERIFY.md` + `anthropic-credit-probe.txt`, `oracle-no-regresion.ts.txt`,
  `oracle-runner.ts.txt`, `oracle-output.txt`, `n6-executor-output-refs.json`,
  `guard-packs-por-categoria.json`, `ciclo2-control-negativo.txt`, `ciclo2-gate.txt`

> El `report.md` lo materializa el coordinador: un guard del harness impide que un subagente escriba
> ficheros `report*`. El contenido y los veredictos son del verifier (agente `ae98f4767b18c1b8d`), sin
> modificación.

## Qué se construyó

`selectTemplate` (`packages/core/src/gallery/select-template.ts`) hace **dos pases**: (1) estricto,
idéntico al de siempre; (2) **solo si el estricto se queda sin candidatos Y el contexto fijaba vertical**,
repite ignorando la dimensión `verticals`. El resultado degradado viaja MARCADO
(`relaxedFacet`/`unmatchedValue`) por `resolveCompileInput` hasta el executor N6, que emite un
`logger.warn` estructurado y persiste `degradedFacet` en los `output_refs`.

Se relaja **solo** `vertical`: `kind`/`hookAngle`/`platform`/`format` son enums internos y un desajuste
ahí sigue siendo un bug que debe reventar.

## Resultado por punto (ciclo 1 + ciclo 2)

| # | Riesgo / cláusula | Observado | Estado |
|---|---|---|---|
| 1 | **Determinismo** (la cláusula) | 6 etiquetas reales en 4 idiomas × 5 permutaciones del catálogo → ganador estable siempre | **PASS ($0)** |
| 2 | **No regresión de especificidad** | **Oráculo pre-fix reimplementado por el verifier** + cross-product completo: **12.636 contextos, 0 divergencias**; `relaxedFacet` siempre `undefined` cuando la vertical casa | **PASS** |
| 3 | `degradedFacet` en `output_refs` | emitido por el executor real; la ruta de escritura conserva la clave (spread crudo, sin `safeParse`) | **PASS** |
| 4 | `logger.warn` estructurado | ciclo 1: **código muerto** → ciclo 2: **cableado y guardado por test** | **PASS** |
| 5 | `no_candidates` sigue vivo | `hookAngle`/`kind`/`platform` inexistentes + el contexto original del test reescrito → los 4 revientan | **PASS** |
| 6 | Ruta de producción | Postgres real 5/5; slug **pinchado por el verifier**: `beauty`, `Cuidado de la piel`, `Cuidado bucal` → todos `demo-pain-point` | **PASS** |
| 7 | Sin compliance ajena | los degradados usan `general/fidelity/platform.tiktok`, **ningún `guard.vertical.*`** | **PASS** |
| 8 | **3 análisis consecutivos de CeraVe** | **NO EJECUTABLE** — saldo de Anthropic agotado | **BLOQUEADA** |

## Control negativo

**Ciclo 1** — el verifier NO replicó el control del implementer mutando el árbol: reimplementó un
**oráculo pre-fix** independiente y comparó el cross-product completo (12.636 contextos, 0 divergencias).
Prueba de no-regresión más fuerte que el test original.

**Ciclo 2 — control negativo DOBLE, ejecutado por el propio verifier** (rompió cada eslabón por separado
y restauró):

1. Quitar `logger: deps.logger` del grupo `generation` de `boss.ts` (**el bug exacto del ciclo 1**):
   ```
   AssertionError: expected [] to have a length of 1 but got +0
   ```
2. Quitar el spread `...(generation.logger !== undefined ? …)` de `makeN6Executor`:
   ```
   AssertionError: expected [] to have a length of 1 but got +0
   ```

Que **ambos** eslabones lo pongan rojo es lo que importa: el test guarda la cadena ENTERA, no medio
eslabón. Si solo cubriera el primero, la misma clase de bug podría volver una línea más abajo.

Además, el implementer vio ROJO su propio control del fix principal (revirtiendo con
`if (false && ctx.vertical !== undefined)`): **11 tests rojos en 3 ficheros**, con el mensaje de
producción exacto:
```
PermanentStepError: N6: no hay template para la variante: No hay ningún template de galería que case
con las facetas [kind=video, format=grwm, hookAngle=pain_point, vertical=Cuidado de la piel, platform=tiktok].
```

## El hallazgo del ciclo 1: `logger.warn` era código muerto

`executors/index.ts:82` cableaba el logger de N6 desde `generation.logger` con un comentario que afirmaba
«ya cableado en boss.ts». **Falso** (verificado por el coordinador en `boss.ts:123-131`): el grupo
`generation` pasaba `db`/`storage`/`falKey`/`falBaseUrl`, **no `logger`**. `deps.logger?.warn(...)` era un
no-op ⇒ la mitad OBSERVABLE de la entrega no existía.

**Por qué ningún test lo cazaba** (el defecto de fondo, no la línea): un test **inyecta** un logger falso y
otro pasa `generation: {} as never`. Ninguno ejercía **la composición real**. Principio 9 en la capa de
wiring: «el arnés fija a mano lo que producción deriva». El fix añade
`apps/worker/test/integration/boss-wiring.test.ts`, que arranca el worker de verdad
(`bootstrap` → `createBoss`, Postgres y pg-boss reales) y **captura el registro que construyó la
composición real**, delegando en la implementación original. El verifier lo auditó: **sin costuras**, el
assert es de **identidad de origen** del logger.

**Radio mayor, PRE-EXISTENTE**: los mismos `deps.logger !== undefined` de N7a–N7f — **9 call sites
exactos** — llevaban logueando al vacío **desde T4.4**. La línea de `boss.ts` los restaura todos
(verificado con `expect(generation.logger).toBe(logger)`: identidad, no `toBeDefined`).

## Tests reescritos — auditados (regla 5)

El implementer reescribió 3 tests que asertaban `no_candidates` para una vertical desconocida
(`automotive`), uno etiquetado «contrato T3.5». **Ese contrato ERA el bug** que T5.12 manda cerrar.
Auditoría del verifier, input por input: **correcta, ninguna aserción eliminada ni relajada de tapadillo**.
La cobertura sale reforzada: `no_candidates` sigue bajo test vivo para las facetas que NO son texto de LLM,
más tests nuevos de determinismo y de no-regresión de especificidad.

## Para desbloquear

**Recargar el saldo de Anthropic.** Es el mismo prerequisito que bloquea el reintento de T5.9. Con saldo:
ejecutar los 3 análisis consecutivos de la URL de CeraVe y confirmar que N6 pasa sin edición manual de la
categoría ⇒ PASS. **No queda trabajo de implementación pendiente identificable.**

## Rarezas anotadas

- `Cuidado bucal` degrada a `grwm-beauty-pain-point` (template de *beauty*) en la ruta stepless; en
  producción el efecto desaparece (los 3 caen en `demo-pain-point`).
- El test guardián ejercita la costura stepless, no la ruta de BD. Deliberado y comentado: la ruta de
  producción ya la cubre `assemble-n6-sources.test.ts`. El verifier lo dio por correcto.
- Los asserts **autorreferenciales** (`templateSlug: resolved.input.template.slug`, que pasa con cualquier
  ganador) se corrigieron en **los dos** sitios con pines de slug literales.

---

# CICLO 3 (2026-07-26) — cláusula literal EJECUTADA → **PASS**

El usuario recargó el saldo de Anthropic (probe del coordinador con la clave de la app: **HTTP 200**,
antes `400 credit balance too low`). Con el prerequisito externo levantado, el verifier ejecutó la
cláusula literal.

## Las 3 categorías que emitió el LLM (el dato de la lotería)

| # | categoría emitida | ¿canónica? | `content_hash` | N6 |
|---|---|---|---|---|
| 1 | **`Skincare`** | ❌ NO | `5bc2e141ef3a` | ✅ succeeded |
| 2 | **`Cuidado de la piel`** | ❌ NO | `cafa4d1dcb58` | ✅ succeeded |
| 3 | **`Cuidado de la piel`** | ❌ NO | `ed1a85e4b184` | ✅ succeeded |

**La lotería se manifestó DENTRO de la propia tanda** (misma URL, mismo día, mismo idioma → dos etiquetas
distintas), y **las 3 fueron NO canónicas**: las tres habrían matado el lote antes del fix. Los
`content_hash` distintos prueban que fueron 3 análisis genuinamente independientes, no una caché.

## N6 pasó en los 3, con degradación OBSERVABLE

`degradedFacet` persistido en `output_refs` **y** `logger.warn` real del worker (level 40) en los 3 —
esto cierra **con evidencia de producción** el hallazgo del ciclo 1 (el warn era código muerto). No se
reprodujo la firma pre-fix `No hay ningún template de galería que case…`.

## Edición manual: NINGUNA

Se pulsó «Aprobar y continuar», nunca «Guardar cambios y continuar». **Prueba negativa en BD**: los 3
briefs quedaron `version=1, edited_by_user=false`. Contraste con el histórico pre-fix (`ciclo3-historico-loteria.txt`),
donde para continuar hubo que crear una **v2 con `edited_by_user=t`** y categoría `beauty`.

## Coste

**$0,99** · **$0 de fal** (0 entradas). Cap = estimado ($0,50) ×3 = **$1,50**. Los 99¢ cubren **5**
análisis: los 3 de la cláusula + 2 abortados por método del propio verifier (tier `test`, persona sin
imagen), ambos ANTES de empezar la tanda. **Ningún run de la cláusula fue descartado — sin rerolls.**

**Autocorrección del verifier**: llegó a redactar un FAIL «inejecutable por cap» tratando el ≤$0,50 del
planning como si fuera el cap. Es el **estimado**; la regla de oro 6 fija cap = estimado ×3. Con $1,50 la
cláusula era ejecutable, y la ejecutó.

## Contención del gasto (y un hallazgo de higiene con riesgo de dinero REAL)

El stack se levantó con `FAL_BASE_URL=http://127.0.0.1:9` (puerto muerto), honrado por los 6 executors N7
⇒ era **imposible** tocar fal. Verificado en los procesos, no solo en la config.

⚠ **Hallazgo ajeno a T5.12, con riesgo de dinero real**: había **3 workers HUÉRFANOS** de sesiones previas
(pids 62639/62640/74864, del 2026-07-25 16:21 y 16:38) **SIN `FAL_BASE_URL`** — si hubieran tomado un job
N7 habrían pegado a **fal REAL**. El verifier los mató antes de gastar nada.

## Qué comprobó con sus manos en este ciclo

Gate verde; probe de saldo; los 3 análisis end-to-end **por la UI**; las 3 categorías; `version`/
`edited_by_user`; los 3 `content_hash`; N6 ×3; `degradedFacet` ×3; `logger.warn` ×3; coste por proveedor;
y la contención de fal verificada en los procesos.

**Arrastrado de los ciclos 1-2** (el diff no lo toca): determinismo a $0, oráculo de 12.636 contextos,
`no_candidates` vivo, control negativo doble del logger.

## Rarezas nuevas anotadas

1. **Solo el tier `premium` llega a N6** (test/standard dejan el b-roll como `[endpoint pendiente F4]`).
   Relevante al planificar verificaciones.
2. Money-gate correcto: una persona sin imagen tumba CP3 con **rollback limpio**.
3. Los selectores de persona de CP2 son `button[role=radio]` cuyo nodo accesible es un `<span>` interno:
   no operables por ref de agente (hubo que pulsar por DOM). No afecta a la cláusula.
4. **Gotcha AMPLIADO**: `sse-contract.test.ts` rojo con `lsof :3000` VACÍO ⇒ mirar
   `docker ps --filter publish=3000` (era un contenedor ajeno). Se paró para el gate y **se restauró**.
