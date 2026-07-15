// SIEMBRA DE LA GALERÍA (T3.2): upsert idempotente de los templates de prompt y los guard
// packs que `packages/core/gallery-seed/*.json` versiona en git. Espejo de `library.repo.ts`
// (T2.1): una transacción, ON CONFLICT … DO UPDATE por CLAVE NATURAL (slug / key), y —lo
// load-bearing— el set-list de la actualización NO pisa las columnas de RUNTIME.
//
// §10.2 regla 1: "el JSON es el formato de intercambio y review; la BD es el runtime". Correr
// `seed:gallery` N veces deja la MISMA galería: el segundo pase actualiza metadatos, no inserta
// filas nuevas.
import { count, sql } from 'drizzle-orm';
import type { GallerySeed } from '@ugc/core/gallery';
import type { DbClient } from '../client';
import { guardPack, promptTemplate } from '../schema/gallery';

export interface SeedGalleryCounts {
  templates: number;
  guardPacks: number;
}

/**
 * Siembra templates + guard packs y devuelve el TOTAL de filas por tabla tras la operación (no
 * las insertadas: en la segunda corrida se insertan 0 y el total no cambia — que es lo que
 * prueba la idempotencia).
 *
 * Todo en UNA transacción: o queda la galería entera, o nada a medias.
 */
export async function seedGallery(db: DbClient, seed: GallerySeed): Promise<SeedGalleryCounts> {
  await db.transaction(async (tx) => {
    // ── guard packs primero (los templates los referencian por key) ──
    if (seed.guardPacks.length > 0) {
      await tx
        .insert(guardPack)
        .values(
          seed.guardPacks.map((p) => ({
            key: p.key,
            scope: p.scope,
            vertical: p.vertical,
            platform: p.platform,
            lines: p.lines,
          })),
        )
        // Existe (misma key) → se REESCRIBEN sus datos. `excluded.*` para que cada fila del
        // INSERT de N valores reciba SU propio valor (un literal las pisaría todas).
        .onConflictDoUpdate({
          target: guardPack.key,
          set: {
            scope: sql`excluded.scope`,
            vertical: sql`excluded.vertical`,
            platform: sql`excluded.platform`,
            lines: sql`excluded.lines`,
            updatedAt: new Date(),
          },
        });
    }

    if (seed.templates.length > 0) {
      await tx
        .insert(promptTemplate)
        .values(
          seed.templates.map((t) => ({
            slug: t.slug,
            title: t.title,
            description: t.description,
            kind: t.kind,
            body: t.body,
            beats: t.beats,
            variables: t.variables,
            assetSlots: t.assetSlots,
            guardPackKeys: t.guardPackKeys,
            defaultDurationS: t.defaultDurationS,
            defaultAspect: t.defaultAspect,
            formats: t.formats,
            hookAngles: t.hookAngles,
            verticals: t.verticals,
            platforms: t.platforms,
            aesthetics: t.aesthetics,
            freeTags: t.freeTags,
            status: t.status,
            featured: t.featured,
            license: t.license,
            author: t.author,
            attribution: t.attribution,
            language: t.language,
            translations: t.translations,
            compliance: t.compliance,
          })),
        )
        // El template existe (mismo slug) → se ACTUALIZAN sus campos AUTORADOS. El seed es la
        // fuente de verdad de lo que el template ES; la BD, de su HISTORIA. Por eso el set-list
        // NUNCA toca `perf`, `usageCount` ni `headVersion` (estado de runtime/flywheel de F7):
        // pisarlos corromperría la historia en cada re-siembra — el bug que este molde evita.
        .onConflictDoUpdate({
          target: promptTemplate.slug,
          set: {
            title: sql`excluded.title`,
            description: sql`excluded.description`,
            kind: sql`excluded.kind`,
            body: sql`excluded.body`,
            beats: sql`excluded.beats`,
            variables: sql`excluded.variables`,
            assetSlots: sql`excluded.asset_slots`,
            guardPackKeys: sql`excluded.guard_pack_keys`,
            defaultDurationS: sql`excluded.default_duration_s`,
            defaultAspect: sql`excluded.default_aspect`,
            formats: sql`excluded.formats`,
            hookAngles: sql`excluded.hook_angles`,
            verticals: sql`excluded.verticals`,
            platforms: sql`excluded.platforms`,
            aesthetics: sql`excluded.aesthetics`,
            freeTags: sql`excluded.free_tags`,
            status: sql`excluded.status`,
            featured: sql`excluded.featured`,
            license: sql`excluded.license`,
            author: sql`excluded.author`,
            attribution: sql`excluded.attribution`,
            language: sql`excluded.language`,
            translations: sql`excluded.translations`,
            compliance: sql`excluded.compliance`,
            updatedAt: new Date(),
          },
        });
    }
  });

  return countGallery(db);
}

/** Totales por tabla — lo que `seed:gallery` imprime y lo que la Verificación mira. */
export async function countGallery(db: DbClient): Promise<SeedGalleryCounts> {
  const [templates] = await db.select({ n: count() }).from(promptTemplate);
  const [guardPacks] = await db.select({ n: count() }).from(guardPack);
  return {
    templates: templates?.n ?? 0,
    guardPacks: guardPacks?.n ?? 0,
  };
}
