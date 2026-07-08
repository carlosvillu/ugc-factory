// Creación de un run desde una definición de DAG (T0.7b, §9.0). ATÓMICO: en UNA
// transacción inserta el `pipeline_run` + todos los `step_run` (roots ⇒ `pending`,
// dependientes ⇒ `awaiting_deps`) y ENCOLA los roots (los lleva a `queued` y crea
// su job `step.execute` vía el JobQueue tx-scoped). Un crash entre el INSERT y el
// encolado dejaría un run varado — por eso los dos van en la misma tx (rollback
// deshace ambos).
//
// Reusa el mismo `withTransaction`/JobQueue tx-scoped que `transition()` (T0.7a):
// no abre conexión aparte. La resolución aguas abajo (dependientes → queued al
// completar un root) NO es cosa de aquí: la hace `transition()` en el `succeed`.
import { newUlid } from '../contracts';
import { enqueueStep } from './transition';
import type { RunDefinition } from './run-definition';
import { initialStatus, validateDag } from './run-definition';
import type { NewStepRow, WithTransaction } from './ports';

/** Se lanza si la definición del DAG es estructuralmente inválida (ciclo, dep
 *  colgante, sin root). El route handler la mapea a `validation_error` (400). */
export class InvalidRunDefinitionError extends Error {
  constructor(reason: string) {
    super(`definición de run inválida: ${reason}`);
    this.name = 'InvalidRunDefinitionError';
  }
}

export interface CreateRunDeps {
  withTransaction: WithTransaction;
}

export interface CreatedStep {
  key: string;
  stepId: string;
  nodeKey: string;
  status: string;
}
export interface CreateRunResult {
  runId: string;
  /** Los steps creados, en el orden de la definición. */
  steps: CreatedStep[];
}

/**
 * Crea el run y devuelve sus ids. Valida el DAG ANTES de tocar la BD (ciclo/dep
 * colgante/sin root ⇒ `InvalidRunDefinitionError`, cero efectos). Dentro de la tx:
 * INSERT run + steps, luego encolado de los roots (update a `queued` + job en la
 * misma tx). El NOTIFY inicial se emite tras encolar los roots.
 */
export async function createRun(deps: CreateRunDeps, def: RunDefinition): Promise<CreateRunResult> {
  const invalid = validateDag(def);
  if (invalid) throw new InvalidRunDefinitionError(invalid);

  // ULID por nodo, generado ANTES del INSERT: permite resolver `dependsOn` (que
  // referencia `key`s locales) a los ULIDs reales de los steps (db.md §1).
  const idByKey = new Map<string, string>(def.nodes.map((n) => [n.key, newUlid()]));
  const runId = newUlid();

  // Resuelve una `key` local a su ULID; lanza si falta (imposible tras validateDag,
  // pero el guard evita el non-null assertion y documenta el invariante).
  const idOf = (key: string): string => {
    const id = idByKey.get(key);
    if (id === undefined) throw new InvalidRunDefinitionError(`clave sin id: ${key}`);
    return id;
  };

  // Filas con su `key` local adjunta: así el resultado se arma sin re-buscar.
  const planned = def.nodes.map((node) => ({
    key: node.key,
    row: {
      id: idOf(node.key),
      runId,
      nodeKey: node.nodeKey,
      status: initialStatus(node),
      dependsOn: node.dependsOn.map(idOf),
      config: node.config ?? null,
    } satisfies NewStepRow,
  }));
  const stepRows: NewStepRow[] = planned.map((p) => p.row);

  await deps.withTransaction(async ({ runs, steps, jobs, events }) => {
    await runs.insertRun({ id: runId, projectId: def.projectId });
    await runs.insertSteps(stepRows);

    // Encolado atómico de los roots: los steps sin deps (`pending`) pasan a
    // `queued` y se crea su job `step.execute` en ESTA tx. Equivale a
    // `transition(root,'enqueue')` pero sin abrir otra tx — el efecto (update +
    // enqueue) es idéntico al de la máquina de estados para `pending→queued`.
    // Reusa `enqueueStep` (transition.ts) para no duplicar el contrato del job ni
    // el formato del `singletonKey` de dedup (jobs.md §5).
    for (const step of stepRows) {
      if (step.status !== 'pending') continue;
      await steps.update(step.id, { status: 'queued' });
      await enqueueStep(jobs, { id: step.id, runId, nodeKey: step.nodeKey });
    }

    // NOTIFY inicial: el snapshot SSE (T0.10) ve el run ya con sus roots en cola.
    await events.notify(runId);
  });

  return {
    runId,
    steps: planned.map(({ key, row }) => ({
      key,
      stepId: row.id,
      nodeKey: row.nodeKey,
      // El status devuelto refleja el estado POST-encolado: los roots quedaron en
      // `queued`, no en el `pending` con que se insertaron.
      status: row.status === 'pending' ? 'queued' : row.status,
    })),
  };
}
