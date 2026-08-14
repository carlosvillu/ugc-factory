// DISPATCH KIND-AWARE del consumer `output.download` (T4.11, MONEY POINT deuda T4.11 l.591). El sweeper
// de T4.3 reconcilia CUALQUIER generación colgada y encola `output.download`, cuyo consumer liquida
// descargando el output. HASTA T4.11 llamaba SIEMPRE al finalizer SOLO-IMAGEN: una generación de AUDIO
// (`{audio:{url}}`) o VÍDEO (`{video:{url}}`) recogida por esa vía reventaría (el output no tiene
// `images[]`) o crearía un asset `keyframe` corrupto. Este test fija que `finalizeGenerationByKind` RUTA
// por el `model_profile.kind` real al finalizer correcto — con la UNIDAD DE COSTE correcta por kind — y
// que un `tts` (que necesita ASR) NO se liquida por esta vía.
//
// Es el camino que el E2E live de una variante feliz NO ejercita (no deja generaciones atascadas para el
// sweeper) — por eso vive aquí, stepless y dedicado, con la DESCARGA simulada (un downloader inyectado:
// la URL de output es pública, no hay contrato de red que probar aquí).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeLogger } from '@ugc/core/observability';
import { PermanentStepError } from '@ugc/core/orchestrator';
import {
  createAsset,
  createGeneration,
  getAsset,
  getAssetByGenerationKind,
  getGeneration,
  getModelProfileByEndpoint,
  makeLocalStorageAdapter,
  seedGallery,
  updateGeneration,
  type ModelProfile,
} from '@ugc/db';
import { pipelineRun, project, stepRun } from '@ugc/db/schema';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { LoserRaceError } from '@ugc/core/generation';
import {
  createTestDatabase,
  makeGeneration,
  makePipelineRun,
  makeStepRun,
  type TestDatabase,
} from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';
import type { OutputDownloader } from '../../src/finalize-generation';

import { finalizeGenerationByKind } from '../../src/finalize-download';
import { resolveProductionDedup } from '../../src/generation-dedup';

// Un output payload por familia, en la forma que el modelo REAL emite (barrera anti-finalizer-de-imagen:
// ninguno trae `images[]`).
const VIDEO_URL = 'https://fal.media/files/out-clip.mp4';
const AUDIO_URL = 'https://fal.media/files/out-bed.mp3';
const IMAGE_URL = 'https://fal.media/files/out-frame.png';
const VIDEO_OUTPUT = { video: { url: VIDEO_URL, content_type: 'video/mp4' }, duration: 5 };
const AUDIO_OUTPUT = { audio: { url: AUDIO_URL, content_type: 'audio/mpeg' } };
const IMAGE_OUTPUT = {
  images: [{ url: IMAGE_URL, width: 1024, height: 1024, content_type: 'image/png' }],
};

const BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

/** Downloader de test: devuelve bytes sin red para CUALQUIER URL, y CUENTA por URL (para afirmar que el
 *  finalizer de vídeo descargó la URL de VÍDEO, no la de imagen). */
function makeDownloader(): { downloader: OutputDownloader; downloadedUrls: string[] } {
  const downloadedUrls: string[] = [];
  return {
    downloadedUrls,
    downloader: {
      download(url: string): Promise<Response> {
        downloadedUrls.push(url);
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(BYTES);
            c.close();
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      },
    },
  };
}

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;
const profiles: Record<string, ModelProfile> = {};

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'services:finalize-download' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-fin-dl-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  const seed = validateGallerySeed(RAW_GALLERY_SEED);
  if (!seed.ok || !seed.seed) throw new Error('el seed de galería no valida');
  await seedGallery(tdb.db, seed.seed);
  for (const [key, endpoint] of Object.entries({
    image: 'fal-ai/flux-2',
    imageEdit: 'fal-ai/bytedance/seedream/v4.5/edit', // image-edit, coste por 'image', output width/height null
    avatar: 'fal-ai/bytedance/omnihuman/v1.5', // avatar, coste por 'second'
    video: 'fal-ai/veo3.1/image-to-video', // i2v, coste por 'second'
    music: 'fal-ai/ace-step', // music, coste por 'second'
    tts: 'fal-ai/kokoro', // tts (no liquidable por descarga)
  })) {
    const p = await getModelProfileByEndpoint(tdb.db, endpoint);
    if (p === undefined) throw new Error(`perfil ${endpoint} no sembrado`);
    profiles[key] = p;
  }
});

beforeEach(async () => {
  await tdb.pool.query(
    'TRUNCATE TABLE generation, asset, cost_entry, step_run, pipeline_run, project CASCADE',
  );
});

afterAll(async () => {
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

/** Siembra una generación `submitted` de un kind con sus `inputs` (para recuperar la duración de vídeo/
 *  música que el output no siempre emite) — como la dejaría el servicio antes de colgarse. */
async function seedGen(key: string, inputs: Record<string, unknown> = {}) {
  return createGeneration(
    tdb.db,
    makeGeneration({ modelProfileId: profiles[key]!.id, inputs, status: 'submitted' }),
  );
}

/** Siembra project→pipeline_run→step_run con un `node_key` (N7d o N7f) y devuelve el `stepId`. Es la
 *  cadena mínima que la ruta RECONCILE de vídeo b-roll consulta para discriminar el `assetKind` (T5c.7):
 *  `generation.stepRunId` → `step_run.node_key`. */
async function seedStep(nodeKey: string): Promise<string> {
  const [proj] = await tdb.db
    .insert(project)
    .values({ name: `p-${nodeKey}-${Math.random().toString(36).slice(2)}` })
    .returning({ id: project.id });
  const run = makePipelineRun({ projectId: proj!.id, status: 'running' });
  await tdb.db.insert(pipelineRun).values(run);
  const step = makeStepRun({ runId: run.id!, nodeKey, status: 'running' });
  await tdb.db.insert(stepRun).values(step);
  return step.id!;
}

/** Siembra una generación de VÍDEO b-roll (`i2v`, perfil `video`) `submitted` con su `stepRunId` — la
 *  forma en que el executor de N7d/N7f la deja antes de colgarse (SIEMPRE con stepId). `inputs.duration`
 *  ("8s") recupera la duración que Veo no emite. `contentHash` overridable para las pruebas de dedup. */
async function seedVideoGen(args: {
  stepRunId: string | null;
  duration?: string;
  contentHash?: string;
  status?: 'submitted' | 'completed';
}) {
  return createGeneration(
    tdb.db,
    makeGeneration({
      modelProfileId: profiles.video!.id,
      inputs: { duration: args.duration ?? '8s' },
      status: args.status ?? 'submitted',
      stepRunId: args.stepRunId,
      ...(args.contentHash !== undefined ? { contentHash: args.contentHash } : {}),
    }),
  );
}

function deps() {
  return {
    db: tdb.db,
    storage,
    downloader: makeDownloader().downloader,
    logger: makeLogger({ name: 'worker', level: 'silent' }),
  };
}

async function costUnit(generationId: string): Promise<string | null | undefined> {
  const rows = await tdb.db.query.costEntry.findMany({
    where: (c, { eq }) => eq(c.generationId, generationId),
  });
  return rows[0]?.unit;
}

describe('finalizeGenerationByKind — dispatch kind-aware (T4.11 money point)', () => {
  it('AVATAR (video) → crea asset avatar_clip con coste por SEGUNDO, NO un keyframe de imagen', async () => {
    const gen = await seedGen('avatar', { duration: 5 });
    const d = deps();
    const res = await finalizeGenerationByKind(d, {
      generation: gen,
      output: VIDEO_OUTPUT,
      statusPayload: { status: 'OK' },
    });
    // Rutó al finalizer de VÍDEO: asset avatar_clip (NO keyframe), coste por segundo.
    const asset = await getAsset(tdb.db, res.assetId!);
    expect(asset?.kind).toBe('avatar_clip');
    expect(await costUnit(gen.id)).toBe('seconds');
    // El finalizer de imagen NUNCA corrió: no hay asset keyframe para esta generación.
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'keyframe')).toBeUndefined();
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('completed');
  });

  it('VIDEO i2v (b-roll) → crea asset broll_clip con coste por SEGUNDO (duración recuperada de inputs)', async () => {
    // Veo NO emite `duration` en el output → se recupera del `inputs.duration` PERSISTIDO ("8s").
    // T5c.7: la ruta de vídeo b-roll deriva el assetKind por el node_key del step (N7d → broll_clip), así
    // que la generación DEBE venir de un step N7d — como en producción (el executor SIEMPRE pasa stepId).
    const stepId = await seedStep('N7d');
    const gen = await seedVideoGen({ stepRunId: stepId, duration: '8s' });
    const res = await finalizeGenerationByKind(deps(), {
      generation: gen,
      output: { video: { url: VIDEO_URL, content_type: 'video/mp4' } }, // SIN duration en el output
      statusPayload: { status: 'OK' },
    });
    const asset = await getAsset(tdb.db, res.assetId!);
    expect(asset?.kind).toBe('broll_clip');
    expect(asset?.durationS).toBe(8); // recuperada de inputs.duration "8s"
    expect(await costUnit(gen.id)).toBe('seconds');
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'keyframe')).toBeUndefined();
  });

  it('MUSIC → crea asset music_bed con coste por SEGUNDO (duración de inputs), NO keyframe', async () => {
    const gen = await seedGen('music', { duration: 30 });
    const res = await finalizeGenerationByKind(deps(), {
      generation: gen,
      output: AUDIO_OUTPUT,
      statusPayload: { status: 'OK' },
    });
    const asset = await getAsset(tdb.db, res.assetId!);
    expect(asset?.kind).toBe('music_bed');
    expect(asset?.durationS).toBe(30);
    expect(await costUnit(gen.id)).toBe('seconds');
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'keyframe')).toBeUndefined();
  });

  it('IMAGE → conserva la ruta de imagen (asset keyframe, coste por images)', async () => {
    const gen = await seedGen('image');
    const res = await finalizeGenerationByKind(deps(), {
      generation: gen,
      output: IMAGE_OUTPUT,
      statusPayload: { status: 'OK' },
    });
    const asset = await getAsset(tdb.db, res.assetId!);
    expect(asset?.kind).toBe('keyframe');
    expect(await costUnit(gen.id)).toBe('images');
  });

  // EL CAMINO DE PRODUCCIÓN de la ruta de referencias de N7a (T4.4b): el worker completa por
  // webhook+sweeper → `finalizeGenerationByKind` (kind 'image') → `finalizeGeneration`, NO por poll.
  // seedream/nano-banana EDIT emiten `width:null, height:null`; sin el parser tolerante derivado del
  // `promptAdapter`, el parser estricto los rechazaba → 0 asset + 0 cost_entry (el bug de money-path que
  // el verifier cazó, EN el camino que el test de poll no mira). Este test lo blinda AQUÍ.
  it('IMAGE-EDIT (seedream, width:null) → finaliza OK por la vía webhook/sweeper con coste por IMAGEN no-cero', async () => {
    const gen = await seedGen('imageEdit');
    const res = await finalizeGenerationByKind(deps(), {
      generation: gen,
      // La forma REAL de seedream/edit: width/height null (no ausentes).
      output: {
        images: [{ url: IMAGE_URL, width: null, height: null, content_type: 'image/png' }],
      },
      statusPayload: { status: 'OK' },
    });
    const asset = await getAsset(tdb.db, res.assetId!);
    expect(asset?.kind).toBe('keyframe');
    // Sin dims → el asset se persiste con width/height null (se releen del fichero aguas abajo si hace falta).
    expect(asset?.width).toBeNull();
    // COSTE POR IMAGEN no-cero: seedream 4¢/img × 1 imagen. NO 0¢ (la fuga que el fix cierra).
    expect(await costUnit(gen.id)).toBe('images');
    expect(res.costCents).toBe(4);
    expect((await getGeneration(tdb.db, gen.id))?.costActual).toBe(4);
  });

  it('TTS → NO se liquida por descarga (necesita ASR) → PermanentStepError, sin asset ni completed', async () => {
    const gen = await seedGen('tts');
    await expect(
      finalizeGenerationByKind(deps(), {
        generation: gen,
        output: AUDIO_OUTPUT,
        statusPayload: { status: 'OK' },
      }),
    ).rejects.toBeInstanceOf(PermanentStepError);
    // No se corrompió: ni asset, ni completed.
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'tts_audio')).toBeUndefined();
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('submitted');
  });

  // ── CONTROL NEGATIVO (regla 5a): la mina que el fix desactiva ──
  it('CONTROL NEGATIVO: un output de VÍDEO (sin images[]) rutado a la vía correcta NO revienta y NO crea keyframe', async () => {
    // Si el dispatch se "simplificara" de vuelta a llamar SIEMPRE a `finalizeGeneration` (imagen), este
    // output `{video:{url}}` (sin `images[]`) lanzaría `no trae images[]` y/o crearía un keyframe corrupto.
    // La ruta kind-aware lo lleva al finalizer de vídeo → asset de vídeo, cero keyframe. Este test cae si
    // alguien restaura la vía única de imagen.
    const gen = await seedGen('avatar', { duration: 4 });
    const res = await finalizeGenerationByKind(deps(), {
      generation: gen,
      output: VIDEO_OUTPUT,
      statusPayload: { status: 'OK' },
    });
    const asset = await getAsset(tdb.db, res.assetId!);
    expect(asset?.kind).toBe('avatar_clip');
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'keyframe')).toBeUndefined();
  });

  it('CONTRACT-VIOLATION en la vía del sweeper → PermanentStepError (no-retry), NO FalResponseError', async () => {
    // Un output persistido MALFORMADO (un vídeo sin `video`) es DETERMINISTA: esta vía corre en el consumer
    // del sweeper, FUERA de `runGenerationStep`, así que un `FalResponseError` no se mapearía a Permanent y
    // pg-boss lo reintentaría 5× sobre el MISMO payload roto hasta dead-letter. El fix lo hace
    // `PermanentStepError` DIRECTO → el consumer lo absorbe (no-op, sin reintentar). Este test cae si
    // alguien restaura `FalResponseError` en esas ramas (PermanentStepError NO es su subclase).
    const gen = await seedGen('avatar', { duration: 5 });
    await expect(
      finalizeGenerationByKind(deps(), {
        // output de un avatar SIN `video` (contract-violation): {} no encaja el schema de vídeo.
        generation: gen,
        output: {},
        statusPayload: { status: 'OK' },
      }),
    ).rejects.toBeInstanceOf(PermanentStepError);
    // No se corrompió: ni asset de vídeo, ni completed.
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'avatar_clip')).toBeUndefined();
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('submitted');
  });

  it('CONTRACT-VIOLATION de MÚSICA (output sin audio) → PermanentStepError (no-retry)', async () => {
    const gen = await seedGen('music', { duration: 30 });
    await expect(
      finalizeGenerationByKind(deps(), {
        generation: gen,
        output: { not_audio: true }, // sin `audio`
        statusPayload: { status: 'OK' },
      }),
    ).rejects.toBeInstanceOf(PermanentStepError);
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'music_bed')).toBeUndefined();
  });
});

// ── T5c.7 (MONEY-PATH): la ruta RECONCILE de vídeo b-roll discrimina N7d/N7f por node_key ──────────
// N7d (body) y N7f (CTA) comparten el endpoint i2v `fal-ai/veo3.1/image-to-video` → mismo
// `model_profile.kind='i2v'`. El bug (reproducido con $2,62 reales en T5c.4): la finalización re-derivaba
// el `assetKind` por `model_kind` → SIEMPRE `broll_clip` → el finalizador de N7f no hallaba su `cta_clip`
// → «completed pero sin asset cta_clip (invariante roto)» → N8 varado → sin vídeo. El fix deriva el
// `assetKind` por el `node_key` del step (`generation.stepRunId` → `step_run.node_key`).
describe('finalizeGenerationByKind — ruta de vídeo b-roll kind-aware por node_key (T5c.7)', () => {
  it('N7f (CTA) → crea asset cta_clip, NO broll_clip (el nodo que rompió con dinero real)', async () => {
    const stepId = await seedStep('N7f');
    const gen = await seedVideoGen({ stepRunId: stepId });
    const res = await finalizeGenerationByKind(deps(), {
      generation: gen,
      output: { video: { url: VIDEO_URL, content_type: 'video/mp4' } }, // Veo NO emite duration
      statusPayload: { status: 'OK' },
    });
    const asset = await getAsset(tdb.db, res.assetId!);
    // LA ASERCIÓN CLAVE: cta_clip, no broll_clip. Con el bug (derivar por model_kind) saldría broll_clip
    // y este assert fallaría → es el CONTROL NEGATIVO (revertir el fix a `videoAssetKindForModelKind` deja
    // este test ROJO: asset broll_clip en vez de cta_clip).
    expect(asset?.kind).toBe('cta_clip');
    expect(asset?.durationS).toBe(8);
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'cta_clip')).toBeDefined();
    // NO se creó el asset equivocado (broll_clip) ni un keyframe.
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'broll_clip')).toBeUndefined();
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'keyframe')).toBeUndefined();
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('completed');
  });

  it('N7f REDELIVERY (rama alreadyFinalized): una N7f ya completed con su cta_clip → NO-OP gracioso, NO «invariante roto»', async () => {
    // EL PUNTO EXACTO DE T5c.4 (`finalize-single-call-per-second.ts:113-123`): una segunda finalización
    // de la MISMA N7f (redelivery de pg-boss / segundo finalizador concurrente) toma la rama
    // `alreadyFinalized` y busca el asset por `assetKind`. Con el bug (derivar por model_kind) buscaría
    // `broll_clip`, no hallaría el `cta_clip` existente y lanzaría «completed pero sin asset cta_clip
    // (invariante roto)» — el error LITERAL que mató el run con $2,62 reales. El fix pasa el `cta_clip`
    // correcto por node_key → halla su asset → no-op sin lanzar ni re-crear ni re-cobrar.
    const stepId = await seedStep('N7f');
    // Primera finalización: crea la fila completed + su asset cta_clip.
    const gen = await seedVideoGen({ stepRunId: stepId });
    const first = await finalizeGenerationByKind(deps(), {
      generation: gen,
      output: { video: { url: VIDEO_URL, content_type: 'video/mp4' } },
      statusPayload: { status: 'OK' },
    });
    // Segunda finalización (redelivery): la fila ya está completed → rama alreadyFinalized.
    const reFetched = (await getGeneration(tdb.db, gen.id))!;
    const second = await finalizeGenerationByKind(deps(), {
      generation: reFetched,
      output: { video: { url: VIDEO_URL, content_type: 'video/mp4' } },
      statusPayload: { status: 'OK' },
    });
    // No-op gracioso: devuelve el MISMO asset cta_clip, sin lanzar.
    expect(second.assetId).toBe(first.assetId);
    expect((await getAsset(tdb.db, second.assetId!))?.kind).toBe('cta_clip');
    // No se duplicó el cost_entry (una sola liquidación bajo lock).
    const costRows = await tdb.db.query.costEntry.findMany({
      where: (c, { eq: e }) => e(c.generationId, gen.id),
    });
    expect(costRows).toHaveLength(1);
  });

  it('N7d (body) → SIGUE dando broll_clip (no se rompe el caso que funcionaba) pese a compartir endpoint', async () => {
    const stepId = await seedStep('N7d');
    const gen = await seedVideoGen({ stepRunId: stepId });
    const res = await finalizeGenerationByKind(deps(), {
      generation: gen,
      output: { video: { url: VIDEO_URL, content_type: 'video/mp4' } },
      statusPayload: { status: 'OK' },
    });
    const asset = await getAsset(tdb.db, res.assetId!);
    expect(asset?.kind).toBe('broll_clip');
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'cta_clip')).toBeUndefined();
  });

  it('stepRunId === null en ruta de vídeo b-roll → PermanentStepError RUIDOSO (nunca cae a broll_clip)', async () => {
    // ESTADO IMPOSIBLE: el executor de N7d/N7f SIEMPRE pasa stepId. Un null es cableado roto → se lanza
    // (el fallback silencioso a broll_clip ES el bug). No se corrompe: ni asset, ni completed.
    const gen = await seedVideoGen({ stepRunId: null });
    await expect(
      finalizeGenerationByKind(deps(), {
        generation: gen,
        output: { video: { url: VIDEO_URL, content_type: 'video/mp4' } },
        statusPayload: { status: 'OK' },
      }),
    ).rejects.toBeInstanceOf(PermanentStepError);
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'broll_clip')).toBeUndefined();
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'cta_clip')).toBeUndefined();
    expect((await getGeneration(tdb.db, gen.id))?.status).toBe('submitted');
  });

  it('node_key desconocido (p.ej. N7c) en ruta de vídeo b-roll → PermanentStepError (no fallback silencioso)', async () => {
    // Un step cuyo node_key no es N7d ni N7f no produce vídeo b-roll: derivar broll_clip por defecto
    // enmascararía la inconsistencia. Se lanza ruidoso.
    const stepId = await seedStep('N7c');
    const gen = await seedVideoGen({ stepRunId: stepId });
    await expect(
      finalizeGenerationByKind(deps(), {
        generation: gen,
        output: { video: { url: VIDEO_URL, content_type: 'video/mp4' } },
        statusPayload: { status: 'OK' },
      }),
    ).rejects.toBeInstanceOf(PermanentStepError);
    expect(await getAssetByGenerationKind(tdb.db, gen.id, 'broll_clip')).toBeUndefined();
  });
});

// ── T5c.7 Parte 2+3: la ruta REUSE/dedup (§9.6) y la remediación de la FILA ENVENENADA ────────────
// El dedup recibe el `assetKind` como PARÁMETRO (no lo deriva): quien lo llama debe pasar `cta_clip`
// para N7f. Una fila N7f `completed` cuyo asset quedó `broll_clip` (el envenenamiento que dejó el bug)
// hace que un dedup posterior con `cta_clip` dé `undefined` → la fila `completed` satisface el índice
// parcial de producción → el INSERT choca → re-lookup undefined → `LoserRaceError` EN BUCLE (nunca
// autocura). La remediación (re-kinding el asset a `cta_clip`) restaura el reuse a $0.
describe('resolveProductionDedup — reuse de N7f y remediación de la fila envenenada (T5c.7 §9.6)', () => {
  const BODY = 'video/mp4';

  /** Fabrica una generación de vídeo `completed` con su asset del `assetKind` dado y un `content_hash`
   *  compartido — la forma en que N7f dejó su fila (bien o envenenada). */
  async function seedCompletedVideoWithAsset(args: {
    contentHash: string;
    assetKind: 'broll_clip' | 'cta_clip';
    stepRunId: string;
  }): Promise<{ generationId: string; assetId: string }> {
    const gen = await seedVideoGen({
      stepRunId: args.stepRunId,
      contentHash: args.contentHash,
      status: 'submitted',
    });
    await updateGeneration(tdb.db, gen.id, { status: 'completed', completedAt: new Date() });
    const created = await createAsset(tdb.db, {
      kind: args.assetKind,
      storageKey: `generations/${gen.id}/clip.mp4`,
      mime: BODY,
      bytes: 4,
      checksum: 'deadbeef',
      durationS: 8,
      generationId: gen.id,
    });
    return { generationId: gen.id, assetId: created.id };
  }

  /** El shape mínimo de `insertValues` que `resolveProductionDedup` necesita para el INSERT-if-absent. */
  function insertValues(contentHash: string, stepRunId: string) {
    return makeGeneration({
      modelProfileId: profiles.video!.id,
      contentHash,
      status: 'submitting',
      inputs: { duration: '8s' },
      stepRunId,
    });
  }

  /** Estrecha una `DedupResolution` a su rama `{ reused }` (o falla con un mensaje claro) — narrowing FUERA
   *  del assert para no meter `expect` en un condicional (regla lint `vitest/no-conditional-expect`). */
  function expectReused(res: Awaited<ReturnType<typeof resolveProductionDedup>>) {
    if (!('reused' in res)) {
      throw new Error(
        'se esperaba un dedup hit ({ reused }) pero se creó una fila submitting nueva',
      );
    }
    return res.reused;
  }

  it('FAST-HIT: una N7f completed con su asset cta_clip correcto → dedup con cta_clip la reutiliza (0 submits)', async () => {
    const stepId = await seedStep('N7f');
    const hash = 'a'.repeat(64);
    const { generationId, assetId } = await seedCompletedVideoWithAsset({
      contentHash: hash,
      assetKind: 'cta_clip',
      stepRunId: stepId,
    });
    const res = await resolveProductionDedup(tdb.db, {
      contentHash: hash,
      assetKind: 'cta_clip',
      insertValues: insertValues(hash, stepId),
      serviceLabel: 'runGenerateBroll',
      assetLabel: 'un clip de CTA',
    });
    const reused = expectReused(res);
    expect(reused.generation.id).toBe(generationId);
    expect(reused.assetId).toBe(assetId);
    // No insertó una fila `submitting` nueva: solo existe la `completed` reutilizada.
    const gens = await tdb.db.query.generation.findMany({
      where: (g, { eq: e }) => e(g.contentHash, hash),
    });
    expect(gens).toHaveLength(1);
  });

  it('FILA ENVENENADA: N7f completed con asset broll_clip → dedup con cta_clip lanza LoserRaceError EN BUCLE (nunca autocura)', async () => {
    // El estado exacto que dejó el bug de T5c.4: la fila N7f está `completed` (satisface el índice parcial
    // de producción) pero su asset quedó `broll_clip` en vez de `cta_clip`.
    const stepId = await seedStep('N7f');
    const hash = 'b'.repeat(64);
    await seedCompletedVideoWithAsset({
      contentHash: hash,
      assetKind: 'broll_clip', // ← ENVENENADO
      stepRunId: stepId,
    });

    // Un dedup con el kind CORRECTO (cta_clip) no halla el asset → INSERT choca contra el índice parcial
    // (ya hay una fila completed con ese hash) → re-lookup undefined → LoserRaceError. Y REPETIR el dedup
    // da LO MISMO: la fila envenenada nunca se autocura, el bucle de retry quema CPU para siempre.
    const attempt = () =>
      resolveProductionDedup(tdb.db, {
        contentHash: hash,
        assetKind: 'cta_clip',
        insertValues: insertValues(hash, stepId),
        serviceLabel: 'runGenerateBroll',
        assetLabel: 'un clip de CTA',
      });
    await expect(attempt()).rejects.toBeInstanceOf(LoserRaceError);
    await expect(attempt()).rejects.toBeInstanceOf(LoserRaceError); // sigue rojo: no autocura

    // REMEDIACIÓN: re-kinding del asset envenenado a cta_clip (preserva el reuse $0 vs marcar failed y
    // re-pagar). Es EXACTAMENTE el UPDATE one-off que el bucle corre contra la única fila dev (no un
    // script de prod: en prod hay 0 filas envenenadas). Tras remediar, el MISMO dedup pasa a FAST-HIT.
    const poisonedGenId = (
      await tdb.db.query.generation.findMany({
        where: (g, { eq: e }) => e(g.contentHash, hash),
      })
    )[0]!.id;
    await tdb.pool.query(
      `UPDATE asset SET kind = 'cta_clip' WHERE generation_id = $1 AND kind = 'broll_clip'`,
      [poisonedGenId],
    );
    const healed = expectReused(await attempt());
    expect(healed.asset.kind).toBe('cta_clip');
  });
});
