# Verificación T0.7b — Runs, consumer genérico y executors de demo

- **Tarea**: T0.7b · Runs, consumer genérico y executors de demo
- **Fecha**: 2026-07-08
- **Ejecutor**: verifier (subagente escéptico, contexto fresco)
- **Sistema**: monorepo levantado localmente — Postgres (docker compose dev, `ugc-postgres-dev`) + `apps/web` (Next 16 / Turbopack) y `apps/worker` (pg-boss) arrancados EN VIVO en procesos separados; suites de integración con Testcontainers.
- **Intento**: 3º ciclo de VERIFY (los 2 previos = FAIL por el bug de boot de web; el usuario autorizó este intento tras el circuit breaker).
- **Coste real**: $0 (sin APIs de pago; Postgres local + pg-boss).
- **VEREDICTO: PASS**

## Verificación literal (planning.md T0.7b)
> `POST /api/runs` con el DAG de demo → los 3 steps pasan `pending→queued→running→succeeded` en orden (filas con timestamps coherentes); 20 runs concurrentes completan sin interbloqueos ni estados corruptos (script de concurrencia).

## Resultado por punto

| # | Esperado | Observado | OK |
|---|---|---|---|
| 0 | Gate verde (prerequisito) | `pnpm gate` 293 tests / 21 suites verde (lint+typecheck+format+knip) | ✅ |
| 1a | web arranca (Turbopack) + migraciones al boot | wrapper `node scripts/dev.mjs` corre; `running startup migrations`→`startup migrations applied`; sin crash | ✅ |
| 1b | `/api/health` `{ok:true,db:true}` | exacto, 1er intento | ✅ |
| 1c | `POST /api/runs` (DAG demo) → 201 + estados iniciales | 201; N0 `queued`, N1/N2 `awaiting_deps`; encolado atómico del root | ✅ |
| 1d | 3 steps a `succeeded` EN ORDEN, timestamps coherentes (seam cross-proceso vía worker real) | 3/3 `succeeded`; `started≤finished`; cadena N0→N1→N2 respetada; reproducible 2× por HTTP | ✅ |
| 2 | 20 concurrentes sin interbloqueos ni corrupción | 60 steps `succeeded`, cadena respetada | ✅ |

## El fix de boot (2º intento) verificado que funciona
El bug (web no arrancaba: `migrationsFolder()` no resolvía la carpeta bajo el bundle de Turbopack) se arregló inyectando `UGC_DB_MIGRATIONS_DIR` (ruta absoluta) en el ENTORNO REAL del proceso `next dev` vía el wrapper `apps/web/scripts/dev.mjs` — el único canal que llega al runtime nodejs que ejecuta `instrumentation.register()` (una asignación `process.env.X=…` dentro de `next.config.ts` NO llega; probado en el intento 1).

Probado en shell con `UGC_DB_MIGRATIONS_DIR` **AUSENTE** (`env -u UGC_DB_MIGRATIONS_DIR pnpm dev`) para demostrar que la var la pone el FIX, no el entorno del ejecutor (la contaminación que causó el falso PASS del intento 1). El log muestra `apps/web dev$ node scripts/dev.mjs` (el wrapper corre), luego `running startup migrations` → `startup migrations applied`, sin error de instrumentation. Contraste: el crash previo quedó en `pnpm-dev-crash.log`.

## Parte 1 — evidencia de las filas step_run (run HTTP real `01KX1EWDDVAEK8J8BEV5149442`)
```
 demo.sleep.N0 | succeeded | retry_count=0 | started 18:12:15.465+00 | finished 18:12:15.525+00
 demo.sleep.N1 | succeeded | retry_count=0 | started 18:12:15.966+00 | finished 18:12:16.024+00
 demo.sleep.N2 | succeeded | retry_count=0 | started 18:12:16.46 +00 | finished 18:12:16.52 +00
```
Aserciones literales verificadas por SQL:
- `started_at ≤ finished_at` en los 3 steps.
- Orden de la cadena: `finished(N0)=15.525 ≤ started(N1)=15.966`; `finished(N1)=16.024 ≤ started(N2)=16.46`.
- Estados iniciales al crear (201): N0 (root, sin deps) `queued` con job encolado atómicamente; N1/N2 (con deps) `awaiting_deps`.

2ª ejecución HTTP idéntica (no-fluke). El worker corrió en proceso SEPARADO y consumió sobre el mismo Postgres — el seam cross-proceso (web encola / worker consume) que ninguna suite ejercita, verificado end-to-end por primera vez.

## Parte 2 — 20 runs concurrentes: PASS
El bloque `describe('estrés: 20 runs concurrentes (Verificación T0.7b)')` de `apps/worker/test/integration/step-execute.test.ts`: los 60 steps alcanzan `succeeded`, la cadena N0→N1→N2 se respeta por run, timestamps coherentes, sin deadlocks. Re-ejecutado → PASS (`concurrency-rerun.txt`).

## Notas
- La lógica de T0.7b (verificada en integración a lo largo de los 3 ciclos): handler-level de `POST /api/runs` (201 + estados iniciales + encolado atómico + 400 tipados incl. nodeKey duplicado), retry agotándose (`failed` terminal, retry_count=3), convergencia K<max, idempotencia de job duplicado, executor desconocido (`failed` terminal, retry_count=0), y los 3 fixes de la code-review HIGH-effort — todos verdes.
- El fix de boot vive en tooling de dev (`scripts/dev.mjs` + `package.json` + `next.config.ts` + `eslint.config.ts`), no en lógica de producto. `migrate.ts` conserva su fallback `require.resolve` para CLI/tests (verificado no envenenado: CLI `db:migrate` y suites no fijan la var; gate verde).
- **Recordatorio para T0.13** (no es regresión de T0.7b): el wrapper es dev-only; el arranque de web en producción (`next build`/`start` en contenedor) usa otro camino y deberá verificar por su cuenta que las migraciones de arranque resuelven la carpeta allí.
- El defecto de boot era whole-system (la clase que el gate CUA existe para cazar): las suites verdes lo ocultaban porque importan `runMigrations`/handlers vía tsx/vitest, nunca a través del bundler de Turbopack.

## Reproducción
- `pnpm gate` (raíz) → verde.
- `rm -rf apps/web/.next && env -u UGC_DB_MIGRATIONS_DIR pnpm dev` → web arranca + migra; `curl -s localhost:3000/api/health` → `{ok:true,db:true}`.
- `POST localhost:3000/api/runs` con el DAG de demo (projectId sembrado) + worker corriendo → 3 steps a `succeeded` en orden (observar `step_run` en psql).
- `pnpm exec vitest run --project 'worker:integration'` → Parte 2 (20 concurrentes) PASS.

## Evidencia adjunta (docs/verifications/T0.7b/)
`gate-output.txt`, `pnpm-dev.log`, `pnpm-dev-crash.log`, `post-runs-response.txt`, `step-run-rows.txt`, `step-run-run2.txt`, `concurrency-rerun.txt`, `worker-integration.txt`, `web-integration.txt`, `web-boot-with-shell-env-OK.log`.
