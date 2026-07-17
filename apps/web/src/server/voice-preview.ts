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
import { getSecretsKeyFromEnv, decryptSecret, type SecretBlob } from '@ugc/core/secrets';
import { getModelProfileByEndpoint, getPersona, getSecretBlob, type DbClient } from '@ugc/db';
import { runTtsOnly, type VoicePreviewResult } from '@ugc/services';

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

/** El host base de la API de fal a interceptar en E2E (`FAL_BASE_URL`): en producción está AUSENTE y
 *  el fetch global va a la fal real; en el stack E2E apunta al fake server (`startFakeExternalApis`),
 *  así que la suite JAMÁS gasta dinero. Los orígenes de fal que el `fetch` inyectado reescribe. */
const FAL_ORIGINS = ['https://queue.fal.run', 'https://rest.fal.run', 'https://fal.run'];

/**
 * El `fetch` que se inyecta en el FalClient para el preview. En producción (`FAL_BASE_URL` ausente) es
 * el `fetch` global sin cambios. En E2E, REESCRIBE el origen de cualquier request a la API de fal
 * (`queue.fal.run`, etc.) al `FAL_BASE_URL` del fake server — así el submit del SDK y el polling/download
 * (que siguen las URLs que el fake devuelve, auto-referenciales) se interceptan sin tocar el FalClient
 * de core (menor blast radius que un middleware en `makeFalClient`, que TODA la generación de imagen
 * comparte). Se lee `FAL_BASE_URL` SOLO aquí (web), nunca en core.
 */
export function makeFalPreviewFetch(
  falBaseUrl: string | undefined,
): typeof globalThis.fetch | undefined {
  if (falBaseUrl === undefined || falBaseUrl === '') return undefined;
  const target = new URL(falBaseUrl);
  return (input, init) => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const origin = FAL_ORIGINS.find((o) => rawUrl.startsWith(o));
    if (origin === undefined) return globalThis.fetch(input, init);
    // Reescribe SOLO el origen (protocolo+host+puerto); preserva path+query tal cual, para que las
    // rutas del queue (`/fal-ai/kokoro/requests/:id/status`) caigan en el fake que las sirve.
    const rewritten = new URL(rawUrl);
    rewritten.protocol = target.protocol;
    rewritten.host = target.host;
    return globalThis.fetch(rewritten.href, init);
  };
}

/** La API key de fal EN CLARO desde `app_setting` (cifrada, §19.2). Lanza `provider_error` si no hay
 *  key configurada (no se puede generar la muestra) — accionable, no un 500 opaco. */
async function loadFalKey(db: DbClient): Promise<string> {
  const blob = await getSecretBlob(db, 'fal');
  if (blob === undefined || blob === null) {
    throw new AppError('provider_error', 'no hay API key de fal configurada (Ajustes → fal)');
  }
  try {
    return decryptSecret(blob as SecretBlob, getSecretsKeyFromEnv());
  } catch {
    throw new AppError('provider_error', 'la API key de fal no se pudo descifrar');
  }
}

export interface GenerateVoicePreviewDeps {
  db: DbClient;
  storage: import('@ugc/core').StorageAdapter;
  logger?: import('@ugc/core').Logger;
  /** `FAL_BASE_URL` (E2E) — ver `makeFalPreviewFetch`. Lo pasa el route handler desde su accessor. */
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

  const previewFetch = makeFalPreviewFetch(deps.falBaseUrl);

  return runTtsOnly(
    {
      db,
      storage: deps.storage,
      // Key PEREZOSA: `runTtsOnly` solo la resuelve en el cache-miss (antes de gastar) — una
      // reproducción cacheada no paga el `getSecretBlob`+descifrado de `loadFalKey`.
      falKey: () => loadFalKey(db),
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      ...(previewFetch !== undefined ? { fetch: previewFetch } : {}),
    },
    // `voiceInputs` es una interfaz (`{voice, speed?}`) sin index signature; se copia a un objeto
    // plano para encajar en `GenerationInputs` (`Record<string, unknown>`).
    { ttsProfile, ttsInputs: { ...voiceInputs }, language: input.language },
  );
}
