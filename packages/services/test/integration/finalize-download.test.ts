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
  createGeneration,
  getAsset,
  getAssetByGenerationKind,
  getGeneration,
  getModelProfileByEndpoint,
  makeLocalStorageAdapter,
  seedGallery,
  type ModelProfile,
} from '@ugc/db';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createTestDatabase, makeGeneration, type TestDatabase } from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';
import type { OutputDownloader } from '../../src/finalize-generation';

import { finalizeGenerationByKind } from '../../src/finalize-download';

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
  await tdb.pool.query('TRUNCATE TABLE generation, asset, cost_entry CASCADE');
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
    const gen = await seedGen('video', { duration: '8s' });
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
