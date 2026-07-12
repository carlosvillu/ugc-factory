// Repo del agregado `checkpoint_decision` (T1.11; db.md §4: una función por caso de uso con el
// executor Drizzle como PRIMER argumento — mismo patrón que brief.repo/spend.repo).
//
// El CANAL GENÉRICO de la decisión de un checkpoint: dos casos de uso, escribir la decisión que
// acompaña a una aprobación (`recordCheckpointDecision`) y leerla por step
// (`findCheckpointDecision`, que es lo que N7a/T4.4 necesita para saber si genera un packshot-IA
// o usa fotos reales). El porqué de la tabla —y de que NO sea `audit_log` ni `output_refs`— está
// en la cabecera de la tabla (`schema/pipeline.ts`).
//
// El executor es un `Db` (conexión O TRANSACCIÓN) porque la escritura corre DENTRO de la misma
// transacción que la transición del checkpoint (`withDomainTransaction`): la decisión y la
// aprobación commitean juntas o no commitea ninguna.
import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import {
  checkpointDecision,
  type CheckpointDecision as CheckpointDecisionRow,
} from '../schema/pipeline';

/**
 * Persiste la decisión del humano en un checkpoint. `decision` es jsonb OPACO para la BD (su
 * forma la valida el contrato de core en la frontera HTTP, igual que con `output_refs`).
 *
 * Devuelve `false` si YA HABÍA una decisión para ese step (el INSERT no escribió nada).
 *
 * QUÉ SIGNIFICA UN CONFLICTO AQUÍ, Y POR QUÉ NO SE SOBRESCRIBE (code-review de T1.11). El
 * `step_run_id` es UNIQUE y un step se aprueba UNA vez: tras la transición ya no está en
 * `waiting_approval` y un segundo POST da 409. O sea que un conflicto en esta tabla NO es una
 * carrera benigna — es la señal de que DOS aprobaciones del MISMO step COMMITEARON, es decir, de
 * que la guardia de estado del orquestador falló. Y esta decisión alimenta a N7a (T4.4), que
 * gasta dinero real en fal.ai: un estado inconsistente que nadie ve es peor que un fallo ruidoso.
 *
 * Tres salidas posibles y por qué esta:
 *  - `DO UPDATE` (lo que había): sobrescribe EN SILENCIO y el sistema sigue como si nada. Es
 *    justo lo que no se puede hacer con la señal de un invariante roto.
 *  - dejar reventar (23505 → 500): rompería la transacción y con ella una aprobación que el
 *    orquestador SÍ pudo hacer — deshacer una transición legítima por un fallo de bookkeeping.
 *  - `DO NOTHING` + el caller GRITA (esto): la PRIMERA decisión gana (es sobre la que commiteó la
 *    transición; una segunda no tiene por qué ser "más verdad"), el dato queda consistente, y el
 *    `false` obliga al caller a decidir qué hacer con la anomalía. `apps/web` la loguea a nivel
 *    ERROR (ver `server/checkpoint-decision.ts`): `packages/db` no tiene logger —es persistencia
 *    pura— y no se lo va a inventar por esto; el repo dice LA VERDAD (¿escribió o no?) y quien
 *    tiene observabilidad decide cuánto ruido hace.
 */
export async function recordCheckpointDecision(
  db: Db,
  input: { stepRunId: string; kind: string; decision: unknown },
): Promise<boolean> {
  const inserted = await db
    .insert(checkpointDecision)
    .values({
      stepRunId: input.stepRunId,
      kind: input.kind,
      decision: input.decision,
    })
    .onConflictDoNothing({ target: checkpointDecision.stepRunId })
    .returning({ id: checkpointDecision.id });
  return inserted.length > 0;
}

/**
 * La decisión que el humano tomó en ESE step, o `undefined` si no tomó ninguna (la rama URL de
 * CP1 no necesita decidir nada: se aprueba y ya). Lectura POR CLAVE — es justo lo que `audit_log`
 * no sabe hacer bien y por lo que esta tabla existe.
 *
 * El consumidor real es N7a (T4.4): mira la decisión del checkpoint del que depende para saber si
 * genera el packshot con IA o usa las fotos reales del producto.
 */
export async function findCheckpointDecision(
  db: Db,
  stepRunId: string,
): Promise<CheckpointDecisionRow | undefined> {
  const rows = await db
    .select()
    .from(checkpointDecision)
    .where(eq(checkpointDecision.stepRunId, stepRunId))
    .limit(1);
  return rows[0];
}
