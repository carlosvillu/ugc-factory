// Contrato de intake del análisis (F1, N0 — §7.4 / §9 N0). ESTE fichero define
// SOLO la rama de TEXTO LIBRE del intake (T1.6): descripción + refs de imágenes
// opcionales. La rama de URL (T1.4) y la config de LOTE (idiomas/plataformas/tier/
// nº variantes, N0 batch = F2) llegan en sus tareas — NO se anticipan aquí.
//
// El MISMO schema valida en el cliente (RHF + zodResolver, forms.md §1) y re-valida
// en el route handler (withRoute, api.md §1): una sola definición de "válido"
// elimina el drift cliente/servidor por construcción.
import { z } from 'zod';

// El texto libre del intake manual: descripción del producto que el usuario pega.
// Mínimo razonable (20 chars): un párrafo corto, no una palabra suelta — la
// síntesis del RawContent y el brief posterior necesitan sustancia. Máximo generoso
// (20 000 chars) para acotar el payload sin cortar descripciones legítimas.
export const MANUAL_FREE_TEXT_MIN = 20;
export const MANUAL_FREE_TEXT_MAX = 20_000;

// Nº máximo de imágenes de referencia por intake manual (guarda de alcance del
// upload — la validación del nº se comparte con el endpoint de assets, T1.6).
export const MANUAL_IMAGE_REFS_MAX = 8;

/** Una referencia de imagen ya subida (endpoint POST /api/assets): la URL de
 *  descarga proxificada del asset + un alt opcional. NO son los bytes: el upload
 *  es un paso previo, aquí solo viaja la referencia. */
export const IntakeImageRefSchema = z.object({
  // URL de descarga del asset (`/api/assets/:id/download`): la vía de salida
  // proxificada (api.md §7), nunca la storage_key cruda.
  url: z.string().min(1),
  alt: z.string().nullable().optional(),
});
export type IntakeImageRef = z.infer<typeof IntakeImageRefSchema>;

/**
 * Config del intake manual (texto libre). `source: 'manual'` es literal (una sola
 * rama en T1.6): re-declararlo fija el discriminante para cuando T1.4 añada la rama
 * `url` como unión discriminada sobre este mismo campo.
 */
export const ManualIntakeConfigSchema = z.object({
  source: z.literal('manual'),
  // El proyecto al que cuelga el análisis (FK NOT NULL en url_analysis, T1.2).
  projectId: z.string().min(1),
  freeText: z
    .string()
    .trim()
    .min(
      MANUAL_FREE_TEXT_MIN,
      `Describe el producto con al menos ${String(MANUAL_FREE_TEXT_MIN)} caracteres`,
    )
    .max(MANUAL_FREE_TEXT_MAX, 'La descripción es demasiado larga'),
  // Refs de imágenes ya subidas (opcional): default `[]` para que el submit sin
  // imágenes sea válido sin que el cliente tenga que enviar el campo.
  imageRefs: z
    .array(IntakeImageRefSchema)
    .max(MANUAL_IMAGE_REFS_MAX, `Máximo ${String(MANUAL_IMAGE_REFS_MAX)} imágenes`)
    .default([]),
});
export type ManualIntakeConfig = z.infer<typeof ManualIntakeConfigSchema>;
