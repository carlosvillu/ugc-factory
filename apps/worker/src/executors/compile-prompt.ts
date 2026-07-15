// Executor de N6 · COMPILADOR DE PROMPTS (T3.5, §7.2 N6/§9.3). **Determinista y $0** ("sin LLM",
// §9.3), igual que N4: no pasa por caja. Step AUTOMÁTICO, NO checkpoint (§9.5 no lo marca como
// checkpoint): el `resolvedPrompt` es auditoría en canvas (T4.11), no una decisión con dinero — el
// dinero se gasta en N7. Molde de N4 (strategy.ts): cáscara fina que conecta el orquestador con el
// MOTOR PURO de `@ugc/core/gallery` (`compilePrompt`) y devuelve el resultado por `output_refs`.
//
// ┌─ CORTE DE ALCANCE DE T3.5 (respetado a rajatabla) ──────────────────────────────────────────┐
// │ El motor de compilación (selección de template, interpolación §10.4, guard packs §9.5,       │
// │ fidelity guard + anti-estilo, validación de resolución) vive COMPLETO en core y se testea con │
// │ golden files. ESTE executor es el REGISTRO MÍNIMO: valida su config, llama al motor y emite el │
// │ resolvedPrompt. NO construye el DAG de generación (N6→N7a-e), NO persiste en la tabla          │
// │ `generation` (que NO EXISTE hasta T4.1) y NO lee brief/persona/guion de la BD — ese cableado   │
// │ es F4/T4.11. Aquí el compilador COMPUTA; T4.11 lo materializa en el run de generación.         │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// DE DÓNDE SACA SUS FUENTES. En F4 N6 leerá de la variante (`variantId` en su config) el guion, la
// persona y las facetas. Hoy, sin el DAG de generación que las produce, si un predecesor emitió el
// contrato `N6-sources` (por sus `output_refs`), N6 COMPILA de verdad vía el motor de core; si no,
// marca el nodo INAPLICABLE (no inventa fuentes: eso sería fingir el trabajo de T4.11). El parseo +
// selección de template viven en `resolveCompileInput` (core, junto a zod y el motor).
import {
  AnalysisN6ConfigSchema,
  PermanentStepError,
  type StepExecutor,
} from '@ugc/core/orchestrator';
import {
  compilePrompt,
  resolveCompileInput,
  validateGallerySeed,
  RAW_GALLERY_SEED,
  type CompileInput,
} from '@ugc/core/gallery';

/**
 * N6: compila el prompt de una variante (determinista, $0). Esqueleto de T3.5 — el motor es real
 * (core), el cableado de fuentes desde la BD y el DAG de generación son F4/T4.11.
 *
 * Sin deps de infraestructura: N6 no lee la BD en T3.5 (no hay tabla `generation` ni productor aguas
 * arriba todavía). Cuando F4 traiga el DAG de generación, este executor estrenará su grupo de deps
 * ({ db }) —como N4 reusó `analysis.db`— para leer la variante que hoy solo referencia.
 */
export function makeN6Executor(): StepExecutor {
  // NO es `async`: N6 en T3.5 es puramente síncrono (valida config + llama al motor puro; no hay I/O
  // que esperar hasta que F4 le dé la BD). Devuelve `Promise.resolve()` para cumplir el contrato
  // `StepExecutor`. Cuando F4 estrene sus deps de BD, este cuerpo pasará a `async` con awaits reales.
  return (ctx) => {
    const { collectOutput, markInapplicable, deps } = ctx;
    if (collectOutput === undefined) {
      throw new PermanentStepError(
        'N6: el ExecutorContext no trae collectOutput (bug de cableado)',
      );
    }

    const parsed = AnalysisN6ConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      throw new PermanentStepError(`N6: config inválida: ${parsed.error.message}`);
    }

    // El seed de galería (templates + guard packs) es la fuente de verdad del motor — los mismos JSON
    // que `pnpm seed:gallery` inserta. Un seed inválido es un fallo de configuración PERMANENTE (no
    // reintentable): el catálogo está roto, un retry no lo arregla.
    const validation = validateGallerySeed(RAW_GALLERY_SEED);
    if (!validation.ok || validation.seed === undefined) {
      throw new PermanentStepError('N6: el seed de galería no valida (catálogo de templates roto)');
    }

    const compileInput = extractCompileInput(
      deps ?? [],
      validation.seed.templates,
      validation.seed.guardPacks,
    );
    if (compileInput === undefined) {
      // Nodo no aplicable: el productor de las fuentes (F4/T4.11) todavía no está cableado. El
      // consumer lo cierra con `skip_inapplicable` (mismo mecanismo que N2 sin imágenes), no como
      // fallo. Deja constancia del motivo en el artefacto.
      collectOutput({
        node: 'N6',
        skipped: 'awaiting_generation_dag',
        variantId: parsed.data.variantId,
        note: 'El compilador N6 está registrado; el DAG de generación que le pasa las fuentes es T4.11.',
      });
      markInapplicable?.();
      return Promise.resolve();
    }

    // COMPILACIÓN REAL vía el motor puro de core. NO lanza: resultado tipado (ok / issues).
    const result = compilePrompt(compileInput);
    if (!result.ok) {
      // Un slot irresoluble es un desajuste de datos (variante sin guion, persona sin setting…): un
      // fallo DURO y accionable (nombra slot + fuente), no reintentable. Mejor reventar ruidoso que
      // enviar a un modelo de PAGO un prompt con `{slot}` sin resolver.
      const detail = result.issues.map((i) => `{${i.slot ?? '?'}}←${i.source ?? '?'}`).join(', ');
      throw new PermanentStepError(`N6: prompt con slots sin resolver: ${detail}`);
    }

    collectOutput({
      node: 'N6',
      variantId: parsed.data.variantId,
      templateSlug: result.result.templateSlug,
      guardPackKeysUsed: result.result.guardPackKeysUsed,
      resolvedPrompt: result.result.resolvedPrompt,
      resolvedBeats: result.result.resolvedBeats,
    });
    return Promise.resolve();
  };
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
): CompileInput | undefined {
  for (const dep of deps) {
    // Un dep que no es un `N6-sources` (p.ej. otro artefacto) se ignora, no falla: `invalid_sources`
    // aquí solo significa "esta dep no es la mía". Solo `no_template` (sí era un N6-sources, pero sus
    // datos no casan el catálogo) es un error duro.
    const resolved = resolveCompileInput(dep.outputRefs, templates, guardPacks);
    if (resolved.ok) return resolved.input;
    if (resolved.error === 'no_template') {
      throw new PermanentStepError(`N6: no hay template para la variante: ${resolved.message}`);
    }
  }
  return undefined;
}
