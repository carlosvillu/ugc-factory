// Executor del nodo N7e · BED MUSICAL IA (T4.9, §7.2 N7e). Molde: N7d (`generate-broll.ts`): una
// cáscara FINA que parsea la config, resuelve el model_profile de música por endpoint (clave natural
// del catálogo), cría el guard de catálogo (`kind:'music'` ANTES de gastar) y llama al servicio
// `runGenerateMusic` UNA vez. Toda la lógica de submit/poll/download/coste vive en el servicio; aquí se
// cablea. A diferencia de N7d (b-roll, 1 clip por escena del body), el bed es UNO por variante: N7e no
// itera escenas — un solo bed cubre el anuncio (§14).
//
// FRONTERAS DE T4.9 (no over-build):
//   - El mood + la duración vienen del config (costura stepless). T4.11 rellenará el mood desde el
//     recipe/brief y la duración desde la variante.
//   - `audio_source=ai_bed` en la VARIANTE (Verificación de T4.11, movida desde T4.9): AL CABLEAR N7e al
//     DAG (T4.11 pass 2b-i) el executor recibe `ctx.variantId` (columna `step_run.variant_id`), así que
//     AHORA sí marca la variante. Se hace TRAS el bed (no antes): la procedencia solo es cierta cuando el
//     bed existe. Stepless (sin `variantId`) el executor omite la marca — la lleva el asset `music_bed`.
import { N7eConfigSchema, PermanentStepError } from '@ugc/core/orchestrator';
import type { StepExecutor } from '@ugc/core/orchestrator';
import { isMusicModelKind } from '@ugc/core/gallery';
import { getModelProfileByEndpoint, setVariantAudioSource } from '@ugc/db';
import { runGenerateMusic } from '@ugc/services';

import type { GenerationExecutorDeps } from './generation';
import { requireOutputContext, runGenerationStep } from './_shared';

/** El ref ligero del bed musical generado (la verdad vive en `generation`/`asset`). */
interface N7eOutput {
  musicEndpoint: string;
  mood: string;
  generationId: string;
  assetId: string;
  durationSeconds: number;
  costCents: number;
}

/**
 * N7e · BED MUSICAL IA (T4.9, §7.2). Genera UN bed de música por MOOD y DURACIÓN con ace-step para
 * poner debajo del voiceover (§14). Instrumental por defecto (la voz es de N7b).
 */
export function makeN7eExecutor(deps: GenerationExecutorDeps): StepExecutor {
  return async (ctx) => {
    const { collectOutput, stepId } = requireOutputContext(ctx, 'N7e');

    const parsed = N7eConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      throw new PermanentStepError(`N7e: config inválida: ${parsed.error.message}`);
    }
    const cfg = parsed.data;

    // Resolver el model_profile de música por endpoint (clave natural, patrón N7a-N7d). Un shape
    // inválido / kind incorrecto es un bug de datos permanente (galería mal sembrada) → `PermanentStepError`
    // (reintentarlo no re-siembra el catálogo).
    const profile = await getModelProfileByEndpoint(deps.db, cfg.musicEndpoint);
    if (profile === undefined) {
      throw new PermanentStepError(
        `N7e: no existe el model_profile de música ${cfg.musicEndpoint} (¿galería sin sembrar?)`,
      );
    }
    if (!isMusicModelKind(profile.kind)) {
      throw new PermanentStepError(
        `N7e: el model_profile ${cfg.musicEndpoint} es kind '${profile.kind}', no un modelo de música (music)`,
      );
    }

    const res = await runGenerationStep(() =>
      runGenerateMusic(
        {
          db: deps.db,
          storage: deps.storage,
          falKey: deps.falKey,
          ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
          ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
          ...(deps.falBaseUrl !== undefined
            ? { falOptions: { baseUrlOverride: deps.falBaseUrl } }
            : {}),
        },
        {
          musicModelProfileId: profile.id,
          mood: cfg.mood,
          durationSeconds: cfg.durationSeconds,
          ...(cfg.lyrics !== undefined ? { lyrics: cfg.lyrics } : {}),
          ...(stepId !== undefined ? { stepRunId: stepId } : {}),
        },
      ),
    );

    // EFECTO DE DOMINIO POR VARIANTE (Verificación T4.11): la variante cuyo bed acabamos de generar
    // tiene `audio_source='ai_bed'`. Solo cuando el nodo corre POR VARIANTE en el DAG (`ctx.variantId`
    // presente, de `step_run.variant_id`); stepless (smoke sin variante) se omite. TRAS el bed: la
    // procedencia solo es cierta con el asset ya creado. Idempotente (un retry reescribe el mismo valor).
    if (ctx.variantId != null && ctx.variantId !== '') {
      const marked = await setVariantAudioSource(deps.db, ctx.variantId, 'ai_bed');
      if (!marked) {
        // La variante del step no existe: cableado roto (un `variant_id` que no apunta a ninguna fila).
        // Permanente (reintentar no la crea); el bed ya se generó, pero la variante no se pudo marcar.
        throw new PermanentStepError(
          `N7e: la variante ${ctx.variantId} del step no existe; no se pudo marcar audio_source='ai_bed'`,
        );
      }
    }

    collectOutput({
      musicEndpoint: cfg.musicEndpoint,
      mood: cfg.mood,
      generationId: res.generation.id,
      assetId: res.assetId,
      durationSeconds: res.durationSeconds,
      costCents: res.costCents,
    } satisfies N7eOutput);
  };
}
