// Servicio del lado servidor del PREVIEW DE VOZ (T4.6, §8.3): dado una Persona y un idioma, resuelve
// su voz del `voice_map`, la mapea a un `model_profile` de TTS y genera (o reutiliza de caché) una
// muestra escuchable. El route handler `POST /api/personas/[id]/voice-preview` queda fino (api.md §1):
// parsea → delega aquí → serializa.
//
// RESOLUCIÓN MÍNIMA (T4.6), NO la completa (T4.11): el proveedor de la voz (`voiceMap[lang].provider`)
// determina el endpoint del TTS — elevenlabs→turbo-v2.5 (standard, de pago), kokoro→kokoro (test). Se
// deriva del PROVEEDOR y no del idioma A PROPÓSITO (corrección de diseño): si se eligiera el endpoint
// por idioma y no casara con `voiceMap[lang].provider`, `resolveVoiceStep` lanzaría (triple
// incoherente) o —peor— se mandaría un voiceId de un proveedor al endpoint de otro y se quemaría dinero
// sintetizando la voz default. Con provider→endpoint el voiceId es coherente POR CONSTRUCCIÓN. La
// resolución COMPLETA (recipe del tier × voice_map × idioma) es T4.11.
import { AppError } from '@ugc/core/contracts';
import { PersonaSchema, resolveVoiceStep, type VoiceProvider } from '@ugc/core/persona';
import { getModelProfileByEndpoint, getPersona, type DbClient } from '@ugc/db';
import { runTtsOnly, type VoicePreviewResult } from '@ugc/services';
import { loadFalKey } from './fal-key';

/**
 * El endpoint del TTS de fal que le corresponde a cada proveedor de voz (T4.6, resolución MÍNIMA). Es
 * el mapa provider→endpoint que hace el triple coherente por construcción (ver la cabecera):
 *   · `elevenlabs` → Turbo v2.5 (tier standard, de pago; multilingüe: cubre es y en).
 *   · `kokoro`     → kokoro base (tier test; solo voces inglesas `af_/am_`, §13.1).
 *   · `minimax`    → sin endpoint TTS sembrado (§13.1 siembra kokoro/elevenlabs) → error accionable.
 * `null` = proveedor sin TTS: el caller lanza `provider_error` (no hay muestra posible).
 */
const PROVIDER_TTS_ENDPOINT: Readonly<Record<VoiceProvider, string | null>> = {
  elevenlabs: 'fal-ai/elevenlabs/tts/turbo-v2.5',
  kokoro: 'fal-ai/kokoro',
  minimax: null,
};

export interface GenerateVoicePreviewDeps {
  db: DbClient;
  storage: import('@ugc/core').StorageAdapter;
  logger?: import('@ugc/core').Logger;
  /** `FAL_BASE_URL` (E2E): se pasa al FalClient de core como `baseUrlOverride` (seam de intercepción
   *  por-origen de primera clase). Lo pasa el route handler desde su accessor. AUSENTE en producción. */
  falBaseUrl?: string;
}

/**
 * Resuelve la voz de la Persona en el idioma dado y genera/reutiliza su muestra de preview. Lanza:
 *  · `not_found` si la Persona no existe;
 *  · `validation_error` si la Persona no tiene voz para ese idioma (voice_map sin la clave);
 *  · `provider_error` si el proveedor no tiene TTS sembrado o falla la resolución del perfil.
 */
export async function generateVoicePreview(
  deps: GenerateVoicePreviewDeps,
  input: { personaId: string; language: string },
): Promise<VoicePreviewResult> {
  const { db } = deps;

  const personaRow = await getPersona(db, input.personaId);
  if (personaRow === undefined) {
    throw new AppError('not_found', 'persona no encontrada');
  }
  // El `voice_map` es jsonb opaco en BD: se valida con el MISMO contrato que la API pública (nunca se
  // castea). `PersonaSchema` reconstruye el shape; su `voiceMap` es `Record<locale, VoiceRef>`.
  const persona = PersonaSchema.parse({
    ...personaRow,
    referenceImageIds: [],
    createdAt: personaRow.createdAt.toISOString(),
    updatedAt: personaRow.updatedAt.toISOString(),
  });

  const voiceRef = persona.voiceMap[input.language];
  if (voiceRef === undefined) {
    throw new AppError(
      'validation_error',
      `la persona no tiene voz asignada para el idioma «${input.language}»`,
    );
  }

  // provider→endpoint (resolución mínima T4.6). Un proveedor sin TTS sembrado es accionable.
  const ttsEndpoint = PROVIDER_TTS_ENDPOINT[voiceRef.provider];
  if (ttsEndpoint === null) {
    throw new AppError(
      'provider_error',
      `el proveedor de voz «${voiceRef.provider}» no tiene un endpoint TTS sembrado`,
    );
  }

  // Validar el triple (provider ↔ endpoint ↔ voiceId) — coherente por construcción, pero se pasa por
  // `resolveVoiceStep` para producir los inputs del TTS y por defensa en profundidad (mismatch→lanza).
  const voiceInputs = resolveVoiceStep({
    provider: voiceRef.provider,
    ttsEndpoint,
    voice: voiceRef.voiceId,
  });

  const ttsProfile = await getModelProfileByEndpoint(db, ttsEndpoint);
  if (ttsProfile === undefined) {
    throw new AppError('provider_error', `no hay model_profile sembrado para «${ttsEndpoint}»`);
  }

  // SEAM DE INTERCEPCIÓN E2E (T4.11, deuda T4.6 saldada): en vez de envolver un `fetch` aquí (capa web),
  // se pasa `FAL_BASE_URL` al FalClient de core como `baseUrlOverride` — capacidad de PRIMERA CLASE que
  // reescribe por-origen el submit + poll + download (las `status_url`/`response_url` absolutas de fal),
  // y que cubre por igual el path de worker (executors N7) cuando T4.11 lo cablee. AUSENTE en producción
  // → fetch a la fal real. Se lee `FAL_BASE_URL` SOLO aquí (web), nunca en core.
  const baseUrlOverride =
    deps.falBaseUrl !== undefined && deps.falBaseUrl !== '' ? deps.falBaseUrl : undefined;

  return runTtsOnly(
    {
      db,
      storage: deps.storage,
      // Key PEREZOSA: `runTtsOnly` solo la resuelve en el cache-miss (antes de gastar) — una
      // reproducción cacheada no paga el `getSecretBlob`+descifrado de `loadFalKey`.
      falKey: () => loadFalKey(db),
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      ...(baseUrlOverride !== undefined ? { falOptions: { baseUrlOverride } } : {}),
    },
    // `voiceInputs` es una interfaz (`{voice, speed?}`) sin index signature; se copia a un objeto
    // plano para encajar en `GenerationInputs` (`Record<string, unknown>`).
    { ttsProfile, ttsInputs: { ...voiceInputs }, language: input.language },
  );
}
