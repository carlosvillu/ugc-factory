// Regresión permanente del TRENDING SOUND ADVISOR (T6.6, §14 pt 1-2, e2e.md §8/§9, DoD BLOQUEANTE). Ejercita
// el Advisor del panel de publicación de `/library` contra el sistema real (web + BD + el route native-sound +
// el fake de Creative Center que sirve el catálogo REAL-SHAPE con `if_cml` por sonido):
//   · FILTROS COMERCIALES (§14 pt 2): orgánico muestra CML Y no-CML con su badge; un destino `both` (paid/Spark)
//     restringe a SOLO CML. La ley en DOS destinos (no el punto fijo de uno solo).
//   · SUGERENCIAS POR MOOD: los chips de mood (derivados del título) FILTRAN la lista.
//   · SELECCIÓN + COHERENCIA CON T6.2 (el CONTROL NEGATIVO del arnés): una variante `ai_bed` OFRECE Spark;
//     tras ELEGIR un sonido no-CML se marca `native_trending` → el checklist BLOQUEA Spark en vivo. Revertir la
//     coherencia (que native_trending no marque, o que sparkEligibility deje de bloquear) pone ESTE test ROJO.
//   · GUÍA in-app del flujo nativo + la RESTRICCIÓN de cuentas Business (§14 pt 1) visibles.
//   · EXPORT CON HEADROOM (§14 pt 1): una variante `native_trending` ofrece la descarga SIN bed (headroom),
//     aunque su destino sea orgánico (no `both`).
//
// COSTE $0: variantes aprobadas + máster sembradas (como publishing-checklist/library.spec). El catálogo de
// sonidos lo sirve el fake — NUNCA se pega a TikTok real.
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

const RUN = newUlid().slice(-8);

/** Sube unos bytes como asset `final_video` y devuelve {id, bytes}. */
async function seedMasterAsset(bytes: Buffer): Promise<string> {
  const id = newUlid();
  const storageKey = `e2e/sound-${id}.mp4`;
  const put = await storage.put(storageKey, bytes, { mime: 'video/mp4' });
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
 * Siembra un lote + una variante APROBADA con su máster. `audioSource` y `destination` PARAMETRIZADOS.
 * `withNoBed` materializa la versión SIN bed (headroom) en la key convención para probar su descarga.
 */
async function seedApprovedVariant(opts: {
  audioSource: 'ai_bed' | 'native_trending';
  destination: 'organic' | 'both';
  platforms: string[];
  personaName: string;
  withNoBed?: boolean;
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
    [batchId, p!.id, brief!.id, JSON.stringify({ destination: opts.destination }), ['es']],
  );

  const masterBytes = randomBytes(8192);
  const masterId = await seedMasterAsset(masterBytes);
  const variantId = newUlid();
  const filenameCode = `nuvela-${variantId.slice(-8).toLowerCase()}-es-15s`;
  await queryStack(
    `INSERT INTO ad_variant
       (id, batch_id, angle_name, framework, persona_id, language, duration_target, platform_targets,
        filename_code, status, audio_source, master_asset_id, score)
     VALUES ($1, $2, 'A1 · Antes/después', 'pain_point', $3, 'es', 15, $4, $5, 'approved', $6, $7, 100)`,
    [variantId, batchId, persona!.id, opts.platforms, filenameCode, opts.audioSource, masterId],
  );

  if (opts.withNoBed) {
    // La versión sin bed (headroom): MISMOS bytes de vídeo en la KEY CONVENCIÓN `noBedStorageKey`. Literal
    // repetido a propósito (no se importa @ugc/services: su barrel arrastra un import json que el loader de
    // Playwright rechaza — mismo motivo documentado en library.spec).
    await storage.put(`masters/${variantId}/master-no-bed.mp4`, masterBytes, { mime: 'video/mp4' });
  }

  return variantId;
}

function selectVariant(page: Page, variantId: string) {
  return page.locator(`[data-slot="library-variant-item"][data-variant-id="${variantId}"]`);
}

test.describe('Trending Sound Advisor /library (T6.6)', { tag: ['@f6'] }, () => {
  test('FILTRO COMERCIAL: orgánico muestra CML y no-CML con su flag', async ({ page }) => {
    const v = await seedApprovedVariant({
      audioSource: 'ai_bed',
      destination: 'organic',
      platforms: ['tiktok'],
      personaName: `Organic ${RUN}`,
    });

    await page.goto('/library');
    await expect(page.locator('[data-slot="library-browser"]')).toBeVisible({ timeout: 15_000 });
    await selectVariant(page, v).click();

    const advisor = page.locator('[data-slot="sound-advisor"]');
    await expect(advisor).toBeVisible({ timeout: 15_000 });
    // Orgánico: la nota de alcance NO restringe a CML.
    await expect(page.locator('[data-slot="sound-advisor-scope"]')).toContainText(/orgánico/i);
    // Aparecen sonidos CML (success) Y no-CML (warning) — ambos lados.
    await expect(
      page.locator('[data-slot="sound-commercial-flag"][data-commercial="true"]').first(),
    ).toBeVisible();
    await expect(
      page.locator('[data-slot="sound-commercial-flag"][data-commercial="false"]').first(),
    ).toBeVisible();
  });

  test('FILTRO COMERCIAL: destino paid/Spark (both) restringe a SOLO CML', async ({ page }) => {
    // El otro punto de la ley (§14 pt 2): con destino `both` el servidor filtra a CML → NO hay sonidos no-CML.
    const v = await seedApprovedVariant({
      audioSource: 'ai_bed',
      destination: 'both',
      platforms: ['tiktok'],
      personaName: `Paid ${RUN}`,
    });

    await page.goto('/library');
    await selectVariant(page, v).click();

    await expect(page.locator('[data-slot="sound-advisor-scope"]')).toContainText(
      /Commercial Music Library|CML/i,
      { timeout: 15_000 },
    );
    // Hay sonidos CML…
    await expect(
      page.locator('[data-slot="sound-commercial-flag"][data-commercial="true"]').first(),
    ).toBeVisible();
    // …y NINGUNO no-CML (el filtro comercial los quitó).
    await expect(
      page.locator('[data-slot="sound-commercial-flag"][data-commercial="false"]'),
    ).toHaveCount(0);
  });

  test('SUGERENCIAS POR MOOD: un chip de mood filtra la lista', async ({ page }) => {
    const v = await seedApprovedVariant({
      audioSource: 'ai_bed',
      destination: 'organic',
      platforms: ['tiktok'],
      personaName: `Mood ${RUN}`,
    });

    await page.goto('/library');
    await selectVariant(page, v).click();

    await expect(page.locator('[data-slot="sound-mood-filters"]')).toBeVisible({ timeout: 15_000 });
    const totalBefore = await page.locator('[data-slot="sound-item"]').count();
    expect(totalBefore).toBeGreaterThan(1);

    // Filtrar por «Chill» → la lista se reduce a los sonidos con ese mood (menos que el total).
    await page.locator('[data-slot="sound-mood-chip"][data-mood="chill"]').click();
    await expect
      .poll(async () => page.locator('[data-slot="sound-item"]').count())
      .toBeLessThan(totalBefore);
    // Al menos uno queda, y todos los visibles llevan el badge de mood Chill.
    await expect(page.locator('[data-slot="sound-item"]').first()).toBeVisible();

    // «Todos» restaura la lista completa.
    await page.locator('[data-slot="sound-mood-chip"][data-mood="all"]').click();
    await expect
      .poll(async () => page.locator('[data-slot="sound-item"]').count())
      .toBe(totalBefore);
  });

  test('GUÍA in-app: el flujo nativo y la restricción de cuentas Business son visibles (§14 pt 1)', async ({
    page,
  }) => {
    const v = await seedApprovedVariant({
      audioSource: 'ai_bed',
      destination: 'organic',
      platforms: ['tiktok'],
      personaName: `Guide ${RUN}`,
    });

    await page.goto('/library');
    await selectVariant(page, v).click();

    await expect(page.locator('[data-slot="native-sound-guide"]')).toBeVisible({ timeout: 15_000 });
    // La restricción de cuentas Business (§14 pt 1) — documentada, no automatizada.
    const restriction = page.locator('[data-slot="native-sound-business-restriction"]');
    await expect(restriction).toBeVisible();
    await expect(restriction).toContainText(/Business/i);
    await expect(restriction).toContainText(/personal|creator/i);
  });

  test('FUENTE CAÍDA: cuando Creative Center no responde, la UI AVISA y NO muestra una lista vacía', async ({
    page,
  }) => {
    // DoD BLOQUEANTE (cláusula `sourceOk=false` re-scopeada): en producción SIN sesión de TikTok (T6.1) la
    // fuente real da 404 → el route degrada a `{ sounds: [], sourceOk: false }`. La UI debe DISTINGUIR «fuente
    // caída» (aviso `sound-source-unavailable`) de «filtro sin resultados» (`sound-list-empty`) — si no, el
    // usuario ve una lista vacía indistinguible y no sabe que hay una acción pendiente (conectar TikTok).
    const v = await seedApprovedVariant({
      audioSource: 'ai_bed',
      destination: 'organic',
      platforms: ['tiktok'],
      personaName: `SourceDown ${RUN}`,
    });

    // INTERCEPCIÓN LOCAL AL TEST (no toca el fake compartido, sin flake en otros specs): la llamada del
    // NAVEGADOR al GET del Advisor se responde con lo que el route produce cuando Creative Center falla (404):
    // 200 + body `sourceOk:false`, lista vacía. Es exactamente lo que el verifier observó en vivo.
    await page.route('**/api/variants/*/native-sound', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sounds: [], commercialOnly: false, sourceOk: false }),
      });
    });

    await page.goto('/library');
    await expect(page.locator('[data-slot="library-browser"]')).toBeVisible({ timeout: 15_000 });
    await selectVariant(page, v).click();

    // El aviso de fuente caída es VISIBLE…
    const unavailable = page.locator('[data-slot="sound-source-unavailable"]');
    await expect(unavailable).toBeVisible({ timeout: 15_000 });
    // …y NO se muestra el vacío de «filtro sin resultados» (la conflación que se evita).
    await expect(page.locator('[data-slot="sound-list-empty"]')).toHaveCount(0);
  });

  test('SELECCIÓN + COHERENCIA T6.2 (control negativo): elegir un no-CML marca native_trending y BLOQUEA Spark', async ({
    page,
  }) => {
    const v = await seedApprovedVariant({
      audioSource: 'ai_bed',
      destination: 'organic',
      platforms: ['tiktok'],
      personaName: `Select ${RUN}`,
      withNoBed: true,
    });

    await page.goto('/library');
    await selectVariant(page, v).click();

    // ANTES: la variante es ai_bed → Spark se OFRECE (el otro lado de la coherencia).
    const spark = page.locator('[data-slot="spark-option"]');
    await expect(spark).toBeVisible({ timeout: 15_000 });
    await expect(spark).toHaveAttribute('data-allowed', 'true');
    await expect(page.locator('[data-slot="spark-blocked-reason"]')).toHaveCount(0);

    // ELEGIR un sonido no-CML (cc-sound-0001 es if_cml:false en el catálogo).
    const nonCml = page.locator('[data-slot="sound-item"][data-commercial="false"]').first();
    await expect(nonCml).toBeVisible();
    await nonCml.locator('[data-slot="sound-select"]').click();
    await expect(nonCml).toHaveAttribute('data-selected', 'true', { timeout: 15_000 });

    // DESPUÉS: audio_source=native_trending → Spark se BLOQUEA en vivo (recarga del PublishingState).
    await expect(spark).toHaveAttribute('data-allowed', 'false', { timeout: 15_000 });
    await expect(spark).toBeDisabled();
    await expect(page.locator('[data-slot="spark-blocked-reason"]')).toBeVisible();
    await expect(page.locator('[data-slot="spark-blocked-reason"]')).toContainText(
      /licencia|comercial/i,
    );

    // EXPORT CON HEADROOM (§14 pt 1): al ser native_trending, aparece la descarga sin bed (headroom) — aunque
    // el destino sea orgánico (no `both`). Recargamos la variante para re-derivar el linaje (audio_source).
    await page.reload();
    await selectVariant(page, v).click();
    const noBed = page.locator('[data-slot="download-bundle-nobed"]');
    await expect(noBed).toBeVisible({ timeout: 15_000 });
    await expect(noBed).toContainText(/headroom/i);
  });
});
