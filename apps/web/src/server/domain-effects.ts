// EL REGISTRO DE EFECTOS DE DOMINIO DE UN CHECKPOINT (T2.3 — la deuda que T1.11 anotó al planning:
// «lo que se apila en los route handlers NO es la decisión (`persistCheckpointDecision` se queda en
// UNA llamada para siempre) sino el EFECTO DE DOMINIO … Pide un registro forma-del-artefacto →
// efecto. Se paga barato en T2.3 migrando UN efecto, no cuatro en F4»).
//
// EL PROBLEMA QUE RESUELVE. Aprobar un checkpoint tiene, además de la transición genérica del
// orquestador, un efecto que depende de QUÉ artefacto es:
//
//   · CP1 (artefacto `N3Output`, un brief)  → el `product_brief` v1 pasa a `approved`.
//   · CP2 (artefacto `N4Output`, una matriz) → se crea el `ad_batch` + sus `ad_variant` en `planned`.
//   · CP3/CP4 (F2–F4) traerán los suyos.
//
// Con UNA llamada por efecto en el route handler, `/approve` acumula un `await xForStep(...)` por
// checkpoint: cuatro fases más adelante son cuatro llamadas encadenadas, cada una haciendo su
// propio `safeParse` del mismo `output_refs` y no-opeando en silencio si no es lo suyo — y el día
// que alguien olvide añadir la suya, el checkpoint se aprueba SIN su efecto y nadie se entera.
//
// AQUÍ EL EFECTO SE **RESUELVE**, NO SE ENCADENA: el registro discrimina por la FORMA DEL ARTEFACTO
// (el mismo criterio que ya usaban `parseBriefOutput` y el hook de CP1 en cliente — nunca por
// `node_key`, que no identifica una fila tras un supersede, T0.8) y ejecuta EL efecto que
// corresponde. Añadir CP3 es añadir una entrada a la lista.
//
// NO-OP LEGÍTIMO: un checkpoint sin efecto de dominio (los de demo de F0, un artefacto que no
// reconoce ningún schema) no ejecuta nada. Es el caso normal, no un error: la mayoría de los
// checkpoints solo mueven estado.
import { N3OutputSchema, N4OutputSchema, type CheckpointDecision } from '@ugc/core/contracts';
import type { Db } from '@ugc/db';
import { approveBriefForStep } from './brief-checkpoint';
import { createBatchForStep } from './batch-checkpoint';

/**
 * Un efecto de dominio: `matches` reconoce el artefacto por su SCHEMA; `apply` ejecuta el efecto
 * DENTRO de la transacción de la transición (el `db` que recibe es la tx, no la conexión).
 *
 * La decisión del humano viaja también: CP2 la NECESITA (la config del lote ES la decisión), CP1
 * no la mira (su efecto es el mismo se decida lo que se decida). Que el efecto la reciba y decida
 * si le importa es más honesto que dos firmas distintas.
 */
interface DomainEffect {
  matches: (outputRefs: unknown) => boolean;
  apply: (
    db: Db,
    outputRefs: unknown,
    decision: CheckpointDecision | undefined,
  ) => Promise<unknown>;
}

const EFFECTS: DomainEffect[] = [
  {
    // CP1 · BRIEF (T1.10b): aprobar sin editar marca el v1 `approved`. No crea v2 — un v2 idéntico
    // con `edited_by_user:true` mentiría sobre quién escribió ese contenido (§19.1 mide justo eso).
    matches: (outputRefs) => N3OutputSchema.safeParse(outputRefs).success,
    apply: (db, outputRefs) => approveBriefForStep(db, outputRefs),
  },
  {
    // CP2 · MATRIZ (T2.3): confirmar el gasto CREA el lote y sus variantes en `planned`. Sin
    // decisión `matrix` no crea nada (el usuario no ha confirmado ninguna config) — ver
    // `createBatchForStep`.
    matches: (outputRefs) => N4OutputSchema.safeParse(outputRefs).success,
    apply: (db, outputRefs, decision) => createBatchForStep(db, outputRefs, decision),
  },
];

/**
 * Ejecuta el efecto de dominio del artefacto de este step, si tiene uno. Se llama DENTRO de la
 * misma transacción que la transición del checkpoint: el efecto y la transición commitean juntos o
 * no commitea ninguno (la lección de T1.10b — si `approveStep` commiteara y el efecto fallara
 * después, el run habría reanudado aguas abajo sin el efecto y sin forma de reintentarlo: un
 * segundo POST da 409, el step ya no está en `waiting_approval`).
 */
export async function applyDomainEffect(
  db: Db,
  outputRefs: unknown,
  decision: CheckpointDecision | undefined,
): Promise<void> {
  const effect = EFFECTS.find((e) => e.matches(outputRefs));
  if (effect === undefined) return;
  await effect.apply(db, outputRefs, decision);
}
