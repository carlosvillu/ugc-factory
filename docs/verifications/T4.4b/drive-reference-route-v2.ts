// DRIVER LIVE v2 de la RE-VERIFICACIÓN de T4.4b (verifier-side, NO es código de producto ni test).
// Igual que v1 pero con las QUERIES ESCOPADAS a los generationId creados EN ESTE run (v1 dumpeaba
// TODA la tabla `generation`, arrastrando filas viejas). Conduce el EXECUTOR REAL `makeN7aExecutor`
// (ruta de referencias `upload_images`) contra fal REAL con las 3 fotos del producto propio del
// usuario. Ejerce la cadena completa: puente URL→asset → uploadInputCached → imageEditAdapter (9:16)
// → runGenerate (submit/poll/finalize CON EL FIX del parser tolerante) → synthetic_product=false +
// cost_entry NO-CERO por shot. Mide dims REALES del OUTPUT descargado (9:16 sobre el fichero, NO la
// request; el parser tolerante deja width/height NULL en la fila `asset`). GASTA dinero real (~$0,12).
//
// CÓMO SE EJECUTA (los workspace deps @ugc/* + sharp solo resuelven DESDE apps/worker):
//   cp docs/verifications/T4.4b/drive-reference-route-v2.ts apps/worker/scripts/_verifier-drive-t44b.ts
//   (import del executor → `../src/executors/generation`)
//   cd apps/worker && set -a && . ../../.env && set +a && \
//   DOCKER_HOST="unix://$HOME/.docker/run/docker.sock" pnpm exec tsx scripts/_verifier-drive-t44b.ts
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { createDbPool, getAsset, makeLocalStorageAdapter } from '@ugc/db';
import { project, urlAnalysis, productBrief } from '@ugc/db/schema';
import { makeBrief, makeProject, makeUrlAnalysis } from '@ugc/test-utils';
import { makeN7aExecutor } from '../src/executors/generation';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const PRODUCT_DIR = path.join(REPO_ROOT, 'docs/verifications/T4.4b/producto');
const OUT_DIR = path.join(REPO_ROOT, 'docs/verifications/T4.4b');
const PHOTOS = ['retinol-hero-1.avif', 'retinol-hero-2.avif', 'retinol-hero-3.avif'];
const NUM_SHOTS = 3;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`drive: falta ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const falKey = requireEnv('FAL_KEY');
  const dbUrl = requireEnv('DATABASE_URL');

  const server = createServer((req, res) => {
    const name = (req.url ?? '').replace(/^\//, '');
    if (!PHOTOS.includes(name)) {
      res.writeHead(404).end();
      return;
    }
    readFile(path.join(PRODUCT_DIR, name))
      .then((buf) => {
        res.writeHead(200, { 'content-type': 'image/avif' }).end(buf);
      })
      .catch(() => res.writeHead(500).end());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${String(port)}`;
  console.log(`drive: sirviendo producto en ${base}`);

  const storageRoot = path.join(OUT_DIR, '.storage');
  const storage = makeLocalStorageAdapter({ root: storageRoot });
  const { db, pool } = createDbPool(dbUrl);

  try {
    const brief = makeBrief({
      product: {
        name: 'Retinol 5X Overnight Mask',
        brand_name: 'Retinol',
        category: 'skincare',
        subcategory: 'tratamiento de noche',
        one_liner: 'Mascarilla de noche con Retinol 5X que firma, tonifica y alisa',
        description:
          'Tarro de mascarilla facial de noche. Tapa dorada, cuerpo ámbar translúcido, con la marca "Retinol" y el distintivo "5X".',
        features: [{ feature: 'Retinol 5X', evidence: 'concentración 5X en la etiqueta' }],
        how_it_works: 'Se aplica por la noche sobre la piel limpia.',
        variants: ['50ml'],
      },
      assets: {
        hero_image_url: `${base}/${PHOTOS[0]}`,
        images: PHOTOS.map((p) => ({
          url: `${base}/${p}`,
          kind: 'packshot' as const,
          has_overlay_text: true,
          background: 'clean' as const,
          video_suitability: 'hero' as const,
        })),
        video_urls: [],
      },
    });

    const [p] = await db.insert(project).values(makeProject()).returning();
    const [ua] = await db
      .insert(urlAnalysis)
      .values(makeUrlAnalysis({ projectId: p!.id }))
      .returning();
    const [row] = await db
      .insert(productBrief)
      .values({ urlAnalysisId: ua!.id, data: brief, language: 'es' })
      .returning();
    const briefId = row!.id;
    console.log(`drive: brief sembrado ${briefId} (3 fotos referencia)`);

    const stepId = '01JT44BREVERIFYXXXXXXXXXXXX';
    const outputs: unknown[] = [];
    const executor = makeN7aExecutor({ db, storage, falKey });
    console.log(`drive: ejecutando makeN7aExecutor (upload_images, ${String(NUM_SHOTS)} shots) contra fal REAL…`);
    await executor({
      config: { route: 'upload_images', briefId, numShots: NUM_SHOTS, aspect: '9:16' },
      collectOutput: (refs: unknown) => outputs.push(refs),
      stepId,
      deps: [],
    });

    const out = outputs[0] as {
      route: string;
      syntheticProduct: boolean;
      shots: { generationId: string; assetId: string; costCents: number }[];
    };
    console.log(`drive: OUTPUT route=${out.route} syntheticProduct=${String(out.syntheticProduct)} shots=${String(out.shots.length)}`);

    const genIds = out.shots.map((s) => s.generationId);

    console.log('─'.repeat(70));
    for (let i = 0; i < out.shots.length; i++) {
      const shot = out.shots[i]!;
      const asset = await getAsset(db, shot.assetId);
      const stream = await storage.get(asset!.storageKey);
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      const outPath = path.join(OUT_DIR, `0${String(i + 1)}-shot-${String(i + 1)}.png`);
      await writeFile(outPath, Buffer.from(bytes));
      const meta = await sharp(Buffer.from(bytes)).metadata();
      const ratio = meta.width! / meta.height!;
      console.log(
        `drive: shot ${String(i + 1)} → ${String(meta.width)}×${String(meta.height)} px · ratio=${ratio.toFixed(4)} (9:16=0.5625) · costCents=${String(shot.costCents)} · asset.width=${String(asset!.width)} asset.height=${String(asset!.height)} · ${outPath}`,
      );
    }
    console.log('─'.repeat(70));

    // Queries ESCOPADAS a los generationId de ESTE run.
    const gens = await pool.query<{
      id: string;
      status: string;
      synthetic_product: boolean;
      inputs: { image_urls?: string[]; image_size?: string; num_images?: number };
      model_profile_id: string;
    }>(
      "SELECT id, status, synthetic_product, inputs, model_profile_id FROM generation WHERE id = ANY($1) ORDER BY id",
      [genIds],
    );
    console.log(`drive: generation rows (THIS run) = ${String(gens.rows.length)}`);
    for (const g of gens.rows) {
      console.log(
        `  ${g.id} status=${g.status} synthetic_product=${String(g.synthetic_product)} image_size=${String(g.inputs.image_size)} refs=${String((g.inputs.image_urls ?? []).length)} num_images=${String(g.inputs.num_images)}`,
      );
    }

    // cost_entry ESCOPADO al step: COUNT + MIN + SUM (cada fila debe ser NO-CERO, no solo el SUM).
    const costs = await pool.query<{ n: string; total: string | null; minc: string | null; maxc: string | null }>(
      "SELECT COUNT(*)::text AS n, SUM(amount_cents)::text AS total, MIN(amount_cents)::text AS minc, MAX(amount_cents)::text AS maxc FROM cost_entry WHERE provider = 'fal' AND step_run_id = $1",
      [stepId],
    );
    const c = costs.rows[0]!;
    console.log(
      `drive: cost_entry fal del step = ${c.n} filas · total ${String(c.total)} · MIN ${String(c.minc)} · MAX ${String(c.maxc)} céntimos (esperado: 3 filas, cada una 4, total 12)`,
    );

    // Detalle por fila (para probar que NINGUNA es 0 — la fuga era 0 filas / o filas a 0).
    const perRow = await pool.query<{ amount_cents: number; quantity: number; unit: string; generation_id: string }>(
      "SELECT amount_cents, quantity, unit, generation_id FROM cost_entry WHERE provider = 'fal' AND step_run_id = $1 ORDER BY id",
      [stepId],
    );
    for (const r of perRow.rows) {
      console.log(`  cost_entry: amount_cents=${String(r.amount_cents)} quantity=${String(r.quantity)} unit=${r.unit} gen=${r.generation_id}`);
    }
  } finally {
    await pool.end();
    server.close();
  }
}

main().catch((err: unknown) => {
  console.error('drive: FALLO —', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
