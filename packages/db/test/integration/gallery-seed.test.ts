// LA VERIFICACIÓN DE T3.2, CODIFICADA COMO TEST PERMANENTE (regla de trabajo 8 del planning:
// toda cláusula determinista y gratuita de la Verificación vive dentro de `pnpm gate`). Contra
// Postgres REAL (Testcontainers), con el seed REAL:
//
//   1. "`pnpm seed:gallery` (upsert idempotente)" → `seedGallery` sobre la BD clonada inserta
//      los templates del JSON versionado, y se leen de vuelta.
//   2. IDEMPOTENCIA ("el seed corre dos veces sin duplicar filas") → la SEGUNDA siembra deja
//      los MISMOS totales, no el doble.
//   3. El seed es la fuente de verdad de lo que el template ES; la BD, de su HISTORIA → una
//      re-siembra actualiza el body pero NO pisa `perf`/`usageCount`/`headVersion` (runtime).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@ugc/test-utils';
import { RAW_GALLERY_SEED, validateGallerySeed } from '@ugc/core/gallery';
import { modelProfile, promptTemplate } from '@ugc/db/schema';
import { countGallery, markModelVerified, seedGallery } from '../../src/repos/gallery-seed.repo';

/** El seed REAL, validado: `seedGallery` inserta exactamente esto (mismo camino que el script,
 *  sin atajos — el arnés no puede ser más cómodo que la realidad). */
function realSeed() {
  const validation = validateGallerySeed(RAW_GALLERY_SEED);
  if (!validation.seed) throw new Error('el seed real de galería no valida');
  return validation.seed;
}

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'gallery-seed' });
});

afterAll(async () => {
  await tdb.close();
});

describe('`pnpm seed:gallery`: puebla la galería y es IDEMPOTENTE (T3.2)', () => {
  it('siembra el seed REAL y correr dos veces NO duplica filas', async () => {
    const seed = realSeed();

    const first = await seedGallery(tdb.db, seed);
    expect(first.templates).toBe(seed.templates.length);
    expect(first.guardPacks).toBe(seed.guardPacks.length);

    // SEGUNDA corrida: ON CONFLICT … DO UPDATE ⇒ actualiza metadatos, ni una fila más.
    const second = await seedGallery(tdb.db, seed);
    expect(second).toEqual(first);

    // Y los datos siguen ahí (no es que la segunda corrida haya vaciado y repuesto).
    const totals = await countGallery(tdb.db);
    expect(totals).toEqual(first);
  });

  it('los templates llegan con su slug, body y facetas', async () => {
    const seed = realSeed();
    const first = seed.templates[0];
    if (!first) throw new Error('el seed real no tiene templates');

    const [row] = await tdb.db
      .select()
      .from(promptTemplate)
      .where(eq(promptTemplate.slug, first.slug));
    expect(row).toBeDefined();
    expect(row?.body).toBe(first.body);
    expect(row?.kind).toBe(first.kind);
  });

  it('re-sembrar con el body corregido ACTUALIZA la fila pero NO pisa el estado de runtime', async () => {
    const seed = realSeed();
    const target = seed.templates[0];
    if (!target) throw new Error('el seed real no tiene templates');

    const [before] = await tdb.db
      .select()
      .from(promptTemplate)
      .where(eq(promptTemplate.slug, target.slug));
    if (!before) throw new Error('el template no se sembró');

    // Simula la historia acumulada en F7: perf/usageCount/headVersion son de la fila VIVA, no del seed.
    await tdb.db
      .update(promptTemplate)
      .set({ perf: { ctr: 0.042 }, usageCount: 17, headVersion: 3 })
      .where(eq(promptTemplate.id, before.id));

    // Re-siembra con el body CORREGIDO, MISMO slug.
    const corrected = {
      ...seed,
      templates: seed.templates.map((t) =>
        t.slug === target.slug ? { ...t, body: `${t.body} // corregido` } : t,
      ),
    };
    await seedGallery(tdb.db, corrected);

    const [after] = await tdb.db
      .select()
      .from(promptTemplate)
      .where(eq(promptTemplate.slug, target.slug));
    expect(after?.body).toContain('// corregido'); // la corrección LLEGA
    expect(after?.id).toBe(before.id); // misma fila
    expect(after?.perf).toEqual({ ctr: 0.042 }); // la HISTORIA no se pisa
    expect(after?.usageCount).toBe(17);
    expect(after?.headVersion).toBe(3);

    // Restaura el seed canónico para no dejar el clon en un estado raro para el resto del fichero.
    await seedGallery(tdb.db, seed);
  });
});

describe('model_profile: seed idempotente + `fal:verify` posee verified_at/status (T3.4)', () => {
  it('siembra el catálogo §13.1 y re-sembrar NO duplica ni pisa el estado de runtime', async () => {
    const seed = realSeed();

    const first = await seedGallery(tdb.db, seed);
    expect(first.modelProfiles).toBe(seed.modelProfiles.length);

    const second = await seedGallery(tdb.db, seed);
    expect(second.modelProfiles).toBe(first.modelProfiles); // ni una fila más

    // Los perfiles llegan con su endpoint, kind y cost; verified_at NULL y status default active.
    const kokoro = seed.modelProfiles.find((m) => m.falEndpoint === 'fal-ai/kokoro');
    if (!kokoro) throw new Error('el seed real no trae fal-ai/kokoro');
    const [row] = await tdb.db
      .select()
      .from(modelProfile)
      .where(eq(modelProfile.falEndpoint, 'fal-ai/kokoro'));
    expect(row).toBeDefined();
    expect(row?.kind).toBe('tts');
    expect(row?.cost).toEqual(kokoro.cost);
    expect(row?.verifiedAt).toBeNull(); // el seed NO verifica; lo hace `fal:verify`
    expect(row?.status).toBe('active');
  });

  it('re-sembrar NO borra el `verified_at`/`status` que puso `fal:verify` (el bug que el molde evita)', async () => {
    const seed = realSeed();
    await seedGallery(tdb.db, seed);

    // Simula lo que hace `pnpm fal:verify`: marca verified_at y degrada un endpoint retirado.
    const verifiedAt = new Date('2026-07-15T10:00:00Z');
    await markModelVerified(tdb.db, 'fal-ai/kokoro', { verifiedAt });
    await markModelVerified(tdb.db, 'fal-ai/latentsync', { status: 'deprecated', verifiedAt });

    // Re-siembra: el ON CONFLICT actualiza cost/kind pero DEBE dejar verified_at/status intactos.
    await seedGallery(tdb.db, seed);

    const [kokoro] = await tdb.db
      .select()
      .from(modelProfile)
      .where(eq(modelProfile.falEndpoint, 'fal-ai/kokoro'));
    expect(kokoro?.verifiedAt).toEqual(verifiedAt); // NO pisado por la re-siembra

    const [latentsync] = await tdb.db
      .select()
      .from(modelProfile)
      .where(eq(modelProfile.falEndpoint, 'fal-ai/latentsync'));
    expect(latentsync?.status).toBe('deprecated'); // el estado de runtime sobrevive
    expect(latentsync?.verifiedAt).toEqual(verifiedAt);
  });
});
