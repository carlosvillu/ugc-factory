// Regresión permanente del CHECKLIST DE PUBLICACIÓN + CP5 (T6.2, e2e.md §8/§9, DoD BLOQUEANTE). Ejercita el
// panel de publicación de `/library` contra el sistema real (web + BD + los routes de publishing/cp5):
//   · REGLA SPARK (§14 pt 2): una variante `audio_source=native_trending` BLOQUEA la opción Spark con
//     explicación; una con bed IA la PERMITE. Ambas ramas en el MISMO slot (`spark-option`).
//   · CP5 (modo degradado manual): con CP5 ACTIVADO, iniciar el flujo lo PAUSA en el checkpoint
//     (`waiting_confirmation`) y solo confirmar lo reanuda a `confirmed`.
//   · MARCADO del checklist: marcar un ítem PERSISTE (recargar la página lo mantiene marcado).
//   · CONTROLES NEGATIVOS (regla del arnés): el spec asserta AMBOS lados de cada regla — Spark ofrecido para
//     bed IA vs bloqueado para native_trending (revertir la regla Spark = Spark ofrecido para
//     native_trending = ROJO aquí); flujo PAUSADO con CP5 on vs directo sin CP5 (revertir la pausa de CP5 =
//     el flujo no se detiene = ROJO aquí).
//
// POR QUÉ SE SIEMBRA (coste $0): variantes aprobadas + su máster (fichero mp4 real + fila `asset` + fila
// `ad_variant`), como `library.spec` (T5.7). Recorrer el pipeline gastaría fal. El `audio_source` se
// PARAMETRIZA (native_trending vs ai_bed) para probar block-vs-allow lado a lado.
import { randomBytes } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { newUlid } from '@ugc/core/contracts';
import { createAsset, createDb, makeLocalStorageAdapter } from '@ugc/db';
import {
  persona as personaTable,
  productBrief as productBriefTable,
  project as projectTable,
  urlAnalysis as urlAnalysisTable,
} from '@ugc/db/schema';
import { makeAsset, makeProductBrief, makeProject, makeUrlAnalysis } from '@ugc/test-utils';
import { queryStack, stackDatabaseUrl, assetsDir } from './support/stack-db';

const stackDb = createDb(stackDatabaseUrl);
const storage = makeLocalStorageAdapter({ root: assetsDir });

/** Sufijo único por ejecución (persona.name es UNIQUE; el stack no trunca entre corridas). */
const RUN = newUlid().slice(-8);

/** Sube unos bytes como asset `final_video` y devuelve su id. */
async function seedMasterAsset(): Promise<string> {
  const id = newUlid();
  const storageKey = `e2e/publishing-${id}.mp4`;
  const put = await storage.put(storageKey, randomBytes(4096), { mime: 'video/mp4' });
  const row = await createAsset(
    stackDb,
    makeAsset({
      id,
      kind: 'final_video',
      storageKey,
      mime: 'video/mp4',
      bytes: put.bytes,
      checksum: put.checksum,
    }),
  );
  return row.id;
}

/**
 * Siembra un lote + una variante APROBADA con su máster. `audioSource` PARAMETRIZADO (§14): `native_trending`
 * bloquea Spark; `ai_bed` lo permite. Devuelve el `variantId`.
 */
async function seedApprovedVariant(opts: {
  audioSource: 'ai_bed' | 'native_trending';
  platforms: string[];
  personaName: string;
}): Promise<string> {
  const [p] = await stackDb.insert(projectTable).values(makeProject()).returning();
  const [ua] = await stackDb
    .insert(urlAnalysisTable)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const [brief] = await stackDb
    .insert(productBriefTable)
    .values(
      makeProductBrief({
        urlAnalysisId: ua!.id,
        data: { product: { name: 'Serum', brand_name: 'Nuvela' } },
      }),
    )
    .returning();
  const [persona] = await stackDb
    .insert(personaTable)
    .values({
      name: opts.personaName,
      ageRange: '25-34',
      gender: 'female',
      ethnicity: 'latina',
      style: 'casual',
      descriptor: 'mujer de 29 años',
      setting: 'baño',
      personality: 'cercana',
    })
    .returning();

  const batchId = newUlid();
  await queryStack(
    `INSERT INTO ad_batch (id, project_id, brief_id, matrix, tier, objective, languages)
     VALUES ($1, $2, $3, $4, 'test', 'hook_test', $5)`,
    [batchId, p!.id, brief!.id, JSON.stringify({ destination: 'organic' }), ['es']],
  );

  const masterId = await seedMasterAsset();
  const variantId = newUlid();
  const filenameCode = `nuvela-${variantId.slice(-8).toLowerCase()}-es-15s`;
  await queryStack(
    `INSERT INTO ad_variant
       (id, batch_id, angle_name, framework, persona_id, language, duration_target, platform_targets,
        filename_code, status, audio_source, master_asset_id, score)
     VALUES ($1, $2, 'A1 · Antes/después', 'pain_point', $3, 'es', 15, $4, $5, 'approved', $6, $7, 100)`,
    [variantId, batchId, persona!.id, opts.platforms, filenameCode, opts.audioSource, masterId],
  );
  return variantId;
}

function selectVariant(page: Page, variantId: string) {
  return page.locator(`[data-slot="library-variant-item"][data-variant-id="${variantId}"]`);
}

test.describe('checklist de publicación + CP5 /library (T6.2)', () => {
  test('la regla Spark: native_trending BLOQUEA con explicación; bed IA PERMITE', async ({
    page,
  }) => {
    const trending = await seedApprovedVariant({
      audioSource: 'native_trending',
      platforms: ['tiktok'],
      personaName: `Trending ${RUN}`,
    });
    const bed = await seedApprovedVariant({
      audioSource: 'ai_bed',
      platforms: ['tiktok'],
      personaName: `Bed ${RUN}`,
    });

    await page.goto('/library');
    await expect(page.locator('[data-slot="library-browser"]')).toBeVisible({ timeout: 15_000 });

    // native_trending → Spark BLOQUEADA + explicación visible (§14 pt 2).
    await selectVariant(page, trending).click();
    const sparkT = page.locator('[data-slot="spark-option"]');
    await expect(sparkT).toBeVisible({ timeout: 15_000 });
    await expect(sparkT).toHaveAttribute('data-allowed', 'false');
    await expect(sparkT).toBeDisabled();
    await expect(page.locator('[data-slot="spark-blocked-reason"]')).toBeVisible();
    await expect(page.locator('[data-slot="spark-blocked-reason"]')).toContainText(
      /licencia|comercial/i,
    );

    // CONTROL NEGATIVO (el otro lado de la regla): bed IA → Spark OFRECIDA, sin explicación de bloqueo.
    await selectVariant(page, bed).click();
    const sparkB = page.locator('[data-slot="spark-option"]');
    await expect(sparkB).toHaveAttribute('data-allowed', 'true');
    await expect(sparkB).toBeEnabled();
    await expect(page.locator('[data-slot="spark-blocked-reason"]')).toHaveCount(0);
  });

  test('CP5: con el checkpoint ACTIVADO el flujo se PAUSA y al confirmar se reanuda', async ({
    page,
  }) => {
    const v = await seedApprovedVariant({
      audioSource: 'ai_bed',
      platforms: ['tiktok'],
      personaName: `CP5 ${RUN}`,
    });

    await page.goto('/library');
    await selectVariant(page, v).click();

    const flow = page.locator('[data-slot="cp5-flow"]');
    await expect(flow).toBeVisible({ timeout: 15_000 });
    // Estado inicial: listo (nada iniciado).
    await expect(flow).toHaveAttribute('data-flow-state', 'ready');

    // ACTIVAR CP5 (el switch).
    await page.locator('[data-slot="cp5-toggle"]').click();
    await expect(page.locator('[data-slot="cp5-toggle"]')).toHaveAttribute('data-enabled', 'true');

    // INICIAR el flujo → con CP5 on, SE PAUSA en waiting_confirmation (NO llega a confirmed).
    await page.locator('[data-slot="cp5-start"]').click();
    await expect(flow).toHaveAttribute('data-flow-state', 'waiting_confirmation', {
      timeout: 15_000,
    });
    // El botón de confirmar aparece (el flujo está DETENIDO esperando confirmación).
    await expect(page.locator('[data-slot="cp5-confirm"]')).toBeVisible();

    // CONFIRMAR → reanuda a confirmed.
    await page.locator('[data-slot="cp5-confirm"]').click();
    await expect(flow).toHaveAttribute('data-flow-state', 'confirmed', { timeout: 15_000 });
  });

  test('CONTROL NEGATIVO de CP5: SIN el checkpoint, iniciar va directo a confirmado (sin pausa)', async ({
    page,
  }) => {
    // El otro lado de la regla de pausa: con CP5 DESACTIVADO, el flujo NO se detiene en confirmación. Si la
    // rama de pausa de CP5 se revirtiera (start→confirmed siempre), el test de arriba daría rojo; ESTE fija
    // que sin CP5 el comportamiento correcto ES ir directo a confirmed — la pausa es EXCLUSIVA de CP5 on.
    const v = await seedApprovedVariant({
      audioSource: 'ai_bed',
      platforms: ['tiktok'],
      personaName: `NoCP5 ${RUN}`,
    });

    await page.goto('/library');
    await selectVariant(page, v).click();

    const flow = page.locator('[data-slot="cp5-flow"]');
    await expect(flow).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-slot="cp5-toggle"]')).toHaveAttribute('data-enabled', 'false');

    // Iniciar SIN activar CP5 → directo a confirmed, sin pasar por waiting_confirmation.
    await page.locator('[data-slot="cp5-start"]').click();
    await expect(flow).toHaveAttribute('data-flow-state', 'confirmed', { timeout: 15_000 });
  });

  test('marcar un ítem del checklist PERSISTE (sobrevive a recargar la página)', async ({
    page,
  }) => {
    const v = await seedApprovedVariant({
      audioSource: 'ai_bed',
      platforms: ['tiktok'],
      personaName: `Mark ${RUN}`,
    });

    await page.goto('/library');
    await selectVariant(page, v).click();

    // El checklist §15.4 RENDERIZA los pasos AIGC por plataforma (el bullet pide «reglas Spark/AIGC por
    // audio_source»): el toggle AIGC de TikTok + el aviso de RESET al duplicar campañas (§663-664).
    await expect(
      page.locator('[data-slot="checklist-checkbox"][data-item-id="tiktok_aigc_toggle"]'),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[data-slot="checklist-checkbox"][data-item-id="tiktok_duplicate_recheck"]'),
    ).toBeVisible();

    const item = page.locator('[data-slot="checklist-checkbox"][data-item-id="aigc_disclosure"]');
    await expect(item).toBeVisible({ timeout: 15_000 });
    await expect(item).toHaveAttribute('data-done', 'false');

    // Marcar → done true.
    await item.click();
    await expect(item).toHaveAttribute('data-done', 'true', { timeout: 15_000 });

    // Recargar la página: la marca sobrevive (persistida en variant_publishing).
    await page.reload();
    await selectVariant(page, v).click();
    const itemAfter = page.locator(
      '[data-slot="checklist-checkbox"][data-item-id="aigc_disclosure"]',
    );
    await expect(itemAfter).toHaveAttribute('data-done', 'true', { timeout: 15_000 });
  });
});
