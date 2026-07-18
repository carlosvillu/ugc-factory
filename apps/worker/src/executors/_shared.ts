// HELPERS COMPARTIDOS de los executors de generación (T4.11, deuda T4.8c). Extrae el guard de
// `collectOutput` que N7a-N7e duplicaban byte-a-byte salvo el string del label del nodo.
//
// SEMÁNTICA «collectOutput obligatorio, stepId opcional» (N7a-N7e): el canal de salida
// (`collectOutput`) SIEMPRE lo inyecta el consumer en producción — sin él, el nodo pagaría fal/Anthropic
// y terminaría con `output_refs` vacío (un bug de CABLEADO, no un caso a tolerar). El `stepId` es
// OPCIONAL a propósito: estos nodos corren STEPLESS en el smoke del verifier (sin step_run), y el
// servicio propaga el `stepId` solo si está (atribución del `cost_entry`).
//
// N5 (`write-scripts.ts`) NO usa este helper: su semántica DIVERGE (exige `stepId` Y `collectOutput`
// no-undefined, y devuelve `stepId: string` no-opcional — CP3 abriría sobre un lote sin guiones si
// faltara el step). Fundir esa semántica distinta en un helper parametrizado ensuciaría ambos lados
// (un flag `requireStepId` que solo N5 activa), así que N5 conserva su propio guard local. El coste de
// no fusionarlo es una copia; el coste de fusionarlo sería un helper con dos modos — la copia es más
// honesta (mismo criterio del brief: no forzar una abstracción que fusione semánticas distintas).
import { PermanentStepError } from '@ugc/core/orchestrator';

/** El contexto mínimo que `requireOutputContext` inspecciona. Acepta campos extra (p.ej. `deps` de
 *  N7a) por estructura — solo lee `collectOutput`/`stepId`. */
export interface OutputContext {
  collectOutput?: (outputRefs: unknown) => void;
  stepId?: string;
}

/**
 * Guard de cableado de N7a-N7e: exige `collectOutput` (el canal de salida obligatorio) y devuelve
 * `stepId` tal cual (opcional). Sin `collectOutput` LANZA `PermanentStepError` nombrando el nodo
 * (`nodeLabel`, p.ej. `'N7c'`) — reintentarlo no cablea el canal que falta.
 */
export function requireOutputContext(
  ctx: OutputContext,
  nodeLabel: string,
): { collectOutput: (outputRefs: unknown) => void; stepId: string | undefined } {
  const { collectOutput, stepId } = ctx;
  if (collectOutput === undefined) {
    throw new PermanentStepError(
      `${nodeLabel}: el ExecutorContext no trae collectOutput (bug de cableado)`,
    );
  }
  return { collectOutput, stepId };
}
