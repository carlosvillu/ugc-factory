// VERIFIER T5.5d — harness INDEPENDIENTE (no es el test del implementer). Seed hook·body·cta·body, corre el
// executor N8 REAL con fakes, y DUMPEA a docs/verifications/T5.5d/: la CompositionSpec ensamblada, la fila
// final_video con parent_asset_ids, el qa_report, un WALK recursivo del linaje, y el control negativo del
// throw (cta sin N7f). Assertions PROPIAS del verifier (inputs elegidos por mí; no reuso los del implementer).
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { newUlid } from '@ugc/core/contracts';
import { assembleCompositionSpec } from '@ugc/services';
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
const EV = '/Users/carlosvillu/Developer/__GARBAGE__/UGC_Ads/docs/verifications/T5.5d';
const MP4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

// DISTINCT bytes por output: el path va DENTRO del buffer → cada fitted/normalized tiene checksum ÚNICO,
// así la caché normalize-once (T5.2) NO folda segmentos distintos (bajo bytes idénticos SÍ lo haría — es la
// razón del colapso 3/9 con el MP4 fijo). Con bytes distintos el linaje llega a los 9 N7 raw.
const fakeFfmpeg = async (args: string[]) => {
  const out = args[args.length - 1];
  if (out !== undefined && !out.startsWith('-'))
    await writeFile(out, Buffer.concat([Buffer.from(MP4), Buffer.from(out)]));
  return { code: 0, stderr: '' };
};
const fakeFfprobe = (args: string[]) => {
  const wantsJson = args.includes('-show_streams') || args.includes('json');
  if (wantsJson) {
    return Promise.resolve({
      code: 0,
      stdout: JSON.stringify({
        streams: [
          { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p', r_frame_rate: '30/1', duration: '3.000' },
          { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, bit_rate: '128000', duration: '3.000' },
        ],
        format: { duration: '3.000' },
      }),
      stderr: '',
    });
  }
  return Promise.resolve({ code: 0, stdout: '3.000\n', stderr: '' });
};
const fakeC2pa = async (args: string[]) => {
  const oIdx = args.indexOf('-o');
  const out = oIdx >= 0 ? args[oIdx + 1] : undefined;
  if (out !== undefined) await writeFile(out, Buffer.from(MP4));
  return { code: 0, stderr: '' };
};
const fakeLoudness = () => Promise.resolve(-14);

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'verifier:t55d' });
  assetsDir = mkdtempSync(path.join(tmpdir(), 'ugc-v55d-'));
  storage = makeLocalStorageAdapter({ root: assetsDir });
  mkdirSync(EV, { recursive: true });
});
afterAll(async () => {
  await tdb.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

async function makeAsset(db: any, kind: Asset['kind'], durationS: number, wt?: unknown): Promise<Asset> {
  const key = `n7/${kind}/${newUlid()}`;
  // Bytes ÚNICOS por asset (la key va dentro): las voces SALTAN el fitter, así que su cache key de
  // normalización es el checksum del asset RAW — bytes idénticos las foldarían. Con bytes distintos, no.
  const put = await storage.put(key, Buffer.concat([Buffer.from(MP4), Buffer.from(key)]), { mime: 'video/mp4' });
  return createAsset(db, {
    kind, storageKey: key, mime: 'video/mp4', bytes: put.bytes, checksum: put.checksum, durationS,
    ...(wt !== undefined ? { wordTimestamps: wt } : {}),
  });
}
async function seed(db: any, scenes: { segment: 'hook' | 'body' | 'cta'; narration: string }[]) {
  const [p] = await db.insert(project).values(makeProject()).returning();
  const [ua] = await db.insert(urlAnalysis).values(makeUrlAnalysis({ projectId: p.id })).returning();
  const [brief] = await db.insert(productBrief).values(makeProductBrief({ urlAnalysisId: ua.id })).returning();
  const [batch] = await db.insert(adBatch).values(makeAdBatch({ projectId: p.id, briefId: brief.id })).returning();
  const [variant] = await db.insert(adVariant).values(makeAdVariant({ batchId: batch.id })).returning();
  const [script] = await db.insert(adScript).values(makeAdScript({
    variantId: variant.id,
    scenes: scenes.map((s) => ({ t: 0, seconds: 3, segment: s.segment, narration: s.narration, visual: 'v', camera: 'static', emotion: 'neutral' })),
  })).returning();
  return { variantId: variant.id, scriptId: script.id };
}
const dep = (nodeKey: string, outputRefs: unknown) => ({ stepId: newUlid(), nodeKey, status: 'succeeded' as const, outputRefs });

async function walkLineage(db: any, rootId: string): Promise<Record<string, string[]>> {
  const { getAsset } = await import('@ugc/db');
  const out: Record<string, string[]> = {};
  const q = [rootId];
  const seen = new Set<string>();
  while (q.length) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const a = await getAsset(db, id);
    const parents = (a as any)?.parentAssetIds ?? [];
    out[`${id} (${(a as any)?.kind})`] = parents.map((pid: string) => pid);
    for (const pid of parents) q.push(pid);
  }
  return out;
}

describe('VERIFIER T5.5d', () => {
  it('ESPINA hook·body·cta·body → máster + parent_asset_ids + qa_report + walk + cta desde N7f', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      const { variantId, scriptId } = await seed(db, [
        { segment: 'hook', narration: 'hook line' },
        { segment: 'body', narration: 'first body' },
        { segment: 'cta', narration: 'buy now' },
        { segment: 'body', narration: 'second body' },
      ]);
      const avatar = await makeAsset(db, 'avatar_clip', 5);
      const brollA = await makeAsset(db, 'broll_clip', 6);
      const brollB = await makeAsset(db, 'broll_clip', 6);
      const ctaClip = await makeAsset(db, 'cta_clip', 5);
      const bed = await makeAsset(db, 'music_bed', 20);
      const vo0 = await makeAsset(db, 'tts_audio', 2.1, { text: 'hook line', words: [{ type: 'word', text: 'hook', start: 0, end: 0.4 }] });
      const vo1 = await makeAsset(db, 'tts_audio', 2.7);
      const vo2 = await makeAsset(db, 'tts_audio', 1.8);
      const vo3 = await makeAsset(db, 'tts_audio', 2.9);

      const rawN7Ids = { avatar: avatar.id, brollA: brollA.id, brollB: brollB.id, ctaClip: ctaClip.id, bed: bed.id, vo0: vo0.id, vo1: vo1.id, vo2: vo2.id, vo3: vo3.id };

      const deps = [
        dep('N7c', { avatarEndpoint: 'fal-ai/kling/avatar', generationId: 'g-av', assetId: avatar.id, durationSeconds: 5, costCents: 22 }),
        dep('N7b', { scriptId, language: 'es', clips: [
          { sceneIndex: 0, generationId: 'g0', assetId: vo0.id, durationSeconds: 2.1, wordCount: 2, ttsCostCents: 1, asrCostCents: 1 },
          { sceneIndex: 1, generationId: 'g1', assetId: vo1.id, durationSeconds: 2.7, wordCount: 2, ttsCostCents: 1, asrCostCents: 1 },
          { sceneIndex: 2, generationId: 'g2', assetId: vo2.id, durationSeconds: 1.8, wordCount: 2, ttsCostCents: 1, asrCostCents: 1 },
          { sceneIndex: 3, generationId: 'g3', assetId: vo3.id, durationSeconds: 2.9, wordCount: 2, ttsCostCents: 1, asrCostCents: 1 },
        ] }),
        dep('N7d', { scriptId, brollEndpoint: 'fal-ai/veo/i2v', route: 'i2v', clips: [
          { bodySceneIndex: 0, clipIndex: 0, generationId: 'gb0', assetId: brollA.id, durationSeconds: 6, costCents: 30 },
          { bodySceneIndex: 1, clipIndex: 0, generationId: 'gb1', assetId: brollB.id, durationSeconds: 6, costCents: 30 },
        ] }),
        dep('N7f', { scriptId, ctaEndpoint: 'fal-ai/veo/i2v', route: 'i2v', clips: [
          { ctaSceneIndex: 0, clipIndex: 0, generationId: 'gc0', assetId: ctaClip.id, durationSeconds: 5, costCents: 30 },
        ] }),
        dep('N7e', { musicEndpoint: 'fal-ai/ace-step', mood: 'upbeat', generationId: 'gm', assetId: bed.id, durationSeconds: 20, costCents: 1 }),
      ];

      // (A) La CompositionSpec ensamblada (CRUDA — apunta a los N7 raw, antes de normalizar).
      const variantRow = await (await import('@ugc/db')).getVariant(db, variantId);
      const rawSpec = await assembleCompositionSpec({ db }, { variantId, deps, variantMaxDurationS: variantRow!.durationTarget });
      writeFileSync(path.join(EV, 'assembled-composition-spec.json'), JSON.stringify({ rawN7Ids, rawSpec }, null, 2));

      // ASSERTS del verifier sobre el spec crudo:
      expect(rawSpec.segments.map((s) => s.type)).toEqual(['hook', 'body', 'cta', 'body']);
      // El segmento cta apunta al clip de N7f, NO al avatar de N7c ni al b-roll:
      expect(rawSpec.segments[2]!.videoAsset).toBe(ctaClip.id);
      expect(rawSpec.segments[2]!.videoAsset).not.toBe(avatar.id);
      expect(rawSpec.segments[2]!.voAudio).toBe(vo2.id);
      // Índices: 1er body → brollA+vo1; 2º body → brollB+vo3 (no cruzados):
      expect(rawSpec.segments[1]!.videoAsset).toBe(brollA.id);
      expect(rawSpec.segments[1]!.voAudio).toBe(vo1.id);
      expect(rawSpec.segments[3]!.videoAsset).toBe(brollB.id);
      expect(rawSpec.segments[3]!.voAudio).toBe(vo3.id);
      expect(rawSpec.music?.asset).toBe(bed.id);

      // (B) Corre el executor N8 REAL (fakes de ffmpeg) → persiste el máster.
      const outputs: unknown[] = [];
      await makeN8Executor({ db, storage, runner: fakeFfmpeg, ffprobe: fakeFfprobe, c2paSigner: fakeC2pa, loudnessMeter: fakeLoudness, logger: makeTestLogger() })({
        variantId, config: {}, collectOutput: (r) => outputs.push(r), deps,
      });

      const { rows: masters } = await pool.query('SELECT id, kind, parent_asset_ids, duration_s, width, height FROM asset WHERE kind = $1', ['final_video']);
      const { rows: variants } = await pool.query('SELECT master_asset_id, thumbnail_asset_id, qa_report, score FROM ad_variant WHERE id = $1', [variantId]);
      writeFileSync(path.join(EV, 'final-video-row.json'), JSON.stringify(masters[0], null, 2));
      writeFileSync(path.join(EV, 'ad-variant-row.json'), JSON.stringify(variants[0], null, 2));
      writeFileSync(path.join(EV, 'qa-report.json'), JSON.stringify(variants[0].qa_report, null, 2));
      writeFileSync(path.join(EV, 'n8-output.json'), JSON.stringify(outputs[0], null, 2));

      // (C) WALK del linaje: master → ... → N7 raw.
      const walk = await walkLineage(db, masters[0].id);
      const rawIdSet = new Set(Object.values(rawN7Ids));
      const walkedIds = new Set(Object.keys(walk).map((k) => k.split(' ')[0]));
      const n7Reached = [...rawIdSet].filter((id) => walkedIds.has(id));
      writeFileSync(path.join(EV, 'lineage-walk.json'), JSON.stringify({ walk, rawN7Ids, n7ReachedFromMaster: n7Reached, allN7Reached: n7Reached.length === rawIdSet.size }, null, 2));

      // ASSERTS: máster existe, ad_variant apunta a él, qa_report poblado.
      expect(masters).toHaveLength(1);
      expect(variants[0].master_asset_id).toBe(masters[0].id);
      expect(variants[0].thumbnail_asset_id).toBeTruthy();
      expect(variants[0].qa_report).toBeTruthy();
      expect(variants[0].qa_report.score).toBeGreaterThanOrEqual(0);
      // ¿parent_asset_ids del máster contiene DIRECTAMENTE los N7 raw? (esperado: NO — son los normalizados)
      const directN7 = (masters[0].parent_asset_ids as string[]).filter((id) => rawIdSet.has(id));
      writeFileSync(path.join(EV, 'parent-asset-ids-analysis.json'), JSON.stringify({
        masterParentAssetIds: masters[0].parent_asset_ids,
        rawN7Ids,
        directRawN7InParents: directN7,
        note: 'parent_asset_ids DIRECTOS del máster = assets NORMALIZADOS (video normalizado + voz normalizada + bed); los N7 raw se alcanzan por WALK transitivo (ver lineage-walk.json)',
      }, null, 2));
      // El linaje transitivo DEBE alcanzar TODOS los 9 N7 raw (con bytes distintos, la caché no folda).
      expect(n7Reached.length).toBe(rawIdSet.size);
    } finally {
      await pool.end();
    }
  });

  it('CONTROL NEGATIVO: guion con cta pero SIN dep N7f → PermanentStepError (no reusa avatar)', async () => {
    const { db, pool } = createDbPool(tdb.connectionString);
    try {
      await pool.query('TRUNCATE ad_script, ad_variant, ad_batch, product_brief, url_analysis, project, asset CASCADE');
      const { variantId, scriptId } = await seed(db, [
        { segment: 'hook', narration: 'hook' },
        { segment: 'cta', narration: 'buy' },
      ]);
      const avatar = await makeAsset(db, 'avatar_clip', 5);
      const vo0 = await makeAsset(db, 'tts_audio', 2);
      const vo1 = await makeAsset(db, 'tts_audio', 2);
      // deps SIN N7f (la CTA no tiene su clip). El bug de T5.5a habría reusado el avatar.
      const deps = [
        dep('N7c', { avatarEndpoint: 'fal-ai/kling/avatar', generationId: 'g-av', assetId: avatar.id, durationSeconds: 5, costCents: 22 }),
        dep('N7b', { scriptId, language: 'es', clips: [
          { sceneIndex: 0, generationId: 'g0', assetId: vo0.id, durationSeconds: 2, wordCount: 1, ttsCostCents: 1, asrCostCents: 1 },
          { sceneIndex: 1, generationId: 'g1', assetId: vo1.id, durationSeconds: 2, wordCount: 1, ttsCostCents: 1, asrCostCents: 1 },
        ] }),
      ];
      let threw: unknown;
      try {
        await makeN8Executor({ db, storage, runner: fakeFfmpeg, ffprobe: fakeFfprobe, c2paSigner: fakeC2pa, loudnessMeter: fakeLoudness, logger: makeTestLogger() })({
          variantId, config: {}, collectOutput: () => undefined, deps,
        });
      } catch (e) { threw = e; }
      // NO se creó ningún máster (no degradó reusando el avatar).
      const { rows: masters } = await pool.query('SELECT id FROM asset WHERE kind = $1', ['final_video']);
      writeFileSync(path.join(EV, 'negative-control-cta-no-n7f.json'), JSON.stringify({
        threw: threw instanceof Error ? { name: threw.constructor.name, message: threw.message } : threw,
        isPermanentStepError: threw instanceof PermanentStepError,
        mastersCreated: masters.length,
      }, null, 2));
      expect(threw).toBeInstanceOf(PermanentStepError);
      expect(masters).toHaveLength(0);
    } finally {
      await pool.end();
    }
  });
});
