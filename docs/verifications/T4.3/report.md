# Verificación T4.3 — Polling fallback + reconciliación idempotente

- **Tarea**: T4.3 · Polling fallback + reconciliación idempotente (`planning.md`)
- **Fecha**: 2026-07-16
- **Ejecutor**: verifier (agente escéptico) · sin agent-browser (Verificación 100% backend: worker + fal real + psql)
- **Sistema**: diff T4.3 sin commitear sobre `f58b101` (gate verde) · Postgres 16 dev (`ugc-postgres-dev`, :55432) + worker `apps/worker` via `tsx src/main.ts` con `FAL_KEY` real de `.env` + sweeper (intervalMs 5000, `generationReconcile:true`) · ASSETS_DIR=`/tmp/ugc-assets-dev` · sin web app, sin túnel (webhooks deshabilitados)

## Verificación esperada (literal de planning.md)
> con webhooks deshabilitados (dev local), una generación real completa vía polling; matar el worker durante una generación y reiniciar retoma el seguimiento **sin re-submit** (el billing de fal muestra 1 solo job).

## Gate previo
`pnpm gate` VERDE antes de empezar (protocolo paso 1): 166 files, **1791 tests passed**, lint/typecheck/format/knip/readme:status OK. Evidencia: `gate-output.txt`.

## Pasos ejecutados

### Cláusula 1 — completar vía polling, webhooks deshabilitados
1. Baseline DB capturado (`00-baseline-generations.txt`): 5 generaciones (2 stragglers no-terminales de T4.1/T4.2), 3 `cost_entry` fal.
2. Worker arrancado con `FAL_KEY` → log `sweeper arrancado` con `generationReconcile:true` (`worker-clause1.log`). Sin web app ni túnel = webhooks efectivamente deshabilitados.
3. Generación FLUX.2 dev real (`square_hd`, "lemon on a white plate") vía `submitGenerationForWebhook` con `webhookUrl` MUERTO (`…invalid.example`) → fila `submitted` con `fal_request_id`/`status_url` durables, SIN poll inline (`01-submit-clause1.txt`). GEN=`01KXNTJC2872XHHDVH5MRVPPGG`, req=`019f6ba9-…`.
4. El sweeper polleó el `status_url` guardado → fal COMPLETED → encoló `output.download` → el consumer descargó el PNG, escribió `cost_entry`, `completed`. CERO webhook (grep=0). Evidencia: `worker-clause1.log`, `01-clause1-output.png` (checksum == fila `asset`).

### Cláusula 2 — matar worker mid-generación, reiniciar retoma sin re-submit
5. (Reintento: la 1ª vez maté el wrapper `pnpm`, no el worker real — corregido con `pkill -9 -f src/main.ts`, verificado sin supervivientes.)
6. Con NINGÚN worker vivo, generación fresca ("3 cookies on marble"): GEN=`01KXNTVJQ99T1S76XZ32RJY91F`, **req al submit = `019f6bad-cd02-76d0-be82-516ab9a85808`** (submit con 0 workers → evento único, independiente del worker). Fila `submitted` (`03-submit-clause2-retry.txt`).
7. Worker A arrancado y **SIGKILL (crash duro) a ~3 s**, antes de su 1er tick (+5 s). STATUS_AT_KILL=`submitted` (en vuelo en fal). Worker A NUNCA reconcilió GEN (`worker-A-clause2-retry.log`). Sin supervivientes.
8. **Prueba de "no hay tracker vivo"**: fila `submitted` durante 8 s (> un tick de 5 s) sin worker. Pre-restart: `cost_entry`=0, `asset`=0, req sin cambiar.
9. **Reinicio** (worker B, PID 30990): releyó la fila `submitted`, polleó el MISMO `status_url` → "fal COMPLETED vía polling; … (sin re-submit)" → descarga → `completed` (`worker-B-clause2-retry.log`).
10. Money proof sobre BD real: req_id sin cambiar, `cost_entry`=1, `asset`=1, PNG en disco con checksum == BD.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Con webhooks deshabilitados, una generación real completa vía polling | Sweeper polleó `status_url` guardado → COMPLETED → descarga → `completed`; 0 webhooks | `worker-clause1.log`, `01-clause1-output.png` | OK |
| 1b | Asset a storage propio + `cost_entry` escrito | PNG 1024² en `/tmp/ugc-assets-dev/…`, checksum `812861cb…` == `asset`; `cost_entry` 1c fal | `01-clause1-output.png` | OK |
| 2 | Matar worker mid-generación + reiniciar retoma el seguimiento | Kill SIGKILL con fila `submitted` (en vuelo); worker B releyó BD y polleó el mismo `status_url` → `completed` | `worker-A/B-clause2-retry.log` | OK |
| 2b | SIN re-submit (billing fal = 1 job) | `fal_request_id` idéntico al submit (`019f6bad…`, `req_unchanged=t`); worker no submitea nunca | psql, `worker-B…log` | OK |
| 2c | 1 solo job facturable | `cost_entry` para GEN = **exactamente 1**; `asset` = 1 | psql | OK |
| extra | `submitting` sin req: expira por edad, jamás re-submit | Straggler T4.1 `01KXN41D35…` → `failed`, `fal_request_id` NULL | psql | OK |
| extra | Idempotencia global (sin doble-cobro) | Las 7 generaciones fal tienen <=1 `cost_entry` cada una | psql | OK |

## Coste real
fal (FLUX.2 dev, `square_hd` 1024²): **3 generaciones nuevas ≈ 3c** (clause 1 + 2 intentos de clause 2, todas 1c). El 4º `cost_entry` fal nuevo (`01KXNFEB…`, straggler de T4.2) captura un job ya facturado en T4.2 — NO es gasto de hoy. `cost_entry` fal 3→7.
Coste de la verificación ≈ **$0,03** vs estimado $0,20 (cap ×3 = $0,60). Muy por debajo del cap; sin recalibración. Acumulado F4 ≈ 6,6c + 3c ≈ **9,6c** de ~5€. (`/spend` UI no ejercitada: la web no estaba levantada; la fuente de coste es la tabla `cost_entry` que /spend lee — evidencia por psql, más fuerte que la UI.)

## Veredicto
**PASS** — ambas cláusulas verificadas contra fal REAL: una generación completa vía polling con webhooks deshabilitados, y el crash+restart del worker retoma el seguimiento polleando el `status_url` durable SIN re-submit (1 solo `fal_request_id`, 1 solo `cost_entry`).

Notas / rarezas:
- **Trampa de entorno**: `pnpm exec tsx … &` deja `$!` en el WRAPPER `pnpm`, no en el worker node real (grandchild, `"pid":NNNN` en el log JSON). Matar `$!` NO mata el worker. Usar `pkill -9 -f "src/main.ts"` + verificar con `pgrep -fl`. El 1er intento de cláusula 2 falló por esto; reintento limpio → PASS.
- zsh `noclobber`: redirigir con `>|` sobre ficheros existentes.
- Deuda door-2b (URL de output expirada → gasto huérfano; cap terminal `inProgressMaxAgeMs` 2h) NO ejercitada (tardaría horas) — deuda declarada, NO motivo de FAIL.
- El sweeper reconcilió stragglers heredados en cada arranque (expire-by-age del `submitting` sin req; completó el `submitted` de T4.2 con `status_url` aún válido) — comportamiento correcto sobre datos reales heredados.
- Todas las aserciones de dinero scopeadas al `generation_id` propio (el listado del sweeper toca todas las filas reconciliables).
