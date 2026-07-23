// BUILDER del plan de generación de UNA variante (T4.11 pass 2b-ii, §7.2 N6→N7). La mitad de SERVICIO
// del resolver: LEE la BD (variante→lote→recipe/persona/guion) y produce el `VariantGenerationPlan` que
// `generationRunDefinition` (core) expande en el sub-DAG N6→N7a-e. Lo llama `approveScriptsForStep` (CP3)
// para arrancar el run de generación de las variantes `scripted`.
//
// FRONTERA CORE/SERVICIO (backend principio 1): este módulo TOCA la BD → vive en @ugc/services, no en
// core. La resolución PURA (recipe→endpoints, voice_map→triple) se delega a `@ugc/core/generation`
// (`resolveComponentEndpoints`/`resolveVoiceTriple`), inyectándole los datos ya leídos. Aquí queda solo
// el I/O + el ensamblado.
//
// MONEY-SAFETY (decisión #2 del brief, T1.10a): ANTES de devolver el plan (⇒ antes de `createRun`), cada
// endpoint que va a un config se VERIFICA resoluble con `getModelProfileByEndpoint`. Un `recipe.steps`
// que aún es una ETIQUETA (`broll` de los tiers test/standard, §13.1 l.600) devuelve `undefined` → se
// lanza `PermanentStepError` RUIDOSO. NUNCA se inventa un endpoint: un config con un modelo inexistente
// arrancaría un run que gasta en avatar/voz/música/shots ANTES de que N7d muriese al no resolver el
// b-roll (los N7 independientes de N7d ya habrían pagado). El fallo es honesto y ANTES de gastar. La
// verificación existe en DOS momentos con DOS propósitos: aquí (no crear un run condenado) y en el
// executor (no submitear un payload malo / catch de misseeding kind/caps) — no es duplicación dañina.
import { resolveComponentEndpoints, resolveVoiceTriple, type VoiceMap } from '@ugc/core/generation';
import { AdScriptSchema } from '@ugc/core/contracts';
import type { RecipeTier } from '@ugc/core/library';
import { PermanentStepError } from '@ugc/core/orchestrator';
import type { VariantGenerationPlan } from '@ugc/core/orchestrator';
import {
  getBatch,
  getLatestScriptsByBatch,
  getModelProfileByEndpoint,
  getPersona,
  getRecipe,
  getVariant,
  type DbClient,
} from '@ugc/db';

/** El endpoint del ÚNICO modelo de música sembrado (§13.1, `fal-ai/ace-step`). N7e NO sale de
 *  `recipe.steps` (el enum de componentes no tiene 'music', library/contracts.ts) — misma asimetría que
 *  N7a con flux-2. El bed cubre la variante (§14). */
const MUSIC_ENDPOINT = 'fal-ai/ace-step';

/** El mood por defecto del bed (T4.9 lo tomaba del config del smoke; el plan de producción aún no lo
 *  deriva del brief — deuda anotada). Instrumental, energía media: seguro para cualquier vertical. */
const DEFAULT_MUSIC_MOOD = 'upbeat, energetic, background';

export interface BuildVariantGenerationPlanDeps {
  db: DbClient;
}

/**
 * Ensambla el `VariantGenerationPlan` de una variante `scripted` desde la BD. Lanza `PermanentStepError`
 * (money-safe, antes de crear el run) si el catálogo no soporta la variante: recipe/persona/guion
 * ausentes, un endpoint de recipe que aún es etiqueta (no resoluble), o el voice_map sin el idioma.
 *
 * NO fija los punteros cross-node (`audioAssetId` de N7c, `imageAssetIds` de N7d): esos assets NO
 * existen al construir el plan (N7a/N7b aún no han corrido). Los DERIVA el executor de su dep de la misma
 * variante en runtime (`ctx.deps`, precedencia dep-wins — ver `@ugc/core/generation` cross-node-deps).
 */
export async function buildVariantGenerationPlan(
  deps: BuildVariantGenerationPlanDeps,
  input: { variantId: string },
): Promise<VariantGenerationPlan> {
  const { db } = deps;
  const { variantId } = input;

  const variant = await getVariant(db, variantId);
  if (variant === undefined) {
    throw new PermanentStepError(`buildVariantGenerationPlan: la variante ${variantId} no existe`);
  }
  const batch = await getBatch(db, variant.batchId);
  if (batch === undefined) {
    throw new PermanentStepError(
      `buildVariantGenerationPlan: el lote ${variant.batchId} de la variante ${variantId} no existe`,
    );
  }

  const [recipe, latestScripts] = await Promise.all([
    getRecipe(db, batch.tier),
    getLatestScriptsByBatch(db, variant.batchId),
  ]);
  if (recipe === undefined) {
    throw new PermanentStepError(
      `buildVariantGenerationPlan: no hay recipe sembrado para el tier '${batch.tier}'`,
    );
  }
  const scriptRow = latestScripts.find((s) => s.variantId === variantId);
  if (scriptRow === undefined) {
    throw new PermanentStepError(
      `buildVariantGenerationPlan: la variante ${variantId} no tiene guion (¿no está scripted?)`,
    );
  }
  const scriptId = scriptRow.script.id;
  const language = variant.language;

  const endpoints = resolveComponentEndpoints(recipe);

  // La Persona (una sola lectura, la comparten las ramas de voz y avatar): `undefined` si la variante no
  // la tiene asignada. Cada rama que la NECESITA lanza si falta.
  const persona = variant.personaId === null ? undefined : await getPersona(db, variant.personaId);

  const plan: VariantGenerationPlan = {
    variantId,
    n6Config: { variantId },
  };

  // N7a · PRODUCT SHOTS (keyframes). NO sale de `recipe.steps.shots`: N7a HARDCODEA flux-2 (asimetría
  // deliberada, generation.ts). Ruta `ai_packshot` por defecto (la única implementada; la ruta real la
  // decidiría CP1 — deuda anotada). `briefId` del lote.
  plan.n7aConfig = { route: 'ai_packshot', briefId: batch.briefId };

  // N7b · VOICEOVER: si el recipe tiene componente 'voice'. Resuelve el triple (endpoint TTS × voice_map
  // de la Persona × idioma) — coherencia validada en core.
  if (endpoints.voice !== undefined) {
    if (persona === undefined) {
      throw new PermanentStepError(
        `buildVariantGenerationPlan: la variante ${variantId} necesita voz pero no tiene Persona asignada`,
      );
    }
    const triple = resolveVoiceTriple(recipe, persona.voiceMap as VoiceMap, language);
    await assertEndpointResolvable(db, triple.ttsEndpoint, 'N7b (voice)');
    plan.n7bConfig = {
      scriptId,
      language,
      ttsEndpoint: triple.ttsEndpoint,
      provider: triple.provider,
      voice: triple.voice,
      ...(triple.speed !== undefined ? { speed: triple.speed } : {}),
    };
  }

  // N7c · AVATAR: si el recipe tiene componente 'avatar'. `imageAssetId` = la imagen primaria de la
  // Persona (referenceImageIds[0], ordenada). `audioAssetId` lo DERIVA el executor de su dep N7b (no se
  // fija aquí — no existe todavía).
  if (endpoints.avatar !== undefined) {
    if (persona === undefined) {
      throw new PermanentStepError(
        `buildVariantGenerationPlan: la variante ${variantId} necesita avatar pero no tiene Persona asignada`,
      );
    }
    const imageAssetId = persona.referenceImageIds[0];
    if (imageAssetId === undefined) {
      throw new PermanentStepError(
        `buildVariantGenerationPlan: la Persona de la variante ${variantId} no tiene imagen de referencia (avatar)`,
      );
    }
    await assertEndpointResolvable(db, endpoints.avatar, 'N7c (avatar)');
    plan.n7cConfig = { avatarEndpoint: endpoints.avatar, imageAssetId };
  }

  // N7d · B-ROLL: si el recipe tiene componente 'broll'. `brollEndpoint` del recipe (money-gate: una
  // ETIQUETA-no-endpoint lanza aquí). `imageAssetIds` los DERIVA el executor de su dep N7a. `scriptId`
  // para filtrar las escenas de body.
  if (endpoints.broll !== undefined) {
    await assertEndpointResolvable(db, endpoints.broll, 'N7d (b-roll)');
    plan.n7dConfig = { scriptId, brollEndpoint: endpoints.broll };
  }

  // N7f · CLIP DE CTA (T5.5a, §7.5 «la CTA es product shot animado»): la escena `cta` se anima por i2v
  // del keyframe de N7a — MISMA mecánica que N7d, distinto segmento. REUSA el endpoint i2v del recipe
  // (`endpoints.broll`): NO hay un componente 'cta' propio (YAGNI — el proyecto hardcodea por nodo). El
  // planner rutea hook→N7c y body→N7d; sin esta rama la escena `cta` no tendría ninguna generación (el
  // hueco que originó T5.5a). `imageAssetIds` los DERIVA el executor de su dep N7a; `scriptId` para
  // localizar la escena cta. Money-gate: el endpoint YA se validó arriba (misma clave broll). Se GATEA
  // además en que el guion TENGA una escena `cta` (a diferencia de N7d, aquí se puede saber sin gastar:
  // las escenas ya están en la fila `ad_script` leída): un guion sin cta NO emite N7f (no habría clip
  // que animar) — evita un nodo condenado a `PermanentStepError` en runtime. El jsonb `scenes` es OPACO
  // al salir de la BD → se VALIDA en la frontera (nunca castear), patrón del executor N7d.
  if (endpoints.broll !== undefined) {
    const scenes = AdScriptSchema.pick({ scenes: true }).parse({
      scenes: scriptRow.script.scenes,
    }).scenes;
    if (scenes.some((s) => s.segment === 'cta')) {
      plan.n7fConfig = { scriptId, ctaEndpoint: endpoints.broll };
    }
  }

  // N7e · BED MUSICAL: un bed por variante (§14). Endpoint constante (ace-step, no sale del recipe).
  await assertEndpointResolvable(db, MUSIC_ENDPOINT, 'N7e (music)');
  plan.n7eConfig = {
    musicEndpoint: MUSIC_ENDPOINT,
    mood: DEFAULT_MUSIC_MOOD,
    durationSeconds: variant.durationTarget,
  };

  return plan;
}

/**
 * ¿El tier está LISTO para generar? — es decir, ¿TODOS los endpoints de generación de su recipe
 * resuelven a un `model_profile` REAL? (voice/avatar/broll del recipe + el bed musical constante).
 *
 * SEPARA DOS ETAPAS DEL CICLO DE VIDA que T4.11 fusionó (regla 6, 2026-07-23): (1) aprobar guiones →
 * `scripted` es un hecho sobre el TEXTO, incondicional y agnóstico al tier; (2) arrancar la generación
 * solo tiene sentido cuando el tier es generation-ready. Los tiers `test`/`standard` dejan `broll` como
 * ETIQUETA pendiente-F4 (§13.1 l.600) → NO están listos, y aprobar sus guiones NO debe arrancar (ni
 * fallar por) la generación. `buildVariantGenerationPlan` sigue lanzando RUIDOSO en todos los casos —
 * este predicado NO lo sustituye: es el gate de control de flujo que decide si SIQUIERA se intenta
 * construir el plan. Así un fallo REAL (voz incoherente, persona sin imagen) sigue siendo un throw
 * ruidoso en `buildVariantGenerationPlan`, y solo el endpoint-pendiente-F4 (benigno, esperado) se tolera.
 *
 * La DETECCIÓN es preguntar al resolver real (`getModelProfileByEndpoint`), NUNCA string-match sobre el
 * label (`[`, espacios) — eso reimplementaría la comprobación (trampa T1.8). Mismo mecanismo que
 * `assertEndpointResolvable`, en forma de PREDICADO (control de flujo esperado ≠ excepción).
 */
export async function isTierGenerationReady(db: DbClient, tier: RecipeTier): Promise<boolean> {
  const recipe = await getRecipe(db, tier);
  if (recipe === undefined) return false;
  const endpoints = resolveComponentEndpoints(recipe);
  // Solo los endpoints QUE SALEN DEL RECIPE del tier (voice/avatar/broll): son los que un tier deja como
  // ETIQUETA pendiente-F4 (la condición benigna y esperada que este predicado tolera). El bed musical
  // (`MUSIC_ENDPOINT`) es una CONSTANTE global, no una cuestión de tier-readiness: si estuviera mal
  // sembrado sería un fallo de configuración REAL que debe LANZAR ruidoso dentro de
  // `buildVariantGenerationPlan` (su `assertEndpointResolvable`), no colarse aquí y hacer que TODO tier
  // —premium incluido— deje de generar en silencio (ese sería el gate oscuro un nivel arriba, principio 9).
  const recipeEndpoints = [endpoints.voice, endpoints.avatar, endpoints.broll].filter(
    (e): e is string => e !== undefined,
  );
  const profiles = await Promise.all(recipeEndpoints.map((e) => getModelProfileByEndpoint(db, e)));
  return profiles.every((p) => p !== undefined);
}

/** MONEY-GATE: verifica que `endpoint` resuelve a un `model_profile` REAL. Un `undefined` significa que
 *  `recipe.steps` aún guarda una ETIQUETA (no un endpoint fal vivo, §13.1 l.600) — se lanza
 *  `PermanentStepError` ANTES de crear el run (nunca se inventa un endpoint que gastaría mal). La
 *  DETECCIÓN es preguntar al resolver real (getModelProfileByEndpoint), NO hacer string-match de `[` o
 *  espacios sobre el label (eso reimplementaría la comprobación — trampa T1.8). */
async function assertEndpointResolvable(
  db: DbClient,
  endpoint: string,
  nodeLabel: string,
): Promise<void> {
  const profile = await getModelProfileByEndpoint(db, endpoint);
  if (profile === undefined) {
    throw new PermanentStepError(
      `buildVariantGenerationPlan: ${nodeLabel} apunta a '${endpoint}', que NO es un endpoint fal ` +
        'resoluble (¿etiqueta pendiente F4, §13.1?). No se arranca un run que gastaría en el modelo equivocado.',
    );
  }
}
