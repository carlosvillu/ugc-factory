// `reconcileGeneration` (T4.3, §6.3.9, §9.6): la PRIMITIVA ÚNICA de resume-sin-resubmit de una
// generación de fal. Dada UNA fila `generation` con sus deps inyectadas, decide qué hacer según su
// estado y NUNCA re-submitea (fal no documenta clave de idempotencia en `queue.submit`: re-submitir
// puede crear un 2º job facturable = doble cobro). El submit vive SOLO en `runGenerate`/
// `submitGenerationForWebhook` (T4.1), que persisten `submitting` ANTES del submit y estampan
// `request_id`/`status_url` después. Reconcile es READ-ONLY-a-fal salvo sus escrituras de
// enqueue-finalize / expire.
//
// DOS triggers cablean esta misma primitiva (NO dos poll loops):
//   1. El SWEEPER del worker (durable, load-bearing): cada tick lista las generaciones reconciliables
//      y llama a `reconcileGeneration` por fila. Es lo que "matar el worker y reiniciar" reanuda.
//   2. Un poller lazy en read-path (cuando exista una superficie de lectura de generación no-terminal;
//      hoy NO existe — llega con T4.11 —, así que el trigger productivo es el sweeper).
//
// RAMAS por estado (§9.6):
//   · `submitted`/`in_queue` (tiene `status_url`+`response_url`): POLLEA el `status_url` PERSISTIDO
//     (nunca reconstruido). Si fal reporta COMPLETED → persiste el output en `fal_status_payload` en
//     forma WEBHOOK-COMPATIBLE (`{status:'OK', payload, request_id}`) + marca `in_progress` + ENCOLA
//     `output.download` (el consumer de T4.2 ya finaliza idempotentemente vía `finalizeGeneration`
//     con FOR UPDATE). NO finaliza ni descarga inline (cientos de MB fuera de un tick). Si sigue
//     procesando → no-op (el próximo tick re-chequea) SALVO que lleve colgada más que el deadline por
//     tipo → `failed` (expira). NUNCA re-submit.
//   · `submitting` (SIN `request_id` — crash entre INSERT y submit): NO se puede pollear (no hay URL)
//     NI re-submitir con seguridad → EXPIRA POR EDAD (`failed` si supera el umbral). NUNCA
//     auto-resubmit. (Recoge la deuda #1 de T4.1/T4.2 sobre la fila `submitting` colgada.)
//   · `in_progress` (RECONCILIABLE CON SUB-LÓGICA — NO se pollea fal, NO se marca estado): `in_progress`
//     significa "descarga ya encolada" (lo dejó reconcile o el WEBHOOK de T4.2 — misma laguna, mismo
//     fix). Sin recuperación, `in_progress` sería un AGUJERO NEGRO: si el enqueue falló tras el claim,
//     o si el job `output.download` agotó sus reintentos (URL de output efímera → 403), la fila queda
//     colgada PARA SIEMPRE con gasto de fal sin capturar. Por eso el sweeper SÍ la re-lista y, si lleva
//     en `in_progress` más que `inProgressMs` (deadline de descarga) sin completar → RE-ENCOLA
//     `output.download` (idempotente). El re-encolado es un WRITE GUARDADO (`WHERE status='in_progress'`)
//     que refresca `updatedAt` → resetea el reloj → reintentos espaciados `inProgressMs` (NO uno por
//     tick). Y si supera un TOPE de edad terminal (`inProgressMaxAgeMs`) → `failed` (corta el goteo de
//     una descarga que nunca va a completar; DEUDA door-2b: un re-encolado NO recupera una URL de output
//     EXPIRADA —el consumer re-lee la URL guardada, no re-pollea fal— así que la captura del gasto
//     huérfano de ese caso queda pendiente, ver informe).
//   · `completed`/`failed`/`cancelled`: no-op (terminal).
//
// IDEMPOTENCIA del enqueue (dinero): dos barreras. (1) El caso NORMAL: en cuanto reconcile marca
// `in_progress`, el claim del camino de poll (guardado por `CLAIM_STATUSES_POLL` = submitting/
// submitted/in_queue) ya no vuelve a tomar efecto sobre esa fila, y el re-encolado de `in_progress`
// solo dispara pasado `inProgressMs` (backoff por `updatedAt`), así que dos ticks seguidos NO encolan
// dos veces. (2) El backstop de correctness: el `SELECT … FOR UPDATE` de
// `finalizeGeneration` serializa dos descargas a 1 solo `cost_entry` + el fast-path del consumer
// no-opea si ya está `completed`. El caso normal NO depende del backstop.
import { FalWebhookPayloadSchema } from './fal-webhook-payload';
import { FalProviderError, FalResponseError, type FalStatusCheck } from './fal-client';
import type { Logger } from '../observability';

/** El subconjunto de la fila `generation` que reconcile necesita LEER para decidir. Es un shape
 *  mínimo (no la fila entera de Drizzle) para que core no dependa de db: el sweeper/worker mapea su
 *  fila a esto. Los estados son los del enum `generation_status` (§12). */
export interface ReconcilableGeneration {
  id: string;
  status: string;
  falRequestId: string | null;
  statusUrl: string | null;
  responseUrl: string | null;
  /** Cuándo se creó la fila (`submitting`): base de la expiración por edad del crash-mid-submit. */
  createdAt: Date;
  /** Cuándo empezó la generación (submit hecho): base de la expiración por tipo del job colgado.
   *  Puede ser null si nunca se estampó; se cae a `createdAt`. */
  startedAt: Date | null;
  /** Cuándo se actualizó la fila por última vez (`$onUpdateFn`). Para una fila `in_progress` es un
   *  proxy de "cuándo se encoló la descarga" (el claim a `in_progress` refrescó `updatedAt`), la base
   *  del deadline de descarga y del backoff del re-encolado. */
  updatedAt: Date;
  /** El perfil del modelo, para elegir el deadline por tipo. Hoy solo hay imagen; la costura queda
   *  abierta para vídeo (minutos) sin un global único. */
  kind: GenerationKind;
}

// T4.11: audio/video/non-image generations are NOT handled here; make this kind-aware before wiring N7b/N7c to the worker
// La reconciliación encola `output.download`, cuyo consumer llama `finalizeGeneration` (SOLO-IMAGEN).
// N7b (T4.5) produce generaciones de AUDIO (`kind='tts_audio'`) y N7c (T4.7) de VÍDEO/AVATAR
// (`kind='avatar_clip'`); si el sweeper las reconcilia y encola aquí, el consumer reventaría con su
// output `{audio:{url}}`/`{video:{url}}`. `GenerationKind` NO incluye `'audio'`/`'video'` aún (bueno,
// `'video'` existe en el tipo pero `resolveKind` defaultea a `'image'`) — la mina es LATENTE porque
// T4.5/T4.7 NO cablean N7b/N7c al DAG (corren stepless vía `runGenerateAudio`/`runGenerateAvatar`
// directo, sin sweeper). T4.11 debe: (1) resolver el kind real (audio/vídeo) de la fila, (2) rutar el
// enqueue a un download kind-aware ANTES de que un caller vivo produzca generaciones no-imagen reconciliables.
/** El "tipo" de generación que fija el deadline de cuelgue. Hoy solo `image`; la costura por-tipo
 *  existe para que vídeo (T4.7/T4.8) traiga su propio deadline (minutos) sin tocar esta lógica. */
export type GenerationKind = 'image' | 'video';

/** El resultado observable de una reconciliación (logs + tests distinguen cada rama). */
export type ReconcileOutcome =
  | 'enqueued_download' // fal COMPLETED → payload persistido + `output.download` encolado
  | 're_enqueued_download' // fila `in_progress` colgada > inProgressMs → `output.download` re-encolado
  | 'still_processing' // fal sigue en cola/progreso y no ha superado el deadline → no-op
  | 'expired' // colgada más que el deadline (o `submitting` sin request_id/`in_progress` sin fin) → failed
  | 'noop'; // estado terminal, o `in_progress` dentro del deadline de descarga: nada que hacer

export interface ReconcileResult {
  outcome: ReconcileOutcome;
  generationId: string;
}

/** UN chequeo de estado de fal (no un poll bloqueante): la primitiva `checkStatus` del FalClient,
 *  que hace UN GET al `status_url` PERSISTIDO y devuelve `completed`/`processing`/`failed`. Reconcile
 *  la llama UNA vez por tick (un sweeper no bloquea un tick esperando a fal). Se declara como puerto
 *  para que los tests inyecten un doble que emite lo que fal REAL emitiría (principio 9). */
export type ReconcileCheckStatus = (handle: {
  statusUrl: string;
  responseUrl: string;
}) => Promise<FalStatusCheck>;

/** El writer CONDICIONAL de la fila `generation` (se inyecta `claimGenerationForReconcile` de db en el
 *  worker; los tests inyectan un doble). Aplica el `patch` SOLO si la fila SIGUE en uno de los
 *  `fromStatuses` que recibe — la revalidación que evita el DOBLE-COBRO por carrera: si otro actor
 *  (webhook + su descarga) sacó la fila de esos estados entre el listado y este write, el claim NO toca
 *  la fila (devuelve `false`) y reconcile NO encola/expira. Cada rama pasa su PROPIO `fromStatuses` (el
 *  camino de poll usa `CLAIM_STATUSES_POLL`; el re-encolado de `in_progress` usa
 *  `CLAIM_STATUSES_IN_PROGRESS`) — nunca un grab-bag compartido. Core NO importa db: recibe la escritura
 *  como dep (respeta los puertos). Devuelve `true` si el claim tomó efecto. */
export type ReconcileUpdate = (
  id: string,
  patch: {
    status?: string;
    falStatusPayload?: unknown;
    completedAt?: Date;
  },
  fromStatuses: readonly string[],
) => Promise<boolean>;

/** El encolado de `output.download` (puerto `JobQueue` del orquestador, cableado al boss real en el
 *  worker). Se pasa una función fina para no acoplar reconcile al registro de jobs. */
export type ReconcileEnqueueDownload = (generationId: string) => Promise<void>;

export interface ReconcileDeps {
  checkStatus: ReconcileCheckStatus;
  updateGeneration: ReconcileUpdate;
  enqueueDownload: ReconcileEnqueueDownload;
  /** `now` inyectable (tests deterministas de la expiración por edad). Default `Date.now`. */
  now?: () => number;
  /** Deadlines por tipo (ms). Default `DEFAULT_RECONCILE_DEADLINES_MS`. */
  deadlines?: ReconcileDeadlines;
  logger: Logger;
}

/** Los deadlines de cuelgue por tipo de generación (ms). Vive AQUÍ el "expirar por tipo" de la
 *  Entrega. Imagen en segundos, vídeo en minutos; `submitting` es la edad máxima de un crash entre
 *  INSERT y submit (independiente del tipo: sin request_id no hay job que esperar). */
export interface ReconcileDeadlines {
  /** Edad máxima de una fila `submitting` sin `request_id` antes de expirarla (crash-mid-submit). */
  submittingMs: number;
  /** Cuánto puede una generación de imagen colgar en cola/progreso antes de expirar. */
  imageMs: number;
  /** Cuánto puede una generación de vídeo colgar (minutos). Costura por-tipo (T4.7/T4.8). */
  videoMs: number;
  /** Deadline de DESCARGA: cuánto puede una fila estar `in_progress` (descarga encolada) sin completar
   *  antes de RE-ENCOLAR `output.download`. Debe ser MAYOR que una descarga normal + los reintentos del
   *  job (`expireInSeconds:900` = 15 min) para no pisar al consumer que trabaja bien. */
  inProgressMs: number;
  /** TOPE de edad terminal de una fila `in_progress`: pasado esto se marca `failed` (corta el goteo de
   *  re-encolados de una descarga que nunca completará — p.ej. URL de output expirada). */
  inProgressMaxAgeMs: number;
}

/** Defaults del "expirar por tipo" (§9.6 "timeout por tipo de job"):
 *   · `submitting` 2 min: un submit tarda segundos; 2 min sin request_id ⇒ el proceso murió a media
 *     llamada. Se expira (NUNCA se re-submitea: fal podría retener el job).
 *   · imagen 10 min: FLUX.2 dev termina en segundos-minuto; 10 min colgada ⇒ el job se perdió en fal.
 *   · vídeo 30 min: los modelos de vídeo tardan minutos; margen amplio (se afinará en T4.7/T4.8).
 *   · `inProgressMs` 20 min: > `expireInSeconds:900` (15 min) del job `output.download` + margen, para
 *     re-encolar SOLO cuando una descarga de verdad falló (enqueue perdido / job agotado), no mientras
 *     el consumer aún trabaja.
 *   · `inProgressMaxAgeMs` 2 h: tope terminal; una fila `in_progress` que lleva 2 h sin completar tiene
 *     una descarga irrecuperable (URL de output expirada) → `failed`, se corta el goteo. */
export const DEFAULT_RECONCILE_DEADLINES_MS: ReconcileDeadlines = {
  submittingMs: 2 * 60_000,
  imageMs: 10 * 60_000,
  videoMs: 30 * 60_000,
  inProgressMs: 20 * 60_000,
  inProgressMaxAgeMs: 2 * 60 * 60_000,
};

/** Los estados que el sweeper/read-path re-listan para reconciliar. INCLUYE `in_progress` (T4.3 fix):
 *  no es terminal ni "ya-resuelto" — una descarga encolada puede haberse perdido (enqueue fallido o
 *  job agotado) y la fila quedaría colgada con gasto de fal sin capturar. La sub-lógica de
 *  `reconcileGeneration` para `in_progress` es distinta (re-encolar por deadline, NO pollear fal).
 *  `listReconcilableGenerations` (db) filtra por esto. */
export const RECONCILABLE_STATUSES = [
  'submitting',
  'submitted',
  'in_queue',
  'in_progress',
] as const;

/** Estados desde los que el CLAIM del camino de POLL (marcar `in_progress`/expirar tras pollear fal)
 *  es válido. Excluye `in_progress` a propósito: una fila que ya está `in_progress` NO debe re-recibir
 *  el claim del poll (evita un re-encolado redundante si el webhook la marcó mientras el sweeper
 *  polleaba). El re-encolado de `in_progress` usa su PROPIO conjunto (`CLAIM_STATUSES_IN_PROGRESS`). */
export const CLAIM_STATUSES_POLL = ['submitting', 'submitted', 'in_queue'] as const;

/** El único estado desde el que el re-encolado de descarga (write guardado que refresca `updatedAt`)
 *  es válido: `in_progress`. Si el claim no toma efecto (un completer la llevó a `completed`), NO se
 *  re-encola. */
export const CLAIM_STATUSES_IN_PROGRESS = ['in_progress'] as const;

function deadlineForKind(kind: GenerationKind, deadlines: ReconcileDeadlines): number {
  return kind === 'video' ? deadlines.videoMs : deadlines.imageMs;
}

/**
 * Reconcilia UNA generación contra fal sin re-submitir jamás. Devuelve el outcome observable. NO
 * lanza por el caso normal (un fallo transitorio de fal en el poll es un no-op: el próximo tick
 * reintenta) — solo propaga un error de contrato (`FalResponseError`) que el caller decide loggear;
 * el sweeper envuelve cada fila en try/catch igual que `sweepExpiredSteps`.
 */
export async function reconcileGeneration(
  deps: ReconcileDeps,
  gen: ReconcilableGeneration,
): Promise<ReconcileResult> {
  const now = deps.now ?? Date.now;
  const deadlines = deps.deadlines ?? DEFAULT_RECONCILE_DEADLINES_MS;
  const log = deps.logger.child({ event: 'reconcile_generation', generation_id: gen.id });

  // Estados TERMINALES: nada que hacer.
  if (gen.status === 'completed' || gen.status === 'failed' || gen.status === 'cancelled') {
    return { outcome: 'noop', generationId: gen.id };
  }

  // `in_progress` (descarga encolada): SUB-LÓGICA de recuperación — NO se pollea fal ni se marca
  // estado. Si lleva en `in_progress` menos que el deadline de descarga → no-op (el consumer trabaja).
  // Si lo supera SIN completar → la descarga se perdió (enqueue fallido tras el claim, o job agotado
  // por URL de output efímera) → RE-ENCOLAR `output.download`. El re-encolado es un WRITE GUARDADO que
  // refresca `updatedAt` (resetea el reloj → backoff `inProgressMs`, no un re-encolado por tick). Y si
  // supera el TOPE terminal → `failed` (corta el goteo de una descarga irrecuperable). Ambos writes van
  // guardados por `CLAIM_STATUSES_IN_PROGRESS`: si un completer la llevó a `completed`, el claim no
  // toma efecto y NO se re-encola (anti-doble-cobro; el FOR UPDATE de finalize es el backstop).
  if (gen.status === 'in_progress') {
    return reconcileInProgress(deps, gen, { now, deadlines, log });
  }

  // `submitting` SIN request_id: crash entre INSERT y submit. NO hay URL que pollear NI se puede
  // re-submitir con seguridad (fal podría retener un job) → expira por EDAD, nunca auto-resubmit.
  if (gen.status === 'submitting' || gen.falRequestId === null) {
    const ageMs = now() - gen.createdAt.getTime();
    if (ageMs > deadlines.submittingMs) {
      const expired = await expireFromPoll(deps, gen, now);
      if (expired === null) return raced(log, gen.id);
      log.warn(
        { age_ms: ageMs, deadline_ms: deadlines.submittingMs },
        'reconcile: generación colgada en submitting sin request_id superó su edad; failed (NO re-submit)',
      );
      return expired;
    }
    log.info(
      { age_ms: ageMs },
      'reconcile: generación en submitting aún dentro de su edad; no-op (no re-submit)',
    );
    return { outcome: 'noop', generationId: gen.id };
  }

  // `submitted`/`in_queue` CON URLs: pollea el `status_url` PERSISTIDO (nunca reconstruido).
  if (gen.statusUrl === null || gen.responseUrl === null) {
    // Invariante: una fila con request_id pero sin URLs es incoherente (el submit las estampa
    // juntas). No se puede pollear; se trata como submitting colgado (expira por edad). Observable.
    log.warn(
      {},
      'reconcile: fila con fal_request_id pero sin status_url/response_url (incoherente); se evalúa por edad',
    );
    const ageMs = now() - (gen.startedAt ?? gen.createdAt).getTime();
    if (ageMs > deadlines.submittingMs) {
      const expired = await expireFromPoll(deps, gen, now);
      if (expired === null) return raced(log, gen.id);
      return expired;
    }
    return { outcome: 'noop', generationId: gen.id };
  }

  let check: FalStatusCheck;
  try {
    check = await deps.checkStatus({ statusUrl: gen.statusUrl, responseUrl: gen.responseUrl });
  } catch (err) {
    // Un contrato roto (`FalResponseError`: JSON sin `status` conocido) SE PROPAGA — el caller lo
    // loggea como anomalía, no como un simple reintento. Un fallo del PROVEEDOR (429/timeout/red,
    // `FalProviderError`) es transitorio: no-op salvo que la generación ya haya superado su deadline
    // de cuelgue (entonces expira). Principio del REVIEW: no colapsar las dos ramas de error de fal.
    if (err instanceof FalResponseError) throw err;
    const ageMs = now() - (gen.startedAt ?? gen.createdAt).getTime();
    const deadlineMs = deadlineForKind(gen.kind, deadlines);
    if (ageMs > deadlineMs) {
      const expired = await expireFromPoll(deps, gen, now);
      if (expired === null) return raced(log, gen.id);
      log.warn(
        { age_ms: ageMs, deadline_ms: deadlineMs, err: providerErrMsg(err) },
        'reconcile: checkStatus de fal falló (proveedor) y la generación superó su deadline por tipo; failed (expira)',
      );
      return expired;
    }
    log.info(
      { err: providerErrMsg(err) },
      'reconcile: checkStatus de fal falló (transitorio) dentro del deadline; no-op, el próximo tick reintenta',
    );
    return { outcome: 'noop', generationId: gen.id };
  }

  // fal terminó en FAILED/ERROR/CANCELLED: es TERMINAL en fal → se expira la fila INMEDIATAMENTE
  // (`failed`), sin esperar al deadline. NO se re-submit. (Un `checkStatus` que lanzó `FalProviderError`
  // es un fallo de NUESTRA request —429/timeout—, distinto de fal reportando que el JOB falló: aquel
  // es transitorio y cae en el catch de arriba; este es definitivo.)
  if (check.state === 'failed') {
    const expired = await expireFromPoll(deps, gen, now, { falStatusPayload: check.statusPayload });
    if (expired === null) return raced(log, gen.id);
    log.warn(
      { fal_status: check.falStatus },
      'reconcile: fal reportó FAILED/CANCELLED; generación failed (terminal, sin re-submit)',
    );
    return expired;
  }

  // fal sigue en cola/progreso: no-op SALVO que ya haya colgado más que el deadline por tipo (§9.6
  // "timeout por tipo de job") → se expira. Aquí vive el "expirar por tipo": imagen (segundos-minuto)
  // vs vídeo (minutos), elegido por `gen.kind`.
  if (check.state === 'processing') {
    const ageMs = now() - (gen.startedAt ?? gen.createdAt).getTime();
    const deadlineMs = deadlineForKind(gen.kind, deadlines);
    if (ageMs > deadlineMs) {
      const expired = await expireFromPoll(deps, gen, now, {
        falStatusPayload: check.statusPayload,
      });
      if (expired === null) return raced(log, gen.id);
      log.warn(
        { age_ms: ageMs, deadline_ms: deadlineMs, fal_kind: gen.kind },
        'reconcile: generación colgada en fal más que su deadline por tipo; failed (expira, sin re-submit)',
      );
      return expired;
    }
    log.info(
      { age_ms: ageMs },
      'reconcile: fal sigue procesando dentro del deadline; no-op, el próximo tick re-chequea',
    );
    return { outcome: 'still_processing', generationId: gen.id };
  }

  // fal COMPLETED: persiste el output en `fal_status_payload` en forma WEBHOOK-COMPATIBLE — el
  // consumer `output.download` (T4.2) lee `fal_status_payload` vía `FalWebhookPayloadSchema` y saca
  // el output de `.payload`. Reconcile construye ese mismo shape con el schema de CORE (core→core, no
  // importa services) para que el consumer existente lo consuma sin ramificar. Marca `in_progress`
  // (descarga encolada) → deja de reconciliarse (RECONCILABLE_STATUSES no incluye `in_progress`) → NO
  // re-encola por tick. El orden importa: persistir ANTES de encolar, así el consumer siempre
  // encuentra el output al releer.
  const webhookShaped = FalWebhookPayloadSchema.parse({
    request_id: gen.falRequestId,
    status: 'OK',
    payload: check.output,
    error: null,
  });
  // CLAIM condicional ANTES de encolar: solo se marca `in_progress` + se encola si la fila SIGUE
  // reconciliable. Si otro actor (webhook + su descarga) ya la llevó a `completed` (y escribió su
  // `cost_entry`) entre el listado y este punto, el claim NO toca la fila (devuelve `false`) → NO se
  // encola una 2ª descarga. Sin este guard, un `in_progress` incondicional REGRESARÍA el `completed`
  // y el FOR UPDATE de finalize (que solo frena si YA está `completed`) dejaría pasar un 2º cobro.
  // El claim va desde `CLAIM_STATUSES_POLL` (excluye `in_progress`: si el webhook ya la marcó
  // mientras polleábamos, NO re-encolamos una descarga redundante).
  const claimed = await deps.updateGeneration(
    gen.id,
    { status: 'in_progress', falStatusPayload: webhookShaped },
    CLAIM_STATUSES_POLL,
  );
  if (!claimed) return raced(log, gen.id);
  await deps.enqueueDownload(gen.id);
  log.info(
    {},
    'reconcile: fal COMPLETED vía polling; output persistido (forma webhook) y descarga encolada (sin re-submit)',
  );
  return { outcome: 'enqueued_download', generationId: gen.id };
}

/**
 * SUB-LÓGICA de una fila `in_progress` (descarga encolada): recuperación del agujero negro sin pollear
 * fal. Cierra dos puertas: (1) el `enqueueDownload` falló tras el claim (boss/PG cayó entre los dos
 * writes); (2) el job `output.download` agotó sus reintentos. Se mide el tiempo en `in_progress` por
 * `updatedAt` (el claim lo refrescó). El re-encolado y el failed-terminal van GUARDADOS por
 * `CLAIM_STATUSES_IN_PROGRESS`: si un completer la llevó a `completed` en la carrera, el claim no toma
 * efecto y NO se re-encola (anti-doble-cobro; el FOR UPDATE de finalize es el backstop).
 */
async function reconcileInProgress(
  deps: ReconcileDeps,
  gen: ReconcilableGeneration,
  ctx: { now: () => number; deadlines: ReconcileDeadlines; log: Logger },
): Promise<ReconcileResult> {
  const { now, deadlines, log } = ctx;
  const inProgressMs = now() - gen.updatedAt.getTime();
  const ageMs = now() - gen.createdAt.getTime();

  // Dentro del deadline de descarga: el consumer está (o debería estar) trabajando. No-op.
  if (inProgressMs <= deadlines.inProgressMs) {
    return { outcome: 'noop', generationId: gen.id };
  }

  // TOPE terminal: la descarga lleva demasiado tiempo sin completar (p.ej. URL de output EXPIRADA que
  // ningún re-encolado recuperará — el consumer re-lee la URL guardada, no re-pollea fal). Se marca
  // `failed` para cortar el goteo. DEUDA door-2b: el gasto de fal de ESE caso queda sin capturar en el
  // ledger (la descarga nunca ocurrió); la captura del huérfano es tarea de seguimiento (ver informe).
  if (ageMs > deadlines.inProgressMaxAgeMs) {
    const claimed = await deps.updateGeneration(
      gen.id,
      { status: 'failed', completedAt: new Date(now()) },
      CLAIM_STATUSES_IN_PROGRESS,
    );
    if (!claimed) return raced(log, gen.id);
    log.warn(
      { in_progress_ms: inProgressMs, age_ms: ageMs, max_age_ms: deadlines.inProgressMaxAgeMs },
      'reconcile: fila in_progress superó el tope terminal (descarga irrecuperable); failed (corta el goteo; gasto huérfano no capturado, deuda door-2b)',
    );
    return { outcome: 'expired', generationId: gen.id };
  }

  // Deadline de descarga superado pero dentro del tope: la descarga se perdió (enqueue fallido o job
  // agotado por un fallo TRANSITORIO) → RE-ENCOLAR. El write guardado es un no-op semántico
  // (`status='in_progress'` sobre una fila ya `in_progress`) cuyo ÚNICO efecto es refrescar `updatedAt`
  // (backoff: el próximo re-encolado no ocurre hasta pasar OTRO `inProgressMs`). Si el claim no toma
  // efecto (completer → `completed`), NO se re-encola.
  const claimed = await deps.updateGeneration(
    gen.id,
    { status: 'in_progress' },
    CLAIM_STATUSES_IN_PROGRESS,
  );
  if (!claimed) return raced(log, gen.id);
  await deps.enqueueDownload(gen.id);
  log.warn(
    { in_progress_ms: inProgressMs, deadline_ms: deadlines.inProgressMs },
    'reconcile: fila in_progress superó el deadline de descarga sin completar; output.download RE-ENCOLADO (backoff via updatedAt)',
  );
  return { outcome: 're_enqueued_download', generationId: gen.id };
}

/** El claim condicional no tocó la fila: otro actor (webhook + descarga) ya la sacó de los estados
 *  reconciliables entre el listado y este write. Es un NO-OP SEGURO (el otro camino ya la conduce) —
 *  reconcile no encola ni expira. Es la barrera anti-doble-cobro de la carrera 4-way (§9.0). */
function raced(log: Logger, generationId: string): ReconcileResult {
  log.info(
    { generation_id: generationId },
    'reconcile: la fila cambió de estado (otro actor la reconcilió) entre el listado y el write; no-op seguro',
  );
  return { outcome: 'noop', generationId };
}

/** La MECÁNICA idéntica de las 5 expiraciones del camino de POLL: claim condicional a `failed` +
 *  `completedAt` desde `CLAIM_STATUSES_POLL` (opcionalmente con `falStatusPayload`). Devuelve el
 *  resultado `expired` si el claim tomó efecto, o `null` si otro actor sacó la fila de los estados
 *  poll (el caller mapea `null` → `raced`). NO loggea: cada call-site conserva su `log.warn`
 *  DIFERENCIADO (la observabilidad por rama que el REVIEW exige) — el helper solo colapsa la escritura
 *  repetida, no el diagnóstico. */
async function expireFromPoll(
  deps: ReconcileDeps,
  gen: ReconcilableGeneration,
  now: () => number,
  extraPatch?: { falStatusPayload?: unknown },
): Promise<ReconcileResult | null> {
  const claimed = await deps.updateGeneration(
    gen.id,
    { status: 'failed', completedAt: new Date(now()), ...extraPatch },
    CLAIM_STATUSES_POLL,
  );
  return claimed ? { outcome: 'expired', generationId: gen.id } : null;
}

function providerErrMsg(err: unknown): string {
  if (err instanceof FalProviderError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
