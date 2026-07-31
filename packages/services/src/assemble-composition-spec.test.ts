// Unit del ENSAMBLADOR `assembleCompositionSpec` (T5.5d, gate `services:unit`, SIN ffmpeg ni Postgres). El
// molde: el unit test de `assemble-n6-sources` (pero aquel es integración con BD real; aquí el I/O de BD —
// `getScriptById`/`getAsset`— se MOCKEA a nivel de módulo `@ugc/db`, así el test es puro y $0). Ejerce:
//   1. la FORMA del `CompositionSpec` (1 segmento por escena cubierta, con clip/voz correctos),
//   2. EL CASO DISCRIMINANTE de los constraints 1+2 (guion hook·body·cta·body → cada body-clip lleva SU voz
//      Y la CTA su clip de N7f por `ctaOrdinal`, no el del avatar; `bodySceneIndex`/`ctaSceneIndex` ≠
//      `sceneIndex`),
//   3. `voWords` leído del ASSET (constraint 3), no del output N7b,
//   4. el fallo RUIDOSO sin fuente de vídeo (nunca un spec vacío) y sin dep N7f para una escena cta
//      (simetría del throw: NUNCA reusa el clip del avatar),
//   5. la DISCRIMINABILIDAD de los CUATRO schemas N7 (constraint 3): `findDepBySchema` elige el correcto y
//      N7d NO resuelve como N7f ni al revés (par de riesgo).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { N7dOutputSchema, N7fOutputSchema } from '@ugc/core/contracts';
import { findDepBySchema } from '@ugc/core/generation';

// MOCK del I/O de BD (`@ugc/db`): el ensamblador solo llama `getScriptById` + `getAsset`. Se mockean con
// implementaciones controladas por test — el resto del módulo NO se toca (solo estas dos exports).
const getScriptById = vi.fn();
const getAsset = vi.fn();
vi.mock('@ugc/db', () => ({
  getScriptById: (...args: unknown[]): unknown => getScriptById(...args),
  getAsset: (...args: unknown[]): unknown => getAsset(...args),
}));

// Import DESPUÉS del mock (hoisted por vitest, pero explícito por claridad).
const { assembleCompositionSpec } = await import('./assemble-composition-spec');

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────

/** Una escena mínima que valida `AdSceneSchema`. `seconds` es la ESTIMADA (NO la que el fitter usa: esa es
 *  la `durationSeconds` MEDIDA del clip N7b — constraint 3). */
function scene(segment: 'hook' | 'body' | 'cta', narration: string) {
  return {
    t: 0,
    seconds: 3,
    segment,
    narration,
    visual: 'visual',
    camera: 'static',
    emotion: 'neutral',
  };
}

/** Un output N7b (voiceover) con una voz por escena. `sceneIndex` es ABSOLUTO en el guion. */
function n7bOutput(clips: { sceneIndex: number; assetId: string; durationSeconds: number }[]) {
  return {
    outputRefs: {
      scriptId: 'script-1',
      language: 'es',
      clips: clips.map((c) => ({
        sceneIndex: c.sceneIndex,
        generationId: `gen-vo-${String(c.sceneIndex)}`,
        assetId: u(c.assetId),
        durationSeconds: c.durationSeconds,
        wordCount: 5,
        ttsCostCents: 1,
        asrCostCents: 1,
      })),
    },
  };
}

const n7cOutput = (assetId: string) => ({
  outputRefs: {
    avatarEndpoint: 'fal-ai/kling-video/ai-avatar/v2/standard',
    generationId: 'gen-avatar',
    assetId: u(assetId),
    durationSeconds: 4,
    costCents: 22,
  },
});

/** Un output N7d (b-roll). `bodySceneIndex` es el índice en el SUBCONJUNTO de body (0 = 1ª escena de body). */
function n7dOutput(clips: { bodySceneIndex: number; clipIndex: number; assetId: string }[]) {
  return {
    outputRefs: {
      scriptId: 'script-1',
      brollEndpoint: 'fal-ai/veo3.1/image-to-video',
      route: 'i2v',
      clips: clips.map((c) => ({
        bodySceneIndex: c.bodySceneIndex,
        clipIndex: c.clipIndex,
        generationId: `gen-broll-${String(c.bodySceneIndex)}-${String(c.clipIndex)}`,
        assetId: u(c.assetId),
        durationSeconds: 5,
        costCents: 30,
      })),
    },
  };
}

/** Un output N7f (clip de CTA). `ctaSceneIndex` es el índice en el SUBCONJUNTO de cta (0 = 1ª escena de cta).
 *  GEMELO estructural de N7d salvo la clave `ctaEndpoint` (vs `brollEndpoint`) — el par de riesgo T5.5d. */
function n7fOutput(clips: { ctaSceneIndex: number; clipIndex: number; assetId: string }[]) {
  return {
    outputRefs: {
      scriptId: 'script-1',
      ctaEndpoint: 'fal-ai/veo3.1/image-to-video',
      route: 'i2v',
      clips: clips.map((c) => ({
        ctaSceneIndex: c.ctaSceneIndex,
        clipIndex: c.clipIndex,
        generationId: `gen-cta-${String(c.ctaSceneIndex)}-${String(c.clipIndex)}`,
        assetId: u(c.assetId),
        durationSeconds: 5,
        costCents: 30,
      })),
    },
  };
}

const n7eOutput = (assetId: string) => ({
  outputRefs: {
    musicEndpoint: 'fal-ai/ace-step',
    mood: 'upbeat, energetic',
    generationId: 'gen-music',
    assetId: u(assetId),
    durationSeconds: 20,
    costCents: 1,
  },
});

const fakeDb = {} as never;

/** ULIDs válidos (26 chars, alfabeto Crockford) — `CompositionSpecSchema` valida los asset ids como ULID.
 *  Un mapa de alias legible → ULID para que los asserts sigan siendo legibles. */
// Alfabeto Crockford: sin I, L, O, U (`^[0-9A-HJKMNP-TV-Z]{26}$`). Cada ULID = prefijo fijo + relleno.
const ULID: Record<string, string> = {
  'vid-avatar': '01JAAAAAAAAAAAAAAAAAAAAAAA',
  'vo-0': '01JBBBBBBBBBBBBBBBBBBBBBB0',
  'vo-1': '01JBBBBBBBBBBBBBBBBBBBBBB1',
  'vo-2': '01JBBBBBBBBBBBBBBBBBBBBBB2',
  'vo-3': '01JBBBBBBBBBBBBBBBBBBBBBB3',
  'broll-A': '01JCCCCCCCCCCCCCCCCCCCCCCA',
  'broll-B': '01JCCCCCCCCCCCCCCCCCCCCCCB',
  'broll-C': '01JCCCCCCCCCCCCCCCCCCCCCCC',
  'cta-A': '01JEEEEEEEEEEEEEEEEEEEEEEA',
  'bed-1': '01JDDDDDDDDDDDDDDDDDDDDDD1',
  // Bed musical PROPIO del usuario (T6.2b, `own_license`).
  'own-bed': '01JFFFFFFFFFFFFFFFFFFFFFFF',
};
const u = (alias: string): string => ULID[alias] ?? alias;

afterEach(() => {
  vi.clearAllMocks();
});

describe('assembleCompositionSpec (T5.5d)', () => {
  it('CASO DISCRIMINANTE hook·body·cta·body: cada body-clip su voz Y la CTA su clip N7f (índices filtrados ≠ absolutos)', async () => {
    // Guion: escena 0 hook, 1 body, 2 cta, 3 body. Body son la 1 (absoluta) → bodySceneIndex 0, y la 3
    // (absoluta) → bodySceneIndex 1. La CTA es la 2 (absoluta) → ctaSceneIndex 0 → n7f.clips[0]. Si el
    // ensamblador NO mapeara los espacios de índice, cruzaría voces (body) o leería `undefined` (indexar N7f
    // por absoluto 2, que no existe). Este test mata AMBOS bugs de índice (body Y cta).
    getScriptById.mockResolvedValue({
      id: 'script-1',
      scenes: [
        scene('hook', 'hook line'),
        scene('body', 'first body line'),
        scene('cta', 'cta line'),
        scene('body', 'second body line'),
      ],
    });
    getAsset.mockResolvedValue({ wordTimestamps: null });

    const spec = await assembleCompositionSpec(
      { db: fakeDb },
      {
        variantId: 'v1',
        variantMaxDurationS: 30,
        deps: [
          n7cOutput('vid-avatar'),
          n7bOutput([
            { sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2.1 },
            { sceneIndex: 1, assetId: 'vo-1', durationSeconds: 3.4 },
            { sceneIndex: 2, assetId: 'vo-2', durationSeconds: 1.8 },
            { sceneIndex: 3, assetId: 'vo-3', durationSeconds: 4.2 },
          ]),
          // bodySceneIndex 0 → clip de la 1ª escena de body (absoluta 1); bodySceneIndex 1 → 2ª (absoluta 3).
          n7dOutput([
            { bodySceneIndex: 0, clipIndex: 0, assetId: 'broll-A' },
            { bodySceneIndex: 1, clipIndex: 0, assetId: 'broll-B' },
          ]),
          // ctaSceneIndex 0 → clip de la única escena de cta (absoluta 2). Indexar por absoluto leería undefined.
          n7fOutput([{ ctaSceneIndex: 0, clipIndex: 0, assetId: 'cta-A' }]),
        ],
      },
    );

    // 4 escenas cubiertas → 4 segmentos, en orden temporal.
    expect(spec.segments.map((s) => s.type)).toEqual(['hook', 'body', 'cta', 'body']);

    // El HOOK usa el clip de avatar (N7c) con SU voz absoluta.
    expect(spec.segments[0]).toMatchObject({
      type: 'hook',
      videoAssets: [u('vid-avatar')],
      voAudio: u('vo-0'),
    });
    // ── EL ASSERT QUE MUERDE (cta) ── el segmento cta usa el clip de N7f (`n7f.clips[0]` = cta-A por
    // `ctaOrdinal`), NO el del avatar; su voz es la absoluta 2 (vo-2). El bug de T5.5a (reuso del avatar) o
    // el bug primo de índice (leer n7f.clips[2] = undefined) fallarían aquí.
    expect(spec.segments[2]).toMatchObject({
      type: 'cta',
      videoAssets: [u('cta-A')],
      voAudio: u('vo-2'),
    });

    // ── EL ASSERT QUE MUERDE (body) ── el 1er body (escena absoluta 1) lleva broll-A + vo-1; el 2º body
    // (escena absoluta 3) lleva broll-B + vo-3. Un mapeo por sceneIndex crudo cruzaría las voces.
    expect(spec.segments[1]).toMatchObject({
      type: 'body',
      videoAssets: [u('broll-A')],
      voAudio: u('vo-1'),
    });
    expect(spec.segments[3]).toMatchObject({
      type: 'body',
      videoAssets: [u('broll-B')],
      voAudio: u('vo-3'),
    });
  });

  // ── T5.8c · ESCENA TROCEADA (§7.5): TODOS los clips, ninguno pagado-sin-usar ────────────────────────
  it('escena de body TROCEADA → el segmento lleva TODOS sus clips ordenados por clipIndex (fuga cerrada)', async () => {
    // La escena de body se troceó en 2 clips (narración > maxDuration del modelo). ANTES de T5.8c
    // `pickClip` devolvía SOLO el `clipIndex 0` y `broll-B` se pagaba y se TIRABA (fuga de dinero) — y ese
    // único clip, topado a maxDuration, no cubría la narración → `FitError` en el fitter.
    getScriptById.mockResolvedValue({
      id: 'script-1',
      scenes: [scene('hook', 'hook line'), scene('body', 'a very long body line')],
    });
    getAsset.mockResolvedValue({ wordTimestamps: null });

    const spec = await assembleCompositionSpec(
      { db: fakeDb },
      {
        variantId: 'v1',
        variantMaxDurationS: 30,
        deps: [
          n7cOutput('vid-avatar'),
          n7bOutput([
            { sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2.1 },
            // La narración MEDIDA de la escena de body (8,68 s: el caso real del run de T5.9).
            { sceneIndex: 1, assetId: 'vo-1', durationSeconds: 8.68 },
          ]),
          // DESORDENADOS a propósito: el ensamblador debe ordenarlos por `clipIndex`, no por el orden de
          // llegada (el orden del array ES el orden temporal del concat intra-escena).
          n7dOutput([
            { bodySceneIndex: 0, clipIndex: 1, assetId: 'broll-B' },
            { bodySceneIndex: 0, clipIndex: 0, assetId: 'broll-A' },
          ]),
        ],
      },
    );

    // UN segmento por ESCENA (no uno por clip) con los DOS clips dentro, en orden de clipIndex.
    expect(spec.segments.map((s) => s.type)).toEqual(['hook', 'body']);
    expect(spec.segments[1]).toMatchObject({
      type: 'body',
      videoAssets: [u('broll-A'), u('broll-B')],
      voAudio: u('vo-1'),
    });
  });

  it('escena de CTA TROCEADA → mismo trato que el body (todos los clips de N7f, ordenados)', async () => {
    getScriptById.mockResolvedValue({
      id: 'script-1',
      scenes: [scene('hook', 'hook line'), scene('cta', 'a very long cta line')],
    });
    getAsset.mockResolvedValue({ wordTimestamps: null });

    const spec = await assembleCompositionSpec(
      { db: fakeDb },
      {
        variantId: 'v1',
        variantMaxDurationS: 30,
        deps: [
          n7cOutput('vid-avatar'),
          n7bOutput([
            { sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2.1 },
            { sceneIndex: 1, assetId: 'vo-1', durationSeconds: 9.5 },
          ]),
          n7fOutput([
            { ctaSceneIndex: 0, clipIndex: 1, assetId: 'broll-B' },
            { ctaSceneIndex: 0, clipIndex: 0, assetId: 'cta-A' },
          ]),
        ],
      },
    );

    expect(spec.segments[1]).toMatchObject({
      type: 'cta',
      videoAssets: [u('cta-A'), u('broll-B')],
    });
  });

  // ── T5.8c · TROCEO NO CONTIGUO → ABORTA (no compone un máster corrupto que pasa el QA) ───────────────
  it('clipIndex con HUECO (0 y 2) → PermanentStepError: el concat produciría una escena con un tramo faltante', async () => {
    // Un hueco lo puede producir una carrera de dedup o un retry parcial de N7d. Concatenar [0, 2] daría una
    // escena a la que le falta el tramo central; el fitter solo mira la duración TOTAL y la recortaría tan
    // tranquilo → máster visualmente corrupto INDISTINGUIBLE de uno bueno. Se aborta ruidoso.
    getScriptById.mockResolvedValue({
      id: 'script-1',
      scenes: [scene('body', 'a very long body line')],
    });
    getAsset.mockResolvedValue({ wordTimestamps: null });

    await expect(
      assembleCompositionSpec(
        { db: fakeDb },
        {
          variantId: 'v1',
          variantMaxDurationS: 30,
          deps: [
            n7bOutput([{ sceneIndex: 0, assetId: 'vo-0', durationSeconds: 8.68 }]),
            n7dOutput([
              { bodySceneIndex: 0, clipIndex: 0, assetId: 'broll-A' },
              { bodySceneIndex: 0, clipIndex: 2, assetId: 'broll-C' }, // ← falta el 1
            ]),
          ],
        },
      ),
    ).rejects.toThrow(/NO forman un troceo §7\.5 contiguo: clipIndex=\[0, 2\]/);
  });

  it('clipIndex DUPLICADO (0 y 0) → PermanentStepError (el mismo tramo dos veces tampoco es el troceo)', async () => {
    getScriptById.mockResolvedValue({
      id: 'script-1',
      scenes: [scene('cta', 'a very long cta line')],
    });
    getAsset.mockResolvedValue({ wordTimestamps: null });

    await expect(
      assembleCompositionSpec(
        { db: fakeDb },
        {
          variantId: 'v1',
          variantMaxDurationS: 30,
          deps: [
            n7bOutput([{ sceneIndex: 0, assetId: 'vo-0', durationSeconds: 9.5 }]),
            n7fOutput([
              { ctaSceneIndex: 0, clipIndex: 0, assetId: 'cta-A' },
              { ctaSceneIndex: 0, clipIndex: 0, assetId: 'broll-B' },
            ]),
          ],
        },
      ),
    ).rejects.toThrow(/NO forman un troceo §7\.5 contiguo/);
  });

  it('CONTROL POSITIVO: un set contiguo 0..n-1 (aunque llegue desordenado) NO lanza', async () => {
    // El guard NO muerde el caso legítimo: es el mismo set del test de escena troceada, desordenado.
    getScriptById.mockResolvedValue({
      id: 'script-1',
      scenes: [scene('body', 'a very long body line')],
    });
    getAsset.mockResolvedValue({ wordTimestamps: null });

    const spec = await assembleCompositionSpec(
      { db: fakeDb },
      {
        variantId: 'v1',
        variantMaxDurationS: 30,
        deps: [
          n7bOutput([{ sceneIndex: 0, assetId: 'vo-0', durationSeconds: 8.68 }]),
          n7dOutput([
            { bodySceneIndex: 0, clipIndex: 2, assetId: 'broll-C' },
            { bodySceneIndex: 0, clipIndex: 0, assetId: 'broll-A' },
            { bodySceneIndex: 0, clipIndex: 1, assetId: 'broll-B' },
          ]),
        ],
      },
    );
    expect(spec.segments[0]?.videoAssets).toEqual([u('broll-A'), u('broll-B'), u('broll-C')]);
  });

  it('escena cta SIN dep N7f → PermanentStepError (NUNCA reusa el clip del avatar — simetría del throw)', async () => {
    // El guion tiene una escena cta pero NO hay dep N7f. El bug de T5.5a habría reusado el clip del avatar
    // (n7c) para la CTA. La simetría del throw exige LANZAR en su lugar.
    getScriptById.mockResolvedValue({
      id: 'script-1',
      scenes: [scene('hook', 'hook'), scene('cta', 'cta line')],
    });
    getAsset.mockResolvedValue({ wordTimestamps: null });
    await expect(
      assembleCompositionSpec(
        { db: fakeDb },
        {
          variantId: 'v1',
          variantMaxDurationS: 30,
          deps: [
            n7cOutput('vid-avatar'),
            n7bOutput([
              { sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2 },
              { sceneIndex: 1, assetId: 'vo-1', durationSeconds: 2 },
            ]),
          ],
        },
      ),
    ).rejects.toBeInstanceOf(PermanentStepError);
  });

  it('DISCRIMINABILIDAD de los CUATRO schemas N7 (constraint 3): findDepBySchema elige el correcto; N7d ≠ N7f', () => {
    // El par de RIESGO es N7d↔N7f (idénticos salvo la clave de endpoint). Si un schema quedara laxo, un
    // output N7d validaría como N7f (o al revés) → `findDepBySchema` LANZARÍA por ambigüedad EN RUNTIME (no
    // en el gate). Este test lo caza en el gate: mete cada output N7 y afirma la resolución cruzada.
    const deps = [
      n7dOutput([{ bodySceneIndex: 0, clipIndex: 0, assetId: 'broll-A' }]),
      n7fOutput([{ ctaSceneIndex: 0, clipIndex: 0, assetId: 'cta-A' }]),
    ];
    const asN7d = findDepBySchema(deps, N7dOutputSchema, 'N7d') as {
      brollEndpoint?: string;
      ctaEndpoint?: string;
    };
    const asN7f = findDepBySchema(deps, N7fOutputSchema, 'N7f') as {
      brollEndpoint?: string;
      ctaEndpoint?: string;
    };
    // Cada uno resuelve al SUYO (por su clave distintiva), no al gemelo.
    expect(asN7d.brollEndpoint).toBe('fal-ai/veo3.1/image-to-video');
    expect(asN7d.ctaEndpoint).toBeUndefined();
    expect(asN7f.ctaEndpoint).toBe('fal-ai/veo3.1/image-to-video');
    expect(asN7f.brollEndpoint).toBeUndefined();

    // El output N7d NO valida contra N7fOutputSchema (le falta `ctaEndpoint`) — y viceversa. La ausencia de
    // ambigüedad es lo que impide el throw de `findDepBySchema` en runtime.
    const n7dRefs = deps[0]!.outputRefs;
    const n7fRefs = deps[1]!.outputRefs;
    expect(N7fOutputSchema.safeParse(n7dRefs).success).toBe(false);
    expect(N7dOutputSchema.safeParse(n7fRefs).success).toBe(false);
  });

  it('máster con bed (N7e): music.asset del output N7e, volumen en rango', async () => {
    getScriptById.mockResolvedValue({
      id: 'script-1',
      scenes: [scene('hook', 'hook'), scene('body', 'body')],
    });
    getAsset.mockResolvedValue({ wordTimestamps: null });

    const spec = await assembleCompositionSpec(
      { db: fakeDb },
      {
        variantId: 'v1',
        variantMaxDurationS: 30,
        deps: [
          n7cOutput('vid-avatar'),
          n7bOutput([
            { sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2 },
            { sceneIndex: 1, assetId: 'vo-1', durationSeconds: 3 },
          ]),
          n7dOutput([{ bodySceneIndex: 0, clipIndex: 0, assetId: 'broll-A' }]),
          n7eOutput('bed-1'),
        ],
      },
    );
    expect(spec.music?.asset).toBe(u('bed-1'));
    expect(spec.music?.volume).toBeGreaterThanOrEqual(0.2);
    expect(spec.music?.volume).toBeLessThanOrEqual(0.3);
  });

  it('sin dep N7e: music es null', async () => {
    getScriptById.mockResolvedValue({ id: 'script-1', scenes: [scene('hook', 'hook')] });
    getAsset.mockResolvedValue({ wordTimestamps: null });
    const spec = await assembleCompositionSpec(
      { db: fakeDb },
      {
        variantId: 'v1',
        variantMaxDurationS: 30,
        deps: [
          n7cOutput('vid-avatar'),
          n7bOutput([{ sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2 }]),
        ],
      },
    );
    expect(spec.music).toBeNull();
  });

  // ── BED MUSICAL PROPIO (T6.2b, §14 `own_license`) ─────────────────────────────────────────────────────
  it('bed PROPIO (ownMusicBedAssetId): music.asset es el asset SUBIDO, sin dep N7e', async () => {
    // Camino normal de own_license: N7e NO corrió (el builder omitió n7eConfig) → no hay dep N7e. El bed
    // llega por `ownMusicBedAssetId` (que el N8 executor lee de la fila ad_variant). El máster se compone con
    // ESA música y los mismos parámetros de mezcla (volumen en rango, ducking) que el bed IA.
    getScriptById.mockResolvedValue({
      id: 'script-1',
      scenes: [scene('hook', 'hook'), scene('body', 'body')],
    });
    getAsset.mockResolvedValue({ wordTimestamps: null });

    const spec = await assembleCompositionSpec(
      { db: fakeDb },
      {
        variantId: 'v1',
        variantMaxDurationS: 30,
        ownMusicBedAssetId: u('own-bed'),
        deps: [
          n7cOutput('vid-avatar'),
          n7bOutput([
            { sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2 },
            { sceneIndex: 1, assetId: 'vo-1', durationSeconds: 3 },
          ]),
          n7dOutput([{ bodySceneIndex: 0, clipIndex: 0, assetId: 'broll-A' }]),
        ],
      },
    );
    expect(spec.music?.asset).toBe(u('own-bed')); // la pista del usuario, no un bed de N7e
    expect(spec.music?.volume).toBeGreaterThanOrEqual(0.2);
    expect(spec.music?.volume).toBeLessThanOrEqual(0.3);
    expect(spec.music?.ducking).toBe(true); // mismo grafo de ducking que el bed IA (agnóstico al origen)
  });

  it('bed PROPIO GANA al de N7e cuando coexisten (sustitución, no error)', async () => {
    // Caso de borde (regen/retry): la variante tiene AMBOS un bed propio y una dep N7e. La pista licenciada
    // del usuario manda — es una sustitución deliberada, no un throw.
    getScriptById.mockResolvedValue({ id: 'script-1', scenes: [scene('hook', 'hook')] });
    getAsset.mockResolvedValue({ wordTimestamps: null });

    const spec = await assembleCompositionSpec(
      { db: fakeDb },
      {
        variantId: 'v1',
        variantMaxDurationS: 30,
        ownMusicBedAssetId: u('own-bed'),
        deps: [
          n7cOutput('vid-avatar'),
          n7bOutput([{ sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2 }]),
          n7eOutput('bed-1'), // el bed IA existe, pero el propio gana
        ],
      },
    );
    expect(spec.music?.asset).toBe(u('own-bed'));
  });

  it('sin bed propio y sin dep N7e: music es null (comportamiento normal intacto)', async () => {
    getScriptById.mockResolvedValue({ id: 'script-1', scenes: [scene('hook', 'hook')] });
    getAsset.mockResolvedValue({ wordTimestamps: null });
    const spec = await assembleCompositionSpec(
      { db: fakeDb },
      {
        variantId: 'v1',
        variantMaxDurationS: 30,
        deps: [
          n7cOutput('vid-avatar'),
          n7bOutput([{ sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2 }]),
        ],
      },
    );
    expect(spec.music).toBeNull();
  });

  it('voWords: se lee del ASSET de la voz (getAsset), no del output N7b (constraint 3)', async () => {
    getScriptById.mockResolvedValue({ id: 'script-1', scenes: [scene('hook', 'hook line')] });
    // El asset de la voz trae word timestamps (los que T5.4 quema en captions). El output N7b NO los lleva.
    // Shape REAL del ASR (`WordTimestampsSchema`): `{ text, words: [...] }`.
    const words = {
      text: 'hook line',
      words: [
        { type: 'word', text: 'hook', start: 0, end: 0.4 },
        { type: 'word', text: 'line', start: 0.4, end: 0.8 },
      ],
    };
    getAsset.mockResolvedValue({ wordTimestamps: words });

    const spec = await assembleCompositionSpec(
      { db: fakeDb },
      {
        variantId: 'v1',
        variantMaxDurationS: 30,
        deps: [
          n7cOutput('vid-avatar'),
          n7bOutput([{ sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2 }]),
        ],
      },
    );
    // `voWords` viene del asset (getAsset se llamó con el assetId de la voz).
    expect(getAsset).toHaveBeenCalledWith(fakeDb, u('vo-0'));
    expect(spec.segments[0]?.voWords).toEqual(words);
  });

  it('voWords ausente (asset sin timestamps) → segmento sin voWords (degradación honesta)', async () => {
    getScriptById.mockResolvedValue({ id: 'script-1', scenes: [scene('hook', 'hook')] });
    getAsset.mockResolvedValue({ wordTimestamps: null });
    const spec = await assembleCompositionSpec(
      { db: fakeDb },
      {
        variantId: 'v1',
        variantMaxDurationS: 30,
        deps: [
          n7cOutput('vid-avatar'),
          n7bOutput([{ sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2 }]),
        ],
      },
    );
    expect(spec.segments[0]?.voWords).toBeUndefined();
  });

  it('FALLA RUIDOSO sin NINGUNA fuente de vídeo (ni N7c ni N7d ni N7f) — nunca un spec vacío', async () => {
    getScriptById.mockResolvedValue({ id: 'script-1', scenes: [scene('body', 'body')] });
    await expect(
      assembleCompositionSpec(
        { db: fakeDb },
        {
          variantId: 'v1',
          variantMaxDurationS: 30,
          deps: [n7bOutput([{ sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2 }])],
        },
      ),
    ).rejects.toBeInstanceOf(PermanentStepError);
  });

  it('FALLA sin dep N7b (sin voces no hay narración que ensamblar)', async () => {
    await expect(
      assembleCompositionSpec(
        { db: fakeDb },
        { variantId: 'v1', variantMaxDurationS: 30, deps: [n7cOutput('vid-avatar')] },
      ),
    ).rejects.toBeInstanceOf(PermanentStepError);
  });

  it('DISCRIMINACIÓN por schema (constraint 1): N7c y N7e casi idénticos NO se confunden', async () => {
    // Si N7cOutputSchema o N7eOutputSchema no exigieran su clave distintiva, un output validaría como AMBOS
    // → findDepBySchema LANZARÍA (2+ matches). Que este happy path funcione con N7c Y N7e presentes prueba
    // que cada output valida SOLO su propio schema.
    getScriptById.mockResolvedValue({ id: 'script-1', scenes: [scene('hook', 'hook')] });
    getAsset.mockResolvedValue({ wordTimestamps: null });
    const spec = await assembleCompositionSpec(
      { db: fakeDb },
      {
        variantId: 'v1',
        variantMaxDurationS: 30,
        deps: [
          n7cOutput('vid-avatar'),
          n7eOutput('bed-1'),
          n7bOutput([{ sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2 }]),
        ],
      },
    );
    expect(spec.segments[0]?.videoAssets).toEqual([u('vid-avatar')]); // el avatar es el vídeo (1 clip)
    expect(spec.music?.asset).toBe(u('bed-1')); // el bed es la música
  });

  it('escena de body sin clip N7d correspondiente → PermanentStepError NOMBRANDO N7d/body/bodySceneIndex', async () => {
    getScriptById.mockResolvedValue({
      id: 'script-1',
      scenes: [scene('hook', 'hook'), scene('body', 'b1'), scene('body', 'b2')],
    });
    getAsset.mockResolvedValue({ wordTimestamps: null });
    // El helper unificado `pickClip` DEBE nombrar la dep/segmento/campo correctos (no difuminar el
    // diagnóstico): un fallo de body dice N7d, body y bodySceneIndex.
    await expect(
      assembleCompositionSpec(
        { db: fakeDb },
        {
          variantId: 'v1',
          variantMaxDurationS: 30,
          deps: [
            n7cOutput('vid-avatar'),
            n7bOutput([
              { sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2 },
              { sceneIndex: 1, assetId: 'vo-1', durationSeconds: 3 },
              { sceneIndex: 2, assetId: 'vo-2', durationSeconds: 3 },
            ]),
            // Solo 1 clip de body, pero el guion tiene 2 escenas de body → la 2ª (bodySceneIndex 1) falta.
            n7dOutput([{ bodySceneIndex: 0, clipIndex: 0, assetId: 'broll-A' }]),
          ],
        },
      ),
    ).rejects.toThrow(/dep N7d.*bodySceneIndex/s);
  });

  it('escena de cta sin clip N7f correspondiente → PermanentStepError NOMBRANDO N7f/cta/ctaSceneIndex', async () => {
    getScriptById.mockResolvedValue({
      id: 'script-1',
      scenes: [scene('hook', 'hook'), scene('cta', 'c1'), scene('cta', 'c2')],
    });
    getAsset.mockResolvedValue({ wordTimestamps: null });
    // Espejo del test de body: un fallo de cta dice N7f, cta y ctaSceneIndex (el helper unificado no degrada
    // el diagnóstico — inspection gate del simplify).
    await expect(
      assembleCompositionSpec(
        { db: fakeDb },
        {
          variantId: 'v1',
          variantMaxDurationS: 30,
          deps: [
            n7cOutput('vid-avatar'),
            n7bOutput([
              { sceneIndex: 0, assetId: 'vo-0', durationSeconds: 2 },
              { sceneIndex: 1, assetId: 'vo-1', durationSeconds: 3 },
              { sceneIndex: 2, assetId: 'vo-2', durationSeconds: 3 },
            ]),
            // Solo 1 clip de cta, pero el guion tiene 2 escenas de cta → la 2ª (ctaSceneIndex 1) falta.
            n7fOutput([{ ctaSceneIndex: 0, clipIndex: 0, assetId: 'cta-A' }]),
          ],
        },
      ),
    ).rejects.toThrow(/dep N7f.*ctaSceneIndex/s);
  });
});
