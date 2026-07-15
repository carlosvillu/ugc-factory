// EL CONTRATO `AdScript` — la frontera N5 → N6 del pipeline (§7.4) y la fila de `ad_script` (§12).
// Lo produce el ScriptWriter (N5, T2.4, `scripting/`), lo edita CP3 (T2.6) y lo consume el
// compilador de prompts (N6, T3.5), que interpola `scenes[].visual/camera/emotion` en el template
// de vídeo y `scenes[].narration` en la voz.
//
// EL TIMING ES NUESTRO, NO DEL MODELO (regla dura de T2.4). §7.2 N5 fija la aritmética:
// `word_count ÷ 2,5 = segundos`. Un LLM que te dice «esta escena dura 12 s» está ADIVINANDO: no
// cuenta palabras, no sabe el ritmo de habla, y su número no tiene forma de ser falso. Así que al
// modelo se le pide TEXTO (narración por escena) y los segundos los CALCULAMOS aquí —
// `computeSceneTiming`— del texto que devolvió. Es determinista, gratis, y testeable sin gastar
// un céntimo.
//
// POR QUÉ `scenes[]` ES `{t, narration, visual, camera, emotion}` Y NO `{index, text, seconds}`:
// lo dicta §7.2 N5 literalmente. `narration` es lo que se OYE (y lo que se cuenta para el timing);
// `visual`/`camera`/`emotion` son lo que N6 necesita para escribir el prompt de vídeo. La factory
// `makeAdScript` de test-utils (T2.1) usaba un shape mínimo de relleno: la columna es `jsonb`
// OPACO en la BD y el shape real lo define ESTE contrato, que es quien valida.
import { z } from 'zod';

import { AdSegmentSchema } from './batch-plan';

/**
 * LA CONSTANTE DEL TIMING (§7.2 N5, research/04 §3.2): 2,5 palabras habladas por segundo. Es el
 * ritmo UGC conversacional (más lento que un locutor de radio, más rápido que una narración
 * pausada). La misma que justifica `MAX_HOOK_WORDS = 12` para los 0–3 s del hook: 12 ÷ 2,5 ≈ 5 s
 * es ya el techo del hook más largo tolerable.
 */
export const WORDS_PER_SECOND = 2.5;

/**
 * Una ESCENA del guion (§7.2 N5: `scenes[]{t, narration, visual, camera, emotion}`).
 *
 * `t` es el INSTANTE DE INICIO en segundos desde el arranque del anuncio (no la duración): lo que
 * N8 necesita para colocar el clip en la timeline. La duración vive en `seconds`, y las dos las
 * calcula `computeSceneTiming` — el modelo NUNCA las emite (ver la cabecera).
 *
 * `segment` ata la escena a su segmento (`hook`/`body`/`cta`): es lo que hace posible la DEDUP de
 * N7 (dos variantes del mismo ángulo comparten las escenas de `body` y `cta` en hook-testing) y lo
 * que conecta el guion con `PlannedVariant.segmentKeys`.
 */
export const AdSceneSchema = z.object({
  /** Instante de inicio en segundos desde t=0. Calculado, no pedido al LLM. */
  t: z.number().nonnegative(),
  /** Duración de la escena en segundos: `countWords(narration) ÷ 2,5`. Calculada. */
  seconds: z.number().positive(),
  segment: AdSegmentSchema,
  /** Lo que se OYE. Es el texto que cuenta para el timing. */
  narration: z.string().min(1),
  /** Lo que se VE (input de N6: el prompt de vídeo). */
  visual: z.string().min(1),
  /** Movimiento/encuadre de cámara (input de N6). */
  camera: z.string().min(1),
  /** Emoción del avatar en la escena (input de N6). */
  emotion: z.string().min(1),
});
export type AdScene = z.infer<typeof AdSceneSchema>;

/**
 * Una línea de subtítulo, ya sincronizada (§7.2 N5 `subtitles[]`). Derivada de las escenas —
 * misma aritmética, mismo determinismo: nada que el modelo pueda equivocarse en inventar.
 * `start`/`end` en segundos; los consume el generador ASS de F5.
 */
export const AdSubtitleSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().positive(),
  text: z.string().min(1),
});
export type AdSubtitle = z.infer<typeof AdSubtitleSchema>;

/**
 * `AdScript`: el guion completo de UNA variante. Espeja la fila de `ad_script` (§12:
 * `hook, scenes jsonb[], subtitles jsonb[], cta, full_text, word_count, est_seconds, tone,
 * language`), sin las columnas de PERSISTENCIA (`id`, `variant_id`, `version`, `edited_by_user`,
 * `guardrail_flags`) — core no conoce IDs de BD, y `guardrail_flags` es de T2.5.
 *
 * `filenameCode` es lo que ata este guion a su `PlannedVariant` (el mismo campo del `BatchPlan`):
 * el caller que persiste resuelve `variant_id` con él. Sin él, un `AdScript[]` devuelto por N5
 * sería una lista anónima que habría que re-emparejar por posición — el mismo error que T2.2 ya
 * corrigió al quitar el `libraryIndex`.
 *
 * `sharedBodyKey` NO es decorativo: en hook-testing es la clave (`segmentKeys.body`) por la que
 * dos variantes del MISMO ángulo comparten body y CTA. Dos guiones con la misma `sharedBodyKey`
 * tienen —por construcción— las MISMAS escenas de body y cta, palabra por palabra. Es lo que
 * habilita la dedup de N7 que el estimador ya cobra UNA sola vez.
 */
export const AdScriptSchema = z.object({
  /** `PlannedVariant.filenameCode`: la identidad estable de la variante dentro del plan. */
  filenameCode: z.string().min(1),
  /** El hook HABLADO y ya en el idioma destino (§17). No es la semilla del brief: es el texto
   *  final que oye el espectador. Coincide con la narración de las escenas de `segment: 'hook'`. */
  hook: z.string().min(1),
  /** El CTA hablado, elegido por objetivo (§9.4). Coincide con la narración de las escenas `cta`. */
  cta: z.string().min(1),
  scenes: z.array(AdSceneSchema).min(1),
  subtitles: z.array(AdSubtitleSchema).min(1),
  /** Todo lo hablado, en orden. Es lo que se cuenta para `wordCount`. */
  fullText: z.string().min(1),
  wordCount: z.number().int().positive(),
  /** Duración del guion en segundos: la SUMA de las duraciones de sus escenas (cada una ya con el
   *  suelo de 0,5 s aplicado — ver `MIN_SCENE_SECONDS`), redondeada AL ALZA. NO es exactamente
   *  `wordCount ÷ 2,5`: para guiones de escenas muy cortas los suelos de 0,5 s empujan el total por
   *  encima de esa división (una escena de 1 palabra dura 0,5 s, no 0,4 s). El cálculo por suelos es
   *  el correcto —es lo que N7/N8 van a materializar en clips— y por eso `est_seconds` se deriva de
   *  él, no de la división. Entero: un anuncio no se corta a media palabra. */
  estSeconds: z.number().int().positive(),
  /** El registro de la voz (`ad_script.tone`): lo elige el modelo dentro de la diversidad que se
   *  le instruye por prompt (§9.4 — Sonnet 5 no acepta sampling params). */
  tone: z.string().min(1),
  /** El idioma DESTINO de la variante (`PlannedVariant.language`), no el del brief (§17). */
  language: z.string().min(1),
  /** La clave de dedup del body/cta (`PlannedVariant.segmentKeys.body`). Ver arriba. */
  sharedBodyKey: z.string().min(1),
});
export type AdScript = z.infer<typeof AdScriptSchema>;

/** Cuenta palabras habladas. Misma tokenización que `countWords` de `analyze/brief-validator`
 *  (tokens separados por espacio): el timing y el techo de hook miden lo mismo con la misma vara. */
export function countSpokenWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Segundos de un texto hablado: `palabras ÷ 2,5`, redondeado a 2 decimales (§7.2 N5). Los
 *  decimales importan: N8 recorta el clip a la duración EXACTA de su narración. */
export function secondsForText(text: string): number {
  const words = countSpokenWords(text);
  return Math.round((words / WORDS_PER_SECOND) * 100) / 100;
}
