// RESOLUCIÓN DE VOZ para N7b (T4.5, §13.1) — LÓGICA PURA, sin red ni BD.
//
// §13.1 fija el TTS POR TIER: kokoro (test) / ElevenLabs Turbo v2.5 (standard) / Eleven v3 (premium).
// El `voice_map` de la Persona guarda `{locale: {provider, voiceId}}` (§12): la voz DE UN idioma, con
// su proveedor (un `voiceId` sin proveedor es ambiguo — §11). N7b necesita, para una escena, un TRIPLE
// CONSISTENTE: el endpoint del TTS del tier + el proveedor + el voiceId, TODOS del mismo proveedor.
//
// SEPARACIÓN RESOLUCIÓN vs EJECUCIÓN (decisión de T4.5): la EJECUCIÓN (dado el triple, TTS→ASR) vive en
// `@ugc/services` (`runGenerateAudio`); la RESOLUCIÓN (validar que el triple es coherente) vive AQUÍ.
// T4.5 construye la resolución MÍNIMA: valida coherencia y produce los inputs del TTS. T4.11 construirá
// la resolución COMPLETA (recipe del tier × voice_map de la Persona × idioma de la variante).
//
// EL MISMATCH ES RUIDOSO, NUNCA COERCIÓN. Un triple incoherente (p. ej. el endpoint de kokoro con un
// `voiceId` de elevenlabs) es un fallo de CABLEADO: `fal-ai/kokoro` solo acepta su enum `af_/am_`, así
// que pasarle un id de elevenlabs quemaría dinero en una llamada que fal rechaza o —peor— produce un
// audio con una voz equivocada. Se lanza `PermanentStepError` (reintentarlo no arregla el cableado).
import { PermanentStepError } from '../orchestrator/executor';

/** El proveedor de la voz (espejo de `VoiceProviderSchema`). */
export type VoiceProvider = 'elevenlabs' | 'minimax' | 'kokoro';

/**
 * El PREFIJO de endpoint fal que le corresponde a cada proveedor de TTS. Es el ancla que detecta un
 * triple incoherente sin acoplarse a un catálogo de endpoints concreto: el TTS de kokoro vive bajo
 * `fal-ai/kokoro`, los de elevenlabs bajo `fal-ai/elevenlabs/`. `minimax` no está sembrado como TTS
 * en la galería de F3 (solo aparece como proveedor de voz posible en el contrato) — si se resuelve a
 * él, es un error hasta que se siembre su endpoint.
 */
const PROVIDER_ENDPOINT_PREFIX: Readonly<Record<VoiceProvider, string | null>> = {
  kokoro: 'fal-ai/kokoro',
  elevenlabs: 'fal-ai/elevenlabs/',
  minimax: null,
};

/** El shape de los inputs del TTS que N7b manda a fal (sin el `prompt`, que es la narración): el
 *  servicio los completa con `prompt: scene.narration`. */
export interface ResolvedVoiceInputs {
  voice: string;
  speed?: number;
}

export interface ResolveVoiceStepInput {
  provider: VoiceProvider;
  /** El endpoint del TTS del tier (del recipe). */
  ttsEndpoint: string;
  /** El voiceId DENTRO del proveedor (del voice_map). */
  voice: string;
  speed?: number;
}

/**
 * Valida que el triple (proveedor, endpoint del TTS, voiceId) es COHERENTE y devuelve los inputs del
 * TTS. Lanza `PermanentStepError` si el endpoint no corresponde al proveedor (mismatch de cableado).
 *
 * NO valida que el `voiceId` exista en el enum del proveedor (kokoro sí tiene un enum cerrado; hacerlo
 * aquí duplicaría un catálogo que fal ya valida y que rota) — valida la coherencia PROVEEDOR↔ENDPOINT,
 * que es el mismatch estructural que quema dinero silenciosamente. Un voiceId inexistente lo rechaza fal
 * en el submit (FalProviderError), ruidoso también.
 */
export function resolveVoiceStep(input: ResolveVoiceStepInput): ResolvedVoiceInputs {
  const prefix = PROVIDER_ENDPOINT_PREFIX[input.provider];
  if (prefix === null) {
    throw new PermanentStepError(
      `resolveVoiceStep: el proveedor de voz '${input.provider}' no tiene un endpoint TTS sembrado (§13.1 siembra kokoro/elevenlabs)`,
    );
  }
  const matches =
    input.ttsEndpoint === prefix ||
    input.ttsEndpoint.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
  if (!matches) {
    throw new PermanentStepError(
      `resolveVoiceStep: triple de voz incoherente — proveedor '${input.provider}' con endpoint ` +
        `'${input.ttsEndpoint}' (se esperaba un endpoint '${prefix}…'). El voice_map y el recipe del ` +
        'tier deben coincidir en proveedor; una voz de un proveedor NO vale para el endpoint de otro.',
    );
  }
  return {
    voice: input.voice,
    ...(input.speed !== undefined ? { speed: input.speed } : {}),
  };
}
