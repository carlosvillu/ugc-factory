// Regenera los 3 `.ass` de muestra de T5.4 desde los word timestamps ASR REALES de T4.7b, usando el
// generador de producción. Determinista (coste $0). Ejecutar desde la raíz del repo:
//
//   node --experimental-strip-types docs/verifications/T5.4/gen-samples.mjs
//
// (o `pnpm --filter @ugc/worker exec tsx ../../docs/verifications/T5.4/gen-samples.mjs` si el runtime de
// tu Node no resuelve TS directamente — el generador es TS). Tras generar los `.ass`, quémalos con el
// comando ffmpeg del README dentro de la imagen worker `ugc-worker:t5.1`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WordTimestampsSchema } from '@ugc/core/generation';
import { generateAss } from '../../../apps/worker/src/captions/ass-generator.ts';

const here = dirname(fileURLToPath(import.meta.url));
const wt = WordTimestampsSchema.parse(
  JSON.parse(readFileSync(join(here, '..', 'T4.7b', 'word-timestamps.json'), 'utf8')),
);

const samples = [
  { name: 'sample1-karaoke-tiktok', preset: 'karaoke', platform: 'tiktok' },
  { name: 'sample2-karaoke-reels', preset: 'karaoke', platform: 'reels' },
  { name: 'sample3-subtitle-universal', preset: 'subtitle', platform: 'universal' },
];

for (const s of samples) {
  const ass = generateAss(wt, { preset: s.preset, platform: s.platform });
  writeFileSync(join(here, 'samples', `${s.name}.ass`), ass, 'utf8');
  console.log(`wrote samples/${s.name}.ass (${s.preset}/${s.platform})`);
}
