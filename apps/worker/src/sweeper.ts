// Sweeper de timeouts (T0.9, jobs.md §8): un `setInterval` del worker que expira
// los steps colgados (`running` con `timeout_at < now()`).
//
// POR QUÉ setInterval y NO cron de pg-boss: el cron de pg-boss tiene precisión de
// MINUTO (los schedules se evalúan cada ~30 s y el formato de 5 campos es de
// minuto). La Verificación de T0.9 exige `expired` en <40 s con un timeout de
// 10 s → un cron de 1 min barrería a t≈55-60 s = FAIL. Un setInterval de pocos
// segundos cierra el hueco. Es una desviación deliberada del literal "cron
// pg-boss" del Entrega (regla de trabajo 6, anotada en el journal).
//
// La LÓGICA del barrido (leer ids colgados + transition('expire') por fila) vive
// en core (sweepExpiredSteps); aquí solo el timer, el gate de errores y la limpieza.
//
// SEGUNDA PIEZA DEL TICK (T4.3, §9.6): además de expirar steps, cada tick RECONCILIA
// las generaciones colgadas contra fal (`sweepStuckGenerations`) — pollea el
// `status_url` GUARDADO de las `submitted`/`in_queue` (encola la descarga si fal ya
// terminó; expira las colgadas por tipo), y expira por edad las `submitting` sin
// request_id. Es lo que "matar el worker y reiniciar" reanuda: el sweeper relee la
// fila de BD y sigue el MISMO request, NUNCA re-submitea. La lógica vive en core; aquí
// solo se cablea el `checkStatus` del FalClient (poll de UN GET), el encolado y el
// listado. La fal-key se resuelve POR TICK de `app_setting` (thunk, misma fuente que web y los
// executors N7); un tick sin key OMITE la pieza de generaciones con un warn (el worker sigue).
import {
  claimGenerationForReconcile,
  findExpiredRunningStepIds,
  getModelProfile,
  listReconcilableGenerations,
} from '@ugc/db';
import type { DbClient, Generation, GenerationPatch } from '@ugc/db';
import { AppError } from '@ugc/core/contracts';
import { sweepExpiredSteps } from '@ugc/core/orchestrator';
import type { JobQueue, TransitionDeps } from '@ugc/core/orchestrator';
import { isVideoModelKind } from '@ugc/core/gallery';
import {
  makeFalClient,
  sweepStuckGenerations,
  type GenerationKind,
  type ReconcileCheckStatus,
  type SweepableGenerationRow,
} from '@ugc/core/generation';
import { outputDownloadJob } from '@ugc/core/jobs';
import type { Logger } from '@ugc/core';
import type { PgBoss } from 'pg-boss';
import { makeJobQueue } from './job-queue';

/** Intervalo por defecto del barrido (ms). 5 s: con un timeout de 10 s, el peor
 *  caso de detección es ~15 s ≪ 40 s del gate. Overrideable vía `intervalMs`. */
const DEFAULT_SWEEP_INTERVAL_MS = 5_000;

export interface StartSweeperDeps {
  db: DbClient;
  transitionDeps: TransitionDeps;
  logger: Logger;
  /** El boss para encolar `output.download` cuando una generación reconciliada ya terminó en fal.
   *  Opcional: sin él (y sin `falKey`) la pieza de reconciliación de generaciones se omite. */
  boss?: PgBoss;
  /** THUNK que resuelve la API key de fal (de `app_setting`, cifrada) EN CADA TICK — no un string fijado
   *  al arrancar. Si el thunk lanza (no hay key configurada / no descifra), la reconciliación se OMITE
   *  ESE tick con un warn y el barrido de steps sigue (no depende de fal); el SIGUIENTE tick reintenta,
   *  así una key añadida en Ajustes → fal se recoge sin reiniciar el worker. El composition root lo cablea
   *  a `loadFalKey(db, secretsKey)` (la MISMA fuente que web). */
  falKey?: () => Promise<string>;
  /** Intervalo del barrido (ms). Default `DEFAULT_SWEEP_INTERVAL_MS`. */
  intervalMs?: number;
}

/** Handle del sweeper: `stop()` retira el timer (lo llama el shutdown/cierre del boss). */
export interface Sweeper {
  stop(): void;
}

/**
 * Construye el paso de RECONCILIACIÓN DE GENERACIONES del tick (T4.3): pollea las colgadas contra fal
 * y encola/expira vía `sweepStuckGenerations` (core). La `falKey` se resuelve POR TICK (thunk async) de
 * `app_setting`: si no hay key ese tick, se OMITE la reconciliación con un warn y el tick corre solo la
 * pieza de steps (el SIGUIENTE tick reintenta — una key añadida en Ajustes se recoge sin reiniciar).
 * Exportado para cablearlo y testearlo aislado del timer. El `checkStatus` del FalClient hace UN GET por
 * fila (no un poll bloqueante). El `updateGeneration` y el encolado se pasan como deps a core.
 */
export function makeGenerationSweep(deps: {
  db: DbClient;
  boss: PgBoss;
  /** Resuelve la key de fal vigente (de `app_setting`) al inicio del tick. Lanza si no hay key/no descifra. */
  falKey: () => Promise<string>;
  logger: Logger;
  /** El `checkStatus` a usar (inyectable en tests sin red). Default: el del FalClient construido con la
   *  key resuelta ese tick (un GET autenticado al `status_url` guardado). NUNCA submitea. */
  checkStatus?: ReconcileCheckStatus;
}): () => Promise<void> {
  // El FalClient del sweeper solo usa `checkStatus` (un GET autenticado al `status_url` guardado); no
  // submitea (reconcile JAMÁS re-submitea). Se CACHEA por-key (rate limiter compartido entre ticks): se
  // reconstruye solo si la key rota en Ajustes → fal. En tests, `checkStatus` inyectado bypassa el cliente.
  let cached: { key: string; checkStatus: ReconcileCheckStatus } | undefined;
  const resolveCheckStatus = async (): Promise<ReconcileCheckStatus> => {
    // El thunk se resuelve SIEMPRE primero (la llamada load-bearing por-tick): si lanza —no hay key ese
    // tick— aborta antes de tocar la BD, y aun con `checkStatus` inyectado en tests la resolución de key se
    // EJERCITA (no la bypassa un doble de red). Solo tras resolver la key se decide el cliente.
    const key = await deps.falKey();
    if (deps.checkStatus !== undefined) return deps.checkStatus;
    if (cached?.key !== key) {
      const fal = makeFalClient({ credentials: key });
      cached = { key, checkStatus: (handle) => fal.checkStatus(handle) };
    }
    return cached.checkStatus;
  };
  // El puerto `JobQueue` (no `boss.send` crudo): valida el payload con Zod al encolar, igual que TODO
  // el resto de sitios de encolado (incl. el webhook hermano). Cola `standard` sin singletonKey (inerte
  // ahí, verificado en T4.2): la idempotencia la dan el estado intermedio `in_progress` + el re-query +
  // UNIQUE `fal_request_id` + el FOR UPDATE de finalize.
  const jobQueue: JobQueue = makeJobQueue(deps.boss);
  return async (): Promise<void> => {
    // Resuelve la key vigente ANTES de listar (si el thunk lanza —no hay key ese tick— el tick se aborta
    // sin tocar la BD; el caller lo captura y sigue barriendo steps). Reconcile es un GET, no gasta.
    const checkStatus = await resolveCheckStatus();
    // `kind` por fila se resuelve desde `model_profile.kind` — pero core llama a `resolveKind` de forma
    // SÍNCRONA en su bucle, y la derivación honesta necesita la BD. Se precarga aquí: el `listReconcilable`
    // (async) lee las filas colgadas (pocas) y CALIENTA un mapa `modelProfileId → kind` con una query por
    // perfil ÚNICO; el `resolveKind` síncrono solo lee ese mapa. Así el camino por-tipo se EJERCITA hoy
    // (resuelve `'image'` porque solo hay perfiles de imagen) y vídeo (T4.7/T4.8) solo tendrá que hacer
    // que su perfil resuelva `'video'`. El mapa es per-tick (los kinds no cambian, pero se relee simple).
    const kindByProfile = new Map<string, GenerationKind>();
    await sweepStuckGenerations({
      // `Generation` es estructuralmente asignable a `SweepableGenerationRow` (mismos campos): se pasa
      // directo, sin un remap campo-a-campo. Al listar, se precargan los kinds de sus perfiles.
      listReconcilable: async (): Promise<SweepableGenerationRow[]> => {
        const rows = await listReconcilableGenerations(deps.db);
        await Promise.all(
          [...new Set(rows.map((r) => r.modelProfileId))].map(async (profileId) => {
            const profile = await getModelProfile(deps.db, profileId);
            // Sin perfil (dato inconsistente) → imagen (el deadline más corto, conservador).
            kindByProfile.set(
              profileId,
              profile !== undefined && isVideoModelKind(profile.kind) ? 'video' : 'image',
            );
          }),
        );
        return rows;
      },
      resolveKind: (row) => kindByProfile.get(row.modelProfileId) ?? 'image',
      checkStatus,
      updateGeneration: (id, patch, fromStatuses): Promise<boolean> =>
        // CLAIM condicional: solo aplica el patch si la fila SIGUE en `fromStatuses` (revalidación
        // anti-doble-cobro, ver `claimGenerationForReconcile`). Reconcile pasa el conjunto correcto por
        // rama (poll vs in_progress). `patch.status` viaja como `string` en el puerto de core (reconcile
        // no importa el enum de db); por construcción SIEMPRE es un valor del enum (`failed`/`in_progress`).
        // Se estrecha a `GenerationPatch`/`Generation['status'][]` en esta frontera db.
        claimGenerationForReconcile(
          deps.db,
          id,
          patch as GenerationPatch,
          fromStatuses as readonly Generation['status'][],
        ),
      enqueueDownload: (generationId): Promise<void> =>
        jobQueue.enqueue({ job: outputDownloadJob, payload: { generationId } }),
      logger: deps.logger,
    });
  };
}

/**
 * Arranca el barrido periódico. Cada tick hace DOS cosas (T0.9 + T4.3):
 *   1. `sweepExpiredSteps` (core): expira los steps colgados; a prueba de carreras, nunca lanza por
 *      un step individual.
 *   2. `sweepStuckGenerations` (core, si hay boss y la fal-key resuelve ese tick): reconcilia las
 *      generaciones colgadas contra fal (pollea el `status_url` guardado, encola la descarga o expira).
 * Cada pieza va en su propio try/catch: un fallo de infraestructura (BD caída, fal inalcanzable) NO
 * debe tumbar el proceso ni parar los ticks siguientes — el próximo tick reintenta. `unref()` evita
 * que el timer por sí solo mantenga vivo el event loop en el modo degradado.
 */
export function startSweeper({
  db,
  transitionDeps,
  logger,
  boss,
  falKey,
  intervalMs = DEFAULT_SWEEP_INTERVAL_MS,
}: StartSweeperDeps): Sweeper {
  // La pieza de reconciliación de generaciones necesita boss (encolar) + falKey (pollear). Sin BOSS se
  // omite del todo (no hay dónde encolar la descarga). CON boss se cablea SIEMPRE: la ausencia de key ya
  // no se decide al arrancar sino POR TICK dentro de `makeGenerationSweep` (el thunk lanza → ese tick se
  // omite con warn, el siguiente reintenta) — así una key añadida en Ajustes se recoge sin reiniciar.
  const generationSweep =
    boss !== undefined && falKey !== undefined
      ? makeGenerationSweep({ db, boss, falKey, logger })
      : undefined;
  if (generationSweep === undefined) {
    logger.warn(
      {},
      'sweeper: reconciliación de generaciones OMITIDA (falta boss); solo se barren steps',
    );
  }

  const tick = async (): Promise<void> => {
    try {
      await sweepExpiredSteps({
        ...transitionDeps,
        listExpiredStepIds: () => findExpiredRunningStepIds(db),
        logger,
      });
    } catch (err) {
      logger.error(
        { err },
        'sweeper: barrido de steps falló; se reintenta en el próximo intervalo',
      );
    }
    if (generationSweep !== undefined) {
      try {
        await generationSweep();
      } catch (err) {
        // Key ausente/no descifra (thunk lanza `provider_error`) es un estado ESPERADO, no un fallo: se
        // degrada a warn y el próximo tick reintenta (una key añadida en Ajustes se recogerá). Un error de
        // OTRA clase (BD, fal inalcanzable) sí es un fallo de infraestructura → error. Diagnósticos opuestos.
        if (err instanceof AppError && err.code === 'provider_error') {
          logger.warn(
            { err },
            'sweeper: reconciliación OMITIDA este tick (sin fal-key en app_setting); se reintenta en el próximo',
          );
          return;
        }
        logger.error(
          { err },
          'sweeper: reconciliación de generaciones falló; se reintenta en el próximo intervalo',
        );
      }
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  logger.info(
    { intervalMs, generationReconcile: generationSweep !== undefined },
    'sweeper arrancado',
  );

  return {
    stop() {
      clearInterval(timer);
      logger.info({}, 'sweeper detenido');
    },
  };
}
