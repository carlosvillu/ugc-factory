// El CONTRATO del `qa_report` del pase final (T5.5, §9.7 N9 / Apéndice C): el objeto que el validador QA
// produce y que persiste `ad_variant.qa_report` (§12, jsonb). Vive en CORE —no en services ni en el
// worker— porque es una INTERFAZ PÚBLICA: lo escribe el módulo de composición (`@ugc/services` →
// `composeVariant`), lo relee el panel de QA de CP4 (T5.6, apps/web) y el bundle de export (T5.7). Y
// `apps/web` NO puede importar de `apps/worker` (composition roots hermanos): un contrato Zod en core es la
// única verdad de su forma; la columna jsonb es opaca hasta que este schema la parsea.
//
// LOS 8 CHECKS (media-composition.md §"Pase final, QA y C2PA"): resolution, fps, codec, duration, loudness,
// av_duration_diff, captions_safe_zone, filesize. Cada uno es `pass` | `fail` (un veredicto binario, no un
// número crudo — el número medido vive en `metrics` para depurar/mostrar, el veredicto es lo que gobierna).
// El validador DERIVA los esperados de las MISMAS constantes que el encoder targetea (anti-T1.9): res/fps/
// codec/pixfmt de `CANONICAL_VIDEO_PROFILE`, y duración/loudness/filesize/AAC de `EXPORT_MASTER_PRESET`.
import { z } from 'zod';

/** El veredicto de un check individual: pasa o no pasa. Binario a propósito — el panel de QA muestra
 *  verde/rojo, no un número que el usuario tenga que interpretar; el número medido va aparte en `metrics`. */
export const QaCheckVerdictSchema = z.enum(['pass', 'fail']);
export type QaCheckVerdict = z.infer<typeof QaCheckVerdictSchema>;

/**
 * Los 8 CHECKS del QA N9. Los NOMBRES son contrato (el panel de CP4 y el export bundle los leen por clave):
 *   · `resolution`         : 1080×1920 exacto (CANONICAL_VIDEO_PROFILE).
 *   · `fps`                : 30 fps exacto (CANONICAL_VIDEO_PROFILE).
 *   · `codec`              : vídeo H.264 + pix_fmt yuv420p (CANONICAL_VIDEO_PROFILE).
 *   · `duration`           : ≤ maxDurationS de la variante y ≤ el techo del preset (EXPORT_MASTER_PRESET).
 *   · `loudness`           : loudness integrado −14 LUFS ±tolerancia (EXPORT_MASTER_PRESET).
 *   · `av_duration_diff`   : |duración de vídeo − duración de audio| ≤ tolerancia (sin desincronía grosera).
 *   · `captions_safe_zone` : ningún evento del `.ass` posiciona texto fuera del área útil (reusa el check
 *                            de T5.4). Vacuous-pass cuando la variante no lleva captions.
 *   · `filesize`           : ≤ 500 MB (EXPORT_MASTER_PRESET).
 */
export const QaChecksSchema = z.object({
  resolution: QaCheckVerdictSchema,
  fps: QaCheckVerdictSchema,
  codec: QaCheckVerdictSchema,
  duration: QaCheckVerdictSchema,
  loudness: QaCheckVerdictSchema,
  av_duration_diff: QaCheckVerdictSchema,
  captions_safe_zone: QaCheckVerdictSchema,
  filesize: QaCheckVerdictSchema,
});
export type QaChecks = z.infer<typeof QaChecksSchema>;

/** Las MÉTRICAS crudas que alimentaron los veredictos (para el panel de QA y la depuración). Opcionales
 *  campo a campo: un check que no pudo medir (p. ej. sin pista de audio) deja su métrica ausente pero su
 *  veredicto SIEMPRE presente. No gobiernan nada — el veredicto es lo autoritativo; estos números son la
 *  evidencia legible de por qué. */
export const QaMetricsSchema = z.object({
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  fps: z.number().optional(),
  videoCodec: z.string().optional(),
  pixFmt: z.string().optional(),
  audioCodec: z.string().optional(),
  audioSampleRate: z.number().int().optional(),
  audioChannels: z.number().int().optional(),
  audioBitrate: z.number().int().optional(),
  videoDurationS: z.number().optional(),
  audioDurationS: z.number().optional(),
  loudnessLufs: z.number().optional(),
  filesizeBytes: z.number().int().optional(),
  captionViolations: z.number().int().optional(),
});
export type QaMetrics = z.infer<typeof QaMetricsSchema>;

/**
 * EL `qa_report` COMPLETO (§12 `ad_variant.qa_report`): los 8 veredictos + las métricas crudas + `passed`
 * (¿todos pasan?) + `score` (0–100). El `score` se deriva del ratio de checks en `pass` (§12 lo marca como
 * entero 0–100) — un master con todos los checks en verde puntúa 100. `passed` es redundante con "todos los
 * checks en pass" pero se persiste para que la query de la Verificación ("todos en pass") sea trivial.
 */
export const QaReportSchema = z.object({
  checks: QaChecksSchema,
  metrics: QaMetricsSchema,
  /** true sii TODOS los checks están en `pass`. La query de la Verificación de T5.5 lo lee directamente. */
  passed: z.boolean(),
  /** Puntuación 0–100 (§12): % de checks en `pass`, redondeado. 100 = todos verdes. */
  score: z.number().int().min(0).max(100),
});
export type QaReport = z.infer<typeof QaReportSchema>;
