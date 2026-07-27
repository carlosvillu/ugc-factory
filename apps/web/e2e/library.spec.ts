// Regresión permanente de `/library` — BIBLIOTECA DE VÍDEOS (T5.7, e2e.md §8/§9, DoD BLOQUEANTE). Ejercita
// la página COMPLETA contra el sistema real (web + BD + storage + los routes de library/lineage/bundle):
//   · FILTROS (objetivo/idioma/plataforma) que re-consultan la lista.
//   · PREVIEW (el <video> del máster + el overlay de safe zones conmutable).
//   · LINAJE hasta el hook line y el `template@version` EXACTOS (lo que la Verificación exige).
//   · DESCARGA del bundle verificando el CHECKSUM del MP4 extraído del ZIP contra el `asset.checksum` real.
//   · EL CASO DUAL con/sin bed (§14): un lote destino «ambos» ofrece las DOS versiones; ambas descargan un
//     ZIP con su MP4; el MP4 con bed y el sin bed comparten el MISMO stream de vídeo (fixtures media: el
//     no-bed se siembra como copia del vídeo del máster — la prueba de «sin re-encode» la lleva la suite
//     media de @ugc/services con ffmpeg real; aquí se ejercita la PLOMERÍA del dual, no el re-mux).
//
// POR QUÉ SE SIEMBRA (coste $0): las variantes aprobadas + sus másteres se siembran (fichero mp4 real en el
// almacén + fila `asset` `final_video` + `ad_variant` con linaje), como `variant-review.spec` (T5.6). Recorrer
// el pipeline gastaría fal. La siembra en reposo va por el cliente tipado; el linaje y el puntero al máster,
// por SQL crudo (`queryStack`) — no hay repo que inserte solo esos punteros.
import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { newUlid } from '@ugc/core/contracts';
import { createAsset, createDb, makeLocalStorageAdapter } from '@ugc/db';
import {
  hookLine as hookLineTable,
  persona as personaTable,
  productBrief as productBriefTable,
  project as projectTable,
  promptTemplate as promptTemplateTable,
  urlAnalysis as urlAnalysisTable,
} from '@ugc/db/schema';
import { makeAsset, makeProductBrief, makeProject, makeUrlAnalysis } from '@ugc/test-utils';
import { apiCall } from './support/http';
import { queryStack, stackDatabaseUrl, assetsDir } from './support/stack-db';

const stackDb = createDb(stackDatabaseUrl);
const storage = makeLocalStorageAdapter({ root: assetsDir });

/** Sufijo único por ejecución. `persona.name` es UNIQUE y el stack e2e NO trunca entre
 *  corridas: bajo `fullyParallel` (y en re-runs sobre el mismo stack) un nombre de persona
 *  ESTÁTICO colisiona con el de otra corrida/worker. Los nombres de persona de este spec son
 *  scaffolding incidental (verifica export DUAL/linaje, NO afirma el nombre), así que se les
 *  cuelga este sufijo para hacerlos únicos sin tocar ninguna aserción. */
const RUN = newUlid().slice(-8);

/** El brief que da el `product.name`/`brand_name` del bundle (metadata.json). */
const BRIEF = { product: { name: 'Serum Vitamina C', brand_name: 'Nuvela' } };

interface SeededVariant {
  variantId: string;
  filenameCode: string;
  masterChecksum: string;
  masterStorageKey: string;
}

/** Sube unos bytes como asset `final_video` y devuelve su fila. */
async function seedMasterAsset(
  bytes: Uint8Array,
): Promise<{ id: string; storageKey: string; checksum: string }> {
  const id = newUlid();
  const storageKey = `e2e/library-${id}.mp4`;
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
  return { id: row.id, storageKey, checksum: put.checksum };
}

/**
 * Siembra un lote + una variante APROBADA con LINAJE COMPLETO (hook line + template@version + persona) y su
 * máster. `destination` va en el `matrix` del lote (§14). Si `withNoBed`, siembra también la versión sin bed
 * en la key convención `masters/:variantId/master-no-bed.mp4` (COPIA del vídeo del máster: mismo stream).
 */
async function seedApprovedVariant(opts: {
  destination: 'organic' | 'both';
  language: string;
  platforms: string[];
  hookText: string;
  templateSlug: string;
  templateVersion: number;
  personaName: string;
  withNoBed: boolean;
}): Promise<SeededVariant> {
  const [p] = await stackDb.insert(projectTable).values(makeProject()).returning();
  const [ua] = await stackDb
    .insert(urlAnalysisTable)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const [brief] = await stackDb
    .insert(productBriefTable)
    .values(makeProductBrief({ urlAnalysisId: ua!.id, data: BRIEF }))
    .returning();

  // Hook line + persona + template de la librería (el linaje resuelve a ELLOS).
  const [hook] = await stackDb
    .insert(hookLineTable)
    .values({ angle: 'pain_point', text: opts.hookText, language: opts.language })
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
  const [tpl] = await stackDb
    .insert(promptTemplateTable)
    .values({
      slug: opts.templateSlug,
      title: 'Before/After skincare',
      kind: 'video',
      body: '{persona.descriptor}',
      language: opts.language,
    })
    .returning();

  // El lote con `destination` en el matrix (§14).
  const batchId = newUlid();
  await queryStack(
    `INSERT INTO ad_batch (id, project_id, brief_id, matrix, tier, objective, languages)
     VALUES ($1, $2, $3, $4, 'test', 'hook_test', $5)`,
    [batchId, p!.id, brief!.id, JSON.stringify({ destination: opts.destination }), [opts.language]],
  );

  // El máster con bed (fichero mp4 real). El no-bed, si aplica, es una COPIA de su vídeo (mismos bytes).
  const masterBytes = randomBytes(8192);
  const master = await seedMasterAsset(masterBytes);

  const variantId = newUlid();
  const filenameCode = `nuvela-${variantId.slice(-8).toLowerCase()}-${opts.language}-15s`;
  await queryStack(
    `INSERT INTO ad_variant
       (id, batch_id, angle_name, framework, hook_line_id, persona_id, prompt_template_id, template_version,
        language, duration_target, platform_targets, filename_code, status, audio_source, master_asset_id, score)
     VALUES ($1, $2, 'A1 · Antes/después', 'pain_point', $3, $4, $5, $6, $7, 15, $8, $9, 'approved', 'ai_bed', $10, 100)`,
    [
      variantId,
      batchId,
      hook!.id,
      persona!.id,
      tpl!.id,
      opts.templateVersion,
      opts.language,
      opts.platforms,
      filenameCode,
      master.id,
    ],
  );

  if (opts.withNoBed) {
    // La versión sin bed: MISMOS bytes de vídeo (copia del máster) en la KEY CONVENCIÓN. Es la «fixtures
    // media» del caso dual — la ruta la sirve tal cual; el re-mux real lo prueba la suite media.
    // NOTA: el contrato de esta key vive en `noBedStorageKey` de @ugc/services (lo usa la ruta del bundle),
    // pero NO se importa aquí: el barrel de @ugc/services arrastra @ugc/core/gallery → un `import ... json`
    // sin `assert {type:'json'}` que el loader de Playwright rechaza (el bundler de Next sí lo tolera). Se
    // deja el literal repetido a propósito; si la convención cambia, este test lo destapa (la descarga daría 409).
    await storage.put(`masters/${variantId}/master-no-bed.mp4`, masterBytes, { mime: 'video/mp4' });
  }

  return {
    variantId,
    filenameCode,
    masterChecksum: master.checksum,
    masterStorageKey: master.storageKey,
  };
}

/** Extrae el `metadata.json` y el (único) MP4 de un ZIP de bundle. */
function readBundle(zipBytes: Uint8Array): {
  mp4Name: string;
  mp4Bytes: Uint8Array;
  metadata: unknown;
} {
  const files = unzipSync(zipBytes);
  const names = Object.keys(files);
  const mp4Name = names.find((n) => n.endsWith('.mp4'));
  const metaName = names.find((n) => n === 'metadata.json');
  if (mp4Name === undefined || metaName === undefined) {
    throw new Error(`bundle inválido: entradas ${JSON.stringify(names)}`);
  }
  return {
    mp4Name,
    mp4Bytes: files[mp4Name]!,
    metadata: JSON.parse(Buffer.from(files[metaName]!).toString('utf8')),
  };
}

function browser(page: Page) {
  return page.locator('[data-slot="library-browser"]');
}

test.describe('biblioteca de vídeos /library (T5.7)', () => {
  test('lista, preview, linaje hasta hook/template, y descarga del bundle con checksum', async ({
    page,
    request,
  }) => {
    // Una variante aprobada con destino «ambos» (dual) + linaje completo.
    const v = await seedApprovedVariant({
      destination: 'both',
      language: 'es',
      platforms: ['tiktok', 'meta'],
      hookText: 'La vitamina C que sí se nota',
      templateSlug: 'before-after-skincare',
      templateVersion: 3,
      personaName: `Lucía ${RUN}`,
      withNoBed: true,
    });

    await page.goto('/library');
    await expect(browser(page)).toBeVisible({ timeout: 15_000 });

    // La variante aparece en la lista y se selecciona (o ya es la primera).
    const item = page.locator(
      `[data-slot="library-variant-item"][data-variant-id="${v.variantId}"]`,
    );
    await expect(item).toBeVisible({ timeout: 15_000 });
    await item.click();

    // PREVIEW: el <video> apunta al máster; el overlay de safe zones está presente y conmuta.
    const video = page.locator('[data-slot="library-video"]');
    await expect(video).toHaveAttribute('src', new RegExp(`/api/assets/.+/download`));
    await expect(page.locator('[data-slot="library-safe-zone"]')).toBeVisible();

    // LINAJE: el hook line EXACTO y el template@version EXACTO llegan a la UI.
    await expect(page.locator('[data-slot="lineage-hook"]')).toContainText(
      'La vitamina C que sí se nota',
    );
    await expect(page.locator('[data-slot="lineage-template-ref"]')).toHaveText(
      'before-after-skincare@3',
    );
    await expect(page.locator('[data-slot="lineage-persona"]')).toContainText('Lucía');

    // DESCARGA (con bed): el ZIP trae un MP4 cuyo sha256 == el `asset.checksum` real, y un metadata.json
    // válido con caption dentro de límites. Se pide por `page.request` (hereda la cookie del storageState).
    const withBedUrl = `/api/variants/${v.variantId}/bundle?audio=with_bed`;
    const res = await apiCall(() => request.get(withBedUrl), 'GET bundle with_bed');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/zip');
    const withBed = readBundle(new Uint8Array(await res.body()));
    // El MP4 con bed ES el máster → su checksum coincide con el del asset (paridad con assets-download).
    expect(createHash('sha256').update(withBed.mp4Bytes).digest('hex')).toBe(v.masterChecksum);
    // El header expone el mismo checksum del productor real.
    expect(res.headers()['x-bundle-mp4-checksum']).toBe(v.masterChecksum);
    // El metadata: caption ≤100 sin @/#/links, brand_name ≤20, flags AIGC, audio con bed.
    const meta = withBed.metadata as Record<string, unknown>;
    expect(String(meta.ad_caption).length).toBeLessThanOrEqual(100);
    expect(String(meta.ad_caption)).not.toContain('@');
    expect(String(meta.ad_caption)).not.toContain('#');
    expect(String(meta.brand_name).length).toBeLessThanOrEqual(20);
    expect(meta.brand_name).toBe('Nuvela');
    expect(meta.audio_version).toBe('with_bed');
    expect(meta.audio_source).toBe('ai_bed');
    expect((meta.aigc as Record<string, unknown>).aigc_disclosure).toBe(true);
    expect(Array.isArray(meta.checklist)).toBe(true);
  });

  test('caso DUAL con/sin bed: dos versiones del MISMO máster, mismo stream de vídeo, audio_source distinto', async ({
    page,
    request,
  }) => {
    const v = await seedApprovedVariant({
      destination: 'both',
      language: 'en',
      platforms: ['tiktok'],
      hookText: 'The vitamin C you can actually see',
      templateSlug: 'before-after-dual',
      templateVersion: 2,
      // Sufijo único por corrida (ver `RUN`): un literal estático colisiona con el mismo
      // spec en otro worker/re-run porque el stack no trunca. Fix de-brittling drive-by en
      // T5.10; el primer intento (renombrar a un literal) era insuficiente — el nombre debe
      // ser único POR CORRIDA. El nombre de persona es scaffolding, no una aserción.
      personaName: `Maya Dual ${RUN}`,
      withNoBed: true,
    });

    await page.goto('/library');
    await page
      .locator(`[data-slot="library-variant-item"][data-variant-id="${v.variantId}"]`)
      .click();

    // El botón de descarga SIN bed aparece SOLO en destino «ambos».
    await expect(page.locator('[data-slot="download-bundle-nobed"]')).toBeVisible();

    // Descargar AMBAS versiones y comparar los MP4 extraídos.
    const withBedRes = await apiCall(
      () => request.get(`/api/variants/${v.variantId}/bundle?audio=with_bed`),
      'GET dual with_bed',
    );
    const noBedRes = await apiCall(
      () => request.get(`/api/variants/${v.variantId}/bundle?audio=no_bed`),
      'GET dual no_bed',
    );
    expect(withBedRes.status()).toBe(200);
    expect(noBedRes.status()).toBe(200);

    const withBed = readBundle(new Uint8Array(await withBedRes.body()));
    const noBed = readBundle(new Uint8Array(await noBedRes.body()));

    // Las dos versiones salen del MISMO máster: sus vídeos son idénticos (el fixture no-bed es copia del
    // vídeo del máster). El checksum del MP4 coincide → «mismo máster» probado a nivel de bytes de vídeo.
    // (La prueba de «sin re-encode» del re-mux REAL la lleva la suite media de @ugc/services con ffmpeg.)
    expect(createHash('sha256').update(noBed.mp4Bytes).digest('hex')).toBe(
      createHash('sha256').update(withBed.mp4Bytes).digest('hex'),
    );

    // El metadata distingue las dos versiones: audio_source con bed = ai_bed; sin bed = none.
    expect((withBed.metadata as Record<string, unknown>).audio_source).toBe('ai_bed');
    expect((noBed.metadata as Record<string, unknown>).audio_source).toBe('none');
    expect((withBed.metadata as Record<string, unknown>).audio_version).toBe('with_bed');
    expect((noBed.metadata as Record<string, unknown>).audio_version).toBe('no_bed');
    // Los nombres de fichero difieren (el sin bed lleva el sufijo -nobed) → no colisionan al guardarlos.
    expect(noBed.mp4Name).toContain('-nobed');
    expect(withBed.mp4Name).not.toContain('-nobed');
  });

  test('los filtros re-consultan la lista (idioma)', async ({ page }) => {
    // Dos variantes de idiomas distintos.
    const es = await seedApprovedVariant({
      destination: 'organic',
      language: 'es',
      platforms: ['tiktok'],
      hookText: 'Hook en español',
      templateSlug: 'tpl-es',
      templateVersion: 1,
      personaName: `Lucía ES ${RUN}`,
      withNoBed: false,
    });
    const en = await seedApprovedVariant({
      destination: 'organic',
      language: 'en',
      platforms: ['meta'],
      hookText: 'Hook in English',
      templateSlug: 'tpl-en',
      templateVersion: 1,
      personaName: `Maya EN ${RUN}`,
      withNoBed: false,
    });

    await page.goto('/library');
    await expect(browser(page)).toBeVisible({ timeout: 15_000 });

    // Ambas están (pueden convivir con las de otros tests: fullyParallel siembra datos únicos por spec).
    await expect(
      page.locator(`[data-slot="library-variant-item"][data-variant-id="${es.variantId}"]`),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator(`[data-slot="library-variant-item"][data-variant-id="${en.variantId}"]`),
    ).toBeVisible();

    // Filtrar por idioma «en» → desaparece la de español, queda la inglesa.
    await page.locator('[data-slot="filter-language"]').selectOption('en');
    await expect(
      page.locator(`[data-slot="library-variant-item"][data-variant-id="${en.variantId}"]`),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator(`[data-slot="library-variant-item"][data-variant-id="${es.variantId}"]`),
    ).toHaveCount(0, { timeout: 15_000 });
  });

  test('la versión sin bed responde 409 cuando no está materializada', async ({ request }) => {
    // Una variante «ambos» pero SIN sembrar el fichero no-bed → la ruta debe dar 409 (not ready), no 500.
    const v = await seedApprovedVariant({
      destination: 'both',
      language: 'es',
      platforms: ['tiktok'],
      hookText: 'Sin fichero no-bed',
      templateSlug: 'tpl-nonobed',
      templateVersion: 1,
      personaName: `Sin NoBed ${RUN}`,
      withNoBed: false,
    });
    const res = await apiCall(
      () => request.get(`/api/variants/${v.variantId}/bundle?audio=no_bed`),
      'GET no_bed sin materializar',
    );
    expect(res.status()).toBe(409);
    expect(JSON.parse(await res.text()).code).toBe('invalid_transition');
  });

  test('CLICAR descargar cuando la ruta da 409 muestra el error en la UI y NO descarga un fichero', async ({
    page,
  }) => {
    // CONTROL NEGATIVO A NIVEL CLIENTE (regla del arnés, code-review de T5.7 FIX 1): el test de arriba
    // asserta la RUTA (409); ESTE asserta el COMPORTAMIENTO DEL NAVEGADOR. Con el bug (un `<a href download>`
    // crudo) el clic descargaría el CUERPO del 409 renombrado a `.zip`, sin señal. Con el fix, `downloadBundle`
    // mira el status: 409 → banner de error, NINGÚN download. Se ejercita el caso sin-bed no materializado
    // (destino «ambos» pero sin sembrar el fichero no-bed) — el botón «Sin bed» renderiza bajo «ambos».
    const v = await seedApprovedVariant({
      destination: 'both',
      language: 'es',
      platforms: ['tiktok'],
      hookText: 'Descarga que falla en la UI',
      templateSlug: 'tpl-ui409',
      templateVersion: 1,
      personaName: `UI 409 ${RUN}`,
      withNoBed: false,
    });

    await page.goto('/library');
    await page
      .locator(`[data-slot="library-variant-item"][data-variant-id="${v.variantId}"]`)
      .click();

    const noBedButton = page.locator('[data-slot="download-bundle-nobed"]');
    await expect(noBedButton).toBeVisible({ timeout: 15_000 });

    // Se arma la escucha del evento `download` ANTES del clic: con el bug, el `<a download>` lo dispara; con
    // el fix NUNCA se dispara. Un timeout corto → `null` es la afirmación de «no hubo descarga».
    const downloadEvent = page.waitForEvent('download', { timeout: 2500 }).catch(() => null);
    await noBedButton.click();

    // El error es VISIBLE en la UI (banner de descarga con `role="alert"`).
    await expect(page.locator('[data-slot="download-error"]')).toBeVisible({ timeout: 15_000 });
    // Y NO se descargó ningún fichero (el cuerpo del 409 no aterriza como `.zip`).
    expect(await downloadEvent).toBeNull();
  });
});
