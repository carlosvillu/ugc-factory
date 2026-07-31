// CONTRATOS del Trending Sound Advisor (T6.6, §14 pt 1-2 / §13.3, PRD:626). Lo que el cliente de TikTok
// Creative Center (Popular Music) produce y lo que la API/UI del Advisor consumen. Subpath `@ugc/core/publishing`.
//
// FRONTERA (backend/architecture.md §contratos): schemas Zod + tipos inferidos. Sin BD, sin cola. El cliente
// HTTP (`creative-center.ts`) SÍ vive en core (la frontera prohibida es BD/cola, no la red — como Firecrawl).
import { z } from 'zod';

import { UlidSchema } from '../contracts/ids';

/** Un mood tag DERIVADO (no un dato de TikTok — ver `deriveMoodTags`). El conjunto es cerrado para que la UI
 *  pueda ofrecer chips de filtro estables; un sonido puede tener 0..n moods. */
export const SoundMoodSchema = z.enum([
  'energetic',
  'calm',
  'hype',
  'chill',
  'cinematic',
  'upbeat',
]);
export type SoundMood = z.infer<typeof SoundMoodSchema>;

/**
 * UN SONIDO TRENDING ya proyectado al contrato interno (T6.6). Sale del parser del cliente sobre la respuesta
 * cruda de Creative Center. `commercial` es el FLAG CML DERIVADO del campo real `if_cml` (NO un booleano
 * inventado): true = en la Commercial Music Library (usable en ads/Spark); false = trending general
 * (solo orgánico no-promocionado, §14 pt 1). `moods` es un derivado NUESTRO sobre el título (no de TikTok).
 */
export const TrendingSoundSchema = z.object({
  /** `song_id` de Creative Center — clave estable que la selección persiste. */
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.string().min(1),
  /** URL del cover 720x720. */
  coverUrl: z.string().min(1),
  /** URL de la página de música de TikTok (para «abrir el sonido»). */
  link: z.string().min(1),
  durationSeconds: z.number().int().positive(),
  /** Posición en el chart (1 = más popular). */
  rank: z.number().int().positive(),
  /** EL FLAG COMERCIAL (§14 pt 2): derivado del `if_cml` real. Gobierna la elegibilidad para paid/Spark. */
  commercial: z.boolean(),
  /** Los moods DERIVADOS del título (heurística nuestra). Vacío si el título no casa ningún bucket. */
  moods: z.array(SoundMoodSchema),
});
export type TrendingSound = z.infer<typeof TrendingSoundSchema>;

/** La respuesta del Advisor: los sonidos + de qué destino se filtró (para que la UI sepa si se aplicó el
 *  filtro comercial). `commercialOnly` refleja la ley de §14 pt 2: paid/Spark ⇒ solo CML; orgánico ⇒ todos. */
export const TrendingSoundListSchema = z.object({
  sounds: z.array(TrendingSoundSchema),
  /** ¿Se restringió a sonidos comerciales (CML)? true cuando el destino incluye paid/Spark. */
  commercialOnly: z.boolean(),
  /** ¿La fuente (Creative Center) respondió bien? `false` cuando la lectura falló (red/HTTP/JSON) — el cliente
   *  degrada a lista vacía. La UI lo NECESITA para distinguir «la fuente está caída» (aviso) de «no hay
   *  sonidos para este filtro» (estado vacío normal). En producción, SIN una sesión de TikTok (T6.1), la
   *  fuente real da 404 y esto es `false` — el aviso lo hace explícito en vez de fingir un catálogo vacío. */
  sourceOk: z.boolean(),
});
export type TrendingSoundList = z.infer<typeof TrendingSoundListSchema>;

/** El body de `POST /api/variants/:id/native-sound`: elegir un sonido nativo/trending para la variante. Marca
 *  `audio_source='native_trending'` (§14 pt 1) → el checklist bloquea Spark (coherencia T6.2). `soundId` es el
 *  `song_id` elegido; se guarda para la guía in-app «añadir sonido nativo al publicar». */
export const SelectNativeSoundSchema = z.object({
  soundId: z.string().min(1),
});
export type SelectNativeSoundBody = z.infer<typeof SelectNativeSoundSchema>;

/** La RESPUESTA de `POST /api/variants/:id/native-sound`: la variante marcada + su nuevo `audio_source`
 *  (siempre `native_trending` en este endpoint). Vive en core para que productor (route) y consumidor
 *  (api-client) compartan UNA sola forma — igual que `TrendingSoundListSchema`. `variantId` es un ULID. */
export const SelectNativeSoundResultSchema = z.object({
  variantId: UlidSchema,
  audioSource: z.literal('native_trending'),
});
export type SelectNativeSoundResult = z.infer<typeof SelectNativeSoundResultSchema>;
