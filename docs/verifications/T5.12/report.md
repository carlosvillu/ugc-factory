# T5.12 · `product.category` no canónica revienta N6 — report

- **Tarea**: T5.12 (`planning.md`, fase F5)
- **Fecha**: 2026-07-25 (2 ciclos de verifier)
- **Veredicto**: **BLOQUEADA POR PREREQUISITO EXTERNO** — NO es un FAIL del fix.
  El trabajo de implementación está **completo y verificado a $0**; la cláusula literal
  («3 análisis consecutivos de la URL real de CeraVe») **no es ejecutable**: el saldo de Anthropic está
  agotado (HTTP 400, `req_011CdP33sFzuzmqf7DvdPdw4`, probado con la clave de la app).
- **Coste real**: **$0,00** (estimado ≤$0,50). $0 de fal, $0 de Anthropic.
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
