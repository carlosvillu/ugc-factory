'use client';

// ¿QUÉ CHECKPOINT ESTÁ PAUSADO, Y QUÉ ARTEFACTO TIENE DELANTE? (T2.3 — extraído de
// `use-brief-checkpoint`, que lo inventó en T1.10b y lo explica entero).
//
// POR QUÉ SE EXTRAE AHORA Y NO ANTES. Con UN checkpoint real (CP1) esto era un hook y su
// justificación. Con DOS (CP1 · brief, CP2 · matriz) es un PATRÓN, y copiarlo habría duplicado sus
// tres decisiones difíciles —discriminar por la FORMA del artefacto y no por `node_key`; pedir el
// step ENTERO por REST porque el excerpt del SSE va recortado a 200 caracteres; no escribir estado
// para descartar un hallazgo de otro step— en dos sitios que tendrían que corregirse a la vez. Es
// el criterio de extracción de la skill (`components.md` §4: repetición REAL, 2+).
//
// LO QUE NO CAMBIA (y es la parte que importa): en la duda, NO se secuestra la UI de nadie. Mientras
// no haya CONFIRMACIÓN de que el artefacto es del tipo que el llamante espera, devuelve `null` y el
// usuario se queda con el panel genérico del canvas.
import { useEffect, useState } from 'react';
import { runActions } from '@/lib/api-client';
import { useRunStore } from '@/stores/run-store';

/** El primer checkpoint PAUSADO del run, si lo hay. Es solo el CANDIDATO: qué checkpoint es lo
 *  decide su ARTEFACTO, no esto. Se ordena por id para que el ganador sea DETERMINISTA (un
 *  `.find()` sobre el store no lo era) — y por `isCheckpoint`, nunca por `node_key` (que no
 *  identifica una fila tras un supersede, T0.8).
 *
 *  Con dos checkpoints en el DAG (N3 · CP1 y N4 · CP2) NO hay ambigüedad: N4 depende de N3, así que
 *  mientras CP1 está pausado, N4 está en `awaiting_deps` — nunca hay dos pausados a la vez en el
 *  run de análisis. Si algún día los hubiera, el orden por id (ULID ⇒ cronológico) elige el
 *  primero, que es el que bloquea al otro. */
function usePausedCheckpointId(): string | null {
  return useRunStore((s) => {
    const paused = Object.values(s.steps)
      .filter((st) => st.isCheckpoint && st.status === 'waiting_approval')
      .sort((a, b) => a.id.localeCompare(b.id));
    return paused[0]?.id ?? null;
  });
}

/**
 * El checkpoint pausado cuyo artefacto RECONOCE `parse`, o `null`.
 *
 * `parse` recibe el `output_refs` ENTERO del step (pedido por REST: el excerpt del SSE va recortado
 * a 200 caracteres y no sirve ni para parsear ni —desde luego— para editar) y devuelve lo que su
 * panel necesita, o `null` si el artefacto no es suyo. Esa función ES la discriminación: la FORMA
 * del artefacto, el mismo criterio que usa el servidor (`server/domain-effects.ts`).
 *
 * `parse` debe ser ESTABLE entre renders (definida a nivel de módulo, no inline): entra en las deps
 * del effect, y una función nueva en cada render volvería a pedir el step en bucle.
 */
export function usePausedCheckpoint<T>(
  parse: (outputRefs: unknown) => T | null,
): (T & { stepId: string }) | null {
  const stepId = usePausedCheckpointId();
  // El hallazgo se guarda JUNTO al step que lo produjo, en vez de resetearse al principio del
  // effect: un `setState` síncrono dentro de un effect dispara renders en cascada (y el linter lo
  // veta con razón). Al llevar el `stepId` dentro, el RENDER decide si lo que tiene en la mano
  // sigue siendo válido — sin escribir estado para descartarlo.
  const [found, setFound] = useState<(T & { stepId: string }) | null>(null);

  useEffect(() => {
    if (stepId === null) return;
    let cancelled = false;
    runActions
      .getStep(stepId)
      .then((step) => {
        if (cancelled) return;
        const parsed = parse(step.outputRefs);
        // Solo se ESCRIBE cuando hay artefacto confirmado. Un `null` no hace falta persistirlo: la
        // comparación de abajo ya descarta lo que no sea de este step.
        if (parsed !== null) setFound({ stepId, ...parsed });
      })
      .catch(() => {
        // No se pudo leer el artefacto: NO se abre el panel especializado. El panel genérico sigue
        // ahí y el usuario conserva las acciones del checkpoint (aprobar/rechazar en crudo) —
        // degradar es mucho mejor que dejarle una pantalla de error sin salida.
      });
    return () => {
      cancelled = true;
    };
  }, [stepId, parse]);

  // El hallazgo solo vale si es DE ESTE step: si el step pausado cambió (o dejó de haberlo, o
  // resultó no ser del tipo esperado), lo que tenemos guardado es de otro momento del run y NO se
  // muestra.
  return found !== null && found.stepId === stepId ? found : null;
}
