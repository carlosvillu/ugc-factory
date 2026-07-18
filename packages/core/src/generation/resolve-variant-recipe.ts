// RESOLUCIÓN PURA recipe×voice_map → configs de generación (T4.11 pass 2b-ii) — LÓGICA PURA, sin BD ni
// cola. Es la mitad de core del builder `buildVariantGenerationPlan`: dado el `RecipeSeed` de un tier +
// el voice_map de la Persona + el idioma de la variante, produce los ENDPOINTS por componente y el
// TRIPLE de voz coherente. La mitad de servicio (@ugc/services) LEE la BD y llama a esto.
//
// FRONTERA CORE/SERVICIO (backend principio 1): aquí NO se toca la BD. La resolución endpoint→profile_id
// y la detección de la ETIQUETA-no-endpoint (money-safety, decisión #2 del brief) viven en el servicio,
// porque exigen `getModelProfileByEndpoint` (BD). Aquí solo se PROYECTA el recipe a endpoints y se valida
// la coherencia del triple de voz (`resolveVoiceStep`, ya puro en core).
import type { RecipeSeed, RecipeStepSeed } from '../library/contracts';
import { resolveVoiceStep, type VoiceProvider } from '../persona/voice-resolution';
import { PermanentStepError } from '../orchestrator/executor';

/** El voice_map de una Persona (§12 `{locale: {provider, voiceId}}`), la parte que el resolver consume. */
export interface VoiceMapEntry {
  provider: VoiceProvider;
  voiceId: string;
}
export type VoiceMap = Record<string, VoiceMapEntry | undefined>;

/** El endpoint fal de cada componente presente en el recipe del tier (o `undefined` si el componente no
 *  está en `recipe.steps`). El componente `shots` NO se proyecta: N7a HARDCODEA flux-2 e IGNORA
 *  `recipe.steps.shots` (asimetría deliberada, generation.ts). */
export interface ResolvedComponentEndpoints {
  avatar?: string;
  broll?: string;
  voice?: string;
}

/** El triple de voz resuelto para N7b (endpoint TTS del tier × provider+voiceId del voice_map). */
export interface ResolvedVoiceTriple {
  ttsEndpoint: string;
  provider: VoiceProvider;
  voice: string;
  speed?: number;
}

/** El endpoint `model` del componente en el recipe, o `undefined` si el componente no está. */
function endpointOf(
  steps: readonly RecipeStepSeed[],
  component: RecipeStepSeed['component'],
): string | undefined {
  return steps.find((s) => s.component === component)?.model;
}

/**
 * Proyecta `recipe.steps` a los endpoints por componente (avatar/broll/voice). NO resuelve a profile_id
 * (eso es BD/servicio) ni valida que el endpoint sea resoluble (una ETIQUETA-no-endpoint la caza el
 * servicio con `getModelProfileByEndpoint`→undefined, ANTES de gastar — decisión #2). Puro.
 */
export function resolveComponentEndpoints(recipe: RecipeSeed): ResolvedComponentEndpoints {
  // `shots` se excluye a propósito (N7a HARDCODEA flux-2, ver arriba): solo los tres componentes cuyo
  // endpoint SÍ sale del recipe. Las claves con endpoint ausente se OMITEN (no se ponen a `undefined`).
  const PROJECTED = ['avatar', 'broll', 'voice'] as const;
  const out: ResolvedComponentEndpoints = {};
  for (const component of PROJECTED) {
    const endpoint = endpointOf(recipe.steps, component);
    if (endpoint !== undefined) out[component] = endpoint;
  }
  return out;
}

/**
 * Resuelve el TRIPLE de voz de N7b: el endpoint TTS del recipe (`voice` component) × el
 * `{provider, voiceId}` que el voice_map de la Persona guarda para el IDIOMA de la variante. Valida la
 * coherencia con `resolveVoiceStep` (mismatch provider↔endpoint → `PermanentStepError`, patrón
 * voice-preview.ts). Lanza si el recipe no tiene componente `voice` o el voice_map no cubre el idioma
 * (cableado incompleto — reintentar no lo arregla).
 */
export function resolveVoiceTriple(
  recipe: RecipeSeed,
  voiceMap: VoiceMap,
  language: string,
): ResolvedVoiceTriple {
  const ttsEndpoint = endpointOf(recipe.steps, 'voice');
  if (ttsEndpoint === undefined) {
    throw new PermanentStepError(
      `resolveVoiceTriple: el recipe del tier '${recipe.tier}' no tiene componente 'voice' — no hay endpoint TTS`,
    );
  }
  const voiceRef = voiceMap[language];
  if (voiceRef === undefined) {
    throw new PermanentStepError(
      `resolveVoiceTriple: la Persona no tiene voz en el voice_map para el idioma '${language}'`,
    );
  }
  // Coherencia provider↔endpoint↔voiceId (una voz de un proveedor NO vale para el endpoint de otro):
  // reusa la validación pura ya existente de T4.5 en vez de duplicar el catálogo de prefijos.
  resolveVoiceStep({ provider: voiceRef.provider, ttsEndpoint, voice: voiceRef.voiceId });
  return { ttsEndpoint, provider: voiceRef.provider, voice: voiceRef.voiceId };
}
