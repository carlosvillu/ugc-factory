// ENSAMBLADOR de `N6Sources` desde la BD (T4.11 pass 2b-ii, §7.2 N6 + §10.4). La mitad de SERVICIO del
// nodo N6: dado un `variantId`, LEE brief + persona + guion vigente + facetas (`ad_variant`/`ad_batch`) y
// produce el `N6Sources` que el motor PURO `compilePrompt` (core) consume para resolver el prompt.
//
// POR QUÉ N6 LEE DE LA BD Y NO DE SUS DEPS: N6 es la RAÍZ del sub-DAG de la variante (no tiene deps —
// generation-dag.ts). Las fuentes NO pueden llegar por `ctx.deps`; se ensamblan de la BD por `variantId`,
// exactamente lo que el esqueleto de T3.5 (compile-prompt.ts) anticipaba ("estrenará su grupo de deps
// {db}… para leer la variante"). El contrato `N6Sources` (compile-executor-contract.ts) sigue siendo la
// frontera; aquí se PRODUCE desde la BD (antes ningún nodo lo emitía).
//
// FRONTERA CORE/SERVICIO: este módulo toca la BD → @ugc/services. La selección de template y el mapeo
// slot→valor son PUROS (core: `resolveCompileInput`/`compilePrompt`).
import {
  ProductBriefSchema,
  reconstructAdScriptFromRow,
  BatchPlanSchema,
  type AdScript,
} from '@ugc/core/contracts';
import { PersonaSchema } from '@ugc/core/persona';
import { N6SourcesSchema, type N6Sources } from '@ugc/core/gallery';
import { BRIEF_FRAMEWORK_TO_HOOK_ANGLE } from '@ugc/core/strategy';
import { PermanentStepError } from '@ugc/core/orchestrator';
import {
  getBatch,
  getBrief,
  getLatestScriptsByBatch,
  getPersona,
  getVariant,
  type AdScriptRow,
  type DbClient,
} from '@ugc/db';

export interface AssembleN6SourcesDeps {
  db: DbClient;
}

/**
 * Ensambla el `N6Sources` de una variante desde la BD (validado contra su schema). Lanza
 * `PermanentStepError` (fallo de datos, no reintentable) si la variante/lote/brief/persona no existen o
 * la variante no tiene persona (N6 sin persona no puede resolver los slots `persona.*`/`avatar.ref`).
 * El GUION es opcional (§: se puede compilar antes de guionizar), pero en el path de generación (post-CP3)
 * SIEMPRE está — se incluye si existe.
 */
export async function assembleN6Sources(
  deps: AssembleN6SourcesDeps,
  input: { variantId: string },
): Promise<N6Sources> {
  const { db } = deps;
  const { variantId } = input;

  const variant = await getVariant(db, variantId);
  if (variant === undefined) {
    throw new PermanentStepError(`N6: la variante ${variantId} no existe`);
  }
  const batch = await getBatch(db, variant.batchId);
  if (batch === undefined) {
    throw new PermanentStepError(
      `N6: el lote ${variant.batchId} de la variante ${variantId} no existe`,
    );
  }
  if (variant.personaId === null) {
    throw new PermanentStepError(
      `N6: la variante ${variantId} no tiene Persona asignada — no se pueden resolver los slots de audiencia`,
    );
  }

  const [briefRow, personaRow, latestScripts] = await Promise.all([
    getBrief(db, batch.briefId),
    getPersona(db, variant.personaId),
    getLatestScriptsByBatch(db, variant.batchId),
  ]);
  if (briefRow === undefined) {
    throw new PermanentStepError(`N6: el brief ${batch.briefId} del lote no existe`);
  }
  if (personaRow === undefined) {
    throw new PermanentStepError(`N6: la Persona ${variant.personaId} de la variante no existe`);
  }

  const brief = ProductBriefSchema.parse(briefRow.data);
  // La Persona de la API (fechas ISO) — el mismo reensamblado que voice-preview.ts (el row trae Date).
  const persona = PersonaSchema.parse({
    ...personaRow,
    referenceImageIds: personaRow.referenceImageIds,
    createdAt: personaRow.createdAt.toISOString(),
    updatedAt: personaRow.updatedAt.toISOString(),
  });

  // El guion vigente de la variante + su `sharedBodyKey` de la matriz (mismo cruce por `filenameCode`
  // que `readBatchScripts`): se reconstruye con el mapper COMPARTIDO de core (no se duplica).
  const script = resolveVariantScript(latestScripts, batch.matrix, variantId);

  // framework(brief) → hookAngle(galería). `variant.framework` es `text` (no el enum tipado), así que el
  // acceso al Record puede dar `undefined` si el dato no es uno de los 10 frameworks conocidos: se trata
  // como "no fijar la faceta" (degradación honesta), no como un crash. Se tipa el mapa como
  // `Record<string, string | undefined>` a propósito: el índice con una `string` arbitraria PUEDE fallar
  // (el cast `keyof` mentiría diciendo que siempre resuelve — y el lint marcaría el chequeo como muerto).
  const frameworkToHookAngle: Record<string, string | undefined> = BRIEF_FRAMEWORK_TO_HOOK_ANGLE;
  const hookAngle: string | undefined = frameworkToHookAngle[variant.framework];

  const sources = {
    node: 'N6-sources' as const,
    brief,
    persona,
    ...(script !== undefined ? { script } : {}),
    facets: {
      // §10.4 / compile-executor-contract: `platform` de `ad_variant.platform_targets[0]`; `durationSeconds`
      // de `ad_variant.duration_target`. `aspect` NO se guarda → cae al `defaultAspect` del template
      // (resolveCompileInput). `vertical` NO va aquí: `resolveCompileInput` lo deriva de `brief.product.category`.
      platform: variant.platformTargets[0] ?? batch.platforms[0] ?? 'tiktok',
      durationSeconds: variant.durationTarget,
      // `hookAngle` es CRÍTICO para seleccionar el template (`selectTemplate.passesFilter`): un template
      // que restringe `hookAngles` NO casa si el contexto lo deja `undefined`. Se deriva de
      // `ad_variant.framework` con la MISMA tabla que el compositor N4 (`BRIEF_FRAMEWORK_TO_HOOK_ANGLE`) —
      // una sola fuente de verdad framework→ángulo. Si el framework no es un valor conocido del enum
      // (dato corrupto: la columna es NOT NULL y sale de `angles[].framework`), se OMITE → la selección
      // recae en los templates hook-angle-agnósticos (o lanza `no_template` accionable río abajo).
      ...(hookAngle !== undefined ? { hookAngle } : {}),
      // `format` NO tiene fuente en la BD hoy (ni `ad_variant` ni la matriz lo guardan) → se omite. Es
      // OPCIONAL para la selección: los templates format-agnósticos (`formats: []`) cubren cada ángulo.
    },
  };
  // Se VALIDA contra el schema del contrato (frontera): un ensamblado incoherente falla aquí, no en fal.
  return N6SourcesSchema.parse(sources);
}

/** El `AdScript` vigente de la variante (reconstruido con el mapper compartido de core), o `undefined`
 *  si la variante aún no tiene guion. `sharedBodyKey` sale de `ad_batch.matrix` por `filenameCode`. */
function resolveVariantScript(
  latestScripts: { script: AdScriptRow; variantId: string; filenameCode: string }[],
  matrix: unknown,
  variantId: string,
): AdScript | undefined {
  const row = latestScripts.find((s) => s.variantId === variantId);
  if (row === undefined) return undefined;
  const plan = BatchPlanSchema.parse(matrix);
  const planned = plan.variants.find((v) => v.filenameCode === row.filenameCode);
  if (planned === undefined) {
    // La variante tiene guion pero no está en la matriz: cableado corrupto (la matriz ES de donde
    // salieron las variantes). No se puede reconstruir el AdScript sin `sharedBodyKey`.
    throw new PermanentStepError(
      `N6: la variante ${variantId} (${row.filenameCode}) no aparece en la matriz del lote — sharedBodyKey irresoluble`,
    );
  }
  return reconstructAdScriptFromRow(row.script, row.filenameCode, planned.segmentKeys.body);
}
