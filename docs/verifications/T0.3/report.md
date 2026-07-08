# Verificación T0.3 — Drizzle + primera migración

- **Tarea**: T0.3 · Drizzle + primera migración (`planning.md`)
- **Fecha**: 2026-07-08
- **Ejecutor**: verifier (contexto fresco) · sin agent-browser (Verificación solo backend, cua.md Paso 0)
- **Sistema**: working tree sobre commit `dd96330` con los cambios de T0.3 staged sin commitear (esperado; el commit lo hace el bucle tras el PASS). Postgres 16.14 (Debian, aarch64) en `docker-compose.dev.yml`, contenedor `ugc-postgres-dev`.
  - **Desviación de puerto (heredada de T0.2)**: el 5432 del host está ocupado por OrbStack; `.env` ya usa `POSTGRES_PORT=55432` y `DATABASE_URL=postgres://ugc:ugc@localhost:55432/ugc`. Documentado en `.env.example`.
  - **BD vacía**: `docker compose ... down -v` + `up -d` -> volumen `ugc-postgres-data` recreado desde cero. Baseline confirmado vacío antes de migrar (0 relaciones, 0 tipos). Ver `00-dt-before-migrate.txt`.
- **Gate previo**: `pnpm gate` en verde (lint + typecheck + format:check + knip + test: 12 ficheros, 59 tests passed). Testcontainers son efímeros e independientes del volumen de dev, no contaminan la BD vacía.

## Verificación esperada (literal de planning.md)
> `pnpm db:migrate` sobre BD vacía crea las tablas (visible con `psql \dt`); crear un project vía un script de smoke y leerlo de vuelta.

## Pasos ejecutados
1. Gate `pnpm gate` verde -> habilita el gate CUA (cua.md regla 6).
2. `docker compose -f docker-compose.dev.yml down -v && up -d` -> volumen fresco, Postgres 16.14 healthy.
3. Baseline `\dt` y `\dT` sobre BD vacía -> "Did not find any relations", 0 data types (`00-dt-before-migrate.txt`).
4. `pnpm db:migrate` (1a vez) -> exit 0, "migraciones aplicadas" (`01-migrate-first.txt`).
5. `\dt` -> 3 tablas `app_setting`, `audit_log`, `project` (`02-dt-after-migrate.txt`). `\dT+ project_status` -> enum con `active`/`archived` (`03-dT-enum.txt`). `\d project` -> defaults es/active/now() (`04-project-schema.txt`). Registro en `drizzle.__drizzle_migrations` (1 fila, `05-drizzle-meta.txt`).
6. `pnpm db:migrate` (2a vez, idempotencia) -> exit 0, no-op: siguen 3 tablas y 1 fila de migración (`06-migrate-second-idempotent.txt`).
7. `pnpm db:smoke` -> create project + get roundtrip idéntico, exit 0 (`07-smoke-roundtrip.txt`).
8. Aserción propia del ULID sobre el id impreso: `01KX0NT3SW2VCD9T8KMBT7N2ZP`, 26 chars, Crockford base32 (`^[0-9A-HJKMNP-TV-Z]{26}$`) -> válido.
9. Lectura independiente de la fila en la BD por psql: persistida con todos los defaults aplicados por la BD (`08-project-row-in-db.txt`).

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | `pnpm db:migrate` sobre BD vacía crea las tablas | Exit 0; de 0 relaciones -> 3 tablas + enum `project_status` | 00/01/02/03 | OK |
| 2 | Tablas visibles con `psql \dt` | `\dt` lista `app_setting`, `audit_log`, `project` (public, owner ugc) | 02-dt-after-migrate.txt | OK |
| 3 | Idempotencia (base del lock 18.2) | 2a migrate exit 0, no-op: 3 tablas, 1 fila de migración | 06 | OK |
| 4 | Crear un project vía script de smoke | `db:smoke` crea "Smoke ES", exit 0 | 07-smoke-roundtrip.txt | OK |
| 5 | Leerlo de vuelta idéntico (roundtrip) | created === fetched (JSON estricto); defaults BD aplicados (default_locale=es, status=active, created_at/updated_at) | 07, 08 | OK |
| 6 | id ULID (26 chars Crockford base32) | `01KX0NT3SW2VCD9T8KMBT7N2ZP` válido | 07 + aserción propia | OK |

## Coste real
$0 — infra 100% local (Postgres en Docker), sin llamadas a APIs de pago. Estimado: $0. Sin desviación.

## Veredicto
**PASS** — El sistema real hace literalmente lo que la Verificación describe: `pnpm db:migrate` sobre BD vacía crea las 3 tablas (visibles con `psql \dt`) y el enum `project_status`, y el smoke crea un project y lo relee idéntico (PK ULID válida, defaults aplicados por la BD). Idempotencia confirmada como refuerzo.

Notas:
- Sin rarezas. Timestamps en UTC (+00), coherente con el `TZ=UTC` del compose.
- No se verificó a mano el lock de migración/concurrencia (fuera de la Verificación literal; ya cubierto por su test de integración dedicado, según brief).
- No se levantó `pnpm dev`: la Verificación de T0.3 no observa nada de web/worker; el cableado del lock al arranque de web (18.2) es contexto de Entrega, no de la Verificación.
