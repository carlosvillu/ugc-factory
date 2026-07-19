// ⚠ PROBE SUB-CÉNTIMO de la Verificación de T4.4b (disciplina de gasto T4.3/T4.7). UNA sola llamada a
// `fal-ai/bytedance/seedream/v4.5/edit` con 1 foto AVIF real del producto, por el camino REAL de fal
// (upload → submit → poll → download), para responder ANTES del gasto de 3 shots (~$0,30) las 3
// preguntas del gate de gasto:
//   1. ¿fal seedream/edit ACEPTA el input? (el puente sube PNG re-codificado; este probe sube el AVIF
//      CRUDO para ver si fal lo rechaza — si 4xx, confirma que la re-codificación del puente es necesaria);
//   2. ¿el 9:16 (`image_size:portrait_16_9`) produce un output VERTICAL? — se mide sobre las DIMENSIONES
//      REALES del output descargado (con `sharp`), NO sobre la request;
//   3. ¿sobrevive el label «Retinol»? — juicio humano sobre la imagen guardada.
//
// El probe guarda la imagen en `docs/verifications/T4.4b/probe-output.png` para el juicio humano del
// verifier. Env: FAL_KEY. Turnkey: `pnpm --filter @ugc/worker probe:seedream`.
//
// NO forma parte del gate (cuesta dinero real): el rigor permanente vive en los tests con msw
// (`n7a-references.test.ts`, `reference-image-bridge.test.ts`). Este probe es el DEMO runnable que el
// verifier ejecuta cuando tiene credencial fal, para cerrar la Verificación con juicio humano.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { makeFalClient } from '@ugc/core/generation';

const SEEDREAM_ENDPOINT = 'fal-ai/bytedance/seedream/v4.5/edit';
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const PRODUCT_DIR = path.join(REPO_ROOT, 'docs/verifications/T4.4b/producto');
const OUTPUT_PATH = path.join(REPO_ROOT, 'docs/verifications/T4.4b/probe-output.png');
// El prompt de packshot es determinista en producción (`buildPackshotPrompt`); para el probe basta un
// prompt de recomposición de escena UGC 9:16 que preserve el producto de la referencia.
const PROBE_PROMPT =
  'Place this exact product, unchanged, on a clean bathroom shelf in a bright UGC-style vertical scene. ' +
  'Preserve the product label, shape and colors faithfully. Vertical 9:16 composition.';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(
      `probe:seedream: falta ${name} (la key de fal). Sin ella el probe no puede correr.`,
    );
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const falKey = requireEnv('FAL_KEY');
  const avifPath = path.join(PRODUCT_DIR, 'retinol-hero-1.avif');
  const avifBytes = new Uint8Array(await readFile(avifPath));
  console.log(`probe:seedream: AVIF crudo ${avifPath} (${String(avifBytes.byteLength)} bytes)`);

  const fal = makeFalClient({ credentials: falKey });

  // 1) UPLOAD del AVIF CRUDO a fal storage (probe de aceptación de formato: subimos el AVIF SIN
  //    re-codificar, a propósito, para ver si fal lo rechaza en submit).
  let refUrl: string;
  try {
    refUrl = await fal.uploadInput(avifBytes, { mime: 'image/avif' });
    console.log(`probe:seedream: AVIF subido a fal storage → ${refUrl}`);
  } catch (err) {
    console.error(
      `probe:seedream: fal RECHAZÓ el upload del AVIF crudo → ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error(
      'probe:seedream: ⇒ la re-codificación AVIF→PNG del puente (reference-image-bridge) es NECESARIA (scope de T4.4b, ya implementada).',
    );
    process.exit(2);
  }

  // 2) SUBMIT del edit con `image_size:portrait_16_9` (el 9:16 que el adapter propaga).
  console.log(
    `probe:seedream: submit ${SEEDREAM_ENDPOINT} con image_size=portrait_16_9 (RED REAL, ~1¢)…`,
  );
  const submitted = await fal.submit(SEEDREAM_ENDPOINT, {
    prompt: PROBE_PROMPT,
    image_urls: [refUrl],
    image_size: 'portrait_16_9',
  });
  const polled = await fal.poll({
    statusUrl: submitted.statusUrl,
    responseUrl: submitted.responseUrl,
  });

  // 3) Descargar el output y MEDIR sus dimensiones REALES (no confiar en la request).
  const output = polled.output as { images?: { url?: string }[] } | null;
  const outUrl = output?.images?.[0]?.url;
  if (outUrl === undefined) {
    console.error(`probe:seedream: el output no trae imagen: ${JSON.stringify(polled.output)}`);
    process.exit(3);
  }
  const res = await fal.download(outUrl);
  const outBytes = new Uint8Array(await res.arrayBuffer());
  const meta = await sharp(Buffer.from(outBytes)).metadata();
  await writeFile(OUTPUT_PATH, outBytes);

  console.log('─'.repeat(70));
  console.log(
    `probe:seedream: OUTPUT dims REALES = ${String(meta.width)}×${String(meta.height)} px`,
  );
  const isVertical = meta.height > meta.width;
  console.log(
    `probe:seedream: ¿vertical 9:16? ${isVertical ? 'SÍ' : 'NO'} (h>w = ${String(isVertical)})`,
  );
  console.log(
    `probe:seedream: imagen guardada en ${OUTPUT_PATH} — JUICIO HUMANO: ¿se reconoce «Retinol»?`,
  );
  console.log('─'.repeat(70));
  console.log('probe:seedream: coste real ≈ 1¢ (seedream/edit $0,04/img — verifica en /spend).');
}

main().catch((err: unknown) => {
  console.error('probe:seedream: FALLO —', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
