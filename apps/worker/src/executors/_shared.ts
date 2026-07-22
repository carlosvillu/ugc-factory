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
import { AppError } from '@ugc/core/contracts';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { FalResponseError, LoserRaceError } from '@ugc/core/generation';
import { ModelCapabilitiesSchema, type ModelCapabilities } from '@ugc/core/gallery';

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

/**
 * Resuelve la fal-key del step de `app_setting` (thunk async del composition root) y traduce el fallo de
 * credencial a `PermanentStepError`. Un `provider_error` de `loadFalKey` (no hay key configurada / no
 * descifra) es DETERMINISTA respecto al step: reintentar NO configura la key — el retry inmediato solo
 * quemaría `max_retries` en milisegundos para acabar igual en `failed`. Se falla LIMPIO y terminal con
 * mensaje ACCIONABLE (Ajustes → fal); el humano reconfigura y re-dispara el run. La resolución corre
 * ANTES de cualquier submit, así que un secret ausente no deja gasto huérfano. Cualquier otro error
 * (BD caída) sube tal cual → retryable (infra transitoria).
 */
export async function resolveFalKeyOrPermanent(
  falKey: () => Promise<string>,
  nodeLabel: string,
): Promise<string> {
  try {
    return await falKey();
  } catch (err) {
    if (err instanceof AppError && err.code === 'provider_error') {
      throw new PermanentStepError(`${nodeLabel}: ${err.message}`);
    }
    throw err;
  }
}

/** El resultado de `resolveVideoModelCaps`: las capabilities YA validadas del modelo de vídeo, con
 *  `durations` y `maxDuration` ya comprobados no-vacío/coherentes (por eso NO son opcionales aquí, al
 *  contrario que en `ModelCapabilities`). El caller los pasa a `planGeneration`/`quantizeDurationToEnum`
 *  sin re-chequear. */
export interface ResolvedVideoModelCaps {
  caps: ModelCapabilities;
  durations: number[];
  maxDuration: number;
}

/**
 * GUARD DE CATÁLOGO COMPARTIDO de los executors de vídeo por-segundo (N7d b-roll, N7f clip de CTA):
 * valida las `capabilities` del `model_profile` ANTES de gastar y devuelve `caps`/`durations`/
 * `maxDuration` ya comprobados. Extrae el bloque que N7d y N7f duplicaban byte-a-byte (salvo el label del
 * nodo y el endpoint) — la MISMA defensa de dinero en DOS executors de producción (deuda de reuso T5.5a).
 *
 * MONEY-GATE (todos los checks abortan con `PermanentStepError` — reintentar no re-siembra el catálogo):
 *   1. `capabilities` es jsonb OPACO al salir de la BD → se VALIDA (no se castea). Shape inválido = bug
 *      de datos permanente (galería mal sembrada).
 *   2. `aspect`/`resolution` DEBEN estar en los enums que el modelo declara: un valor no soportado haría
 *      que fal rechace la request y queme dinero. Data-driven (lee los enums del perfil), no hardcodeado.
 *   3. `durations` presente y no vacío (sin enum de duración no se puede cuantizar el clip).
 *   4. INVARIANTE `maxDuration === max(durations)`: el troceo §7.5 usa `maxDuration` (`planGeneration`) y
 *      la cuantización usa `durations` (`quantizeDurationToEnum`) — DOS fuentes de verdad de duración que
 *      DEBEN coincidir; si divergen (o falta `maxDuration` con `durations` presente), una escena larga se
 *      facturaría por debajo de su ventana (clamp silencioso, ledger deshonesto).
 *
 * `nodeLabel` (`'N7d'`/`'N7f'`) y `endpoint` (el `falEndpoint` del perfil) entran en los mensajes de
 * error — así N7d conserva su semántica de mensajes exacta y N7f nombra su propio nodo/endpoint.
 */
export function resolveVideoModelCaps(
  rawCapabilities: unknown,
  input: { aspect: string; resolution: string },
  nodeLabel: string,
  endpoint: string,
): ResolvedVideoModelCaps {
  const capsParsed = ModelCapabilitiesSchema.safeParse(rawCapabilities);
  if (!capsParsed.success) {
    throw new PermanentStepError(
      `${nodeLabel}: capabilities inválidas en ${endpoint}: ${capsParsed.error.message}`,
    );
  }
  const caps = capsParsed.data;

  if (caps.aspects !== undefined && !caps.aspects.includes(input.aspect)) {
    throw new PermanentStepError(
      `${nodeLabel}: el aspect "${input.aspect}" no está en aspects=[${caps.aspects.join(', ')}] de ${endpoint}`,
    );
  }
  if (caps.resolutions !== undefined && !caps.resolutions.includes(input.resolution)) {
    throw new PermanentStepError(
      `${nodeLabel}: la resolución "${input.resolution}" no está en resolutions=[${caps.resolutions.join(', ')}] de ${endpoint}`,
    );
  }
  const durations = caps.durations;
  if (durations === undefined || durations.length === 0) {
    throw new PermanentStepError(
      `${nodeLabel}: el model_profile ${endpoint} no declara capabilities.durations (enum de duración): no se puede cuantizar el clip`,
    );
  }
  const maxDuration = caps.maxDuration;
  if (maxDuration === undefined) {
    throw new PermanentStepError(
      `${nodeLabel}: el model_profile ${endpoint} declara durations=[${durations.join(', ')}] pero no maxDuration: el troceo §7.5 no topa la duración → clamp silencioso. Siembra maxDuration = max(durations).`,
    );
  }
  const maxAllowedDuration = Math.max(...durations);
  if (maxDuration !== maxAllowedDuration) {
    throw new PermanentStepError(
      `${nodeLabel}: incoherencia de catálogo en ${endpoint}: maxDuration=${String(maxDuration)} pero max(durations)=${String(maxAllowedDuration)} (durations=[${durations.join(', ')}]). El troceo y la cuantización usan fuentes distintas y deben coincidir — corrige el seed.`,
    );
  }

  return { caps, durations, maxDuration };
}
