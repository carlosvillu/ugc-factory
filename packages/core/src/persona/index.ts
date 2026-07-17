// API pública del módulo `persona` (T2.0, PRD §11). Subpath `@ugc/core/persona`.
//
// ⚠ ESTE BARREL LO IMPORTA EL NAVEGADOR — y esa es la razón de que exista `persona/server.ts`.
//
// El formulario de `/personas` (client component) valida con `PersonaBodySchema` y el
// `api-client` con `PersonaSchema`: los dos son código de CLIENTE, así que TODO lo que salga por
// aquí acaba en el bundle del navegador. `validateReferenceImage` y `makeSyntheticReferenceImage`
// usan **sharp** (binario nativo de Node) y NO pueden estar en este grafo: Turbopack intenta
// resolver `child_process` para el navegador y el build MUERE («Module not found: Can't resolve
// 'child_process'»). Lo cazó el E2E — el único test que compila la app de verdad para un
// navegador; unit e integración corren en Node y no lo veían.
//
// LA REGLA, pues: aquí solo **contratos Zod + lógica pura** (browser-safe). Lo que toca sharp o
// datos de seed vive en `@ugc/core/persona/server`, y solo lo importan los route handlers y el
// script de seed — procesos Node. Es el mismo criterio que ya cumple `@ugc/core/analyze` (que
// también usa sharp): lo consume `@ugc/services`, nunca un componente.
//
// El barrel expone SOLO lo que se consume desde FUERA del módulo (knip `includeEntryExports`
// veta el over-export «para más adelante»). Los dos umbrales (`REFERENCE_IMAGES_MIN`,
// `MIN_REFERENCE_LONG_EDGE_PX`) TIENEN consumidor externo y por eso salen: el primero lo pinta la
// ficha (`persona-detail.tsx`, «al menos N imágenes de 2K»), el segundo lo usan los tests de la
// API de `apps/web` para construir los PNG reales con los que prueban el guard. Ese segundo uso
// no es decorativo: la alternativa —escribir `2048` a mano en el test— rompería la regla de que
// el arnés no puede ser más cómodo que la realidad, porque el test dejaría de comprobar el umbral
// QUE EL CÓDIGO USA y pasaría a comprobar uno que él mismo se inventa. No hay subpath
// `@ugc/core/persona/contracts`: este barrel es la única puerta.
export {
  PersonaSchema,
  PersonaBodySchema,
  PersonaPatchSchema,
  PersonaListSchema,
  PersonaCandidateListSchema,
  VoiceProviderSchema,
  VOICE_PROVIDER_LABEL,
  REFERENCE_IMAGES_MIN,
  MIN_REFERENCE_LONG_EDGE_PX,
  // Preview de voz (T4.6, §8.3): body (idioma) y respuesta (assetId+cached) del botón ▶ de CP2/CP3.
  VoicePreviewRequestSchema,
  VoicePreviewResponseSchema,
  type VoicePreviewResponse,
  type Persona,
  type PersonaBody,
  type PersonaPatch,
  // El subconjunto que la regla de recomendación LEE. Lo exporta el barrel porque su segundo
  // consumidor es T2.2 (el compositor de matriz), que alimenta filas de `@ugc/db` — no `Persona`.
  type MatchablePersona,
} from './contracts';
// La regla de recomendación (§11 «el avatar_hint sugiere personas compatibles»). PURA: sin red,
// sin sharp, sin BD — el endpoint de candidatas es un passthrough sobre esto y T2.2 la
// reutilizará sin re-implementarla.
export { matchPersonas } from './candidates';
// Resolución de voz para N7b (T4.5, §13.1): valida la coherencia proveedor↔endpoint↔voiceId del triple
// del TTS. PURA: sin red ni BD. La ejecución (TTS→ASR) vive en @ugc/services.
export {
  resolveVoiceStep,
  type VoiceProvider,
  type ResolvedVoiceInputs,
  type ResolveVoiceStepInput,
} from './voice-resolution';
