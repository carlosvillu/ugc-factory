# Verificación T5.11 — N5 parcial se presenta como éxito: aprobar un lote truncado dispara gasto real

- **Tarea**: T5.11 · N5 parcial se presenta como éxito (`planning.md`)
- **Fecha**: 2026-07-25
- **Ejecutor**: verifier (agente) · agent-browser 0.27.x · sesión `t5.11`
- **Sistema**: commit `7dac931` (working tree = diff T5.11 sin commitear, 9 ficheros, 537 inserciones; verificado que mis controles negativos se restauraron byte a byte — MD5 del guard igual antes/después) · docker `ugc-postgres-dev` (:55432) + `pnpm --filter @ugc/web dev` (:3000). **Worker DETENIDO a propósito** antes de cualquier POST en vivo para garantizar $0 (batch premium: un guard fallido habría creado un run que el worker llevaría a fal real).

## Verificación esperada (literal de planning.md)
> con N5 fallando tras escribir k<n guiones, la UI muestra el estado real y **no** permite aprobar CP3; el `step_run` refleja el fallo (no `waiting_approval` con `error=NULL`). Ningún camino de la UI permite disparar gasto sobre un lote incompleto.

## Fixture — el artefacto REAL del bug de T5.9 (no sintético)
El defecto vive en la BD de dev: step `01KYCP8RB3VX13R9Z4V9X8Y6K7` (N5) del batch `01KYCP8RAJ07GFVKXAMVYEZ7ZV`, tier **premium**, en estado `waiting_approval` con `error IS NULL`, `output_refs.status = api_error`, **5 scriptRefs / 12 variantes**. Es EXACTAMENTE el estado pre-fix que la cláusula describe → la rama `partial` del panel es alcanzable (no es código muerto). Evidencia: `01-truncated-step-state.txt`.

## Pasos ejecutados
1. **Gate previo**: certificado verde por el coordinador (2433 tests). Corrí los subconjuntos afectados yo mismo (ver abajo).
2. **Executor N5 (integración, Testcontainers)** — corrí `n5-write-scripts` (7/7): un `429` a mitad ⇒ `PermanentStepError` con recuento real (`1/2`) y causa tipada `PROVEEDOR (api_error`; NO emite artefacto (⇒ el consumer lo lleva a `failed`, no a `waiting_approval`); el guion pagado se conserva. Top-up: el retry pide SOLO el grupo que falta (`calls === 1`), completa 2/2 sin duplicar, y AHORA sí emite artefacto. `over_budget` completo NO se gatea (llega a CP3).
3. **Guard del servidor (integración)** — `scripts-checkpoint` (12/12): un lote 1/2 se rechaza con `INCOMPLETO: 1/2` y `pipeline_run == 0`.
4. **POST DIRECTO a la ruta REAL** `/api/steps/:id/approve` (auth de sesión real vía `/api/login`) sobre el batch 5/12: **HTTP 400** `validation_error` «el lote ... está INCOMPLETO: 5/12 guiones escritos». `pipeline_run`: **31 → 31** (SQL antes/después), variant sigue `planned`, cero variantes `scripted`. Evidencia: `02-route-post.txt`.
5. **Panel en el navegador** (`/runs/01KYCP8RB4XTTDKJXC6HGKQPSE`, sesión autenticada por cookie minteada vía el `/api/login` real): subtítulo «N5 escribió **5 de 12** guiones: el lote está incompleto»; Alert `danger` con «**Lote incompleto.** Hay 5/12 ... No se puede aprobar»; ambos botones `[disabled]` (`confirm:true, approveAll:true`); la afirmación falsa «N5 escribió un guion por variante» AUSENTE (`falseAffirmationPresent:false`). Click humano sobre el botón deshabilitado = no-op (URL sin cambio, `pipeline_run` sigue 31). Evidencia: `03-cp3-panel-5of12-truncated.png`, `05-disabled-click-noop.png`, `browser-console.txt` (limpia).
6. **WCAG** del Alert danger, DARK medido en navegador: cuerpo y recuento `rgb(244,244,245)` sobre bg compositado `rgb(33,16,17)` = **16.68:1** (≫ 4.5:1); icono decorativo 4.87:1 (≫3:1). LIGHT confirmado por los TOKENS (el Alert usa `text-text` sobre `bg-danger-soft`, `alert.tsx:18/24`, no colores hardcodeados) + el gate `pnpm check:contrast`: `light --text sobre --surface 17.72:1` (cuerpo) y `light --danger sobre --danger-soft 5.28:1` (énfasis). AA en ambos temas. Evidencia: `04-wcag-contrast.txt`.

## Controles negativos que reproduje YO (no acepté del informe)
- **Guard del servidor desactivado** (`if (false && ...)` en una copia; restaurado): el test money-safety pasa de rechazar a **RESOLVER con `nextRunId: 01KYCV8ACKS9M8XPBCGG5QPR66`** — un `pipeline_run` REAL creado sobre el lote truncado. Confirma que el guard protege dinero reachable (la claim del implementer es cierta).
- **Deuda declarada (acoplamiento de orden)**: con el guard desactivado Y quitando el restore de `persona.reference_image_ids`, el control negativo falla por `buildVariantGenerationPlan: la Persona ... no tiene imagen de referencia` en vez de por el gasto — es decir, SIN el restore el control negativo sería MENTIRA (rojo por el motivo equivocado, sin llegar a `createRun`). La deuda que el implementer declaró es EXACTA y su restore es lo que hace honesto el control. (Restaurado.)
- **Panel (control propio)**: rendericé con `expectedCount == scripts.length` (semántica pre-fix) sobre un payload truncado ⇒ el botón «Confirmar guiones» queda HABILITADO. Prueba que `expectedCount` (la cuenta de la matriz), y no otra cosa, es lo que gobierna el bloqueo.

## Reconciliación de umbrales (riesgo que perseguí)
El panel deriva `partial` de `expectedCount = plan.variants.length` (matriz); el guard del servidor de `listBatchVariants` (filas). Verifiqué que no divergen: `cloneVariantForRegen` (única vía de añadir variantes tras el scripting) inserta clon en matriz + `ad_variant` + su `ad_script` atómicamente, y `getLatestScriptsByBatch` dedup por variante (⇒ `latest.length ≤ #variantes` siempre; el `<` es sólido).

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | k<n ⇒ el step refleja el fallo, no `waiting_approval` con error=NULL | Executor lanza `PermanentStepError` (causa tipada + k/n) ⇒ `fail`; no emite artefacto | n5-write-scripts 7/7 | ✅ |
| 2 | La UI muestra el estado REAL | Subtítulo «5 de 12», Alert danger «5/12», afirmación falsa ausente | 03-...png | ✅ |
| 3 | La UI NO permite aprobar CP3 | Ambos botones `[disabled]`; click = no-op | 03/05-...png | ✅ |
| 4 | Ningún camino de la UI dispara gasto | POST directo a la ruta real = 400; `pipeline_run` 31→31; 0 scripted | 02-route-post.txt | ✅ |
| 5 | El fix no re-paga (dinero) | Top-up pide solo el grupo faltante (`calls===1`), completa sin duplicar | n5-write-scripts | ✅ |
| 6 | `over_budget` completo SÍ llega a CP3 (no regresión) | No lanza; emite artefacto `over_budget` con 2 refs | n5-write-scripts | ✅ |

## Coste real
**$0.** El fallo del proveedor se inyectó con el doble de test (429 del `fetch` de test) y con dato en reposo (`DELETE ad_script`). Ninguna llamada a API de pago. Worker detenido durante los POST en vivo → imposible que un run llegara a fal.

## Qué comprobé con mis manos vs qué acepté del informe
- **Con mis manos**: las 4 pruebas de integración (leí los tests antes de correrlos y confirmé que sus asserts cubren la cláusula); el POST directo a la ruta HTTP real con auth real y la cuenta SQL de `pipeline_run`; el panel en navegador (recuento, botones disabled, afirmación falsa ausente, consola, WCAG); los 3 controles negativos (guard, deuda de orden, panel); la reconciliación de umbrales por lectura de código.
- **Acepté del informe** (tras leer el código que lo respalda, no a ciegas): la lectura del path `PermanentStepError → transition('fail')` en `step-execute.ts` (leída, confirmada); que el comment del guard sobre «step viejo pausado antes del fix» es exactamente el fixture real que encontré.

## Item ABIERTO para el coordinador — el test permanente E2E NO se ejecutó
La cláusula «Playwright/test permanente» de T5.11 vive en `apps/web/e2e/script-editor.spec.ts` (test `T5.11: con guiones de menos, CP3 muestra el recuento REAL y NO deja aprobar`). Lo LEÍ (es un test correcto y fiel: conduce a un CP3 real, trunca el lote con `DELETE ad_script`, y assertea recuento real + ambos botones disabled + cero variantes `scripted`) y confirmé que TYPECHECK-EA y está CABLEADO al runner (`pnpm e2e:wired:check` OK, 24 specs). **Pero NO lo vi pasar**: el stack e2e de :3100 dio `ERR_CONNECTION_REFUSED` en el login-setup dos veces en mi sesión (arranque del webServer, no fallo de T5.11). Y `script-editor.spec.ts` **NO** está en `test:e2e:phases`, así que la certificación de gate del coordinador (que sí cubre las 4 fases) **no** lo incluye. ⇒ **El coordinador debe ejecutar ese spec** (o que el implementer lo confirme) antes de cerrar. NO bloquea el PASS de la *Verificación* porque probé EN VIVO cada assert de ese spec (panel en navegador + SQL), que es una observación estrictamente más fuerte — pero el test permanente queda sin correr.

## Rarezas / notas
- **MUTACIÓN de estado en la BD de dev que el usuario debe conocer**: borré+reseedé `app_setting.auth.password_hash` (drift: el hash guardado era de un bootstrap anterior al `.env` actual y no podía loguear). **La password de login de dev es ahora la de `AUTH_BOOTSTRAP_PASSWORD` del `.env` (`ugc-factory-dev`)**, que puede diferir de la que el usuario venía usando. Es auth (preparación de escenario permitida), no el flujo bajo verificación — pero anótese para no depurar un login roto misterioso.
- El panel se observó y midió en tema **dark** (el único que el stack de dev renderiza sin toggle expuesto); light se confirmó por tokens + `check:contrast` (ver paso 6), no por medición en navegador.
- Pre-existente ajeno a T5.11: `f4-generation.spec.ts` flaky bajo carga (declarado por el coordinador); no lo toqué.

## Veredicto
**PASS** — con el fixture REAL del bug de T5.9 (5/12, `api_error`, `waiting_approval`, `error=NULL`), la UI muestra el estado real y bloquea la aprobación, el executor manda el step a `failed` (no a `waiting_approval` silencioso), y NINGÚN camino —UI ni POST directo a la ruta real— crea un `pipeline_run` sobre el lote incompleto (SQL 31→31). El top-up no re-paga, `over_budget` no regresiona, y los tres controles negativos (incluida la deuda de orden declarada) miden lo que dicen medir.
