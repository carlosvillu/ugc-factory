// CARRERA CONCURRENTE DE STEPS IDÉNTICOS con winner LENTO (T4.11, MONEY POINT deuda T4.10a/b). Es el
// camino que el E2E live de UNA variante NO ejercita (una variante nunca produce dos generaciones
// idénticas concurrentes) — por eso vive aquí, stepless y dedicado, contra fal MOCKEADO (msw, CERO red,
// CERO gasto).
//
// LO QUE FIJA (la economía Hook×Body×CTA bajo concurrencia real, no la carrera "resuelta al azar" del
// test de T4.10):
//   · Dos generaciones IDÉNTICAS lanzadas a la vez con un winner cuyo poll tarda N ticks (simula Veo,
//     minutos): UNA gana el índice único parcial y submitea/paga; la otra PIERDE el INSERT y —como el
//     winner AÚN NO está `completed`— lanza `LoserRaceError` (la SEÑAL DE TIPO dedicada, no un
//     `FalResponseError` de contrato).
//   · El loser REINTENTA cuando el winner completa → DEDUPLICA al asset del winner: 0 submits nuevos, 0
//     `cost_entry` nuevo, `reused=true`, MISMO assetId. NUNCA un 2º pago de una generación ya hecha.
//   · Invariante de dinero: exactamente 1 submit y 1 cost_entry al final, pase lo que pase con el timing.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  getModelProfileByEndpoint,
  listGenerationsByStatus,
  makeLocalStorageAdapter,
  seedGallery,
  type ModelProfile,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { LoserRaceError } from '@ugc/core/generation';
import { createTestDatabase, server, type TestDatabase } from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { runGenerate } from '../../src/generate';

const ENDPOINT = 'fal-ai/flux-2';
const SUBMIT_URL = `https://queue.fal.run/${ENDPOINT}`;
const OUTPUT_URL = 'https://fal.media/files/out-flux2-concurrent.png';
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const RESPONSE_BODY = {
  images: [{ url: OUTPUT_URL, width: 1024, height: 1024, content_type: 'image/png' }],
  seed: 7,
};

/**
 * Camino feliz con un winner cuyo POLL tarda `slowPolls` ticks en COMPLETED (simula un vídeo Veo lento).
 * Cuenta los submits (el corazón del assert "una sola generación paga") y controla cuándo el winner
 * "completa" para orquestar la carrera de forma DETERMINISTA. `releaseCompletion()` marca al winner como
 * listo (a partir de ahí su status devuelve COMPLETED).
 */
function slowWinnerHappyPath(): {
  submitCount: () => number;
  releaseCompletion: () => void;
} {
  let n = 0;
  let completed = false;
  server.use(
    http.post(SUBMIT_URL, () => {
      n += 1;
      const req = `CONC-req-${String(n)}`;
      return HttpResponse.json({
        request_id: req,
        status_url: `${SUBMIT_URL}/requests/${req}/status`,
        response_url: `${SUBMIT_URL}/requests/${req}`,
        status: 'IN_QUEUE',
      });
    }),
    // El winner sigue IN_QUEUE hasta que el test lo libera (simula la latencia de minutos de Veo).
    http.get(`${SUBMIT_URL}/requests/:req/status`, ({ params }) =>
      HttpResponse.json({
        status: completed ? 'COMPLETED' : 'IN_QUEUE',
        request_id: params.req,
      }),
    ),
    http.get(`${SUBMIT_URL}/requests/:req`, () => HttpResponse.json(RESPONSE_BODY)),
    http.get(OUTPUT_URL, () =>
      HttpResponse.arrayBuffer(PNG_BYTES.buffer, { headers: { 'content-type': 'image/png' } }),
    ),
  );
  return {
    submitCount: () => n,
    releaseCompletion: () => {
      completed = true;
    },
  };
}

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
let fluxProfile: ModelProfile;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  tdb = await createTestDatabase({ label: 'services:generate-concurrent-dedup' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-conc-dedup-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  const profile = await getModelProfileByEndpoint(tdb.db, ENDPOINT);
  if (profile === undefined) throw new Error(`model_profile ${ENDPOINT} no sembrado`);
  fluxProfile = profile;
});

beforeEach(async () => {
  await tdb.pool.query('TRUNCATE TABLE generation, asset, cost_entry CASCADE');
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(async () => {
  server.close();
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

/** `runGenerate` con un `sleep` que CEDE al event loop (`setImmediate`) en vez de un no-op: así el poll
 *  del winner NO es un busy-loop síncrono y el test puede LIBERAR la completion entre ticks de poll (el
 *  timing de la carrera lo controla el mock, no relojes reales). `maxPollAttempts` holgado para que el
 *  winner tenga margen hasta que el test lo libere. */
function deps() {
  return {
    db: tdb.db,
    storage,
    falKey: 'fal-test-key-not-a-secret',
    sleep: () => new Promise<void>((r) => setImmediate(r)),
    falOptions: { pollIntervalMs: 0, maxPollAttempts: 10_000 },
  };
}

const PROMPT = 'A serum bottle on a marble table, identical concurrent step';

async function falCostRowCount(): Promise<number> {
  const { rows } = await tdb.pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM cost_entry WHERE provider = 'fal'",
  );
  return rows[0]?.n ?? 0;
}

describe('carrera concurrente de steps idénticos con winner lento (T4.11 money point)', () => {
  it('el loser lanza LoserRaceError, reintenta cuando el winner completa y DEDUPLICA (1 submit, 1 cost_entry)', async () => {
    const { submitCount, releaseCompletion } = slowWinnerHappyPath();

    // 1) Lanzar los DOS a la vez. El winner submitea y se queda POLLEANDO (IN_QUEUE) porque no lo hemos
    //    liberado. El loser hace MISS del fast-lookup, choca en el INSERT del índice único y —winner aún
    //    NO completed— lanza `LoserRaceError`. Un `allSettled` recoge ambos desenlaces sin condicionar.
    const winnerPromise = runGenerate(deps(), {
      modelProfileId: fluxProfile.id,
      resolvedPrompt: PROMPT,
    });

    // Pequeña cesión del event loop para que el winner cree su fila `submitting` y arranque el poll ANTES
    // de que el loser intente su INSERT (así el loser choca de verdad contra el índice, que es el caso a
    // fijar). No es una espera de reloj: es orden de operaciones sobre la misma BD.
    await new Promise((r) => setImmediate(r));

    const loserResult = await runGenerate(deps(), {
      modelProfileId: fluxProfile.id,
      resolvedPrompt: PROMPT,
    }).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    );

    // 2) El loser PERDIÓ la carrera: el winner aún no había completado, así que lanzó `LoserRaceError`
    //    (la señal de tipo dedicada — NO un contract-violation permanente). Es la rama money-critical: un
    //    retryable que deduplicará, no un failed.
    expect(loserResult.status).toBe('rejected');
    const loserReason = loserResult.status === 'rejected' ? loserResult.reason : undefined;
    expect(loserReason).toBeInstanceOf(LoserRaceError);

    // Hasta aquí: exactamente UN submit (el del winner). El loser NO submiteó.
    expect(submitCount()).toBe(1);

    // 3) El winner completa (simulamos que Veo terminó tras "minutos") y su generación se liquida.
    releaseCompletion();
    const winner = await winnerPromise;
    expect(winner.reused).toBe(false);

    // 4) El RETRY del loser (lo que el executor haría vía failStep→re-encolar): mismo prompt → mismo hash.
    //    Ahora el winner YA está `completed`, así que el fast-lookup ACIERTA → DEDUPLICA a su asset.
    const retry = await runGenerate(deps(), {
      modelProfileId: fluxProfile.id,
      resolvedPrompt: PROMPT,
    });
    expect(retry.reused).toBe(true);
    expect(retry.assetId).toBe(winner.assetId); // el MISMO asset del winner
    expect(retry.costCents).toBe(0); // 0 coste en el hit

    // 5) INVARIANTE DE DINERO: un solo submit (una sola llamada de pago a fal) y un solo cost_entry — el
    //    loser NUNCA re-pagó una generación ya hecha, ni siquiera tras perder la carrera y reintentar.
    expect(submitCount()).toBe(1);
    expect(await falCostRowCount()).toBe(1);
    // Una sola generación `completed` productiva (la del winner); el loser no creó una 2ª fila viva.
    expect(await listGenerationsByStatus(tdb.db, 'completed')).toHaveLength(1);
  });
});
