# Verificación T5.5c — Wiring del executor N9 (QA) + pausa en checkpoint CP4

- **Tarea**: T5.5c · Wiring del executor N9 (QA) + pausa en checkpoint CP4 (`planning.md`)
- **Fecha**: 2026-07-22
- **Ejecutor**: verifier (agente escéptico, contexto fresco) · psql + curl contra sistema levantado
- **Sistema**: working tree del diff en índice (commit base `7e1e8af`, T5.5c sin commitear) · docker compose dev (Postgres 16 `ugc-postgres-dev`, healthy) + `pnpm dev` (web+worker) + `pnpm seed`. Health `{"ok":true,"db":true}`.
- **Superficie**: solo backend (la Verificación pide "todo por query en BD"). Se driva la op como un humano vía los route handlers HTTP reales (`POST /api/steps/:id/{approve,reject}`) con cookie de sesión real; NUNCA se llama al writer directamente para el paso verificado.

## Verificación esperada (literal de planning.md)
> un run que llega a N9 pausa en `waiting_approval` (query del `step_run`) —y NO en `succeeded`: el control negativo es que sin `checkpointConfig.alwaysPause` el run navegaría a `succeeded` (el DAG de generación corre en autopilot)—; llamar la op de aprobar sobre esa variante la lleva a `ad_variant.status='approved'` y el step a `succeeded`; rechazar → `ad_variant.status='rejected'` y el step a `rejected`. Todo por query en BD, coste $0. (La op «regenerar» se difirió a T5.8, ver Entrega — su verificación va con el flujo pleno allí.)

## Pasos ejecutados

### Puntos 1+2 — Pausa CP4 + CONTROL NEGATIVO (que muerda)
Suite de integración del worker contra Postgres real (executors stub, mecanismo de pausa real: consumer genérico + pg-boss + `generationRunDefinition` REAL):
- Positivo: run N8→N9 en autopilot con el builder de producción `generationRunDefinition` → N8 `succeeded`, N9 `waiting_approval` con su `N9Output`. Al usar el builder real, borrar `checkpointConfig` de `generation-dag.ts` pondría este test en rojo.
- Control negativo: el MISMO run con N9 despojado del flag (`isCheckpoint:false, checkpointConfig:null`) → N9 navega a `succeeded`, jamás `waiting_approval`. Contrafáctico real: la pausa la CAUSA `alwaysPause`.
- Inspección: producción (`generation-dag.ts`) emite N9←[N8] con `isCheckpoint:true, checkpointConfig:{alwaysPause:true}`; `checkpoint.ts:shouldPause` devuelve true con `alwaysPause` aunque `autopilot=true`.
- Evidencia: `n9-checkpoint-suite.txt` (2 tests passed).

### Puntos 3+4 — Aprobar / Rechazar drivados por la OP REAL (route handlers)
Los tests de seam del implementer (`qa-checkpoint.test.ts`) llaman `applyQaVerdict` DIRECTAMENTE, sin step_run ni transición: prueban solo el writer de la variante, NO la transición del `step_run` ni el despacho por registro. La Verificación exige AMBAS mitades. Por eso se driva la op HTTP real:
1. Escenario por seed (permitido, CUA regla 1): pipeline_run `full/autopilot=true/running`, dos variantes frescas `planned` bajo batch existente, dos `step_run` N9 en `waiting_approval` con `output_refs`=N9Output válido. Estado inicial: `00-initial-state.txt`.
2. Login real → cookie firmada. `POST /api/steps/<approve>/approve` → 200 (`01-approve-response.txt`).
3. Query BD (`02-approve-db-state.txt`): step `succeeded` Y variante `approved`.
4. `POST /api/steps/<reject>/reject` → 200 (`03-reject-response.txt`).
5. Query BD (`04-reject-db-state.txt`): step `rejected` Y variante `rejected`.

`approve/route.ts` despacha por `applyDomainEffect`; `reject/route.ts` (net-new) adopta `withDomainTransaction`+`applyDomainEffectOnReject`, ambos aplicando el efecto DENTRO de la misma tx que la transición. Atomicidad (rollback) cubierta por el test ROLLBACK del seam (`qa-checkpoint-seam-suite.txt`, 5 passed).

### Punto 5 — N9 NO re-mide ($0, load-bearing)
`qa-verdict.ts` importa solo `@ugc/core/{orchestrator,contracts,generation}` + `_shared`. Ningún runner de media (ffmpeg/ffprobe), ningún cliente fal. Lee la dep N8 por schema, valida `qa_report` y lo re-emite elevando `passed`. Síncrono, sin I/O.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Run a N9 → `waiting_approval` (no `succeeded`) | N8 succeeded, N9 waiting_approval; builder producción | n9-checkpoint-suite.txt | OK |
| 2 | Sin `alwaysPause` → `succeeded` | Mismo run sin flag → N9 succeeded, nunca waiting_approval | n9-checkpoint-suite.txt | OK |
| 3 | Aprobar → variante `approved` Y step `succeeded` | step succeeded + variante approved vía route real | 01/02-approve-*.txt | OK |
| 4 | Rechazar → variante `rejected` Y step `rejected` | step rejected + variante rejected vía route reject net-new | 03/04-reject-*.txt | OK |
| 5 | N9 no re-mide (sin ffmpeg/fal) | qa-verdict.ts sin runner de media ni fal; síncrono | inspección | OK |

## Coste real
$0. Sin llamadas a fal ni API de pago. Estimado $0 → sin desvío. Log dev sin errores; checkpoints logueados `aprobado`/`rechazado`.

## Veredicto
**PASS** — Las cuatro cláusulas observables se cumplen contra el sistema real: N9 pausa en `waiting_approval` (control negativo muerde), aprobar por la op real → step `succeeded` + variante `approved`, rechazar por la op real (net-new) → step `rejected` + variante `rejected`, y N9 no re-mide ($0).

Notas (no bloqueantes):
- Los tests de seam bypasean los route handlers (llaman `applyQaVerdict` directo, sin step_run ni transición): NO cubren la transición del step ni el despacho por registro. Ese hueco se cubrió aquí drivando las ops HTTP reales y queriando `step_run`. Recomendable un test de integración a nivel route para congelar la regresión.
- Escenario de verificación queda sembrado en la BD dev (filename_code `T55C-VERIFY-*`) como evidencia auditable; dato de dev inocuo.
- «Regenerar» no se verifica (difirida a T5.8), correctamente reflejado en la Verificación ajustada.
