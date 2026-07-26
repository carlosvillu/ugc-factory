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
import { FalProviderError, FalResponseError, LoserRaceError } from '@ugc/core/generation';
import { ModelCapabilitiesSchema, type ModelCapabilities } from '@ugc/core/gallery';

/**
 * Status HTTP de `FalProviderError` que son PERMANENTES respecto al step (T5.16, MONEY POINT): un
 * reintento re-submitea el MISMO payload (la `config` del step es INMUTABLE entre vueltas de pg-boss) y
 * fal lo rechaza IGUAL → re-pago garantizado de un fallo determinista. Son fallos que NO se arreglan en la
 * vuelta siguiente sino que exigen intervención HUMANA (recargar saldo, revisar la fal-key en Ajustes,
 * corregir el input inválido):
 *   · 401 — credencial revocada/ausente: la key no cambia reintentando.
 *   · 403 — «User is locked. Reason: Exhausted balance.» (el bug real: N7b re-submiteó 80 veces un 403 de
 *     saldo agotado, cada submit facturado). El saldo no se recarga solo reintentando.
 *   · 422 — unprocessable entity (p.ej. voiceId inválido): la `config` es la misma en cada vuelta, así que
 *     fal re-valida el MISMO payload y lo rechaza IGUAL. Es la MISMA lógica «VIOLACIÓN DE CONFIG
 *     DETERMINISTA» que ya aplica `FalResponseError` a un output roto — decisión T5.16 (ver informe): el
 *     contra-argumento «un 422 podría ser un hipo transitorio de validación upstream» es especulativo y no
 *     es lo observado; reintentar un input inválido solo quema dinero para fallar igual.
 *
 * NO están aquí (siguen RETRYABLE a propósito):
 *   · 429 — rate limit: transitorio; conserva su retry-once con `Retry-After` (fal-client.ts) y otra vuelta
 *     tiene posibilidad REAL de pasar. Colapsarlo en permanente mataría un step que un reintento habría
 *     completado.
 *   · `status === undefined` (timeout/red) — transitorio de verdad: la request ni llegó.
 *   · Cualquier OTRO status (5xx, 4xx no listado): fail-SAFE hacia retryable — un status desconocido se
 *     trata como transitorio (peor caso: un reintento de más), NUNCA como permanente silencioso.
 *
 * Es la MISMA distinción por TIPO/estado que T5.11 aplicó a N5 y T4.11 a la taxonomía loser-race vs
 * contract-violation: clasificar por la naturaleza del fallo (permanente vs transitorio), no por el nodo.
 */
const FAL_PERMANENT_STATUSES: ReadonlySet<number> = new Set([401, 403, 422]);

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
 *   · `FalProviderError` con status PERMANENTE (401/403/422, T5.16): `PermanentStepError`. Un 403 «saldo
 *     agotado» o un 401 «clave revocada» NO se arregla reintentando — cada re-submit se FACTURA (fal cobra
 *     el ENVÍO). El bug real: N7b re-submiteó 80 veces un 403 porque TODO `FalProviderError` subía
 *     retryable, agrupando el saldo-agotado permanente con el timeout transitorio. Ahora se CLASIFICA por
 *     status (`FAL_PERMANENT_STATUSES`) → el permanente va a `failed` terminal en 1 submit, sin re-pago.
 *   · Cualquier OTRO `FalProviderError` (429 rate-limit, timeout/red sin status, 5xx, 4xx no listado) y
 *     cualquier otro error: se DEJA SUBIR tal cual — transitorio, otra vuelta tiene posibilidad real de ir
 *     bien (retryable vía `failStep`). Fail-SAFE: un status desconocido se queda retryable, NO permanente.
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
    // T5.16 — CLASIFICACIÓN POR STATUS del fallo de proveedor. `FalProviderError` NO es subclase de
    // `FalResponseError` (extiende `Error` directo), así que este check es independiente del anterior y su
    // orden no importa. Un 403/401/422 es DETERMINISTA (saldo/credencial/input inválido: reintentar
    // re-paga para fallar igual) → Permanent con mensaje ACCIONABLE (mismo estilo que `resolveFalKeyOrPermanent`,
    // el humano resuelve en Ajustes → fal antes de re-disparar). El 429/timeout/red y todo lo demás sigue
    // cayendo al `throw err` de abajo (retryable).
    if (
      err instanceof FalProviderError &&
      err.status !== undefined &&
      FAL_PERMANENT_STATUSES.has(err.status)
    ) {
      // T5.17: propaga `status` y `detail` (el body de fal, ya normalizado) al `PermanentStepError` para que
      // lleguen SEPARADOS a `step_run.error` (step-execute.ts). El mensaje accionable pide DISCRIMINAR
      // saldo/credencial/input; el `detail` («User is locked. Reason: Exhausted balance.») es la pista que lo
      // permite. Se leen los CAMPOS TIPADOS de `FalProviderError` (NO se regex-parsea el mensaje: la trampa
      // T1.8 de reimplementar la detección por substring). El mensaje también incluye el detail para el visor
      // de logs (T1.16), pero la persistencia estructurada es lo que el operador consulta.
      throw new PermanentStepError(
        `Fallo PERMANENTE del proveedor (fal, HTTP ${String(err.status)}): ${err.message}. ` +
          (err.detail !== undefined ? `Causa (fal): ${err.detail}. ` : '') +
          `No se reintenta (cada envío se factura). Resuélvelo en Ajustes → fal (recarga saldo si es "balance"/403, ` +
          `revisa la fal-key si es credencial/401, corrige el input si es validación/422) y re-dispara el run.`,
        { status: err.status, detail: err.detail },
      );
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
