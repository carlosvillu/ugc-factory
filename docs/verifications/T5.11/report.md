# T5.11 · N5 parcial se presenta como éxito — report

- **Tarea**: T5.11 (`planning.md`, fase F5)
- **Fecha**: 2026-07-25
- **Veredicto**: **PASS**
- **Coste real**: **$0** (estimado $0). Fallo del proveedor INYECTADO con el doble de test; el worker se
  mantuvo DETENIDO durante los POST en vivo ⇒ imposible tocar fal.
- **Evidencia**: `VERIFY.md` + `01-truncated-step-state.txt`, `02-route-post.txt`,
  `03-cp3-panel-5of12-truncated.png`, `04-wcag-contrast.txt`, `05-disabled-click-noop.png`,
  `browser-console.txt`

> El `report.md` lo materializa el coordinador: un guard del harness impide que un subagente escriba
> ficheros `report*`. El contenido y el veredicto son del verifier (agente `aaee171c0a32dc491`), sin
> modificación.

## Resultado por cláusula

| Cláusula | Esperado | Observado | Estado |
|---|---|---|---|
| El `step_run` refleja el fallo (no `waiting_approval` con `error=NULL`) | step a `failed` con causa tipada | el executor lanza `PermanentStepError` (k/n + causa) ⇒ `fail`; no emite artefacto. Integración n5-write-scripts 7/7 | **PASS** |
| La UI muestra el estado real | recuento real visible | subtítulo «5 de 12» + `Alert danger` «5/12»; la afirmación falsa («N5 escribió un guion por variante») **AUSENTE**. Verificado en navegador sobre el batch REAL de T5.9 | **PASS** |
| La UI no permite aprobar CP3 | botones inertes | ambos botones `[disabled]`; click humano = no-op (`05-disabled-click-noop.png`) | **PASS** |
| **Ningún camino** dispara gasto | cero gasto | **POST directo a la ruta HTTP real con auth real → 400**; `pipeline_run` **31→31** por SQL; 0 variantes scripted | **PASS** |
| El top-up no re-paga | solo lo que falta | el retry pide **solo el grupo faltante** (`calls === 1`), completa sin duplicar | **PASS** |
| `over_budget` sigue llegando a CP3 | sin regresión | no lanza; emite artefacto `over_budget` | **PASS** |

## Control negativo

El verifier ejecutó **3 controles negativos propios** (además de leer los 5 del implementer), y restauró el
diff **byte a byte** después (MD5 del guard idéntico; diff stat igual: 537 inserciones, 9 ficheros):

1. **Guard del servidor desactivado** → la aprobación **crea un `pipeline_run` REAL** (`01KYCV8ACK…`).
   Es la prueba directa de que la cerradura impide un gasto que sin ella ocurre. Salida ROJA:

   ```
   AssertionError: promise resolved "{ nextRunId: '01KYCV8ACK…' }" instead of rejecting
   ```

2. **Panel con la semántica pre-fix** → el botón «Confirmar guiones» vuelve a aparecer **sin `[disabled]`**.
   Salida ROJA (unit + e2e); en el snapshot de accesibilidad del fallo:

   ```
   AssertionError: expected null not to be null
   - button "Confirmar guiones"        ← sin [disabled]: el lote truncado vuelve a ser aprobable
   ```

   Los 5 controles del implementer, también vistos ROJOS, incluyen al quitar el gate de la rama de
   escritura:

   ```
   AssertionError: promise resolved "undefined" instead of rejecting
   ```
3. **Deuda de orden del fixture verificada**: sin restaurar `persona.reference_image_ids`, el control
   negativo **mentiría** (fallaría por `buildVariantGenerationPlan`, no por el gasto). El implementer lo
   había declarado y el verifier confirmó que su control mide lo que dice medir.

## Qué comprobó con sus manos vs qué aceptó del informe

- **Sus manos**: las 4 pruebas de integración (leídas antes de correr); el POST directo con auth real y la
  cuenta SQL de `pipeline_run`; el panel en navegador sobre el **artefacto REAL del bug de T5.9** (step
  `01KYCP8RB3…`, 5/12, `api_error`, `waiting_approval`, `error=NULL`); contraste WCAG medido; los 3
  controles negativos; y la reconciliación de umbrales matriz vs filas leyendo `cloneVariantForRegen` /
  `getLatestScriptsByBatch`.
- **Aceptado tras leer el código**: solo el mapeo `PermanentStepError → transition('fail')`.

## Cabo suelto CERRADO por el coordinador

El verifier no pudo ver pasar el test E2E permanente (`script-editor.spec.ts`) porque el stack de :3100 no
arrancó, y ese spec **no** está en `test:e2e:phases` (o sea, la certificación del gate no lo cubría). La
regla 10 lo hace bloqueante, así que **lo ejecuté yo**: `playwright test e2e/script-editor.spec.ts` →
**3 passed (20,5s)**.

De paso caractericé los 2 fallos de la suite e2e COMPLETA: `f4-generation.spec.ts` (ya conocido) y
`brief-editor.spec.ts`. **Ambos pasan AISLADOS** (`brief-editor` 8/8), así que son timeouts por carga
paralela, **no regresiones de T5.11**.

## Rarezas anotadas

1. **Mutación en la BD de dev**: el verifier borró+reseedeó `auth.password_hash` (drift del bootstrap).
   La password de login de dev es ahora `ugc-factory-dev` (`.env`) — anotado para no depurar un login
   roto misterioso más adelante.
2. **Deuda de DS** (del `ds-reviewer`, veredicto LIMPIO): en un lote truncado con flags, el usuario ve dos
   `Alert danger` visualmente **idénticas** que significan cosas distintas: «esta frase infringe una regla»
   y «aprobar quema dinero real». `danger` es el tono más fuerte que el DS ofrece, así que la elección fue
   correcta; la carencia es del DS (candidato a tono/primitiva de mayor severidad, vía Claude Design +
   DesignSync).
3. **Deuda de fixture**: `scripts-checkpoint.test.ts` tiene acoplamiento de orden (el test de atomicidad
   vacía `persona.reference_image_ids` sobre una persona de `beforeAll` que no se trunca). Limpieza general
   fuera del alcance de T5.11.
