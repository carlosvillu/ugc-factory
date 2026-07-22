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
import {
  N3OutputSchema,
  N4OutputSchema,
  N5OutputSchema,
  N9OutputSchema,
  type CheckpointDecision,
} from '@ugc/core/contracts';
import type { WithTransaction } from '@ugc/core/orchestrator';
import type { Db } from '@ugc/db';
import { approveBriefForStep } from './brief-checkpoint';
import { createBatchForStep } from './batch-checkpoint';
import { approveScriptsForStep } from './script-checkpoint';
import { applyQaVerdict } from './qa-checkpoint';

/** El resultado de un efecto de dominio. Hoy solo CP2 aporta algo: el `nextRunId` del run de N5 que
 *  su aprobación arranca (T2.6) — el cliente lo usa para navegar a CP3. El resto no devuelve nada. */
export interface DomainEffectResult {
  nextRunId?: string;
}

/**
 * Un efecto de dominio: `matches` reconoce el artefacto por su SCHEMA; `apply` ejecuta el efecto
 * DENTRO de la transacción de la transición (el `db` que recibe es la tx, no la conexión).
 *
 * `apply` recibe también el `withTransaction` del scope de dominio: CP2 lo NECESITA (arranca el run
 * de N5 con `createRun` en la misma tx, T2.6); los demás efectos lo ignoran. Que todos lo reciban y
 * decidan si les importa es más honesto que dos firmas distintas.
 *
 * La decisión del humano también viaja: CP2/CP3 la NECESITAN (la config / los veredictos SON la
 * decisión), CP1 no la mira. Mismo criterio.
 */
interface DomainEffect {
  matches: (outputRefs: unknown) => boolean;
  apply: (
    db: Db,
    withTransaction: WithTransaction,
    outputRefs: unknown,
    decision: CheckpointDecision | undefined,
    // Un efecto puede no devolver nada (CP1/CP3: solo mutan estado) o devolver un
    // `DomainEffectResult` (CP2: su `nextRunId`). `applyDomainEffect` normaliza el `undefined` a `{}`.
  ) => Promise<DomainEffectResult> | Promise<void>;
  /**
   * Efecto de la rama de RECHAZO (CP4, T5.5c): lo despacha `applyDomainEffectOnReject` desde el route de
   * reject. OPCIONAL: solo CP4 lo tiene (rechazar una variante en QA la marca `rejected`); CP1/CP2/CP3 no
   * tienen efecto de dominio al rechazar —una rama rechazada simplemente no continuaba— y lo dejan
   * ausente. Recibe solo `db` (la tx) + `outputRefs`: rechazar no arranca ningún run ni consume decisión.
   */
  rejectApply?: (db: Db, outputRefs: unknown) => Promise<void>;
}

const EFFECTS: DomainEffect[] = [
  {
    // CP1 · BRIEF (T1.10b): aprobar sin editar marca el v1 `approved`. No crea v2 — un v2 idéntico
    // con `edited_by_user:true` mentiría sobre quién escribió ese contenido (§19.1 mide justo eso).
    matches: (outputRefs) => N3OutputSchema.safeParse(outputRefs).success,
    apply: (db, _withTransaction, outputRefs) => approveBriefForStep(db, outputRefs),
  },
  {
    // CP2 · MATRIZ (T2.3 + T2.6): confirmar el gasto CREA el lote y sus variantes en `planned` Y
    // arranca el run de N5 (en la misma tx) — devuelve su `nextRunId`. Sin decisión `matrix` no crea
    // nada (el usuario no ha confirmado ninguna config) — ver `createBatchForStep`.
    matches: (outputRefs) => N4OutputSchema.safeParse(outputRefs).success,
    apply: async (db, withTransaction, outputRefs, decision) => {
      const result = await createBatchForStep(db, withTransaction, outputRefs, decision);
      return result === undefined ? {} : { nextRunId: result.nextRunId };
    },
  },
  {
    // CP3 · GUIONES (T2.6 + T4.11): aplicar los veredictos por-variante — v2 de los guiones editados,
    // re-lint server-side, y `ad_variant.scripted` SOLO para las que pasan el guard de bloqueo — Y
    // arrancar el RUN DE GENERACIÓN N6→N7 de las variantes `scripted` en la MISMA tx (devuelve su
    // `nextRunId`, patrón de CP2). Sin decisión `scripts` no hace nada.
    matches: (outputRefs) => N5OutputSchema.safeParse(outputRefs).success,
    apply: (db, withTransaction, outputRefs, decision) =>
      approveScriptsForStep(db, withTransaction, outputRefs, decision),
  },
  {
    // CP4 · QA (T5.5c): el ÚNICO checkpoint con efecto de dominio en AMBAS ramas. Aprobar el máster de la
    // variante la lleva a `ad_variant.status='approved'` (`apply`); rechazarla, a `rejected` (`rejectApply`,
    // despachado por el route de reject). Sin decisión: el `variantId` viaja en el artefacto N9 (como CP1).
    // «Regenerar» NO está aquí (no es aprobar/rechazar el step): es un run `kind='regen'` nuevo (op aparte).
    matches: (outputRefs) => N9OutputSchema.safeParse(outputRefs).success,
    apply: (db, _withTransaction, outputRefs) => applyQaVerdict(db, outputRefs, 'approved'),
    rejectApply: (db, outputRefs) => applyQaVerdict(db, outputRefs, 'rejected'),
  },
];

/**
 * Ejecuta el efecto de dominio del artefacto de este step, si tiene uno. Se llama DENTRO de la
 * misma transacción que la transición del checkpoint: el efecto y la transición commitean juntos o
 * no commitea ninguno (la lección de T1.10b — si `approveStep` commiteara y el efecto fallara
 * después, el run habría reanudado aguas abajo sin el efecto y sin forma de reintentarlo: un
 * segundo POST da 409, el step ya no está en `waiting_approval`).
 *
 * Devuelve lo que el efecto produzca (hoy: el `nextRunId` de CP2). Un no-op devuelve `{}`.
 */
export async function applyDomainEffect(
  db: Db,
  withTransaction: WithTransaction,
  outputRefs: unknown,
  decision: CheckpointDecision | undefined,
): Promise<DomainEffectResult> {
  const effect = EFFECTS.find((e) => e.matches(outputRefs));
  if (effect === undefined) return {};
  return (await effect.apply(db, withTransaction, outputRefs, decision)) ?? {};
}

/**
 * Ejecuta el efecto de dominio de la rama de RECHAZO de este step, si su artefacto tiene uno (T5.5c: solo
 * CP4 — rechazar una variante en QA la marca `rejected`). Se llama DENTRO de la misma tx que la transición
 * `reject` del checkpoint (el `db` que recibe ES la tx): el status de la variante y la transición del step
 * commitean juntos o nada — el mismo invariante de atomicidad que `applyDomainEffect`. Un step SIN efecto
 * de rechazo (CP1/CP2/CP3, o un checkpoint de demo) es un NO-OP legítimo: la mayoría de los rechazos solo
 * mueven el step a `rejected` sin tocar el dominio.
 */
export async function applyDomainEffectOnReject(db: Db, outputRefs: unknown): Promise<void> {
  const effect = EFFECTS.find((e) => e.matches(outputRefs));
  if (effect?.rejectApply === undefined) return;
  await effect.rejectApply(db, outputRefs);
}
