import { expect, test } from 'vitest';
import { stepAssetsView } from './step-assets';

test('N6 expone su resolvedPrompt y ningún asset', () => {
  const out = { node: 'N6', variantId: 'V1', resolvedPrompt: 'Una creadora sostiene el producto…' };
  const view = stepAssetsView('N6', out);
  expect(view.resolvedPrompt).toBe('Una creadora sostiene el producto…');
  expect(view.assets).toHaveLength(0);
});

test('N7a lleva sus shots como imágenes (assetId anidado en shots[])', () => {
  const out = { route: 'ai_packshot', shots: [{ assetId: 'A1' }, { assetId: 'A2' }] };
  const view = stepAssetsView('N7a', out);
  expect(view.resolvedPrompt).toBeNull();
  expect(view.assets).toEqual([
    { assetId: 'A1', mediaKind: 'image' },
    { assetId: 'A2', mediaKind: 'image' },
  ]);
});

test('N7b lleva sus clips como audio', () => {
  const out = { clips: [{ sceneIndex: 0, assetId: 'AUD1' }] };
  const view = stepAssetsView('N7b', out);
  expect(view.assets).toEqual([{ assetId: 'AUD1', mediaKind: 'audio' }]);
});

test('N7c lleva su asset (raíz) como vídeo', () => {
  const out = { avatarEndpoint: 'fal-ai/kling', assetId: 'VID1', durationSeconds: 4 };
  const view = stepAssetsView('N7c', out);
  expect(view.assets).toEqual([{ assetId: 'VID1', mediaKind: 'video' }]);
});

test('N7d (b-roll) lleva sus clips como vídeo', () => {
  const out = { route: 'i2v', clips: [{ assetId: 'B1' }, { assetId: 'B2' }] };
  const view = stepAssetsView('N7d', out);
  expect(view.assets).toEqual([
    { assetId: 'B1', mediaKind: 'video' },
    { assetId: 'B2', mediaKind: 'video' },
  ]);
});

test('N7e (música) lleva su asset como audio', () => {
  const out = { musicEndpoint: 'fal-ai/ace-step', assetId: 'M1' };
  const view = stepAssetsView('N7e', out);
  expect(view.assets).toEqual([{ assetId: 'M1', mediaKind: 'audio' }]);
});

test('el node_key con prefijo de DAG se resuelve por su segmento canónico', () => {
  const view = stepAssetsView('gen.N7c', { assetId: 'VID1' });
  expect(view.assets).toEqual([{ assetId: 'VID1', mediaKind: 'video' }]);
});

test('un node_key ajeno al sub-DAG de generación no aporta assets ni prompt', () => {
  const view = stepAssetsView('N3', { productName: 'x', assetId: 'nope' });
  expect(view.resolvedPrompt).toBeNull();
  expect(view.assets).toHaveLength(0);
});

test('assetIds duplicados se colapsan (un asset, un preview)', () => {
  const out = { clips: [{ assetId: 'DUP' }, { assetId: 'DUP' }] };
  const view = stepAssetsView('N7d', out);
  expect(view.assets).toEqual([{ assetId: 'DUP', mediaKind: 'video' }]);
});
