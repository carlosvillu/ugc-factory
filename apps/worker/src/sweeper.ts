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
// listado. Sin `FAL_KEY` la pieza de generaciones se OMITE (el worker arranca igual).
import {
  claimGenerationForReconcile,
  findExpiredRunningStepIds,
  getModelProfile,
  listReconcilableGenerations,
} from '@ugc/db';
import type { DbClient, Generation, GenerationPatch } from '@ugc/db';
import { sweepExpiredSteps } from '@ugc/core/orchestrator';
import type { JobQueue, TransitionDeps } from '@ugc/core/orchestrator';
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
  /** La API key de fal EN CLARO (para el `checkStatus` que pollea el `status_url` guardado). Sin ella
   *  la pieza de reconciliación de generaciones se OMITE con un warn — el worker arranca igual (el
   *  barrido de steps NO depende de fal). El composition root la lee de `FAL_KEY`. */
  falKey?: string;
  /** Intervalo del barrido (ms). Default `DEFAULT_SWEEP_INTERVAL_MS`. */
  intervalMs?: number;
}

/** Handle del sweeper: `stop()` retira el timer (lo llama el shutdown/cierre del boss). */
export interface Sweeper {
  stop(): void;
}

/**
 * Construye el paso de RECONCILIACIÓN DE GENERACIONES del tick (T4.3): pollea las colgadas contra fal
 * y encola/expira vía `sweepStuckGenerations` (core). Devuelve `undefined` si falta `FAL_KEY` (sin
 * credencial no se puede pollear; se loggea y el tick corre solo la pieza de steps). Exportado para
 * cablearlo y testearlo aislado del timer. El `checkStatus` del FalClient hace UN GET por fila (no un
 * poll bloqueante). El `updateGeneration` y el encolado se pasan como deps a core.
 */
export function makeGenerationSweep(deps: {
  db: DbClient;
  boss: PgBoss;
  falKey: string;
  logger: Logger;
  /** El `checkStatus` a usar (inyectable en tests sin red). Default: el del FalClient construido con
   *  `falKey` (un GET autenticado al `status_url` guardado). NUNCA submitea. */
  checkStatus?: ReconcileCheckStatus;
}): () => Promise<void> {
  // El FalClient del sweeper solo usa `checkStatus` (un GET autenticado al `status_url` guardado); no
  // submitea (reconcile JAMÁS re-submitea). Se construye UNA vez (rate limiter compartido entre ticks).
  const fal = makeFalClient({ credentials: deps.falKey });
  const checkStatus: ReconcileCheckStatus =
    deps.checkStatus ?? ((handle) => fal.checkStatus(handle));
  // El puerto `JobQueue` (no `boss.send` crudo): valida el payload con Zod al encolar, igual que TODO
  // el resto de sitios de encolado (incl. el webhook hermano). Cola `standard` sin singletonKey (inerte
  // ahí, verificado en T4.2): la idempotencia la dan el estado intermedio `in_progress` + el re-query +
  // UNIQUE `fal_request_id` + el FOR UPDATE de finalize.
  const jobQueue: JobQueue = makeJobQueue(deps.boss);
  return async (): Promise<void> => {
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
              profile !== undefined && VIDEO_MODEL_KINDS.has(profile.kind) ? 'video' : 'image',
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

/** Los `model_kind` que producen un ASSET DE VÍDEO (deadline de cuelgue en minutos). El resto
 *  (`image`/`tts`/`music`/`utility`) usan el deadline de imagen. Cuando entre vídeo (T4.7/T4.8), sus
 *  perfiles ya resolverán `'video'` por este mapa sin tocar nada más. */
const VIDEO_MODEL_KINDS: ReadonlySet<string> = new Set(['t2v', 'i2v', 'r2v', 'avatar', 'lipsync']);

/**
 * Arranca el barrido periódico. Cada tick hace DOS cosas (T0.9 + T4.3):
 *   1. `sweepExpiredSteps` (core): expira los steps colgados; a prueba de carreras, nunca lanza por
 *      un step individual.
 *   2. `sweepStuckGenerations` (core, si hay `FAL_KEY`+boss): reconcilia las generaciones colgadas
 *      contra fal (pollea el `status_url` guardado, encola la descarga o expira por tipo/edad).
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
  // La pieza de reconciliación de generaciones necesita boss (encolar) + falKey (pollear). Sin ambos
  // se omite: el barrido de steps sigue funcionando (no depende de fal).
  const generationSweep =
    boss !== undefined && falKey !== undefined && falKey !== ''
      ? makeGenerationSweep({ db, boss, falKey, logger })
      : undefined;
  if (generationSweep === undefined) {
    logger.warn(
      {},
      'sweeper: reconciliación de generaciones OMITIDA (falta FAL_KEY o boss); solo se barren steps',
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
