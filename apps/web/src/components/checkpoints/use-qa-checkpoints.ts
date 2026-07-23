'use client';

// ¿QUÉ VARIANTES ESTÁN ESPERANDO REVISIÓN DE QA? (CP4, T5.6)
//
// CP4 NO es como CP1/CP2/CP3, y esta es la diferencia ESTRUCTURAL que reencuadra la tarea. En el
// DAG de generación, N9 se expande POR VARIANTE (`generation-dag.ts`: un nodo N9 con
// `checkpointConfig.alwaysPause:true` por cada variante `scripted`), y cada N9 lleva SU `variantId`.
// En un run con N variantes, N steps N9 pausan en `waiting_approval` A LA VEZ. `usePausedCheckpoint`
// (CP1/CP2/CP3) toma solo `paused[0]` porque en el run de análisis NUNCA hay dos pausados a la vez;
// aquí eso sería un bug silencioso — enseñaría UNA variante y las demás quedarían invisibles y sin
// resolver. Así que este hook recoge TODOS los N9 pausados, no el primero.
//
// CÓMO SE DISCRIMINA. Un N9 pausado es un step `waiting_approval` + `isCheckpoint` + `nodeKey==='N9'`
// + con `variantId`. La forma del artefacto (`N9OutputSchema`) la valida el PANEL cuando pide el step
// entero por `getStep` (el `outputExcerpt` del SSE va recortado a 200 caracteres y no sirve para el
// `qaReport`); aquí basta la proyección del store para LISTAR las variantes que esperan. Se ordena por
// id (ULID ⇒ cronológico) para que la lista sea DETERMINISTA entre renders.
//
// POR QUÉ `nodeKey==='N9'` Y NO SOLO `isCheckpoint` (deliberado, no un olvido de la convención T0.8):
// TODOS los sub-steps del DAG de generación (N6/N7a-f/N8/N9) llevan `variantId`, así que `variantId!==null`
// no discrimina el checkpoint; y `isCheckpoint` genérico sería MÁS laxo, no más estricto — si mañana el
// DAG de generación gana OTRO checkpoint per-variante, `isCheckpoint && variantId` lo mezclaría con CP4 y
// el panel intentaría pintar un checkpoint no-QA como QA. `nodeKey==='N9'` es el proxy INTENCIONADO del
// check por schema que aquí no cabe (excerpt recortado): más estrecho, y sigue discriminando si se añade
// otro checkpoint. (T0.8 rige el DISPATCH del efecto por forma en servidor —lo hacen approve/reject—, no
// un listado de solo-lectura en cliente; N9 es hoy el único checkpoint del DAG de generación.)
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useRunStore } from '@/stores/run-store';

/** Una variante de CP4 esperando revisión: su step N9 pausado + el `variantId` (del snapshot del step). */
export interface QaCheckpointStep {
  /** El step N9 en `waiting_approval`: a él van approve/reject (planos — el efecto per-variante lo
   *  pone el servidor por la forma del artefacto, T5.5c). */
  stepId: string;
  /** La variante cuyo máster se revisa. Sale del snapshot del step (`step_run.variant_id`). */
  variantId: string;
}

/**
 * TODOS los steps N9 pausados del run, como lista de variantes a revisar. `[]` cuando no hay ninguno
 * (CP4 no está activo). NO reutiliza `usePausedCheckpoint` (que colapsa a uno solo).
 *
 * Se subscribe al MAPA `s.steps` (referencia estable con `useShallow`, como el canvas) y deriva la
 * lista con `useMemo` FUERA del selector: un selector que devolviera un array nuevo en cada render
 * dispararía un bucle de re-render (la igualdad por defecto de Zustand es `Object.is`).
 */
export function useQaCheckpoints(): QaCheckpointStep[] {
  const steps = useRunStore(useShallow((s) => s.steps));
  return useMemo(() => {
    const paused: QaCheckpointStep[] = [];
    for (const st of Object.values(steps)) {
      if (
        st.isCheckpoint &&
        st.status === 'waiting_approval' &&
        st.nodeKey === 'N9' &&
        st.variantId !== null
      ) {
        paused.push({ stepId: st.id, variantId: st.variantId });
      }
    }
    return paused.sort((a, b) => a.stepId.localeCompare(b.stepId));
  }, [steps]);
}
