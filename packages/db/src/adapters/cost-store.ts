// Adaptador del puerto `CostStore` de core (T1.20): el rollup del coste real, recomputado
// desde el ledger (`cost_entry`) DENTRO de la transacción que liquida el step.
//
// ────────────────────────────────────────────────────────────────────────────────────────
// 1. AQUÍ VIVE LA GARANTÍA "EL ROLLUP NO PUEDE TUMBAR UNA TRANSICIÓN" — Y ES UN SAVEPOINT.
// ────────────────────────────────────────────────────────────────────────────────────────
// El contrato del puerto dice que estas operaciones NUNCA lanzan (ver ports.ts). Cumplirlo
// con un `try/catch` a secas sería MENTIRA: en Postgres, un statement que falla dentro de
// una transacción la deja ABORTADA — todo lo que venga después responde 25P02
// (`current transaction is aborted`), incluido el `pg_notify` de la transición y su COMMIT.
// Capturar el error en JS no resucita una tx envenenada.
//
// La única forma real de aislar un statement dentro de una tx es un SAVEPOINT: si falla, se
// hace ROLLBACK TO SAVEPOINT y la transacción exterior sigue VIVA y usable. En Drizzle eso es
// una transacción ANIDADA (`tx.transaction(...)`) — el mismo mecanismo que ya usa
// `withDomainTransaction`. Por eso este adaptador es el sitio correcto para la garantía, y core
// no sabe (ni debe saber) que existe un savepoint. Hay un test que lo MUERDE
// (db/test/integration/cost-rollup.test.ts): fuerza un overflow de int4 en el SQL REAL del
// rollup y exige que el step CIERRE igual. Sin savepoint es rojo, con 25P02.
//
// Efecto neto, que es EXACTAMENTE la propiedad que T1.10b estableció en el consumer y que esta
// tarea conserva: un fallo del rollup es una COLUMNA DESACTUALIZADA (recomputable en el
// siguiente cierre, porque la verdad está en `cost_entry`), nunca una transición perdida ni
// dinero perdido.
//
// ────────────────────────────────────────────────────────────────────────────────────────
// §2. EL AGREGADO DEL RUN SE RECOMPUTA UNA VEZ POR TRANSACCIÓN (dedup tx-scoped).
// ────────────────────────────────────────────────────────────────────────────────────────
// (Éste es el sitio CANÓNICO de esta decisión: ports.ts, transition.ts y spend.repo.ts
// apuntan aquí en vez de repetir el argumento — una decisión, un dueño.)
// `applyTransition` llama a `rollupRun` en CADA cierre de step. Los caminos que cierran N steps
// en UNA sola tx —`cancelRun` (barre el run entero: 40 steps en un lote de F2) y
// `invalidateDownstream` (supersede el sub-grafo)— pasarían N veces por ahí y, sin dedup,
// ejecutarían N veces el MISMO `SUM` sobre el MISMO run: 39 de 40 desperdiciados, y 40 tomas
// del lock de escritura de esa fila en vez de una.
//
// El store se construye POR TRANSACCIÓN, así que un `Set<string>` local basta: el primer
// `rollupRun(runId)` de la tx escribe, los siguientes son no-op. Y es CORRECTO deduplicar, no
// una aproximación: el `cost_entry` se escribe ANTES de la transición de cierre (record-first,
// dentro del servicio que paga — T1.4), nunca durante ella, así que UNA recomputación por tx ya
// ve todo el gasto que había que ver. Recomputar más veces daría exactamente el mismo número.
//
// (NOTA HONESTA, para que nadie "mejore" esto por la razón equivocada: NO es un fix de deadlock.
// Se revisó el punto y no existe tal ciclo — los únicos escritores de `pipeline_run` son el
// INSERT de creación, `updateRunAutopilot` y este rollup, y NINGÚN camino lockea `pipeline_run`
// para después esperar una fila de `step_run`. Esto es eficiencia y menos contención sobre la
// fila del run, nada más.)
import type { CostStore } from '@ugc/core/orchestrator';
import type { Logger } from '@ugc/core';
import type { Db, DbTx } from '../client';
import { rollupRunCost, rollupStepCost } from '../repos/spend.repo';

/**
 * Ejecuta `op` en un SAVEPOINT: si lanza, se revierte SOLO lo suyo y la transacción exterior
 * queda intacta y usable. Traga el error dejando TRAZA ESTRUCTURADA — es la implementación del
 * contrato best-effort del puerto.
 *
 * EL TIPO ES `DbTx`, NO LA UNIÓN `Db`, Y ESO ES DELIBERADO: sin transacción no hay savepoint
 * que dar, así que el compilador lo impide en vez de decidirlo en runtime. (La primera versión
 * discriminaba con `typeof db.rollback === 'function'` — duck-typing sobre un tipo de TERCEROS:
 * si Drizzle cambiara dónde expone `rollback`, el store correría SIN savepoint en silencio y el
 * primer fallo tumbaría la transición… que es justo lo que el savepoint existe para impedir. El
 * tipo elimina esa clase de bug entera, y la rama `else` era una trampa sin usuarios: los dos
 * únicos constructores —`makeWithTransaction` y `withDomainTransaction`— siempre pasan una tx.)
 */
async function bestEffort(
  tx: DbTx,
  logger: Logger,
  ctx: Record<string, string>,
  op: (db: Db) => Promise<void>,
): Promise<void> {
  try {
    // Tx anidada de Drizzle = SAVEPOINT en Postgres: su rollback NO aborta la de fuera.
    await tx.transaction(async (sp) => {
      await op(sp);
    });
  } catch (err) {
    // Traza y sigue. NO se relanza: el llamante es una transición del orquestador y su
    // corrección (estado + NOTIFY) no depende de esta proyección.
    //
    // EL LOGGER ES OBLIGATORIO (no opcional, y NO `console`): un fallo TRAGADO sin señal
    // estructurada es el bug de T1.20 reintroducido y encima INVISIBLE. Si el rollup empezara a
    // fallar de forma sistemática (un cambio de schema, un overflow real de int4 con el gasto
    // de fal.ai en F2, permisos), la columna volvería a mentir y NADIE se enteraría. Un
    // `console.warn` no entra en el pino de web/worker ni lleva el id afectado; este `warn` sí,
    // y es grepeable por `stepId`/`runId`.
    logger.warn(
      { err, ...ctx },
      'cost rollup falló: la columna queda DESACTUALIZADA (el cost_entry SÍ está, y el rollup es recomputable)',
    );
  }
}

export function makeCostStore(tx: DbTx, logger: Logger): CostStore {
  // Runs cuyo agregado YA se recomputó en ESTA transacción (el store es tx-scoped: lo construye
  // el adaptador que abre la tx, y muere con ella). Ver el bloque 2 de la cabecera.
  const rolledRuns = new Set<string>();

  return {
    rollupStep: (stepId) => bestEffort(tx, logger, { stepId }, (db) => rollupStepCost(db, stepId)),

    rollupRun: async (runId) => {
      if (rolledRuns.has(runId)) return; // ya recomputado en esta tx: el SUM daría lo mismo
      // Se marca ANTES de ejecutar, no después: si el rollup falla (savepoint revertido, traza
      // en el log), reintentarlo N veces más dentro de la MISMA tx fallaría igual — el ledger no
      // ha cambiado entre medias. Marcar antes evita repetir un error garantizado 39 veces en un
      // `cancelRun`; la columna se recompone sola en el siguiente cierre del run.
      rolledRuns.add(runId);
      await bestEffort(tx, logger, { runId }, (db) => rollupRunCost(db, runId));
    },
  };
}
