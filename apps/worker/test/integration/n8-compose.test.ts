// Integración del executor N8 · COMPOSICIÓN (T5.5d, §9.7 N8). Ejerce el CABLEADO del executor: ensamblar la
// CompositionSpec desde las deps N7 (por schema), encadenar fitter→normalize→compose→persist, y persistir el
// máster (`finalizeVariantMaster`: filas final_video + thumbnail + update de ad_variant). Postgres 16 REAL
// (Testcontainers). $0 ESTRICTO: ffmpeg/ffprobe/c2patool/loudness se INYECTAN como FAKES — cero fal, cero
// binarios. El end-to-end con ffmpeg REAL vive en la suite media (`apps/worker/test/media`, gated RUN_MEDIA);
// aquí se prueba que la orquestación conecta las piezas y produce los efectos de BD. Molde: n7c/n7e.
//
// EL FAKE ffprobe devuelve JSON canónico (streams+format) en CADA probe de la cadena (fitter mide duración;
// composeMaster/composeVariant miden duración de segmento + streams del máster). El FAKE ffmpeg ESCRIBE un
// fichero mínimo a su `-y <out>` (fitter/normalizer/compose leen su salida aguas abajo) — sin esto la cadena
// rompería al no encontrar el output. El fake NUNCA es más cómodo que la realidad en lo que este test AFIRMA
// (la orquestación + los efectos de BD); la fidelidad de bytes de ffmpeg es lo que la suite media cubre.
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { newUlid } from '@ugc/core/contracts';
import { createAsset, createDbPool, makeLocalStorageAdapter, type Asset } from '@ugc/db';
import { adBatch, adVariant, productBrief, project, urlAnalysis, adScript } from '@ugc/db/schema';
import {
  createTestDatabase,
  makeAdBatch,
  makeAdScript,
  makeAdVariant,
  makeProductBrief,
  makeProject,
  makeTestLogger,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import type { StorageAdapter } from '@ugc/core';

import { makeN8Executor } from '../../src/executors/compose-variant';

let tdb: TestDatabase;
let storage: StorageAdapter;
let assetsDir: string;

const MP4_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

/** FAKE ffmpeg: escribe un fichero mínimo a su `-y <out>` (última posición) y devuelve éxito. La cadena
 *  (fitter→normalize→compose) lee ese output aguas abajo — sin escribirlo, el paso siguiente rompería. */
const fakeFfmpeg = async (args: string[]): Promise<{ code: number | null; stderr: string }> => {
  const out = args[args.length - 1];
  if (out !== undefined && !out.startsWith('-')) {
    await writeFile(out, Buffer.from(MP4_BYTES));
  }
  return { code: 0, stderr: '' };
};

/** FAKE ffprobe: responde a las DOS formas que la cadena usa — `format=duration` (fitter + compose miden
 *  duración) y `-show_streams -show_format` JSON (QA del máster). Valores canónicos (1080×1920/30fps/H.264/
 *  yuv420p, ~3 s) para que el QA no rechace por perfil. */
const fakeFfprobe = (
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> => {
  const wantsJson = args.includes('-show_streams') || args.includes('json');
  if (wantsJson) {
    const probe = {
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1080,
          height: 1920,
          pix_fmt: 'yuv420p',
          r_frame_rate: '30/1',
          duration: '3.000',
        },
        {
          codec_type: 'audio',
          codec_name: 'aac',
          sample_rate: '48000',
          channels: 2,
          bit_rate: '128000',
          duration: '3.000',
        },
      ],
      format: { duration: '3.000' },
    };
    return Promise.resolve({ code: 0, stdout: JSON.stringify(probe), stderr: '' });
  }
  // `format=duration` en texto plano.
  return Promise.resolve({ code: 0, stdout: '3.000\n', stderr: '' });
};

/** FAKE c2patool: éxito sin firmar (el fichero de entrada ya existe; el test no inspecciona la firma). */
const fakeC2pa = async (args: string[]): Promise<{ code: number | null; stderr: string }> => {
  // c2patool escribe con `-o <out>`: se copia el input al output para que el paso de QA lo encuentre.
  const oIdx = args.indexOf('-o');
  const out = oIdx >= 0 ? args[oIdx + 1] : undefined;
  if (out !== undefined) await writeFile(out, Buffer.from(MP4_BYTES));
  return { code: 0, stderr: '' };
};

/** FAKE loudness: −14 LUFS (el target del preset → el check de loudness pasa). */
const fakeLoudness = (): Promise<number> => Promise.resolve(-14);

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:n8' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-n8-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
});

afterEach(async () => {
  await tdb.pool.query(
    'TRUNCATE ad_script, ad_variant, ad_batch, product_brief, url_analysis, project, asset CASCADE',
  );
});

afterAll(async () => {
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

/** Crea un asset de vídeo/audio en storage + BD (los clips crudos de N7 que N8 compone). */
async function makeAsset(
  db: ReturnType<typeof createDbPool>['db'],
  kind: Asset['kind'],
  durationS: number,
  wordTimestamps?: unknown,
): Promise<Asset> {
  const key = `n7/${kind}/${newUlid()}`;
  const put = await storage.put(key, MP4_BYTES, { mime: 'video/mp4' });
  return createAsset(db, {
    kind,
    storageKey: key,
    mime: 'video/mp4',
    bytes: put.bytes,
    checksum: put.checksum,
    durationS,
    ...(wordTimestamps !== undefined ? { wordTimestamps } : {}),
  });
}

/** Siembra project→…→variant + guion, devuelve `{variantId, scriptId}`. `scenes` con el shape de
 *  `AdSceneSchema` (t/seconds/segment/narration/visual/camera/emotion) — el default del factory usa otro. */
async function seedVariantWithScript(
  db: ReturnType<typeof createDbPool>['db'],
  scenes: { segment: 'hook' | 'body' | 'cta'; narration: string }[],
): Promise<{ variantId: string; scriptId: string }> {
  const [p] = await db.insert(project).values(makeProject()).returning();
  const [ua] = await db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const [brief] = await db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id }))
    .returning();
  const [batch] = await db
    .insert(adBatch)
    .values(makeAdBatch({ projectId: p!.id, briefId: brief!.id }))
    .returning();
  const [variant] = await db
    .insert(adVariant)
    .values(makeAdVariant({ batchId: batch!.id }))
    .returning();
  const [script] = await db
    .insert(adScript)
    .values(
      makeAdScript({
        variantId: variant!.id,
        scenes: scenes.map((s) => ({
          t: 0,
          seconds: 3,
          segment: s.segment,
          narration: s.narration,
          visual: 'visual',
          camera: 'static',
          emotion: 'neutral',
        })),
      }),
    )
    .returning();
  return { variantId: variant!.id, scriptId: script!.id };
}

/** Envuelve un `outputRefs` en un `ExecutorDep` completo (el executor solo lee `outputRefs`; los otros
 *  campos son de forma). `nodeKey` limpio, `status` succeeded. */
function dep(nodeKey: string, outputRefs: unknown) {
  return { stepId: newUlid(), nodeKey, status: 'succeeded' as const, outputRefs };
}

function makeExecutor(db: ReturnType<typeof createDbPool>['db']) {
  return makeN8Executor({
    db,
    storage,
    runner: fakeFfmpeg,
    ffprobe: fakeFfprobe,
    c2paSigner: fakeC2pa,
    loudnessMeter: fakeLoudness,
    logger: makeTestLogger(),
  });
}

describe('N8 executor (T5.5d): composición', () => {
  it('ESPINA hook·body·cta·body: ensambla + rinde + persiste máster (final_video + thumbnail + ad_variant)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const { variantId, scriptId } = await seedVariantWithScript(db, [
        { segment: 'hook', narration: 'hook line' },
        { segment: 'body', narration: 'first body' },
        { segment: 'cta', narration: 'cta line' },
        { segment: 'body', narration: 'second body' },
      ]);

      // Clips crudos de N7: 1 avatar (hook), 2 b-roll (body), 1 cta (N7f — la CTA tiene su PROPIO clip, no
      // reusa el avatar). 4 voces (una por escena) — la voz del hook lleva word timestamps (para las
      // captions). Duraciones MEDIDAS ≥ narración (fitter recorta).
      const avatar = await makeAsset(db, 'avatar_clip', 5);
      const brollA = await makeAsset(db, 'broll_clip', 6);
      const brollB = await makeAsset(db, 'broll_clip', 6);
      const ctaClip = await makeAsset(db, 'cta_clip', 5);
      // Narraciones ≤ 3 s (el fake ffprobe mide los clips crudos a 3,0 s → el fitter recorta, no rellena
      // grosero). Distintas entre body para que el mapeo de índices sea observable.
      const vo0 = await makeAsset(db, 'tts_audio', 2.1, {
        text: 'hook line',
        words: [{ type: 'word', text: 'hook', start: 0, end: 0.4 }],
      });
      const vo1 = await makeAsset(db, 'tts_audio', 2.7);
      const vo2 = await makeAsset(db, 'tts_audio', 1.8);
      const vo3 = await makeAsset(db, 'tts_audio', 2.9);

      const deps = [
        dep('N7c', {
          avatarEndpoint: 'fal-ai/kling-video/ai-avatar/v2/standard',
          generationId: 'g-av',
          assetId: avatar.id,
          durationSeconds: 5,
          costCents: 22,
        }),
        dep('N7b', {
          scriptId,
          language: 'es',
          clips: [
            {
              sceneIndex: 0,
              generationId: 'g0',
              assetId: vo0.id,
              durationSeconds: 2.1,
              wordCount: 2,
              ttsCostCents: 1,
              asrCostCents: 1,
            },
            {
              sceneIndex: 1,
              generationId: 'g1',
              assetId: vo1.id,
              durationSeconds: 2.7,
              wordCount: 2,
              ttsCostCents: 1,
              asrCostCents: 1,
            },
            {
              sceneIndex: 2,
              generationId: 'g2',
              assetId: vo2.id,
              durationSeconds: 1.8,
              wordCount: 2,
              ttsCostCents: 1,
              asrCostCents: 1,
            },
            {
              sceneIndex: 3,
              generationId: 'g3',
              assetId: vo3.id,
              durationSeconds: 2.9,
              wordCount: 2,
              ttsCostCents: 1,
              asrCostCents: 1,
            },
          ],
        }),
        dep('N7d', {
          scriptId,
          brollEndpoint: 'fal-ai/veo3.1/image-to-video',
          route: 'i2v',
          clips: [
            {
              bodySceneIndex: 0,
              clipIndex: 0,
              generationId: 'gb0',
              assetId: brollA.id,
              durationSeconds: 6,
              costCents: 30,
            },
            {
              bodySceneIndex: 1,
              clipIndex: 0,
              generationId: 'gb1',
              assetId: brollB.id,
              durationSeconds: 6,
              costCents: 30,
            },
          ],
        }),
        // N7f: el clip de la escena cta (absoluta 2 → ctaSceneIndex 0). Su clave distintiva es `ctaEndpoint`
        // (no `brollEndpoint`) — así N8 lo discrimina de N7d por schema (par de riesgo T5.5d).
        dep('N7f', {
          scriptId,
          ctaEndpoint: 'fal-ai/veo3.1/image-to-video',
          route: 'i2v',
          clips: [
            {
              ctaSceneIndex: 0,
              clipIndex: 0,
              generationId: 'gc0',
              assetId: ctaClip.id,
              durationSeconds: 5,
              costCents: 30,
            },
          ],
        }),
      ];

      const outputs: unknown[] = [];
      await makeExecutor(db)({
        variantId,
        config: {},
        collectOutput: (refs: unknown) => outputs.push(refs),
        deps,
      });

      // El máster se persistió: 1 final_video + 1 thumbnail.
      const { rows: masters } = await tdb.pool.query<{ id: string }>(
        "SELECT id FROM asset WHERE kind = 'final_video'",
      );
      expect(masters).toHaveLength(1);
      const { rows: thumbs } = await tdb.pool.query(
        "SELECT id FROM asset WHERE kind = 'thumbnail'",
      );
      expect(thumbs).toHaveLength(1);

      // ad_variant apunta al máster + tiene qa_report + score.
      const { rows: variants } = await tdb.pool.query<{
        master_asset_id: string | null;
        thumbnail_asset_id: string | null;
        score: number | null;
      }>('SELECT master_asset_id, thumbnail_asset_id, score FROM ad_variant WHERE id = $1', [
        variantId,
      ]);
      expect(variants[0]?.master_asset_id).toBe(masters[0]?.id);
      expect(variants[0]?.thumbnail_asset_id).toBe(thumbs[0]?.id);
      expect(variants[0]?.score).toBeGreaterThanOrEqual(0);

      // El output ref de N8.
      expect(outputs).toHaveLength(1);
      const out = outputs[0] as {
        variantId: string;
        masterAssetId: string;
        thumbnailAssetId: string;
      };
      expect(out.variantId).toBe(variantId);
      expect(out.masterAssetId).toBe(masters[0]?.id);
    } finally {
      await pool.end();
    }
  });

  it('sin variantId en el ctx → PermanentStepError (composición es POR VARIANTE)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await expect(
        makeExecutor(db)({ config: {}, collectOutput: () => undefined, deps: [] }),
      ).rejects.toBeInstanceOf(PermanentStepError);
    } finally {
      await pool.end();
    }
  });

  it('variante sin NINGUNA fuente de vídeo (solo N7b) → PermanentStepError (nunca spec vacío)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const { variantId, scriptId } = await seedVariantWithScript(db, [
        { segment: 'body', narration: 'body' },
      ]);
      const vo0 = await makeAsset(db, 'tts_audio', 2);
      await expect(
        makeExecutor(db)({
          variantId,
          config: {},
          collectOutput: () => undefined,
          deps: [
            dep('N7b', {
              scriptId,
              language: 'es',
              clips: [
                {
                  sceneIndex: 0,
                  generationId: 'g0',
                  assetId: vo0.id,
                  durationSeconds: 2,
                  wordCount: 1,
                  ttsCostCents: 1,
                  asrCostCents: 1,
                },
              ],
            }),
          ],
        }),
      ).rejects.toBeInstanceOf(PermanentStepError);
    } finally {
      await pool.end();
    }
  });
});
