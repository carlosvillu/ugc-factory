# `@ugc/db`

**La capa de persistencia.** Schema Drizzle, migraciones, repos por agregado, y los **adapters** que implementan los puertos que [`@ugc/core`](../core) declara.

Esta es la mitad que ensucia las manos: aquí es donde el orquestador puro se convierte en `SELECT ... FOR UPDATE`, advisory locks y `pg_notify`.

## Cómo encaja

```
core  →  db  →  services  →  web, worker
```

Depende solo de `@ugc/core`. Lo consumen `services`, `web`, `worker` y `test-utils`.

## Comandos

```bash
pnpm db:generate    # drizzle-kit: genera el SQL de migración a partir del schema
pnpm db:migrate     # aplica las migraciones pendientes (advisory lock)
pnpm seed           # siembra la librería (hooks, CTAs, recetas) y las personas
pnpm db:smoke       # smoke test: crea un proyecto contra la BD real
```

(Desde la raíz del monorepo; también valen con `pnpm --filter @ugc/db ...`.)

Las migraciones son **ficheros SQL versionados** en [`drizzle/`](drizzle/), generados desde el schema y committeados. Se aplican con un advisory lock, así que arrancar varios procesos a la vez no las duplica.

## El schema

15 tablas, agrupadas por agregado:

| Fichero         | Tablas                                                  | Qué guarda                                                 |
| --------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| `project.ts`    | `project`, `url_analysis`, `product_brief`, `brand_kit` | El producto analizado y su brief (versionado)              |
| `pipeline.ts`   | `pipeline_run`, `step_run`, `checkpoint_decision`       | **El estado del DAG** — el corazón del sistema             |
| `ops.ts`        | `app_setting`, `audit_log`, `cost_entry`, `budget`      | Config y secretos cifrados, auditoría, ledger de gasto     |
| `generation.ts` | `asset`                                                 | Los binarios (referencia; el contenido vive en el storage) |
| `gallery.ts`    | `hook_line`, `cta_line`, `recipe`, `persona`            | La librería reutilizable                                   |
| `batch.ts`      | `ad_batch`, `ad_variant`, `ad_script`                   | La matriz de variantes y sus guiones                       |

`step_run` es la tabla que hay que entender: cada fila es un nodo del pipeline con su estado, su coste estimado y real, sus dependencias y su `supersedes_id`. **El canvas de React Flow es una vista 1:1 de esta tabla.**

## Adapters: donde `core` se enchufa a Postgres

`core` define interfaces; aquí están sus implementaciones:

- `makeStepStore` / `makeRunStore` — lectura y escritura de steps y runs, con bloqueo pesimista donde importa.
- `makeTxJobQueue` — **encolado transaccional**: el job de pg-boss se encola en la _misma transacción_ que el cambio de estado. O pasan las dos cosas, o ninguna. No existe el estado "transicioné pero el job se perdió".
- `makeCostStore` — el rollup del coste, que corre dentro de la transición. Va protegido por un `SAVEPOINT`: en Postgres una transacción abortada se lleva por delante el `pg_notify` **y** el `COMMIT`, así que un `try/catch` de JavaScript no basta para garantizar que un fallo del ledger no tumbe la transición.
- `makeAuditStore`, `makeWithTransaction`, `withDomainTransaction` — esta última compone una escritura de dominio y una operación del orquestador en una única transacción.
- `makeLocalStorageAdapter` — el `StorageAdapter` sobre el filesystem (`/data/assets`), con la puerta abierta a S3/R2 sin tocar el resto.

## Repos

Un fichero por agregado (`project.repo.ts`, `brief.repo.ts`, `steps.repo.ts`, `spend.repo.ts`, `persona.repo.ts`…). Todo lo que sale del paquete pasa por el barrel de `src/index.ts`: si no está exportado ahí, no es API pública.

Dos que merecen mención: `brief.repo.ts` versiona el brief de forma atómica con un advisory lock (editarlo en CP1 crea una versión nueva, no pisa la anterior), y `steps.repo.ts` concentra las lecturas del snapshot y los deltas que alimentan el SSE.

## Convenciones

- **Nada de SQL suelto fuera de aquí.** `web` y `worker` no importan Drizzle: hablan con repos y adapters.
- **Las migraciones se generan, no se escriben a mano** — y una vez committeadas, son inmutables.
- El pool de conexiones lo crea el _composition root_ (`createDbPool`), no los módulos.
