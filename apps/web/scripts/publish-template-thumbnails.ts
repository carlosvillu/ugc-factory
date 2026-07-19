// PUBLICACIÓN de los templates de la galería con thumbnail (T4.12 Pase B): para cada template `draft` sin
// miniatura, genera el thumbnail REAL con fal (flux-2) y lo promociona a `published`. Es la cláusula 2 de
// la Verificación («los ~50 templates quedan `published` con thumbnail en /gallery; ninguno publicado sin
// thumbnail»). El guard de `setTemplateStatus` ya exige el thumbnail primero — este script respeta ese
// orden (genera → estampa `thumbnail_asset_id` → publica).
//
// ┌─ GASTO REAL ────────────────────────────────────────────────────────────────────────────────────┐
// │ Genera un thumbnail flux-2 por template (dedup de producción: dos templates con el MISMO prompt    │
// │ colapsan a una generación). ~56 templates. El bucle lo corre con presupuesto autorizado. IDEMPOTENTE│
// │ por 3 ramas: (a) sin thumbnail → genera+publica; (b) con thumbnail y draft → solo publica (0 fal); │
// │ (c) ya published → skip. Re-correrlo tras un corte solo hace el trabajo que falta.                 │
// └───────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Env: DATABASE_URL, ASSETS_DIR, FAL_KEY. Turnkey: `pnpm --filter @ugc/web publish:template-thumbnails`.
// Requiere la galería sembrada (`pnpm seed:gallery`, model_profile flux-2 + los 56 templates draft).
import { makeLogger } from '@ugc/core/observability';
import { createDb, listTemplates, makeLocalStorageAdapter, setTemplateStatus } from '@ugc/db';
import { generateTemplateThumbnail } from '@ugc/services';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`publish:template-thumbnails: falta ${name}`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const assetsDir = requireEnv('ASSETS_DIR');
  const falKey = requireEnv('FAL_KEY');

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const logger = makeLogger({ name: 'worker', level: 'info' });

  const { templates } = await listTemplates(db);
  console.log(
    `publish:template-thumbnails: ${String(templates.length)} templates · publicando con thumbnail (RED REAL, GASTA)\n`,
  );

  let generated = 0;
  let publishedOnly = 0;
  let skipped = 0;
  let totalCostCents = 0;

  for (const template of templates) {
    // (c) ya published → skip.
    if (template.status === 'published') {
      skipped += 1;
      continue;
    }

    // (a) sin thumbnail → generar (fal) + publicar.
    if (template.thumbnailAssetId === null || template.thumbnailAssetId === '') {
      const result = await generateTemplateThumbnail({ db, storage, falKey, logger }, template);
      totalCostCents += result.costCents;
      await setTemplateStatus(db, template.id, 'published');
      generated += 1;
      console.log(
        `  [gen ] ${template.slug} → published · asset ${result.assetId}` +
          ` · ${result.reused ? '0¢ (dedup)' : `${String(result.costCents)}¢`}`,
      );
      continue;
    }

    // (b) con thumbnail y draft/review → solo publicar (0 fal).
    await setTemplateStatus(db, template.id, 'published');
    publishedOnly += 1;
    console.log(`  [pub ] ${template.slug} → published (ya tenía thumbnail, 0 fal)`);
  }

  console.log(
    `\npublish:template-thumbnails: ${String(generated)} generados+publicados · ${String(publishedOnly)} solo publicados · ${String(skipped)} ya publicados`,
  );
  console.log(`publish:template-thumbnails: coste total = ${String(totalCostCents)}¢ (→ /spend)`);
  console.log('publish:template-thumbnails: OK ✓ — inspecciona /gallery (published con thumbnail)');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('publish:template-thumbnails: falló', err);
  process.exit(1);
});
