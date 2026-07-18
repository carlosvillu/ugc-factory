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
import { FalResponseError, LoserRaceError } from '@ugc/core/generation';

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

/**
 * ENVOLTORIO DE CLASIFICACIÓN DE ERRORES de una llamada a un servicio de generación N7 (MONEY POINT
 * T4.11, deuda T4.10a). Los servicios (`runGenerate*`) lanzan una taxonomía tipada; el consumer de
 * steps (`step-execute.ts`) solo trata `PermanentStepError` como NO-retry. Este helper traduce esa
 * taxonomía al criterio de dinero — ¿reintentarlo produce el MISMO fallo determinista (→ Permanent, no
 * re-paga) o es transitorio/deduplicable (→ retryable)?:
 *
 *   · `LoserRaceError` (carrera perdedora de dedup): REINTENTABLE — se DEJA SUBIR tal cual. En el
 *     reintento el ganador ya está `completed` y el loser deduplica a su asset (0 submits, 0 coste). Se
 *     comprueba ANTES que `FalResponseError` porque es SUBCLASE suya. NUNCA se envuelve en Permanent
 *     (eso lo mandaría a `failed` en vez de deduplicar → rompería «nº de generations = hooks+body+CTA»).
 *   · Cualquier OTRO `FalResponseError` (output sin `video`/`audio`, invariante `assetId===null` roto,
 *     model_profile inexistente, kind incorrecto): VIOLACIÓN DE CONTRATO/CONFIG de una generación ya
 *     completada o de un cableado fijo → DETERMINISTA → `PermanentStepError` (sin retry, sin RE-PAGO a
 *     fal del output malformado — el money-burn T1.10a). Antes subía como throw normal ⇒ `failStep` ⇒
 *     retry ⇒ re-submit ⇒ re-pago de una generación determinísticamente rota.
 *   · `FalProviderError` (429/timeout/red) y cualquier otro error: se DEJA SUBIR tal cual —
 *     transitorio, otra vuelta tiene posibilidad real de ir bien (retryable vía `failStep`).
 *
 * `preserveMessage` conserva el mensaje original del servicio (los outputs malformados llevan el
 * `JSON.stringify` del payload — evidencia que el visor de logs necesita entera, lección T1.16).
 */
export async function runGenerationStep<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // `LoserRaceError` es subclase de `FalResponseError`: se cría ANTES para dejarla subir retryable.
    if (err instanceof LoserRaceError) throw err;
    if (err instanceof FalResponseError) {
      throw new PermanentStepError(err.message);
    }
    throw err;
  }
}
