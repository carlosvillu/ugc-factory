// Executor del nodo N7f · CLIP DE CTA (T5.5a, §7.5 «la CTA es product shot animado»). GEMELO de N7d
// (`generate-broll.ts`): una cáscara FINA que parsea la config, lee la fila REAL de `ad_script`,
// FILTRA a las escenas del segmento `cta` (§7.5 l.292-294: la CTA es un product shot animado, opción A
// del PRD), planifica/cuantiza como N7d y llama al servicio COMPARTIDO `runGenerateBroll` una vez POR
// CLIP con `assetKind:'cta_clip'`. La CTA animada ES i2v de un keyframe, MECÁNICAMENTE idéntica al
// b-roll (mismo Veo i2v) — por eso REUSA el endpoint del recipe (`ctaEndpoint` = el de b-roll) y el
// servicio, sin una 3ª copia de la liquidación (deuda 644).
//
// POR QUÉ UN EXECUTOR PROPIO Y NO REUSAR N7d. El SEGMENTO difiere (cta vs body) y su OUTPUT lleva una
// CLAVE DISTINTIVA (`ctaEndpoint`, NO `brollEndpoint`): en T5.5d el ensamblador N8 leerá los cuatro
// clips (N7c/N7d/N7e/N7f) por su dep — si N7f emitiera la MISMA forma que N7d, `findDepBySchema` no las
// distinguiría (ambigüedad / clip equivocado en el segmento cta). Un executor hermano con su filtro y
// su output es más honesto que ramificar N7d por segmento.
//
// FALLA RUIDOSO (money-gate) si una escena cta no tiene keyframe N7a que animar (mismo guard que N7d):
// un i2v de CTA sin frame inicial se ABORTA con `PermanentStepError` ANTES de gastar.
import { N7fConfigSchema, PermanentStepError } from '@ugc/core/orchestrator';
import type { StepExecutor } from '@ugc/core/orchestrator';
import { isBrollModelKind, planGeneration, quantizeDurationToEnum } from '@ugc/core/gallery';
import { deriveKeyframeAssetIds } from '@ugc/core/generation';
import { AdScriptSchema, type N7fOutput } from '@ugc/core/contracts';
import { getModelProfileByEndpoint, getScriptById } from '@ugc/db';
import { runGenerateBroll } from '@ugc/services';

import type { GenerationExecutorDeps } from './generation';
import {
  requireOutputContext,
  runGenerationStep,
  resolveFalKeyOrPermanent,
  resolveVideoModelCaps,
} from './_shared';

// El shape del artefacto vive en core (`N7fOutputSchema`, contracts/step-outputs.ts): es la FRONTERA
// CROSS-NODE por la que N8 consume los clips de la CTA (`clips[].assetId`, indexados por `ctaSceneIndex`).
// Su CLAVE DISTINTIVA es `ctaEndpoint` (NO `brollEndpoint`) — lo que en T5.5d permite a `findDepBySchema`
// discriminar la dep N7f (clip de CTA) de la dep N7d (b-roll), que comparten la mecánica i2v (par de riesgo).
// El executor solo lo produce tipado contra ella (`satisfies N7fOutput`); nadie llama `.parse()` en el emit.
type N7fClipRef = N7fOutput['clips'][number];

/**
 * N7f · CLIP DE CTA (T5.5a, §7.5). Genera el clip de vídeo de la escena `cta` por i2v del keyframe de
 * product shot (N7a). MISMA mecánica que N7d (b-roll) pero para el segmento `cta`, con `assetKind:
 * 'cta_clip'`. Clip SILENCIOSO (la voz de la CTA es de N7b).
 */
export function makeN7fExecutor(deps: GenerationExecutorDeps): StepExecutor {
  return async (ctx) => {
    const { collectOutput, stepId } = requireOutputContext(ctx, 'N7f');

    const parsed = N7fConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      throw new PermanentStepError(`N7f: config inválida: ${parsed.error.message}`);
    }
    const cfg = parsed.data;

    // CROSS-NODE (§9.6, money-path): los KEYFRAMES i2v vienen de los product shots de N7a de la MISMA
    // variante. En un RUN se DERIVAN del output de la dep N7a (`ctx.deps`); `cfg.imageAssetIds` es la
    // costura STEPLESS del test/smoke. Precedencia DEP-WINS (helper compartido con N7d): un keyframe
    // rancio de OTRA variante animaría el producto equivocado y quemaría vídeo real.
    const depKeyframes = deriveKeyframeAssetIds(ctx.deps ?? []);
    const imageAssetIds = depKeyframes ?? cfg.imageAssetIds;
    if (imageAssetIds === undefined || imageAssetIds.length === 0) {
      throw new PermanentStepError(
        'N7f: no hay keyframes — ni dep N7a (run) ni cfg.imageAssetIds (stepless). ' +
          'Una escena cta sin keyframe N7a no se puede animar (money-gate).',
      );
    }

    // Leer la fila REAL de `ad_script` + el model_profile i2v de la CTA (por endpoint). Independientes →
    // en UNO (`Promise.all`, patrón N7d). El script se VALIDA (nunca castear el jsonb opaco de la BD).
    const [scriptRow, profile] = await Promise.all([
      getScriptById(deps.db, cfg.scriptId),
      getModelProfileByEndpoint(deps.db, cfg.ctaEndpoint),
    ]);
    if (scriptRow === undefined) {
      throw new PermanentStepError(`N7f: el guion ${cfg.scriptId} no existe`);
    }
    const script = AdScriptSchema.pick({ scenes: true, language: true }).parse({
      scenes: scriptRow.scenes,
      language: scriptRow.language,
    });
    if (profile === undefined) {
      throw new PermanentStepError(
        `N7f: no existe el model_profile de CTA ${cfg.ctaEndpoint} (¿galería sin sembrar?)`,
      );
    }
    if (!isBrollModelKind(profile.kind)) {
      throw new PermanentStepError(
        `N7f: el model_profile ${cfg.ctaEndpoint} es kind '${profile.kind}', no un modelo de vídeo i2v/r2v/t2v`,
      );
    }

    // GUARD DE CATÁLOGO COMPARTIDO (money-gate, ANTES de gastar): el MISMO helper de `_shared.ts` que usa
    // N7d — valida `capabilities` (jsonb opaco de la BD) y comprueba aspect/resolution/durations + el
    // invariante `maxDuration === max(durations)`. Un valor no soportado quemaría dinero → aborta.
    const { durations, maxDuration } = resolveVideoModelCaps(
      profile.capabilities,
      { aspect: cfg.aspect, resolution: cfg.resolution },
      'N7f',
      cfg.ctaEndpoint,
    );

    // §7.5: LA CTA ES UN PRODUCT SHOT ANIMADO. Se filtra a las escenas de segment 'cta' ANTES de
    // planificar (espejo del filtro `=== 'body'` de N7d). Una escena cta sin materializar era el hueco
    // que originó T5.5a; aquí se cierra. El orden se preserva (índices estables para N8/dedup).
    const ctaScenes = script.scenes.filter((s) => s.segment === 'cta');
    if (ctaScenes.length === 0) {
      throw new PermanentStepError(
        `N7f: el guion ${cfg.scriptId} no tiene ninguna escena de cta — no hay clip de CTA que generar`,
      );
    }

    // Troceo/cuantización igual que N7d (`planGeneration`, función pura testeada de T3.6): una escena cta
    // > maxDuration se parte; cada clip cuantiza su duración al enum del modelo (redondeo-arriba).
    const plan = planGeneration(ctaScenes, maxDuration);

    // Resuelve la fal-key UNA vez por step (de `app_setting`) ANTES del primer submit — sin key/no
    // descifra → falla PERMANENTE con mensaje accionable (Ajustes → fal), no retry storm.
    const falKey = await resolveFalKeyOrPermanent(deps.falKey, 'N7f');
    const clips: N7fClipRef[] = [];
    for (let ctaSceneIndex = 0; ctaSceneIndex < plan.scenes.length; ctaSceneIndex++) {
      const scenePlan = plan.scenes[ctaSceneIndex];
      if (scenePlan === undefined) continue;
      for (const planned of scenePlan.clips) {
        const durationSeconds = quantizeDurationToEnum(planned.seconds, durations);
        const res = await runGenerationStep(() =>
          runGenerateBroll(
            {
              db: deps.db,
              storage: deps.storage,
              falKey,
              ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
              ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
              ...(deps.falBaseUrl !== undefined
                ? { falOptions: { baseUrlOverride: deps.falBaseUrl } }
                : {}),
            },
            {
              // REUSA el servicio de b-roll con el kind del clip de CTA (T5.5a): misma mecánica i2v, kind
              // distinto → dedup y asset separados de los b-roll.
              assetKind: 'cta_clip',
              brollModelProfileId: profile.id,
              imageAssetIds,
              // LINAJE §12: el clip de CTA deriva del keyframe de N7a que se anima → `parent_asset_ids`
              // = esos keyframes (la verificación lo comprueba; T5.7 recorre este linaje).
              parentAssetIds: imageAssetIds,
              durationSeconds,
              aspectRatio: cfg.aspect,
              resolution: cfg.resolution,
              ...(stepId !== undefined ? { stepRunId: stepId } : {}),
              // SALT DE DEDUP (T4.10) NAMESPACEADO con prefijo `cta:` (T5.5a, fix de colisión de
              // producción). Sin el prefijo, el salt de N7f (`ctaSceneIndex:clipIndex`) COLISIONA con el
              // de N7d (`bodySceneIndex:clipIndex`): body escena 0 → "0:0", cta escena 0 → "0:0". Como
              // N7f reusa el MISMO endpoint (`endpoints.broll`), el MISMO keyframe N7a y el MISMO prompt
              // por defecto que N7d, una variante con body(4s)+cta(4s) sobre el mismo keyframe daría
              // content_hash IDÉNTICO → el índice único de PRODUCCIÓN (global por hash) haría que el
              // segundo (N7f) chocara y fuese a `failed` por LoserRaceError en bucle: la escena cta NUNCA
              // se generaría (el hueco que T5.5a cierra reaparecería como fallo silencioso). El prefijo
              // `cta:` hace DISJUNTOS los espacios de salt de N7d y N7f (N7f ∩ N7d = ∅) SIN tocar el
              // cómputo de hash de N7d (broll queda byte-idéntico). El dedup cross-variant de N7f se
              // preserva: dos variantes con la misma CTA → mismo `cta:0:0` → mismo hash → dedup.
              dedupSalt: `cta:${String(ctaSceneIndex)}:${String(planned.clipIndex)}`,
            },
          ),
        );
        clips.push({
          ctaSceneIndex,
          clipIndex: planned.clipIndex,
          generationId: res.generation.id,
          assetId: res.assetId,
          durationSeconds: res.durationSeconds,
          costCents: res.costCents,
        });
      }
    }

    collectOutput({
      scriptId: cfg.scriptId,
      ctaEndpoint: cfg.ctaEndpoint,
      route: profile.kind,
      clips,
    } satisfies N7fOutput);
  };
}
