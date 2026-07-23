// Contratos de la API de `/library` (T5.7, §9.7 N10). La frontera REST entre `apps/web` (rutas
// `/api/library`, `/api/variants/:id/lineage`) y su api-client. Son la VISTA PÚBLICA (api.md): no espejan la
// fila `ad_variant` — reagrupan lo que la lista y el panel de linaje 4c necesitan.
//
// Por qué en CORE: contratos Zod, frontera universal (backend/principio 4). El route handler `parse`a antes de
// serializar; el api-client re-valida al recibir → un drift de shape se caza en ambos bordes.
import { z } from 'zod';

import { BatchDestinationSchema } from './batch-plan';
import { UlidSchema } from './ids';

/** Una TARJETA de la lista de `/library`: identidad + estado + thumbnail + lo filtrable (objetivo/destino). */
export const LibraryVariantSummarySchema = z.object({
  id: UlidSchema,
  filenameCode: z.string(),
  angleName: z.string(),
  language: z.string(),
  status: z.string(),
  durationTarget: z.number().int(),
  platformTargets: z.array(z.string()),
  masterAssetId: UlidSchema.nullable(),
  thumbnailAssetId: UlidSchema.nullable(),
  score: z.number().int().nullable(),
  objective: z.string(),
  destination: BatchDestinationSchema,
});
export type LibraryVariantSummary = z.infer<typeof LibraryVariantSummarySchema>;

/** La respuesta de `GET /api/library`: las variantes aprobadas (las descargables). */
export const LibraryListSchema = z.object({
  variants: z.array(LibraryVariantSummarySchema),
});
export type LibraryList = z.infer<typeof LibraryListSchema>;

/** El LINAJE de una variante (panel 4c): del máster hasta el hook line + `template@version` + persona. Los
 *  punteros a la librería son NULLABLES (hook del brief, persona sin fijar, template no registrado). */
export const VariantLineageSchema = z.object({
  variant: z.object({
    id: UlidSchema,
    filenameCode: z.string(),
    angleName: z.string(),
    framework: z.string(),
    language: z.string(),
    durationTarget: z.number().int(),
    platformTargets: z.array(z.string()),
    status: z.string(),
    audioSource: z.string().nullable(),
    score: z.number().int().nullable(),
    masterAssetId: UlidSchema.nullable(),
    thumbnailAssetId: UlidSchema.nullable(),
  }),
  /** El hook line (de la librería) o `null` si el hook vino del brief. */
  hook: z.object({ id: UlidSchema, text: z.string(), angle: z.string() }).nullable(),
  /** La persona o `null` si no se fijó. */
  persona: z.object({ id: UlidSchema, name: z.string() }).nullable(),
  /** El template + versión EXACTA (`slug@version`), o `null`. */
  template: z
    .object({ id: UlidSchema, slug: z.string(), title: z.string(), version: z.number().int() })
    .nullable(),
  /** El máster (duración/dimensiones), o `null` si aún no se compuso. */
  master: z
    .object({
      id: UlidSchema,
      durationS: z.number().nullable(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
    })
    .nullable(),
  /** El lote: objetivo y destino (§14). */
  batch: z.object({
    id: UlidSchema,
    objective: z.string(),
    destination: BatchDestinationSchema,
  }),
});
export type VariantLineageResponse = z.infer<typeof VariantLineageSchema>;
