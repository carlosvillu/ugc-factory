# Verificación T0.8 — Checkpoints, aprobación, invalidación, skip y cancel

- **Tarea**: T0.8 · Checkpoints, aprobación, invalidación, skip y cancel (`planning.md`)
- **Fecha**: 2026-07-10
- **Ejecutor**: verifier (contexto fresco, escéptico) · backend-only (curl + psql, sin UI — la Verificación no menciona navegador; el canvas es T0.11)
- **Sistema**: diff T0.8 sin commitear sobre commit `b90b6b7` · docker compose dev (`ugc-postgres-dev`, Postgres 16, puerto 55432) + `pnpm dev` (web pid 29868 + worker pid 29869, misma BD) + migraciones aplicadas + project sembrado por psql `01JXVERIF0PROJECT00000T08A`
- **Gate previo**: `pnpm gate` VERDE antes de verificar — lint + typecheck + format:check + knip + 384 tests (33 files) passed.
- **Health**: `{"ok":true,"db":true}`; smoke previo (run llano N0→N1→N2) alcanzó `succeeded|3` ⇒ worker consume y progresa steps de verdad.

## Verificación esperada (literal de planning.md)
> run de demo con checkpoint → se pausa; `approve` reanuda; `edit` crea nueva fila del step aguas abajo con `supersedes_id` (la antigua queda `superseded`) y el diff aparece en `audit_log` (query); `skip` sobre un nodo skippable lo salta y el run completa; `cancel` detiene un run en curso; con `autopilot=true` no hay pausas y el override "parar siempre aquí" gana.

## Método
Todas las acciones verificadas (`approve`/`edit`/`skip`/`cancel`) se ejecutan vía los endpoints HTTP reales autenticados (login → cookie de sesión), contra el sistema levantado (web+worker+Postgres). La preparación de escenario (crear runs, project) usa API/psql, permitido por el protocolo. La evidencia de estado es SIEMPRE query psql a `step_run`/`audit_log` (no logs del código bajo prueba). Waits por condición (`wait_step`), sin sleeps fijos salvo ventanas de estabilidad deliberadas. Helpers del verifier en `lib.sh` (NO son del implementer).

## Resultado observado vs esperado

| # | Cláusula | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| 1 | Pausa en checkpoint | N1 llega a `waiting_approval` y SE DETIENE (no avanza solo) | N1=`waiting_approval` en 2s; N2=`awaiting_deps` estable durante 8s sin auto-avanzar | c12-output.txt | OK |
| 2 | approve reanuda | approve → N1 `succeeded`, dependientes avanzan, run progresa | POST approve `{ok:true}` → N1 `succeeded`, N2 `succeeded`; `succeeded/3` (run completa) | c12-output.txt | OK |
| 3 | edit + invalidación + audit_log | N1 `succeeded`; sub-grafo aguas abajo → filas nuevas con `supersedes_id`, antiguas `superseded`; diff `{ai,edited}` en audit_log (actor/action=edit/entity=step_run) | Old N2 `superseded`; new N2 `succeeded` con `supersedes_id`=old N2; N1 `succeeded` con output_refs editado persistido; audit_log: user/edit/step_run/N1 diff `{ai:null, edited:{...}}`. Run completa. Extra: run con closure {N2,N3} probó remapeo multi-nodo y re-encolado. | c3-multinode.txt, c3-clean.txt, c3-after.txt | OK |
| 4 | skip completa el run | skip nodo skippable → `skipped` Y dependientes avanzan hasta run COMPLETO; NADA varado en awaiting_deps | Skip N1 (awaiting_deps) → `skipped`; N0 `succeeded`; N2 avanzó a `succeeded` (skipped cuenta como dep resuelta); nonterminal=0 | c4-output.txt | OK |
| 5 | cancel detiene el run | cancel sobre run en curso → TODOS los no-terminales `cancelled`, ninguno en awaiting_deps/queued/running | N0 `running` + N1/N2 `awaiting_deps` → cancel `{cancelled:3}` → los 3 `cancelled`; nonterminal=0 | c5-output.txt | OK |
| 6 | autopilot + override | autopilot=true: checkpoint normal NO pausa (run corre entero); checkpoint con alwaysPause=true SÍ pausa | 6a: autopilot + N1 checkpoint sin override → N1 directo a `succeeded`, `succeeded/3`, nunca waiting_approval. 6b: autopilot + N1 alwaysPause=true → N1 `waiting_approval` estable 6s, N2 awaiting_deps | c6-output.txt | OK |

## Rareza observada (NO bloquea PASS — defecto del fixture del verifier, no del producto)
En la primera corrida de la cláusula 3 usé un DAG con node_key `demo.sleep.N3`, que NO está registrado en el executor registry de F0 (`apps/worker/src/executors/index.ts` solo registra `demo.sleep.N0/N1/N2`). El registro de invalidación re-encoló la fila nueva de N3 y el consumer la llevó a `failed` con "executor desconocido" — comportamiento CORRECTO del producto ante un node_key sin executor. Esto NO es un fallo de T0.8: la invalidación del sub-grafo (supersede + filas nuevas con supersedes_id + dependsOn remapeado + re-encolado) funcionó; solo el executor del nodo no existe en F0. Reejecuté la cláusula 3 con closure {N2} (registrado) → run completa limpio. Único log level-50 de toda la verificación; sin 500s en ningún endpoint.

## Notas
- `pipeline_run.status` NO se computa en T0.8 (deuda #4): "completa"/"cancela" se verifican por AGREGACIÓN de estados de `step_run` (todos terminales / todos cancelled, nonterminal_count=0), NO por columna run.status — correcto según el alcance.
- El caso `submitting`+cancel (deuda latente anotada) no se ejercita en F0; ninguna cláusula lo alcanza.
- Cláusulas 1 y 6b: verificada la ESTABILIDAD de la pausa (ventana de 8s / 6s), no solo el alcance del estado.

## Coste real
$0 — sin APIs de pago. Orquestador + Postgres local + executors de demo (sleep). Estimado $0.

## Veredicto
**PASS** — Las 6 cláusulas de la Verificación se cumplen literalmente contra el sistema real levantado, con evidencia psql de estados antes/después y del audit_log. La única rareza (executor desconocido para N3) es un fallo de mi propio fixture, no del producto.

## Anexo — cláusula 3 multi-nodo limpio (c3-multinode.txt)
Corrida definitiva con closure de DOS nodos usando SOLO executors registrados (N3=`demo.fail` sin failRate ⇒ éxito). Tras editar N1: old N2 y old N3 → `superseded`; new N2 y new N3 → `succeeded` con `supersedes_id` a sus filas antiguas; run completa (`succeeded|4`, `superseded|2`, nonterminal=0). Prueba end-to-end el remapeo de dependsOn: la new N3 dependió de la new N2 (no de la antigua superseded) y ejecutó bien. Con esto la "rareza" del N3 no-registrado queda como mera nota de fixture, no huella en la evidencia principal.
