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

// ─── Rama URL del intake (T1.10a) ────────────────────────────────────────────────
// La que este fichero anticipaba desde T1.6 ("cuando T1.4 añada la rama `url` como
// unión discriminada sobre este mismo campo"). Mismo discriminante: `source`.

/** Idiomas de análisis soportados hoy (config del LOTE, N0). Lista corta y explícita:
 *  un `z.string()` libre dejaría pasar cualquier cosa hasta el prompt de N3. */
export const ANALYSIS_LANGUAGES = ['es', 'en'] as const;

/**
 * Config del intake por URL: la URL a scrapear + la config del lote (N0 mínimo). NO
 * crea el `url_analysis` en el submit — a diferencia del modo manual, aquí el scraping
 * es TRABAJO del pipeline (nodo N1), así que el submit arranca el run y el análisis
 * nace dentro de él.
 */
export const UrlIntakeConfigSchema = z.object({
  source: z.literal('url'),
  projectId: z.string().min(1),
  url: z
    .string()
    .trim()
    .min(1, 'Pega la URL del producto')
    // `z.url()` valida el formato; además se exige http(s) explícitamente: un
    // `ftp://` o un `javascript:` parsean como URL válida pero no son scrapeables
    // (y `javascript:` sería un vector de inyección si alguna vista lo renderizara).
    .refine((value) => /^https?:\/\//i.test(value), 'La URL debe empezar por http:// o https://')
    .refine((value) => URL.canParse(value), 'No parece una URL válida'),
  targetLanguage: z.enum(ANALYSIS_LANGUAGES).default('es'),
});
export type UrlIntakeConfig = z.infer<typeof UrlIntakeConfigSchema>;
