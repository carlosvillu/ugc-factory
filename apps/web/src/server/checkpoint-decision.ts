// EL CANAL DE DECISIONES del checkpoint (T1.11): el efecto de dominio "persistir lo que el humano
// DECIDIÓ" que acompaña a la aprobación (o a la edición-y-aprobación) de un checkpoint.
//
// POR QUÉ VIVE AQUÍ Y NO EN CORE — exactamente el mismo argumento que `brief-checkpoint.ts`:
// `approveStep`/`editStep` son operaciones GENÉRICAS del orquestador (mueven estados, invalidan
// sub-grafos, auditan diffs) y no saben —ni deben saber— qué es una decisión de producto. El
// efecto se COMPONE fuera, en el route handler, DENTRO de la misma transacción
// (`withDomainTransaction`): la decisión y la transición commitean juntas o no commitea ninguna.
// Si la transición falla (doble clic, run cancelado entre medias, step ya no en
// `waiting_approval`), la decisión NO queda persistida — sería una decisión sobre una aprobación
// que nunca ocurrió, y el consumidor (N7a, T4.4) la leería como si el humano hubiese elegido.
//
// GENÉRICO DE VERDAD: este módulo no sabe qué decide CP1. Recibe la decisión ya validada contra
// `CheckpointDecisionSchema` (unión discriminada por `kind`, core) y la persiste con su `kind`.
// CP2/CP3/CP4 añaden su miembro a esa unión y pasan por aquí sin tocar una línea de esto.
import type { CheckpointDecision } from '@ugc/core/contracts';
import { recordCheckpointDecision, type Db } from '@ugc/db';
import { getRequestLogger } from './request-context';

/**
 * Persiste la decisión del checkpoint, si el body traía una. NO-OP cuando no la trae: la mayoría
 * de las aprobaciones no deciden nada (la rama URL de CP1 no necesita elegir entre subir fotos y
 * generar un packshot — su brief ya tiene imágenes), y una fila vacía "por si acaso" sería ruido
 * que el consumidor tendría que aprender a ignorar.
 */
export async function persistCheckpointDecision(
  db: Db,
  stepId: string,
  decision: CheckpointDecision | undefined,
): Promise<void> {
  if (decision === undefined) return;
  // `kind` sube a columna (es la clave por la que el consumidor discrimina); el objeto entero se
  // guarda en `decision` — incluido su `kind`, que es lo que lo hace re-parseable contra el
  // contrato de core sin recomponerlo a mano.
  const inserted = await recordCheckpointDecision(db, {
    stepRunId: stepId,
    kind: decision.kind,
    decision,
  });

  // AQUÍ SE GRITA. Que ya hubiera una decisión para este step significa que DOS aprobaciones del
  // MISMO step commitearon — el step se aprueba UNA vez (tras la transición ya no está en
  // `waiting_approval`; un segundo POST da 409), así que esto es la señal de que la guardia de
  // estado del orquestador falló. La primera decisión GANA (es sobre la que commiteó la
  // transición), pero el evento NO se traga: esta decisión alimenta a N7a (T4.4), que gasta
  // dinero real en fal.ai, y un invariante roto que nadie ve es peor que un error ruidoso.
  //
  // No se lanza: la transición ya ocurrió y tumbar la tx desharía una aprobación legítima por un
  // fallo de bookkeeping. Se registra a nivel ERROR y el dato queda consistente.
  if (!inserted) {
    getRequestLogger().error(
      { step_id: stepId, decision_kind: decision.kind },
      'INVARIANTE ROTO: el step ya tenía una decisión de checkpoint (¿dos aprobaciones del mismo ' +
        'step commitearon?). Se CONSERVA la primera; la nueva se descarta',
    );
  }
}
