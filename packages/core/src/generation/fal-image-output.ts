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
