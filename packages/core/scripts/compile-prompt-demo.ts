// `pnpm compile:prompt` (T3.5, Verificación): compila UNA variante real con los templates de
// prueba de T3.2 e imprime el `resolvedPrompt`. Es la contrapartida CLI de los golden files: los
// goldens fijan el output en el gate; este script deja VER y `grep`ear el prompt de un vistazo.
//
// PURO, SIN BD, SIN RED, $0: usa `RAW_GALLERY_SEED` (los mismos JSON que `pnpm seed:gallery`
// inserta) + los fixtures de demo (`compile-fixtures.ts`). No toca Postgres ni fal — el compilador
// es una función pura, así que "compilar una variante real" no necesita infraestructura.
//
// LA VERIFICACIÓN LO EJERCITA ASÍ: `pnpm compile:prompt | grep "no deformation"` debe encontrar el
// fidelity guard, y el guard del vertical (beauty) debe aparecer. Este script imprime también un
// resumen (template elegido, guard packs inyectados) para que esa comprobación sea legible.
import { validateGallerySeed, RAW_GALLERY_SEED } from '../src/gallery/index';
import { compilePrompt } from '../src/gallery/compile-prompt';
import { selectTemplate } from '../src/gallery/select-template';
import { DEMO_BEAUTY_BRIEF, DEMO_PERSONA, DEMO_SCRIPT } from '../src/gallery/compile-fixtures';

function main(): void {
  const validation = validateGallerySeed(RAW_GALLERY_SEED);
  if (!validation.ok || !validation.seed) {
    console.error(
      'compile:prompt: el seed de galería NO valida — corrige el seed antes de compilar.',
    );
    process.exit(1);
  }
  const { templates, guardPacks } = validation.seed;

  // Selecciona el template por las facetas de la variante de demo (beauty / pain_point / tiktok /
  // grwm) — el mismo camino determinista que el executor N6 usará en producción.
  const selection = selectTemplate(templates, {
    vertical: DEMO_BEAUTY_BRIEF.product.category,
    hookAngle: 'pain_point',
    platform: 'tiktok',
    format: 'grwm',
  });
  if (selection.error !== undefined) {
    console.error(`compile:prompt: ${selection.message}`);
    process.exit(1);
  }

  const result = compilePrompt({
    template: selection.template,
    sources: {
      brief: DEMO_BEAUTY_BRIEF,
      persona: DEMO_PERSONA,
      script: DEMO_SCRIPT,
      campaign: { platform: 'tiktok', aspect: '9:16', durationSeconds: 22 },
    },
    guardPacks,
  });

  if (!result.ok) {
    console.error('compile:prompt: la compilación tiene slots sin resolver:');
    for (const issue of result.issues) {
      console.error(
        `  - [${issue.code}] {${issue.slot ?? '?'}} ← ${issue.source ?? '?'}: ${issue.message}`,
      );
    }
    process.exit(1);
  }

  const { resolvedPrompt, templateSlug, guardPackKeysUsed } = result.result;
  console.log('=== compile:prompt — variante de demo (beauty / pain_point / tiktok) ===');
  console.log(`template: ${templateSlug}`);
  console.log(`guard packs: ${guardPackKeysUsed.join(', ')}`);
  console.log('=== resolvedPrompt ===');
  console.log(resolvedPrompt);
  process.exit(0);
}

main();
