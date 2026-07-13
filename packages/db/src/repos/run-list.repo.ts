// El LISTADO de runs (T1.17): la lectura que alimenta `GET /api/runs` y la página `/runs`.
// Proyección de PRESENTACIÓN (hermana de `readRunSnapshot`), no una fila de persistencia.
//
// ────────────────────────────────────────────────────────────────────────────────────────
// TRES COLUMNAS DE `pipeline_run`/`step_run` MIENTEN. ESTE REPO NO LEE NINGUNA DE LAS TRES.
// ────────────────────────────────────────────────────────────────────────────────────────
//
// 1. `pipeline_run.status` — NADIE LO MANTIENE (deuda diferida de T0.8: `transition()` mueve
//    los steps y nunca recomputa el agregado). En la BD local, los CUATRO runs reales dicen
//    `pending`: los dos que completaron sus 3 steps y los dos que murieron en N3. Un listado
//    que la pintara mentiría en el 100 % de las filas.
//    ⇒ el estado se DERIVA de los steps con `deriveRunStatus` (core, función pura con test).
//
// 2. `pipeline_run.total_cost_actual` — la misma historia: NULL en los 4 runs reales. Nadie
//    hace el rollup a nivel de run.
//
// 3. `step_run.cost_actual` — la trampa MÁS CARA, y la menos obvia: `rollupStepCost` (T1.10b)
//    solo corre al CERRAR BIEN un step. Un step que FALLA deja `cost_actual` NULL… habiendo
//    GASTADO. Comprobado en la BD local: los dos N3 muertos tienen `cost_actual = NULL` y
//    16 y 13 céntimos en `cost_entry`. Sumar la columna del step pintaría **$0.00 en los dos
//    runs muertos**: exactamente el fallo que esta tarea existe para no cometer, mudado de la
//    columna de estado a la de dinero (y en la dirección peor: ocultar gasto real).
//    ⇒ el coste se agrega del LEDGER (`cost_entry`, append-only), que es la verdad del dinero.
//
// ASIMETRÍA DELIBERADA CON `superseded` (T0.8): el ESTADO ignora los steps superseded (la
// verdad de un nodo es su fila VIVA: un retry con éxito no debe arrastrar el fallo viejo),
// pero el COSTE los INCLUYE — el dinero gastado en el intento invalidado se gastó de verdad.
// Es justo POR ESO que el ledger es append-only. No es un descuido: son dos preguntas
// distintas sobre el mismo run.
import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import { deriveCurrentStep, deriveRunStatus, type RunListItem } from '@ugc/core/contracts';
import { AnalysisN1ConfigSchema } from '@ugc/core/orchestrator';
import type { Db } from '../client';
import { pipelineRun, stepRun } from '../schema/pipeline';
import { costEntry } from '../schema/ops';

/** Longitud a la que se recorta el mensaje de error en la FILA del listado (el error entero
 *  se ve en el canvas del run, que es a donde la fila enlaza). */
const ERROR_EXCERPT_MAX = 160;

export interface RunListPage {
  runs: RunListItem[];
  total: number;
}

/**
 * EL ROLLUP DE COSTE POR RUN, DESDE EL LEDGER. La ÚNICA fuente honesta del dinero que un run
 * gastó, y la comparten sus DOS consumidores: el listado (`listRuns`) y el objeto run que pinta
 * la cabecera del canvas (`GET /api/runs/:id`).
 *
 * Existe como función compartida —y no copiada— precisamente porque la alternativa fácil ya
 * causó un bug REAL: la cabecera del canvas sumaba `step_run.cost_actual` y enseñaba **$0.00 en
 * los dos runs que murieron en N3 habiendo gastado 16 y 13 céntimos** (`rollupStepCost` solo
 * corre al cerrar BIEN un step ⇒ un step que falla deja la columna NULL). Dos sitios que
 * responden «cuánto costó este run» tienen que responder LO MISMO, y con el mismo dato.
 *
 * `cost_entry` NO tiene `run_id`: el rollup es el join `cost_entry → step_run → run_id`. SUM de
 * enteros (exacto, sin float) y `::int` obligatorio — `sum()` en Postgres devuelve `bigint`, que
 * `node-postgres` entrega como STRING (sin el cast, el `z.number()` del contrato reventaría).
 *
 * INCLUYE los steps `superseded` a propósito: el dinero del intento invalidado se gastó de
 * verdad (es la razón de ser de un ledger append-only). Ojo a la asimetría con el ESTADO, que sí
 * los ignora (la verdad de un nodo es su fila viva): son dos preguntas distintas sobre el run.
 */
// La versión en LOTE es interna del módulo (la consumen `listRuns` y `runLedgerCost`, aquí
// mismo); fuera solo sale la de UN run, que es la que pide `GET /api/runs/:id`. Knip veta el
// export sin consumidor externo.
async function runLedgerCosts(db: Db, runIds: string[]): Promise<Map<string, number>> {
  if (runIds.length === 0) return new Map();
  const rows = await db
    .select({
      runId: stepRun.runId,
      costCents: sql<number>`coalesce(sum(${costEntry.amountCents}), 0)::int`,
    })
    .from(costEntry)
    .innerJoin(stepRun, eq(costEntry.stepRunId, stepRun.id))
    .where(inArray(stepRun.runId, runIds))
    .groupBy(stepRun.runId);
  // Un run SIN cargos no aparece en el GROUP BY: su coste es 0, y quien consulte el mapa debe
  // resolverlo con `?? 0` — nunca `undefined`/NaN en pantalla.
  return new Map(rows.map((r) => [r.runId, r.costCents]));
}

/** El coste del ledger de UN run (azúcar sobre `runLedgerCosts`): lo consume `GET /api/runs/:id`,
 *  que alimenta la cabecera del canvas. 0 si el run no gastó nada. */
export async function runLedgerCost(db: Db, runId: string): Promise<number> {
  return (await runLedgerCosts(db, [runId])).get(runId) ?? 0;
}

/**
 * Página del listado de runs, orden DESC por creación (el último lanzado, arriba).
 *
 * Tres queries acotadas y ninguna N+1: (1) la página de runs + su total, (2) TODOS los steps
 * de ESOS runs (`inArray`, índice `step_run_run_id_idx`), (3) el rollup del ledger por run
 * para ESOS runs. Después se ensambla en TS con las funciones PURAS de core — que es
 * exactamente lo que permite testear la regla del estado sin una BD levantada.
 */
export async function listRuns(
  db: Db,
  { limit, offset }: { limit: number; offset: number },
): Promise<RunListPage> {
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: pipelineRun.id,
        kind: pipelineRun.kind,
        createdAt: pipelineRun.createdAt,
      })
      .from(pipelineRun)
      // ORDEN POR **PK**, NO POR `created_at`, Y NO ES UN ATAJO: es lo mismo, servido por un
      // índice que ya existe.
      //
      // `pipeline_run` NO tiene NINGÚN índice salvo su PK (`pg_indexes` solo devuelve
      // `pipeline_run_pkey`). Un `ORDER BY created_at DESC` obliga a un SEQ SCAN de la tabla
      // ENTERA + un nodo de SORT en CADA carga de `/runs` —O(total_runs), sin que el `limit`
      // acote nada—, porque no hay índice por el que recorrer.
      //
      // La PK es un **ULID**, y un ULID es MONOTÓNICO con el tiempo (sus 48 bits de cabecera son
      // el timestamp en ms): para ESTA tabla —cuyas filas las crea `createRun`, que genera el
      // ULID en el mismo instante que la fila—, `ORDER BY id DESC` produce EXACTAMENTE el mismo
      // orden que `ORDER BY created_at DESC, id DESC`, y lo sirve el btree de la PK con un index
      // scan hacia atrás: sin seq scan y sin sort. Verificado contra los 4 runs reales de la BD
      // local: orden idéntico.
      //
      // ⚠ NO LO «ARREGLES» VOLVIENDO A `created_at` SIN AÑADIR UN ÍNDICE: sería cambiar un index
      // scan por un seq scan + sort a cambio de cero semántica nueva. Si algún día `created_at`
      // deja de ir en el mismo orden que el id (un backfill que inserte filas con fecha ajena),
      // entonces sí: índice en `created_at DESC` y se ordena por él.
      .orderBy(desc(pipelineRun.id))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(pipelineRun),
  ]);

  const total = totalRow?.total ?? 0;
  if (rows.length === 0) return { runs: [], total };

  const runIds = rows.map((r) => r.id);

  const [steps, costs] = await Promise.all([
    db
      .select({
        runId: stepRun.runId,
        nodeKey: stepRun.nodeKey,
        status: stepRun.status,
        error: stepRun.error,
        config: stepRun.config,
      })
      .from(stepRun)
      .where(inArray(stepRun.runId, runIds))
      // Por id = orden de creación = orden topológico del DAG: `deriveCurrentStep` desempata
      // entre candidatos del mismo rango quedándose con el PRIMERO, así que el orden importa.
      .orderBy(stepRun.id),
    // EL COSTE, DEL LEDGER — la MISMA función que alimenta la cabecera del canvas
    // (`GET /api/runs/:id`). Ver `runLedgerCosts`: es lo que impide que dos sitios respondan
    // distinto a «cuánto costó este run».
    runLedgerCosts(db, runIds),
  ]);

  const stepsByRun = new Map<string, typeof steps>();
  for (const step of steps) {
    const list = stepsByRun.get(step.runId) ?? [];
    list.push(step);
    stepsByRun.set(step.runId, list);
  }
  const costByRun = costs;

  const runs = rows.map((run): RunListItem => {
    const runSteps = stepsByRun.get(run.id) ?? [];
    const status = deriveRunStatus(runSteps.map((s) => s.status));
    const current = deriveCurrentStep(runSteps);

    return {
      id: run.id,
      kind: run.kind,
      createdAt: run.createdAt.toISOString(),
      status,
      origin: originOf(runSteps),
      costActualCents: costByRun.get(run.id) ?? 0,
      currentStep: current?.nodeKey ?? null,
      // El error solo se muestra cuando EXPLICA el estado (run fallido): el `error` de un step
      // que luego se reintentó con éxito no es el error del run.
      error: status === 'failed' ? errorExcerptOf(current?.error) : null,
    };
  });

  return { runs, total };
}

/**
 * QUÉ se analizó, desde la `config` del step N1 (el input del intake, persistido en la
 * creación del run). No hay FK `pipeline_run → url_analysis`: esa config es la única atadura
 * real entre un run y su origen — y, a diferencia del `output_refs` de N1, existe desde el
 * INSTANTE en que el run se crea (un run que murió scrapeando ya sabe decir qué URL le pidieron).
 *
 * Un run que no es de análisis (los DAGs de demo de F0, los lotes de F2+) no tiene N1 con esta
 * config: su origen es `other`. NO se inventa uno.
 */
function originOf(steps: readonly { nodeKey: string; config: unknown }[]): RunListItem['origin'] {
  const n1 = steps.find((s) => s.nodeKey === 'N1');
  if (!n1) return { source: 'other' };

  // `config` es jsonb OPACO para la BD: se valida contra el schema de core que lo PRODUJO
  // (`analysisRunDefinition`), nunca contra una copia local. Un safeParse que falla = este run
  // no es de análisis ⇒ `other`, sin lanzar (el listado no puede reventar por un run raro).
  const parsed = AnalysisN1ConfigSchema.safeParse(n1.config);
  if (!parsed.success) return { source: 'other' };
  return parsed.data.source === 'url'
    ? { source: 'url', url: parsed.data.url }
    : { source: 'manual' };
}

/**
 * El mensaje del error del step, recortado para la fila. `step_run.error` es jsonb opaco
 * (`{message}` del consumer, T0.7b): se lee defensivamente — un error con otra forma NO puede
 * tumbar el listado.
 */
function errorExcerptOf(error: unknown): string | null {
  if (error == null) return null;
  const message =
    typeof error === 'object' && 'message' in error && typeof error.message === 'string'
      ? error.message
      : JSON.stringify(error);
  return message.length > ERROR_EXCERPT_MAX ? `${message.slice(0, ERROR_EXCERPT_MAX)}…` : message;
}
