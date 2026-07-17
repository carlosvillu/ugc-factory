// Contratos de la LIBRERÍA DE PERSONAS (T2.0, PRD §11 + §12).
//
// Una `persona` es un avatar SINTÉTICO persistente (D10: sin caras reales) que el pipeline
// reutiliza entre lotes: su demografía y personalidad se inyectan en el CASTING del prompt
// de vídeo (§10.3 punto 2), sus imágenes de referencia son el IDENTITY LOCK (i2v/avatar) y su
// `voice_map` decide QUÉ voz habla en cada idioma.
//
// Por qué el contrato vive en core y no en db: es la frontera universal (backend §1/§4). El
// mismo shape lo valida el route handler de `/api/personas`, lo consume el formulario de
// `/personas` (react-hook-form + zodResolver con ESTE schema) y lo leerá el compositor de
// matriz de T2.2. `packages/db` solo persiste lo que este contrato declara válido.
import { z } from 'zod';

/**
 * Proveedores de TTS del §11: «el proveedor cambia por tier y el `voiceId` solo es unívoco
 * DENTRO de su proveedor». Por eso el voice_map guarda el par, no un id suelto: un
 * `voiceId` sin proveedor es ambiguo y el día que el tier cambie de proveedor se elegiría
 * una voz que no existe.
 */
export const VoiceProviderSchema = z.enum(['elevenlabs', 'minimax', 'kokoro']);
type VoiceProvider = z.infer<typeof VoiceProviderSchema>;

/** La etiqueta legible de cada proveedor. Vive JUNTO al enum —y no en los componentes— porque es
 *  la otra mitad del mismo dato: estaba copiada en `persona-form` y `persona-detail`, así que
 *  añadir un proveedor (F4 trae la asignación de voz) obligaba a acordarse de DOS ficheros, y
 *  tocar solo uno dejaba el formulario ofreciendo un proveedor que la ficha pintaba `undefined`.
 *  El `Record` es exhaustivo: el compilador exige la etiqueta al añadir un valor al enum. */
export const VOICE_PROVIDER_LABEL: Readonly<Record<VoiceProvider, string>> = {
  elevenlabs: 'ElevenLabs',
  minimax: 'MiniMax',
  kokoro: 'Kokoro',
};

/** La voz de UN idioma: `{provider, voiceId}` (§12 `voice_map jsonb {locale: {provider, voiceId}}`). */
const VoiceRefSchema = z.object({
  provider: VoiceProviderSchema,
  voiceId: z.string().min(1),
  /** Etiqueta legible del modelo/voz que se pinta en la ficha (mockup 6c: «ElevenLabs Turbo»).
   *  Opcional: es cosmética, no identifica la voz. */
  label: z.string().min(1).optional(),
});
type VoiceRef = z.infer<typeof VoiceRefSchema>;

/** Locale como CLAVE del voice_map: minúsculas + guion opcional (`es`, `en`, `pt-br`). */
const LocaleKeySchema = z
  .string()
  .regex(/^[a-z]{2}(-[a-z]{2})?$/, 'el locale debe ser tipo `es`, `en` o `pt-br`');

/**
 * `voice_map`: un `VoiceRef` POR LOCALE (§12). Las claves son locales BCP-47 cortos (`es`,
 * `en`, `pt-br`…) — `z.record` con clave string y NO un enum cerrado, por el mismo motivo
 * que `hook_line.language` es `text` en la BD: «añadir un idioma es añadir voces al
 * voice_map + traducir las librerías» (§17), no una migración.
 *
 * Un voice_map VACÍO es válido en el contrato (una persona recién creada aún no tiene voz
 * asignada); lo que la Verificación de T2.0 exige es poder crear una CON es+en.
 */
const VoiceMapSchema = z.record(LocaleKeySchema, VoiceRefSchema);
type VoiceMap = z.infer<typeof VoiceMapSchema>;

/** Rango de edad del §11 («rango de edad», no una edad exacta: una persona sintética no
 *  cumple años). Formato `NN-NN` — es EXACTAMENTE lo que el placeholder `{persona.age_range}`
 *  de §10.4 inyecta en el prompt, sin traducción. */
const AgeRangeSchema = z
  .string()
  .regex(/^\d{2}-\d{2}$/, 'el rango de edad debe tener la forma `25-34`');

/** Género del §11. Vocabulario cerrado (se inyecta en el casting del prompt: los valores son
 *  parte del contrato del prompt, no texto libre). */
const PersonaGenderSchema = z.enum(['female', 'male', 'non_binary']);
export type PersonaGender = z.infer<typeof PersonaGenderSchema>;

/**
 * El cuerpo de una persona (lo que el usuario edita en `/personas`). Es también el body de
 * `POST /api/personas` y, en `.partial()`, el de `PATCH /api/personas/:id`.
 *
 * ⚠ LOS NOMBRES DE CAMPO SON CONTRATO CON T2.4 (PRD §10.4/§452): el renderizador de guiones
 * resuelve `{persona.age_range}`, `{persona.descriptor}` y `{persona.setting}` — así que la
 * persona los EXPONE con ese nombre exacto (`ageRange` → `age_range` es la única traducción,
 * la de camelCase↔snake_case que ya hace todo el proyecto). §11 no nombra `descriptor` ni
 * `setting`; se añaden como columnas de primera clase precisamente para que T2.4 no tenga que
 * inventarlos ni derivarlos de un texto libre.
 */
export const PersonaBodySchema = z.object({
  /** Nombre propio de la persona (§11). Es la CLAVE NATURAL (UNIQUE en la BD): la identidad
   *  de una persona es su nombre, y es lo que hace idempotente el seed. */
  name: z.string().min(1).max(80),
  // ── Demografía (§11: rango de edad, género, etnia, estilo) ──────────────────
  ageRange: AgeRangeSchema,
  gender: PersonaGenderSchema,
  /** Etnia (§11). Texto libre: la taxonomía de etnias NO es un enum que este proyecto vaya a
   *  cerrar bien, y va literal al casting del prompt. */
  ethnicity: z.string().min(1).max(60),
  /** Estilo (§11): `casual`, `deportivo`, `elegante`… Texto libre, va al casting. */
  style: z.string().min(1).max(60),
  /** `{persona.descriptor}` (§10.4): la frase de UNA línea que describe a la persona en el
   *  prompt («mujer de 29 años, latina, look casual»). Se escribe, no se deriva: el prompt es
   *  redacción, no una concatenación de campos. */
  descriptor: z.string().min(1).max(160),
  /** `{persona.setting}` (§10.4): el escenario cotidiano por defecto de esta persona
   *  («baño con luz natural, encimera con productos»). §10.3 punto 3 exige 2–3 anclas. */
  setting: z.string().min(1).max(200),
  /** Personalidad (§11): «se inyecta en el casting del prompt». Párrafo. */
  personality: z.string().min(1).max(600),
  /** `wardrobeNotes` (§11): continuidad de vestuario entre CUTs (§ «wardrobe continuity
   *  declarada por CUT»). Opcional: una persona puede no fijar vestuario. */
  wardrobeNotes: z.string().max(300).nullable().optional(),
  voiceMap: VoiceMapSchema,
});
export type PersonaBody = z.infer<typeof PersonaBodySchema>;

/** El PATCH: cualquier subconjunto del cuerpo. `.partial()` sobre el mismo objeto — nunca una
 *  segunda declaración a mano (dos verdades divergen). */
export const PersonaPatchSchema = PersonaBodySchema.partial();
export type PersonaPatch = z.infer<typeof PersonaPatchSchema>;

/**
 * La persona COMPLETA tal como sale de la API (lo que consume el frontend y validará T2.2).
 * `referenceImageIds` son ULIDs de filas `asset` (kind `reference_image`), en ORDEN: el
 * primero es el retrato principal del identity lock (el grande del mockup 6c).
 */
export const PersonaSchema = PersonaBodySchema.extend({
  id: z.string().min(1),
  referenceImageIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Persona = z.infer<typeof PersonaSchema>;

/** La lista de `/personas` y de `GET /api/personas`. */
export const PersonaListSchema = z.object({ personas: z.array(PersonaSchema) });

/**
 * LO QUE LA REGLA DE RECOMENDACIÓN NECESITA LEER, y nada más (`candidates.ts`).
 *
 * ⚠ ES UN SUBCONJUNTO ESTRUCTURAL A PROPÓSITO, no una comodidad. La regla vive en core para que
 * la reutilicen DOS consumidores con formas de dato distintas:
 *   · el endpoint `/api/personas/candidates` (web), que tiene `Persona` — el contrato de SALIDA
 *     de la API, con las fechas ya serializadas a ISO;
 *   · **el compositor de matriz de T2.2** («ángulos × hooks × PERSONAS × …»), que corre fuera de
 *     web y lee `PersonaRow` de `@ugc/db` — con `Date` reales.
 *
 * Si la regla exigiera `Persona`, T2.2 solo podría llamarla importando `apps/web` (imposible),
 * duplicando el mapping fila→contrato (dos verdades de serialización) o haciendo un HTTP a su
 * propia app desde el worker. Ninguna es la altitud correcta. Pidiendo solo los 6 campos que de
 * verdad lee, las DOS formas encajan sin conversión — y el día que la regla necesite un campo
 * más, este tipo lo declara y el compilador avisa a los dos consumidores.
 */
export interface MatchablePersona {
  name: string;
  gender: PersonaGender;
  ethnicity: string;
  style: string;
  descriptor: string;
  ageRange: string;
}

/** Respuesta del endpoint de CANDIDATAS (`GET /api/personas/candidates?avatar_hint=…`):
 *  las personas compatibles, mejor primero, con su puntuación (así la UI de T2.2 puede
 *  explicar POR QUÉ se recomienda una). */
const PersonaCandidateSchema = z.object({
  persona: PersonaSchema,
  score: z.number(),
  /** Los tokens del `avatar_hint` que casaron. Es la EXPLICACIÓN de la recomendación. */
  matched: z.array(z.string()),
});
type PersonaCandidate = z.infer<typeof PersonaCandidateSchema>;

export const PersonaCandidateListSchema = z.object({
  candidates: z.array(PersonaCandidateSchema),
});

/**
 * Respuesta de `POST /api/personas/:id/voice-preview` (T4.6, §8.3): el asset de la muestra de voz a
 * reproducir + si vino de caché. El `<audio src>` del ▶ apunta a `/api/assets/${assetId}/download`.
 * `cached` es observable de la garantía "N reproducciones, 0 coste" (aunque la comprobación fuerte es
 * el conteo de `cost_entry` en `/spend`, este flag da señal directa al cliente/tests).
 */
export const VoicePreviewResponseSchema = z.object({
  assetId: z.string().min(1),
  cached: z.boolean(),
});
export type VoicePreviewResponse = z.infer<typeof VoicePreviewResponseSchema>;

/** Body de `POST /api/personas/:id/voice-preview`: el idioma de la variante cuya voz previsualizar. */
export const VoicePreviewRequestSchema = z.object({
  language: LocaleKeySchema,
});

/**
 * MÍNIMO de imágenes de referencia por persona (§11: «retratos consistentes, mismo sujeto en
 * 2–3 encuadres»). No lo impone la BD (una persona nace sin imágenes y se le suben después):
 * lo impone la UI y lo comprueba la Verificación («crear una persona con 2 imágenes ≥2K»).
 */
export const REFERENCE_IMAGES_MIN = 2;

/**
 * EL UMBRAL «≥2K» de §11 («referenceImages[] ≥2K (identity lock)»), en píxeles.
 *
 * El PRD dice «≥2K» y no dice sobre qué lado. Se interpreta —y se DEJA ESCRITO aquí, que es
 * el sitio donde el número tiene nombre— como **el lado LARGO ≥ 2048 px** (2K = 2048 en la
 * convención de imagen digital). Motivo: la referencia de identity lock es un RETRATO, casi
 * siempre vertical (el mockup 6c dibuja el principal en 4:5), y un 1638×2048 vertical es una
 * referencia perfectamente válida a 2K que un umbral sobre AMBOS lados rechazaría sin razón.
 * Lo que la resolución del identity lock necesita es densidad de píxeles en la cara, y eso lo
 * fija el lado largo.
 *
 * Un solo número, con nombre, en un solo sitio: el endpoint de upload lo aplica (leyendo las
 * dimensiones del FICHERO con sharp, nunca creyéndose lo que diga el cliente) y su test lo
 * ejercita en la frontera exacta (2048 pasa, 2047 no).
 */
export const MIN_REFERENCE_LONG_EDGE_PX = 2048;
