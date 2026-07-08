# Verificación T0.2 — Docker compose dev + healthcheck con ping de Postgres

- **Tarea**: T0.2 · `docker-compose.dev.yml` (Postgres 16) + `/api/health` con ping de conexión (`planning.md`)
- **Fecha**: 2026-07-08
- **Ejecutor**: verifier (agente escéptico, contexto fresco) · superficie backend (curl/logs, sin navegador — Paso 0 de cua.md)
- **Sistema**: working tree con los cambios staged de T0.2 sin commitear (esperado; commit lo hace el bucle tras PASS). HEAD previo `96f0c78`. Postgres `postgres:16` en contenedor `ugc-postgres-dev`. `pnpm dev` (Next 16.2.10 + worker tsx) en el host.
- **Desviación ambiental**: el puerto 5432 del host estaba ocupado por otro proyecto (contenedor `househunt-db`, también `postgres:16`, healthy). Ajustado en `.env` (gitignored, copiado de `.env.example`): `POSTGRES_PORT=55432` **y** el literal de `DATABASE_URL` a `postgres://ugc:ugc@localhost:55432/ugc` (el `.env.example` documenta que `DATABASE_URL` no interpola el puerto). Binding confirmado `0.0.0.0:55432->5432/tcp` sobre el contenedor propio — no el vecino.

## Verificación esperada (literal de planning.md)
> `docker compose -f docker-compose.dev.yml up -d` -> `/api/health` devuelve `{ok:true, db:true}`; parar Postgres hace que devuelva `db:false` sin tumbar la app.

## Gate previo
`pnpm gate` en verde (lint + typecheck + format:check + knip + test): **48 tests passed (9 files)**. Sin superficie web nueva en el gate -> no aplica test:e2e. Evidencia: `gate-output.txt`.

## Pasos ejecutados
1. Gate `pnpm gate` -> verde (48/48). -> `gate-output.txt`.
2. `.env` desde `.env.example`, puerto -> 55432 en ambas lineas. `docker compose -f docker-compose.dev.yml up -d` -> contenedor `healthy` en ~11s, binding `55432->5432`. -> `compose-up.txt`.
3. `pnpm dev` (web + worker) arranca; web `Ready` en 330ms; worker loguea `worker ready`. -> `pnpm-dev.log`.
4. **db:true**: `curl /api/health` -> `{"ok":true,"db":true}`, HTTP 200, 30ms. -> `01-health-db-true.txt`.
5. **worker ready**: log JSON estructurado `{...,"name":"worker","health":{"ok":true,"db":true},"msg":"worker ready"}`. Web loguea lo mismo -> ambos conectan al arrancar. -> `02-worker-ready.txt`.
6. **db:false (trampa)**: `docker compose ... stop postgres` -> `curl /api/health` -> `{"ok":true,"db":false}`, HTTP 200, **8ms**. Web (PID 63674) y worker (PID 63680) siguen vivos con los mismos PIDs; `/` y un segundo `/api/health` siguen sirviendo 200. -> `03-health-db-false.txt`.
7. **recuperacion**: `docker compose ... start postgres` -> healthy en 6s -> `curl` -> `{"ok":true,"db":true}`, mismo PID de web (sin reinicio). -> `04-recovery.txt`.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | `up -d` levanta Postgres 16 | Contenedor healthy, binding 55432->5432 | compose-up.txt | OK |
| 2 | `/api/health` -> `{ok:true, db:true}` | Body exacto `{"ok":true,"db":true}`, 200, 30ms | 01-health-db-true.txt | OK |
| 3 | web Y worker conectan al arrancar | Ambos loguean `db:true` en JSON al boot | 02-worker-ready.txt, pnpm-dev.log | OK |
| 4 | parar Postgres -> `db:false` | Body exacto `{"ok":true,"db":false}`, 200 | 03-health-db-false.txt | OK |
| 5 | degradacion rapida (no cuelga >5s) | 8ms (connection-refused), muy por debajo del budget 1.5s | 03-health-db-false.txt | OK |
| 6 | sin tumbar la app | web PID 63674 y worker PID 63680 vivos; `/` y `/api/health` siguen 200 | 03-health-db-false.txt | OK |
| 7 | (refuerzo) recuperacion sin reiniciar app | `db:true` de nuevo, mismo PID de web | 04-recovery.txt | OK |

## Coste real
$0 — infra local, sin APIs de pago. (Estimado: $0.)

## Veredicto
**PASS** — El sistema real hace literalmente lo que la Verificacion describe: `up -d` + `/api/health` -> `{ok:true,db:true}`; parar Postgres -> `{ok:true,db:false}` con HTTP 200 en 8ms sin tumbar web ni worker; recuperacion transparente. Gate previo verde.

Notas / rarezas:
- Ningun error en consola/logs; los logs de web y worker son JSON estructurado limpio (LOG_PRETTY off por defecto, correcto).
- Desviacion ambiental de puerto (55432) documentada arriba; no afecta a lo verificado: el ping golpea el contenedor propio, confirmado porque `stop postgres` sobre ese contenedor si bascula a `db:false`.
- El bug del worker desde `dist/` (mencionado en el brief) queda fuera de este flujo: `pnpm dev` corre el worker sobre fuente (tsx), y asi arranco y logueo `worker ready` correctamente.
