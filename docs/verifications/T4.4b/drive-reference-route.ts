// DRIVER LIVE de la Verificación de T4.4b (verifier-side, NO es código de producto ni test).
// Conduce el EXECUTOR REAL `makeN7aExecutor` (ruta de referencias `upload_images`) contra fal REAL,
// con las 3 fotos del producto propio del usuario como referencias. Ejerce la CADENA COMPLETA que el
// probe NO toca: puente URL→asset (descarga HTTP real + AVIF→PNG) → uploadInputCached → imageEditAdapter
// (9:16 propagado) → runGenerate (submit/poll/finalize) → synthetic_product=false + cost_entry por shot.
//
// Sirve un servidor HTTP local con las AVIF del producto para que `bridgeReferenceImageUrl` haga un
// fetch() REAL (faithful a producción: el hero es una URL descargable). Mide las dims REALES de cada
// output descargado (no de la request). Suma el coste de fal desde cost_entry. GASTA dinero real (~$0,12).
//
// CÓMO SE EJECUTÓ (los workspace deps `@ugc/*` + `sharp` solo resuelven DESDE apps/worker, por el
// store estricto de pnpm): se copió este fichero a `apps/worker/scripts/_verifier-drive-t44b.ts`
// (con el import del executor cambiado a `../src/executors/generation`), y se corrió:
//   cd apps/worker && set -a && . ../../.env && set +a && \
//   DOCKER_HOST="unix://$HOME/.docker/run/docker.sock" pnpm exec tsx scripts/_verifier-drive-t44b.ts
// El throwaway se borró tras capturar la salida (drive-output.txt). Esta copia en docs/ es la EVIDENCIA.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { createDbPool, getAsset, makeLocalStorageAdapter } from '@ugc/db';
import { project, urlAnalysis, productBrief } from '@ugc/db/schema';
import { makeBrief, makeProject, makeUrlAnalysis } from '@ugc/test-utils';
// (al correr desde apps/worker/scripts, este import es `../src/executors/generation`)
import { makeN7aExecutor } from '../../../apps/worker/src/executors/generation';

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

  // 1) Servidor HTTP local que sirve las AVIF del producto (hero descargable, faithful a producción).
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
    // 2) Brief REAL con el producto Retinol y las 3 fotos como referencias (ruta upload_images).
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

    // 3) EJECUTOR REAL contra fal REAL. stepId sintético → atribución del cost_entry al step (money-path).
    const stepId = '01JT44BVERIFYXXXXXXXXXXXXXX';
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

    // 4) Descargar cada shot desde NUESTRO storage, medir dims REALES, guardar PNG numerado.
    console.log('─'.repeat(70));
    for (let i = 0; i < out.shots.length; i++) {
      const shot = out.shots[i]!;
      const asset = await getAsset(db, shot.assetId);
      const stream = await storage.get(asset!.storageKey);
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      const outPath = path.join(OUT_DIR, `0${String(i + 1)}-shot-${String(i + 1)}.png`);
      await writeFile(outPath, Buffer.from(bytes));
      // Dims REALES del fichero DESCARGADO (no de la request): el 9:16 se ASSERTA aquí.
      const meta = await sharp(Buffer.from(bytes)).metadata();
      const ratio = meta.width! / meta.height!;
      console.log(
        `drive: shot ${String(i + 1)} → ${String(meta.width)}×${String(meta.height)} px · ratio=${ratio.toFixed(4)} (9:16=0.5625) · costCents=${String(shot.costCents)} · ${outPath}`,
      );
    }
    console.log('─'.repeat(70));

    // 5) Verificación observable en BD (fuente de verdad, no logs del código).
    const gens = await pool.query<{
      status: string;
      synthetic_product: boolean;
      inputs: { image_urls?: string[]; image_size?: string; num_images?: number };
      model_profile_id: string;
    }>(
      "SELECT status, synthetic_product, inputs, model_profile_id FROM generation ORDER BY id",
    );
    console.log(`drive: generation rows = ${String(gens.rows.length)}`);
    for (const g of gens.rows) {
      console.log(
        `  status=${g.status} synthetic_product=${String(g.synthetic_product)} image_size=${String(g.inputs.image_size)} refs=${String((g.inputs.image_urls ?? []).length)} num_images=${String(g.inputs.num_images)}`,
      );
    }
    const costs = await pool.query<{ total: string | null; n: string }>(
      "SELECT SUM(amount_cents)::text AS total, COUNT(*)::text AS n FROM cost_entry WHERE provider = 'fal' AND step_run_id = $1",
      [stepId],
    );
    console.log(
      `drive: cost_entry fal del step = ${costs.rows[0]!.n} filas · total ${String(costs.rows[0]!.total)} céntimos`,
    );

    const kinds = await pool.query<{ kind: string; count: string }>(
      "SELECT kind, COUNT(*)::text AS count FROM asset GROUP BY kind ORDER BY kind",
    );
    console.log('drive: assets por kind:', JSON.stringify(Object.fromEntries(kinds.rows.map((r) => [r.kind, Number(r.count)]))));
  } finally {
    await pool.end();
    server.close();
  }
}

main().catch((err: unknown) => {
  console.error('drive: FALLO —', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
