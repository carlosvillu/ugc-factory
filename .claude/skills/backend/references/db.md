# Drizzle: schema, migraciones, repos y transacciones

> Capa: `packages/db` — la implementación con Drizzle + Postgres 16 de los puertos de persistencia que define `packages/core`. Sirve T0.3, T0.7a, T1.2 y T3.1 del planning. Los tests de todo lo de aquí los define `testing/references/db-integration.md` (harness Testcontainers) y `testing/references/orchestrator.md` (transaccionalidad); este documento NO los duplica.

**Drizzle evoluciona rápido (0.x → 1.0 cambia relations y drizzle-kit).** Si dudas de una API exacta, verifica con Context7 (`.mcp.json`) o docs oficiales antes de asumirla; la skill instalada `postgres-drizzle` complementa con la distinción 0.x vs 1.0. Los snippets de este documento son esquemas de patrón para el código futuro, con las APIs de Drizzle 0.x verificadas a fecha de escritura.

**Contenido**: [1. Schema por dominio](#1-schema-por-dominio) · [2. Tipos](#2-tipos-inferselectinferinsert-nunca-shapes-a-mano) · [3. Migraciones](#3-migraciones) · [4. Repos](#4-repos-funciones-por-agregado-executor-como-primer-argumento) · [5. Adaptadores de puertos](#5-adaptadores-de-puertos) · [6. El patrón §9.0 desde SQL](#6-el-patrón-transaccional-del-orquestador-90-visto-desde-sql) · [7. Read models con relational queries](#7-relational-queries-para-read-models) · [8. Índices y constraints con intención](#8-índices-y-constraints-con-intención-12) · [9. Qué NO va aquí](#9-qué-no-va-aquí)

## 1. Schema por dominio

Un fichero por grupo de tablas en `packages/db/src/schema/`, re-exportados en `schema/index.ts`. Por qué: los diffs de una feature tocan UN fichero coherente, y `drizzle(pool, { schema })` recibe el barrel completo sin listas manuales.

| Fichero | Tablas (§12) |
|---|---|
| `project.ts` | `project`, `brand_kit`, `url_analysis`, `product_brief` |
| `pipeline.ts` | `pipeline_run`, `step_run` |
| `batch.ts` | `ad_batch`, `ad_variant`, `ad_script` |
| `generation.ts` | `generation`, `asset` |
| `gallery.ts` | `prompt_template`, `prompt_version`, `guard_pack`, `hook_line`, `cta_line`, `persona`, `model_profile`, `recipe` |
| `publishing.ts` | `platform_account`, `publication`, `metric_snapshot`, `experiment_rule` |
| `ops.ts` | `cost_entry`, `budget`, `app_setting`, `audit_log` |

`drizzle.config.ts` apunta a la carpeta (glob), no a ficheros sueltos — añadir un dominio nuevo no toca la config:

```ts
// packages/db/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/*.ts',
  out: './drizzle', // SQL committeado: la historia de migraciones es parte del repo
});
```

**Helpers compartidos** en `schema/columns.helpers.ts`. Los PKs son ULIDs **generados en la app** (util de `@ugc/core`): ordenables por tiempo y disponibles ANTES del INSERT — logs, `singletonKey` de pg-boss y payloads de NOTIFY pueden referenciar la fila que aún no existe.

```ts
// packages/db/src/schema/columns.helpers.ts
import { text, timestamp } from 'drizzle-orm/pg-core';
import { newUlid } from '@ugc/core/contracts'; // vive en contracts/ids.ts junto a UlidSchema

export const ulidPk = () => text('id').primaryKey().$defaultFn(() => newUlid());

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
    .$onUpdateFn(() => new Date()),
};
```

**Enums `pgEnum` junto a su tabla**, con los valores EXACTOS de §7.1/§12 — el enum es parte del contrato de la tabla y el diff de migración los muestra juntos. Copia bien la lista la primera vez: añadir un valor a un pgEnum es un `ALTER TYPE … ADD VALUE` trivial, pero renombrar o quitar uno es migración manual delicada.

```ts
// packages/db/src/schema/pipeline.ts
import { sql } from 'drizzle-orm';
import {
  boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { ulidPk, timestamps } from './columns.helpers';
import { project } from './project';

// §7.1 — máquina de estados completa del step. NO reordenar ni renombrar a la ligera.
export const stepStatus = pgEnum('step_status', [
  'awaiting_deps', 'pending', 'queued', 'submitting', 'running',
  'waiting_approval', 'succeeded', 'failed', 'rejected', 'skipped',
  'cancelled', 'expired', 'superseded',
]);

// §7.1.e — el estado del run se DERIVA de sus steps; enum más corto a propósito.
export const runStatus = pgEnum('run_status', [
  'pending', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled', 'expired',
]);

export const runKind = pgEnum('run_kind', ['full', 'partial', 'regen']);

export const pipelineRun = pgTable('pipeline_run', {
  id: ulidPk(),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  kind: runKind('kind').notNull().default('full'),
  autopilot: boolean('autopilot').notNull().default(false),
  status: runStatus('status').notNull().default('pending'),
  // …batch_id?, started_at/finished_at, total_cost_estimated/actual (§12)
  ...timestamps,
});

export const stepRun = pgTable('step_run', {
  id: ulidPk(),
  runId: text('run_id').notNull().references(() => pipelineRun.id, { onDelete: 'cascade' }),
  nodeKey: text('node_key').notNull(), // N0..N11 / N7a..N7e
  variantId: text('variant_id'),
  status: stepStatus('status').notNull().default('pending'),
  // §7.1.c: la invalidación crea filas NUEVAS con supersedes_id; jamás resetea.
  // Self-FK: la anotación AnyPgColumn rompe la inferencia circular.
  supersedesId: text('supersedes_id').references((): AnyPgColumn => stepRun.id),
  isCheckpoint: boolean('is_checkpoint').notNull().default(false),
  checkpointConfig: jsonb('checkpoint_config'),
  dependsOn: text('depends_on').array().notNull().default(sql`'{}'::text[]`), // ULIDs de steps del MISMO run
  retryCount: integer('retry_count').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(3),
  timeoutAt: timestamp('timeout_at', { withTimezone: true }), // el sweeper compara contra now() de Postgres
  // …input_refs/output_refs/error jsonb, cost_estimated/actual, started_at/finished_at (§12)
  ...timestamps,
}, (t) => [
  index('step_run_run_id_idx').on(t.runId), // el snapshot SSE lee todos los steps de un run
  index('step_run_sweep_idx').on(t.timeoutAt).where(sql`${t.timeoutAt} IS NOT NULL`), // cron de barrido (T0.9)
]);
```

Toda FK declara `onDelete` **explícito** (el PRD lo exige en todas): la política de borrado es una decisión de producto, no un default heredado — y su test la fija (`db-integration.md` §5).

## 2. Tipos: `$inferSelect`/`$inferInsert`, nunca shapes a mano

```ts
// al final de cada fichero de schema
export type StepRun = typeof stepRun.$inferSelect;
export type NewStepRun = typeof stepRun.$inferInsert;
export type PipelineRun = typeof pipelineRun.$inferSelect;
```

- **NUNCA dupliques a mano** un shape de fila: dos fuentes de verdad divergen en silencio; `$infer*` mantiene el tipo pegado al schema y una migración que cambia una columna rompe el typecheck en todos los consumidores.
- **Los contratos Zod de `@ugc/core` son la vista pública** (API, SSE, payloads de jobs) y se escriben a mano: pueden renombrar, omitir o reagrupar campos — no son un espejo de la tabla. Los tipos `$infer*` son el shape de persistencia, interno a db y sus adaptadores.
- **`drizzle-zod` solo para validaciones internas de db** si hacen falta (p. ej. validar un `jsonb` antes de insertar). Jamás se exporta un schema de drizzle-zod como contrato público: acoplaría la API a la tabla y un `ALTER TABLE` se convertiría en breaking change del frontend.

## 3. Migraciones

Flujo único: editar schema → `drizzle-kit generate` → SQL committeado en `packages/db/drizzle/` → `migrate()` con lock en el arranque de web (§18.2, T0.3). El SQL committeado ES la historia: se revisa en PR como cualquier código.

```ts
// apps/web/src/server/migrate.ts — se invoca UNA vez en el arranque
import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const MIGRATION_LOCK_KEY = 724_100; // constante propia; distinta de la del harness de tests

export async function runMigrations(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // Advisory lock de sesión: si dos procesos arrancan a la vez (deploy,
    // restart de compose), solo uno migra; el otro espera y encuentra el
    // schema ya al día. Sin lock: migraciones concurrentes = corrupción.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    const require = createRequire(import.meta.url);
    await migrate(drizzle(client), {
      // Resuelta respecto al paquete, NUNCA process.cwd() (mismo criterio que el harness de testing)
      migrationsFolder: path.join(path.dirname(require.resolve('@ugc/db/package.json')), 'drizzle'),
    });
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    await client.end();
  }
}
```

Reglas no negociables:

- **`drizzle-kit push` PROHIBIDO** fuera de prototipado local sin datos: aplica el schema sin dejar historia y puede dropear columnas para "cuadrar" — en el VPS eso es pérdida de datos sin rastro.
- **Conflicto de ramas → regenerar limpia**: borra tu migración no mergeada, rebasa sobre main y vuelve a `drizzle-kit generate`. NUNCA edites a mano el journal ni renumeres SQLs ya aplicados en algún entorno.
- **`drizzle-kit check` en CI**: detecta colisiones entre migraciones generadas en paralelo antes de que lleguen a una BD.
- **Cada migración se prueba contra el testcontainer**: el globalSetup de testing aplica TODAS las migraciones a la template en cada run — una migración rota aborta la suite entera, rápido y en un solo sitio. Lo que la migración *promete* (UNIQUE parciales, enums, `ON DELETE`) lleva además su test explícito: patrón y snippets en `testing/references/db-integration.md` §5.

## 4. Repos: funciones por agregado, executor como primer argumento

Un fichero por agregado (`steps.repo.ts`, `runs.repo.ts`, `generations.repo.ts`…) con funciones que reciben el executor como PRIMER argumento. Así la misma función corre sobre la conexión o dentro de una transacción — es lo que permite al orquestador componer repos bajo un solo `db.transaction`.

El alias `Db` (conexión | transacción) se exporta UNA vez desde db; el tipo de la tx se **deriva** del callback de `transaction()` para no depender de los generics internos de `PgTransaction`, que cambian entre versiones de Drizzle:

```ts
// packages/db/src/client.ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema'; // el barrel incluye schema/relations.ts (§7)

export type DbClient = NodePgDatabase<typeof schema>;
export type DbTx = Parameters<Parameters<DbClient['transaction']>[0]>[0];
export type Db = DbClient | DbTx;

/** Bajo nivel: quien posee el pool (worker) lo pasa y lo cierra él en el shutdown. */
export function makeDb(pool: Pool): DbClient {
  return drizzle(pool, { schema });
}

/** Conveniencia: pool interno. Es lo que usan el accessor getDb() de web (testing/api.md §2.1)
 *  y los tests que abren conexiones propias (testing/orchestrator.md §2). */
export function createDb(connectionString: string): DbClient {
  return makeDb(new Pool({ connectionString }));
}
```

```ts
// packages/db/src/repos/steps.repo.ts
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { stepRun, type StepRun, type NewStepRun } from '../schema/pipeline';

// Núcleo del orquestador: lock de fila para transición serializada (§9.0).
export async function findStepForUpdate(tx: Db, id: string): Promise<StepRun | undefined> {
  const [row] = await tx.select().from(stepRun).where(eq(stepRun.id, id)).for('update');
  return row;
}

export async function updateStep(tx: Db, id: string, patch: Partial<NewStepRun>): Promise<StepRun> {
  const [row] = await tx.update(stepRun).set(patch).where(eq(stepRun.id, id)).returning();
  if (!row) throw new Error(`step_run ${id} no existe`); // el orquestador lo mapea a AppError
  return row;
}

// Sweeper (T0.9): skipLocked evita bloquearse con transiciones en vuelo —
// un step lockeado por transition() se barre en la siguiente pasada del cron.
export async function claimExpirableSteps(tx: Db, limit = 50): Promise<StepRun[]> {
  return tx.select().from(stepRun)
    .where(and(
      inArray(stepRun.status, ['queued', 'submitting', 'running']),
      lte(stepRun.timeoutAt, sql`now()`),
    ))
    .orderBy(asc(stepRun.id)) // orden determinista de locks: previene deadlocks (testing/orchestrator.md §2)
    .limit(limit)
    .for('update', { skipLocked: true });
}
```

**Nada de generic repository ni active record.** Cada query es explícita y existe para un caso de uso con nombre: los `findAll/save` genéricos esconden justo el SQL que importa aquí (`FOR UPDATE`, `RETURNING`, `ON CONFLICT`, `skipLocked`) e invitan a N+1. Un repo nuevo empieza con la query que necesitas hoy, no con un CRUD por si acaso. Tests: roundtrip real contra el clon de Testcontainers (`db-integration.md` §6 — su snippet de ejemplo usa un estilo factory anterior a esta convención; lo vinculante de ahí es el patrón de roundtrip, y la forma del repo es la de este documento).

## 5. Adaptadores de puertos

`packages/core` define los puertos (`StepStore`, `JobQueue`, `WithTransaction`…); db los implementa envolviendo repos. La dirección manda: **el adaptador habla los tipos de los contratos de core**, no expone filas Drizzle — a menudo el mapeo es identidad estructural, pero cuando diverjan se convierte aquí, nunca en core.

```ts
// packages/db/src/adapters/step-store.ts
import type { StepStore } from '@ugc/core/orchestrator';
import type { Db } from '../client';
import * as steps from '../repos/steps.repo';

// Implementa EXACTAMENTE el puerto de architecture.md §2 (se amplía cuando el puerto crezca).
// Funciona igual con conexión o tx: los repos aceptan la unión Db.
export function makeStepStore(db: Db): StepStore {
  return {
    findForUpdate: async (id) => (await steps.findStepForUpdate(db, id)) ?? null, // el puerto habla null, no undefined
    update: (id, patch) => steps.updateStep(db, id, patch),
    insertSuperseding: (previous, next) => steps.insertSuperseding(db, previous, next),
    findDependents: (stepId) => steps.findDependents(db, stepId),
  };
}
```

`makeWithTransaction` implementa el puerto `WithTransaction` definido en `architecture.md` §2: abre la tx de Drizzle y entrega al orquestador los `TxStores` **tx-scoped** — core compone la transacción sin saber que Drizzle existe:

```ts
// packages/db/src/adapters/with-transaction.ts
import { sql } from 'drizzle-orm';
import type PgBoss from 'pg-boss';
import type { WithTransaction } from '@ugc/core/orchestrator';
import type { DbClient } from '../client';
import { makeStepStore } from './step-store';
import { makeTxJobQueue } from './job-queue';

export function makeWithTransaction(db: DbClient, boss: PgBoss): WithTransaction {
  return (fn) =>
    db.transaction(async (tx) => fn({
      steps: makeStepStore(tx),
      jobs: makeTxJobQueue(boss, tx), // INSERT del job pg-boss dentro de ESTA tx (adaptador {db}: jobs.md)
      events: {
        notify: async (runId) => {
          // pg_notify (no NOTIFY a pelo): acepta el payload parametrizado.
          await tx.execute(sql`SELECT pg_notify('pipeline_events', ${runId})`);
        },
      },
      // TxStores crece con el orquestador (runs, generations…): se añade el store al puerto y aquí, en el mismo PR.
    }));
}
```

Las apps cablean esto en su composition root (`apps/web/src/server/context.ts`, `apps/worker/src/bootstrap.ts`); los tests de integración cablean lo mismo contra el clon de Testcontainers — idéntico código, distinta conexión.

## 6. El patrón transaccional del orquestador (§9.0) visto desde SQL

Lo que `transition(stepId, event)` ejecuta contra Postgres, en UNA transacción:

```sql
BEGIN;
SELECT * FROM step_run WHERE id = $1 FOR UPDATE;      -- 1) lock de fila; el estado se revalida BAJO el lock
-- 2) validar la transición: lógica PURA de core (nextStatus); ilegal ⇒ throw ⇒ ROLLBACK
UPDATE step_run SET status = $next, started_at = … WHERE id = $1;
-- 3) resolver depends_on: steps aguas abajo satisfechos → queued (lockeados en orden por id)
INSERT INTO pgboss.job (name, data, …) VALUES (…);    -- 4) MISMA tx (detalle del adaptador {db}: jobs.md)
SELECT pg_notify('pipeline_events', $run_id);          -- 5) solo se ENTREGA en COMMIT
COMMIT;
```

Por qué cada pieza:

- **FOR UPDATE + revalidación bajo el lock**: dos procesos (webhook en web, consumer en worker) llegan a la vez; el perdedor, al desbloquearse, ve el estado ya cambiado y falla limpio con `IllegalTransitionError` — exactamente una aplicación de la transición (test en `testing/orchestrator.md` §2).
- **Job en la MISMA tx**: post-commit, un crash entre UPDATE y encolado deja steps `queued` que nadie ejecuta; pre-commit sin tx compartida, un rollback deja jobs fantasma. La atomicidad es lo innegociable (`testing/orchestrator.md` §4).
- **`pg_notify` transaccional**: NOTIFY solo se entrega en COMMIT — un rollback silencia el evento SSE automáticamente, sin código de compensación.
- **Rollback total en ilegal**: la fila queda byte a byte idéntica (ni `updated_at`), cero jobs, cero NOTIFY — el orden validar-antes-de-escribir lo garantiza y el test lo verifica (`testing/orchestrator.md` §1).
- **NUNCA un FOR UPDATE abierto durante una llamada HTTP externa.** Trabajo externo (fal.ai) = **dos transiciones cortas**: tx1 persiste la intención (`submitting`) y commitea; la llamada HTTP corre SIN transacción; tx2 persiste `request_id` y transiciona. Un lock abierto durante segundos de red serializa el pipeline entero contra la latencia de un proveedor.
- **Locks múltiples siempre en orden determinista por id** (resolución de deps, invalidación de sub-grafo): órdenes distintos en transacciones cruzadas = deadlock `40P01`.

## 7. Relational queries para read models

Las lecturas compuestas (snapshot del run con sus steps para la API y el evento `snapshot` del SSE) usan las relational queries — una query, shape anidado, sin joins a mano:

```ts
// packages/db/src/repos/runs.repo.ts
export async function getRunSnapshot(db: Db, runId: string) {
  return db.query.pipelineRun.findFirst({
    where: eq(pipelineRun.id, runId),
    with: {
      steps: { orderBy: (s, { asc }) => [asc(s.createdAt)] },
    },
  });
}
```

- **Escrituras: SIEMPRE query builder + tx.** Las relational queries son de lectura y no expresan `FOR UPDATE`, `RETURNING` ni `ON CONFLICT` — todo lo que el orquestador necesita.
- **Nota de barrel**: `schema/relations.ts` se re-exporta también en `schema/index.ts` — es lo que hace que `drizzle(pool, { schema })` conozca las relaciones y `db.query.*` funcione con el mismo barrel.
- **Nota de versión**: en Drizzle 0.x las relaciones se declaran con `relations()` (en `schema/relations.ts`); Drizzle 1.0 las sustituye por `defineRelations` con otra API de filtros. Por eso el RQB queda **encapsulado en repos**: los consumidores llaman `getRunSnapshot(db, id)` y un upgrade de Drizzle se paga en un solo fichero, no filtrado por core y las apps. Ante la duda de sintaxis exacta: skill `postgres-drizzle` o Context7.

## 8. Índices y constraints con intención (§12)

Regla: cada índice existe para una query o invariante con nombre — un índice "por si acaso" es coste de escritura sin retorno. Cada uno lleva su test (patrones en `testing/references/db-integration.md` §5–§7):

| Constraint / índice | Por qué existe | Test |
|---|---|---|
| UNIQUE `generation.fal_request_id` | Idempotencia de webhooks: fal reintenta hasta 10 veces en 2 h; el segundo INSERT choca (23505) y el handler hace no-op en vez de duplicar la generation | Insert duplicado rechaza (patrón §5) |
| UNIQUE **parcial** `brand_kit.domain WHERE domain IS NOT NULL` | Un BrandKit por dominio scrapeado, pero N filas en modo manual sin dominio (NULL no colisiona) | Ambos casos, explícitos (§5, T1.2) |
| GIN sobre facetas de `prompt_template` (`formats`, `hook_angles`, `verticals`, `platforms`) | Búsqueda facetada de la galería con `@>` sobre `text[]`; sin GIN es seq scan sobre cientos de templates | EXPLAIN con volumen sintético + corrección del resultado (§7, T3.1) |
| UNIQUE `metric_snapshot(publication_id, date)` | El sync diario de métricas upsertea (`ON CONFLICT`) — re-ejecutar el sync no duplica días | Upsert idempotente contra el clon |
| UNIQUE **parcial** `generation.content_hash` (estados activos/completados) | Dedupe Hook×Body×CTA (§9.6): dos consumers que buscan el mismo hash a la vez no submiten dos veces — la constraint es la barrera, el FOR UPDATE la disciplina | Carrera con dos consumers (`testing/orchestrator.md` §10, T4.10) |
| Índice `asset.normalized_cache_key` | Caché normalize-once del render (§9.7): el worker busca por checksum+params antes de re-normalizar | Lookup del repo (§6) |
| Índice `cost_entry(occurred_at)` | El panel `/spend` agrupa por rango de fechas; es la query caliente del ledger | Lookup del repo (§6) |

Declaración en el schema (mismo fichero que la tabla):

```ts
// packages/db/src/schema/project.ts (extracto)
export const brandKit = pgTable('brand_kit', {
  id: ulidPk(),
  domain: text('domain'), // nullable: modo manual sin dominio
  // …
}, (t) => [
  uniqueIndex('brand_kit_domain_uq').on(t.domain).where(sql`${t.domain} IS NOT NULL`),
]);

// packages/db/src/schema/gallery.ts (extracto)
export const promptTemplate = pgTable('prompt_template', {
  id: ulidPk(),
  formats: text('formats').array().notNull(),
  hookAngles: text('hook_angles').array().notNull(),
  // …
}, (t) => [
  index('prompt_template_formats_gin').using('gin', t.formats),
  index('prompt_template_hook_angles_gin').using('gin', t.hookAngles),
]);
```

Los UNIQUE parciales y los `ON DELETE` son exactamente lo que puede divergir entre el schema TS y el SQL migrado — por eso su comportamiento observable se fija con tests de integración, no se supone (`db-integration.md` §5).

## 9. Qué NO va aquí

- **Harness de Testcontainers** (template database, `createTestDatabase()`, pitfalls de pools) y los patrones de test de migraciones/repos/índices → `testing/references/db-integration.md` (fuente de verdad; no dupliques ni un snippet).
- **Tests del orquestador** (transiciones, carreras, NOTIFY, encolado transaccional) → `testing/references/orchestrator.md`.
- **Colas pg-boss**: `defineJob`, creación de colas, el adaptador `{ db }` del encolado transaccional, consumers, retries, cron, shutdown → `references/jobs.md`.
- **Dónde vive una pieza** (puertos, módulos de core, contratos Zod públicos, composition roots) → `references/architecture.md`.
- **Accessors `getDb()`/`setDbForTests()` de apps/web**, route handlers y envelope de errores → `references/api.md`.
- **SQL genérico de Postgres** (diseño de queries, locking avanzado) → skill `supabase-postgres-best-practices`; dudas de API Drizzle 0.x vs 1.0 → skill `postgres-drizzle` + Context7.
