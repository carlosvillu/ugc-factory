// Parseo del OUTPUT de un modelo de imagen de fal (§9.6, T4.1) — LÓGICA PURA.
//
// FLUX.2 dev (y los modelos `image` en general) devuelven `{ images: [{ url, width, height,
// content_type }], ... }` (contrato verificado en la doc de fal, 2026-07-15). El servicio
// necesita: la URL para DESCARGAR el PNG a nuestro storage, y las dimensiones para calcular
// el coste por MEGAPÍXEL (el pricing vive en `@ugc/services`, no aquí: es I/O de dinero).
//
// Es Zod en la frontera (principio 4 de backend): un output que no encaje es un
// `FalResponseError` en el servicio, no un crash aguas abajo. NO se asume la forma — se valida.
import { z } from 'zod';

/** Una imagen del output de fal: URL descargable + dimensiones + mime. */
const FalImageSchema = z.object({
  url: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  content_type: z.string().optional(),
});
export type FalImage = z.infer<typeof FalImageSchema>;

/** El output de un modelo de imagen: al menos una imagen. `seed`/`timings`/etc. se ignoran. */
const FalImageOutputSchema = z.object({
  images: z.array(FalImageSchema).min(1),
});
export type FalImageOutput = z.infer<typeof FalImageOutputSchema>;

/**
 * Valida y extrae el output de imagen de fal. Devuelve `null` si no encaja (el servicio lo
 * mapea a `FalResponseError`: se pagó pero el contrato no se cumplió — rama de validación,
 * NO de proveedor). Nunca lanza.
 */
export function extractImageOutput(output: unknown): FalImageOutput | null {
  const parsed = FalImageOutputSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}

/** Una imagen de la que SOLO nos importa la URL (las dimensiones se releen del fichero). */
const FalImageUrlSchema = z.object({
  url: z.string().min(1),
  content_type: z.string().optional(),
});
export type FalImageUrl = z.infer<typeof FalImageUrlSchema>;

const FalImageUrlOutputSchema = z.object({
  images: z.array(FalImageUrlSchema).min(1),
});
export type FalImageUrlOutput = z.infer<typeof FalImageUrlOutputSchema>;

/**
 * Variante TOLERANTE de `extractImageOutput` para consumidores que NO facturan por megapíxel
 * y releen las dimensiones DEL FICHERO descargado (p. ej. las reference-images de personas, que
 * pasan por `validateReferenceImage(bytes)`). `nano-banana-2/edit` REAL emite `width:null,
 * height:null` en el output — nulls que el `FalImageSchema` estricto rechaza (`.optional()` acepta
 * ausente, no `null`). Aquí solo exigimos la URL descargable; el resto del output se ignora.
 * Devuelve `null` si no encaja (el servicio lo mapea a `FalResponseError`). Nunca lanza.
 */
export function extractImageUrlOutput(output: unknown): FalImageUrlOutput | null {
  const parsed = FalImageUrlOutputSchema.safeParse(output);
  return parsed.success ? parsed.data : null;
}
