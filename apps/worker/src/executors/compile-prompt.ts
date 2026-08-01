// Executor de N6 · COMPILADOR DE PROMPTS (T3.5, §7.2 N6/§9.3). **Determinista y $0** ("sin LLM",
// §9.3), igual que N4: no pasa por caja. Step AUTOMÁTICO, NO checkpoint (§9.5 no lo marca como
// checkpoint): el `resolvedPrompt` es auditoría en canvas (T4.11), no una decisión con dinero — el
// dinero se gasta en N7. Molde de N4 (strategy.ts): cáscara fina que conecta el orquestador con el
// MOTOR PURO de `@ugc/core/gallery` (`compilePrompt`) y devuelve el resultado por `output_refs`.
//
// QUIÉN LO CONSUME HOY: el `resolvedPrompt`/`resolvedBeats` de la variante entera lo lee la UI de
// auditoría del canvas (T4.11: `run-canvas/step-assets.ts` del `output_refs`). T5b.1b-i AÑADE al output
// `scenePrompts`: un prompt compilado por escena `body`/`cta` (con `compilePrompt({ scene })`, ver
// `compileScenePrompts` abajo) con su guard pack §9.5. WINDOWING PARCIAL (verdad explícita para
// T5b.1b-ii): la ventana temporal `[t, t+seconds)` de la escena SOLO acota `resolvedBeats` y el bloque
// `Beats:` del prompt; la PROSA del template `body` es GLOBAL y sigue narrando el hook/cta de otras
// escenas. NINGÚN N7 lo lee AÚN — cablear ese consumo en N7d/N7f (b-roll/CTA i2v), hoy caídos a
// `DEFAULT_BROLL_PROMPT`, es la DEUDA que queda para T5b.1b-ii. La arista `dependsOn:[n6Key]` es orden.
//
// EL MOTOR VIVE EN CORE. La compilación (selección de template, interpolación §10.4, guard packs §9.5,
// fidelity guard + anti-estilo, validación de resolución) vive COMPLETA en `@ugc/core/gallery`
// (`compilePrompt`) y se testea con golden files. Este executor es la cáscara fina: valida su config,
// RESUELVE las fuentes y llama al motor. No persiste en `generation` (esa fila la crea N7 al submitear,
// §9.6): el `resolvedPrompt` de variante y los `scenePrompts` viajan por `output_refs` (el primero al
// canvas de auditoría; los segundos los leerá N7d/N7f en T5b.1b-ii) — este executor no toca generación.
//
// DE DÓNDE SACA SUS FUENTES (dos orígenes, precedencia dep-first — ver el docstring de `makeN6Executor`):
// en el DAG de generación (post-CP3) N6 es la RAÍZ (sin dep productora) y ENSAMBLA el `N6Sources` de la
// BD por `variantId` (`assembleN6Sources`, @ugc/services); en la costura stepless (smoke/unit de T3.5)
// un predecesor emite el contrato `N6-sources` por sus `output_refs` y N6 compila de él sin BD. Sin
// ninguno de los dos, marca el nodo INAPLICABLE. El parseo + selección de template viven en
// `resolveCompileInput` (core, junto a zod y el motor).
import {
  AnalysisN6ConfigSchema,
  PermanentStepError,
  type StepExecutor,
} from '@ugc/core/orchestrator';
import type { N6ScenePrompt } from '@ugc/core/contracts';
import {
  compilePrompt,
  resolveCompileInput,
  validateGallerySeed,
  RAW_GALLERY_SEED,
  type CompileDegradation,
  type CompileInput,
  type CompileIssue,
} from '@ugc/core/gallery';
import { assembleN6Sources } from '@ugc/services';
import type { Logger } from '@ugc/core';
import type { DbClient } from '@ugc/db';

/** Deps de N6 (T4.11): la BD para ENSAMBLAR el `N6Sources` de la variante (brief+persona+guion+facetas)
 *  cuando N6 corre en el DAG de generación (donde es la RAÍZ, sin dep productora). `db` es opcional para
 *  la costura STEPLESS: el smoke/unit de T3.5 pasa el `N6-sources` por `deps` sin BD; el path de
 *  producción (post-CP3) lo lee de la BD por `variantId`. */
export interface N6ExecutorDeps {
  db?: DbClient;
  /** T5.12: destino del warning de DEGRADACIÓN de faceta (category libre del LLM que ningún template
   *  reconoce). Sin logger la degradación sigue siendo visible por `output_refs` (`degraded`). */
  logger?: Logger;
}

/**
 * N6: compila el prompt de una variante (determinista, $0). El motor de compilación vive completo en
 * `@ugc/core/gallery` (golden files); este executor RESUELVE LAS FUENTES y llama al motor.
 *
 * DOS ORÍGENES DE FUENTES (precedencia dep-first, para no romper la costura stepless de T3.5):
 *   1. STEPLESS: un dep con un `N6-sources` (`output_refs`) → compila de él (smoke/unit sin BD).
 *   2. PRODUCCIÓN (T4.11): sin ese dep pero CON `deps.db` → ENSAMBLA el `N6Sources` de la BD por
 *      `variantId` (`assembleN6Sources`, @ugc/services). N6 es la raíz del sub-DAG (no tiene productor
 *      aguas arriba), así que en un run real SIEMPRE cae aquí.
 *   3. Ninguno (sin dep y sin `db`) → INAPLICABLE (el mismo surface de T3.5 antes de F4).
 */
export function makeN6Executor(deps: N6ExecutorDeps = {}): StepExecutor {
  return async (ctx) => {
    const { collectOutput, markInapplicable } = ctx;
    if (collectOutput === undefined) {
      throw new PermanentStepError(
        'N6: el ExecutorContext no trae collectOutput (bug de cableado)',
      );
    }

    const parsed = AnalysisN6ConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      throw new PermanentStepError(`N6: config inválida: ${parsed.error.message}`);
    }
    const { variantId } = parsed.data;

    // El seed de galería (templates + guard packs) es la fuente de verdad del motor — los mismos JSON
    // que `pnpm seed:gallery` inserta. Un seed inválido es un fallo de configuración PERMANENTE (no
    // reintentable): el catálogo está roto, un retry no lo arregla.
    const validation = validateGallerySeed(RAW_GALLERY_SEED);
    if (!validation.ok || validation.seed === undefined) {
      throw new PermanentStepError('N6: el seed de galería no valida (catálogo de templates roto)');
    }
    const { templates, guardPacks } = validation.seed;

    // (1) STEPLESS: fuentes por dep `N6-sources` (precede a la BD para no romper el smoke/unit).
    const fromDeps = extractCompileInput(ctx.deps ?? [], templates, guardPacks);
    let compileInput = fromDeps?.input;
    let degraded = fromDeps?.degraded;

    // (2) PRODUCCIÓN: sin dep pero con BD → ensambla el N6Sources de la variante (assembleN6Sources).
    if (compileInput === undefined && deps.db !== undefined) {
      const sources = await assembleN6Sources({ db: deps.db }, { variantId });
      const resolved = resolveCompileInput(sources, templates, guardPacks);
      if (!resolved.ok) {
        throw new PermanentStepError(
          `N6: no se pudo resolver el CompileInput de la variante ${variantId}: ${resolved.message}`,
        );
      }
      compileInput = resolved.input;
      degraded = resolved.degraded;
    }

    if (compileInput === undefined) {
      // Ni dep `N6-sources` ni BD: el nodo no aplica (mismo surface de T3.5). El consumer lo cierra con
      // `skip_inapplicable` (como N2 sin imágenes), no como fallo. Deja constancia del motivo.
      collectOutput({
        node: 'N6',
        skipped: 'awaiting_generation_dag',
        variantId,
        note: 'El compilador N6 está registrado; el DAG de generación que le pasa las fuentes es T4.11.',
      });
      markInapplicable?.();
      return;
    }

    // T5.12 · DEGRADACIÓN OBSERVABLE. La selección encontró template ignorando la `vertical` porque
    // la `product.category` del brief es texto libre del LLM (`Cuidado de la piel`, `Cuidado bucal`…).
    // El lote NO muere — pero la señal "el análisis emite verticales fuera del enum" no se pierde:
    // queda en el log estructurado Y en los `output_refs` del step (auditable en canvas / step_run).
    if (degraded !== undefined) {
      deps.logger?.warn(
        {
          variantId,
          facet: degraded.facet,
          unmatchedValue: degraded.value,
          templateSlug: degraded.templateSlug,
        },
        'N6: category no reconocida por el catálogo — selección DEGRADADA ignorando la vertical',
      );
    }

    // COMPILACIÓN REAL vía el motor puro de core. NO lanza: resultado tipado (ok / issues).
    const result = compilePrompt(compileInput);
    if (!result.ok) {
      // Un slot irresoluble es un desajuste de datos (variante sin guion, persona sin setting…): un
      // fallo DURO y accionable (nombra slot + fuente), no reintentable. Mejor reventar ruidoso que
      // enviar a un modelo de PAGO un prompt con `{slot}` sin resolver.
      throw new PermanentStepError(
        `N6: prompt con slots sin resolver: ${formatCompileIssues(result.issues)}`,
      );
    }

    // T5b.1b-i · UN prompt POR ESCENA `body`/`cta`. N7d/N7f (i2v de b-roll y CTA) generan 1 clip por
    // ESCENA, así que además del `resolvedPrompt` de la variante entera (arriba, para el canvas)
    // compilamos con `compilePrompt({ scene })` cada escena `body`/`cta` — el motor filtra los beats a
    // la ventana `[scene.t, scene.t+scene.seconds)` y emite su guard pack. El `sceneIndex` es el índice
    // ABSOLUTO en `script.scenes`, el mismo keying que `segmentSceneIndices` da a N7d/N7f (T5b.1b-ii).
    // NO toca generación: N7 aún no lee este array, así que el `content_hash` del dedup NO cambia.
    const scenePrompts = compileScenePrompts(compileInput, variantId);

    collectOutput({
      node: 'N6',
      variantId,
      templateSlug: result.result.templateSlug,
      guardPackKeysUsed: result.result.guardPackKeysUsed,
      resolvedPrompt: result.result.resolvedPrompt,
      resolvedBeats: result.result.resolvedBeats,
      // RETROCOMPATIBLE: se AÑADE al output; los campos de arriba mantienen su forma. SIEMPRE presente
      // (incluido `[]` cuando el guion no tiene escenas body/cta), para que el control negativo sea
      // observable en el step_run en vez de ausente.
      scenePrompts,
      // Presente SOLO cuando hubo degradación (T5.12): deja rastro auditable en el step_run.
      ...(degraded !== undefined ? { degradedFacet: degraded } : {}),
    });
  };
}

/**
 * T5b.1b-i · Compila UN prompt por escena de segmento `body`/`cta` del guion de la variante. El motor
 * (`compilePrompt({ scene })`) filtra los BEATS a la ventana temporal de la escena y emite su guard
 * pack (§9.5); esta función solo itera las escenas relevantes y arma el array del output de N6.
 *
 * WINDOWING PARCIAL: la ventana `[t, t+seconds)` SOLO acota `resolvedBeats` y el bloque `Beats:` del
 * prompt. La PROSA del template `body` es GLOBAL (menciona el hook/cta de otras escenas como "cómo se
 * ve" del clip), así que el prompt de una escena `body` puede contener la línea del hook en prosa —
 * quien cablee el modelo de pago en T5b.1b-ii debe saberlo. Cuando la ventana no cruza NINGÚN beat del
 * grid del template, `resolvedBeats: []` y `noBeatsOverlap: true` lo dejan auditable.
 *
 * `sceneIndex` es el índice ABSOLUTO en `script.scenes` (coincide con `segmentSceneIndices`, el keying
 * que N7d/N7f usan). Si no hay guion o no hay escenas `body`/`cta` → `[]` (control negativo).
 *
 * NO lanza salvo bug de datos: la compilación por escena usa el MISMO body y un SUBCONJUNTO de los beats
 * de la variante entera, que YA compiló `ok` arriba, así que no puede fallar por un slot nuevo. Si aun
 * así fallara, es un `PermanentStepError` ruidoso — una entrada ausente se volvería `DEFAULT_BROLL_PROMPT`
 * en la generación de pago de T5b.1b-ii, y eso hay que verlo, no tragarlo en silencio.
 */
function compileScenePrompts(compileInput: CompileInput, variantId: string): N6ScenePrompt[] {
  const scenes = compileInput.sources.script?.scenes ?? [];
  const scenePrompts: N6ScenePrompt[] = [];
  for (const [sceneIndex, scene] of scenes.entries()) {
    if (scene.segment !== 'body' && scene.segment !== 'cta') continue;
    const sceneResult = compilePrompt({ ...compileInput, scene });
    if (!sceneResult.ok) {
      throw new PermanentStepError(
        `N6: la escena ${String(sceneIndex)} (${scene.segment}) de la variante ${variantId} no compila: ${formatCompileIssues(sceneResult.issues)}`,
      );
    }
    scenePrompts.push({
      sceneIndex,
      segment: scene.segment,
      t: scene.t,
      seconds: scene.seconds,
      resolvedPrompt: sceneResult.result.resolvedPrompt,
      resolvedBeats: sceneResult.result.resolvedBeats,
      guardPackKeysUsed: sceneResult.result.guardPackKeysUsed,
      // SEÑAL AUDITABLE: la ventana temporal de la escena no cruzó ningún beat del grid (estático) del
      // template — p.ej. una escena en t>duración del template. El prompt sale sin sección `Beats:` con
      // `ok:true`; sin este flag sería indistinguible de una escena normal. T5b.1b-ii lo usa para no
      // mandar a fal un prompt sin beats en silencio (§ testing: nunca esconder un fallo).
      noBeatsOverlap: sceneResult.result.resolvedBeats.length === 0,
    });
  }
  return scenePrompts;
}

/** Formatea los `CompileIssue` de un fallo de compilación (`{slot}←fuente`, unidos por coma) para el
 *  mensaje del `PermanentStepError` — mismo formato para el fallo de variante entera y el por escena. */
function formatCompileIssues(issues: CompileIssue[]): string {
  return issues.map((i) => `{${i.slot ?? '?'}}←${i.source ?? '?'}`).join(', ');
}

/**
 * Busca en las deps resueltas un `N6-sources` y lo convierte en `CompileInput` (parseo + selección
 * de template §9.3, ambos en `resolveCompileInput` de core). Devuelve `undefined` cuando ninguna dep
 * lo trae (el caso de T3.5: sin DAG de generación) → el nodo se marca inaplicable. Un `N6-sources`
 * presente pero sin template compatible es un fallo PERMANENTE (datos que no casan el catálogo).
 * Aislado para que F4 lo reemplace por la lectura desde la variante en la BD sin tocar el executor.
 */
function extractCompileInput(
  deps: { outputRefs: unknown }[],
  templates: Parameters<typeof resolveCompileInput>[1],
  guardPacks: Parameters<typeof resolveCompileInput>[2],
): { input: CompileInput; degraded?: CompileDegradation } | undefined {
  for (const dep of deps) {
    // Un dep que no es un `N6-sources` (p.ej. otro artefacto) se ignora, no falla: `invalid_sources`
    // aquí solo significa "esta dep no es la mía". Solo `no_template` (sí era un N6-sources, pero sus
    // datos no casan el catálogo) es un error duro.
    const resolved = resolveCompileInput(dep.outputRefs, templates, guardPacks);
    if (resolved.ok) {
      return resolved.degraded !== undefined
        ? { input: resolved.input, degraded: resolved.degraded }
        : { input: resolved.input };
    }
    if (resolved.error === 'no_template') {
      throw new PermanentStepError(`N6: no hay template para la variante: ${resolved.message}`);
    }
  }
  return undefined;
}
