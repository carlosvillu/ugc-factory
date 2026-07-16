// SIEMBRA DE LA GALERÍA (T3.2): upsert idempotente de los templates de prompt y los guard
// packs que `packages/core/gallery-seed/*.json` versiona en git. Espejo de `library.repo.ts`
// (T2.1): una transacción, ON CONFLICT … DO UPDATE por CLAVE NATURAL (slug / key), y —lo
// load-bearing— el set-list de la actualización NO pisa las columnas de RUNTIME.
//
// §10.2 regla 1: "el JSON es el formato de intercambio y review; la BD es el runtime". Correr
// `seed:gallery` N veces deja la MISMA galería: el segundo pase actualiza metadatos, no inserta
// filas nuevas.
import { count, eq, sql } from 'drizzle-orm';
import type { GallerySeed, ModelStatus } from '@ugc/core/gallery';
import type { DbClient } from '../client';
import type { SeedConflictPolicy } from './library.repo';
import { guardPack, modelProfile, promptTemplate } from '../schema/gallery';

export interface SeedGalleryCounts {
  templates: number;
  guardPacks: number;
  modelProfiles: number;
}

/**
 * Siembra templates + guard packs y devuelve el TOTAL de filas por tabla tras la operación (no
 * las insertadas: en la segunda corrida se insertan 0 y el total no cambia — que es lo que
 * prueba la idempotencia).
 *
 * Todo en UNA transacción: o queda la galería entera, o nada a medias.
 */
export async function seedGallery(
  db: DbClient,
  seed: GallerySeed,
  opts: { onConflict?: SeedConflictPolicy } = {},
): Promise<SeedGalleryCounts> {
  // Política ante colisión (T3.9), hilada por las tres tablas como en `seedLibrary`:
  //   - `'update'` (default): re-siembra deliberada tras un cambio de código (`pnpm seed:gallery`).
  //   - `'nothing'`: first-insert-only, lo que usa el ARRANQUE de web. CRÍTICO para el template:
  //     un `DO UPDATE` en el boot REVERTIRÍA en cada redeploy la edición que el usuario haya hecho
  //     en `/gallery` (`createTemplateVersion` escribe body/beats/guardPackKeys/headVersion sobre
  //     la fila viva) → pérdida de datos. Con `'nothing'`, first boot inserta, boots posteriores
  //     no-op sobre las filas presentes, y un template NUEVO en el código sí se recoge.
  const onConflict = opts.onConflict ?? 'update';
  await db.transaction(async (tx) => {
    // ── guard packs primero (los templates los referencian por key) ──
    if (seed.guardPacks.length > 0) {
      const insertGuardPacks = tx.insert(guardPack).values(
        seed.guardPacks.map((p) => ({
          key: p.key,
          scope: p.scope,
          vertical: p.vertical,
          platform: p.platform,
          lines: p.lines,
        })),
      );
      await (onConflict === 'nothing'
        ? insertGuardPacks.onConflictDoNothing({ target: guardPack.key })
        : // Existe (misma key) → se REESCRIBEN sus datos. `excluded.*` para que cada fila del
          // INSERT de N valores reciba SU propio valor (un literal las pisaría todas).
          insertGuardPacks.onConflictDoUpdate({
            target: guardPack.key,
            set: {
              scope: sql`excluded.scope`,
              vertical: sql`excluded.vertical`,
              platform: sql`excluded.platform`,
              lines: sql`excluded.lines`,
              updatedAt: new Date(),
            },
          }));
    }

    if (seed.templates.length > 0) {
      const insertTemplates = tx.insert(promptTemplate).values(
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
      );
      await (onConflict === 'nothing'
        ? // Boot: la fila viva NO se toca — la edición del usuario (`createTemplateVersion`)
          // sobrevive al redeploy. Un slug NUEVO del código sí se inserta.
          insertTemplates.onConflictDoNothing({ target: promptTemplate.slug })
        : // El template existe (mismo slug) → se ACTUALIZAN sus campos AUTORADOS. El seed es la
          // fuente de verdad de lo que el template ES; la BD, de su HISTORIA. Por eso el set-list
          // NUNCA toca `perf`, `usageCount` ni `headVersion` (estado de runtime/flywheel de F7):
          // pisarlos corromperría la historia en cada re-siembra — el bug que este molde evita.
          insertTemplates.onConflictDoUpdate({
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
          }));
    }

    // ── model_profile (§13.1, T3.4) ──
    // Clave natural = `falEndpoint`. Idéntico molde que arriba, con UNA diferencia LOAD-BEARING:
    // el set-list NO toca `verifiedAt` NI `status`. Esos dos los posee `pnpm fal:verify` (marca
    // cuándo se contrastó contra fal y si el modelo sigue vivo) — pisarlos en cada re-siembra
    // borraría el resultado de la última verificación. Mismo criterio que `perf`/`headVersion`
    // de los templates: el seed es la fuente de verdad de lo que el modelo ES; la BD, de cuándo
    // se verificó y si sigue activo. `status` arranca en su default de columna (`active`) al
    // INSERTAR, y solo `fal:verify` lo pasa a `deprecated`.
    if (seed.modelProfiles.length > 0) {
      const insertModelProfiles = tx.insert(modelProfile).values(
        seed.modelProfiles.map((m) => ({
          falEndpoint: m.falEndpoint,
          kind: m.kind,
          capabilities: m.capabilities,
          cost: m.cost,
          promptAdapter: m.promptAdapter,
        })),
      );
      await (onConflict === 'nothing'
        ? insertModelProfiles.onConflictDoNothing({ target: modelProfile.falEndpoint })
        : insertModelProfiles.onConflictDoUpdate({
            target: modelProfile.falEndpoint,
            set: {
              kind: sql`excluded.kind`,
              capabilities: sql`excluded.capabilities`,
              cost: sql`excluded.cost`,
              promptAdapter: sql`excluded.prompt_adapter`,
              updatedAt: new Date(),
              // NO: verifiedAt, status — los posee `fal:verify` (runtime), no el seed.
            },
          }));
    }
  });

  return countGallery(db);
}

/**
 * Marca el resultado de una verificación de catálogo (`pnpm fal:verify`) sobre UN perfil: pone
 * `verified_at = now()` y, si fal ya no expone el endpoint o divergió a `deprecated`, cambia el
 * `status`. Idempotente por `falEndpoint`. NO toca los campos autorados por el seed.
 */
export async function markModelVerified(
  db: DbClient,
  falEndpoint: string,
  opts: { status?: ModelStatus; verifiedAt?: Date } = {},
): Promise<void> {
  await db
    .update(modelProfile)
    .set({
      verifiedAt: opts.verifiedAt ?? new Date(),
      ...(opts.status ? { status: opts.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(modelProfile.falEndpoint, falEndpoint));
}

/** Totales por tabla — lo que `seed:gallery` imprime y lo que la Verificación mira. */
export async function countGallery(db: DbClient): Promise<SeedGalleryCounts> {
  const [templates] = await db.select({ n: count() }).from(promptTemplate);
  const [guardPacks] = await db.select({ n: count() }).from(guardPack);
  const [modelProfiles] = await db.select({ n: count() }).from(modelProfile);
  return {
    templates: templates?.n ?? 0,
    guardPacks: guardPacks?.n ?? 0,
    modelProfiles: modelProfiles?.n ?? 0,
  };
}
