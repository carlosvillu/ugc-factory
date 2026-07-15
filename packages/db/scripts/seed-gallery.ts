// CLI de siembra de la GALERÍA: lo que `pnpm seed:gallery` (raíz → filtro @ugc/db) invoca y lo
// que ejercita la Verificación de T3.2 ("el seed corre dos veces sin duplicar filas").
//
// Mismo patrón que `db:seed`: carga el `.env` raíz vía la flag `--env-file-if-exists` del
// script, lee DATABASE_URL y falla ruidosamente sin ella.
//
// EL VALIDADOR CORRE ANTES DE TOCAR LA BD: un seed con un slot §10.4 inexistente, un slug
// duplicado o un enum inválido ABORTA aquí, con el detalle de qué template está mal. (El mismo
// validador corre además en `pnpm gate` sobre el seed real — el gate caza el problema antes
// incluso de que nadie ejecute este script.)
//
// IDEMPOTENTE: correrlo N veces deja la misma galería (ON CONFLICT — ver gallery-seed.repo.ts).
import { formatGallerySeedIssues, RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { createDb } from '../src/client';
import { seedGallery } from '../src/repos/gallery-seed.repo';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('seed:gallery: falta DATABASE_URL (¿copiaste .env.example a .env?)');
    process.exit(1);
  }

  const validation = validateGallerySeed(RAW_GALLERY_SEED);
  if (!validation.ok || !validation.seed) {
    console.error(
      `seed:gallery: el seed NO es válido (${String(validation.issues.length)} problemas):`,
    );
    console.error(formatGallerySeedIssues(validation.issues));
    process.exit(1);
  }

  const db = createDb(connectionString);
  const counts = await seedGallery(db, validation.seed);

  console.log(
    `seed:gallery: OK — prompt_template=${String(counts.templates)} ` +
      `guard_pack=${String(counts.guardPacks)} ` +
      `model_profile=${String(counts.modelProfiles)}`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('seed:gallery: falló', err);
  process.exit(1);
});
