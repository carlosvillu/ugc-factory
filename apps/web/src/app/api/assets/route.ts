// `POST /api/assets` (T1.6): upload de una imagen de referencia del intake manual.
// multipart/form-data (campo `file`) → StorageAdapter.put → fila `asset` → devuelve
// `{ id, url }` (la URL de descarga proxificada, api.md §7). Es un endpoint NUEVO
// (T0.5 solo cubría el download).
//
// VALIDACIÓN (la única superficie de riesgo de T1.6): aunque sea mono-usuario
// autenticado, un upload sin límites es el riesgo. Se imponen tres barreras:
//  - ALLOWLIST de mime: solo imágenes (jpeg/png/webp/gif/avif). Nada más.
//  - CAP de tamaño por fichero.
//  - El LÍMITE de nº de imágenes por análisis vive en el schema de intake
//    (MANUAL_IMAGE_REFS_MAX) — este endpoint sube UNA por request.
//
// `withAuth` por fuera (401 antes de tocar nada). NO usa `withRoute` (el body es
// multipart, no JSON): construye su propio try/catch delegando en `toErrorResponse`
// para el envelope único.
import { z } from 'zod';
import { AppError, newUlid } from '@ugc/core/contracts';
import { createAsset } from '@ugc/db';
import { getDb, toErrorResponse } from '@/server';
import { getStorage } from '@/server/storage';
import { withAuth } from '@/server/with-auth';

// pg + filesystem viven en el runtime Node, no en edge.
export const runtime = 'nodejs';
// Muta la BD y el almacén en cada request: jamás se cachea.
export const dynamic = 'force-dynamic';

// Cap de tamaño por fichero (8 MiB): una imagen de referencia razonable. Un fichero
// mayor es 400 validation_error.
const MAX_BYTES = 8 * 1024 * 1024;

// Cap del BODY completo para el precheck de Content-Length (413): el cap de fichero
// (8 MiB) + un margen para el overhead del multipart (boundaries, headers de parte).
// Rechazar por aquí evita bufferizar en RAM un body gigante ANTES de validar el
// fichero — la protección del HEAP (el cap de fichero protege el disco).
const MAX_BODY_BYTES = MAX_BYTES + 1024 * 1024;

// Allowlist de mime (solo imágenes) → extensión de fichero. Es la barrera de tipo Y
// la fuente de la extensión en un solo mapa (antes eran un Set + un Record paralelos
// que había que mantener sincronizados). Un fichero fuera de estas claves es 400
// validation_error — nunca llega al almacén.
const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
} as const;
type AllowedMime = keyof typeof MIME_TO_EXT;

// Type guard: tras pasarlo, `file.type` se estrecha a `AllowedMime`, así que el lookup
// de la extensión devuelve `string` (no `string | undefined`) sin fallback muerto.
function isAllowedMime(mime: string): mime is AllowedMime {
  return mime in MIME_TO_EXT;
}

// El id de asset devuelto es un ULID (contrato de salida validado por el cliente).
const AssetUploadResponseSchema = z.object({
  id: z.string(),
  url: z.string(),
});

export const POST = withAuth(async (req: Request): Promise<Response> => {
  try {
    // PRECHECK de tamaño ANTES de bufferizar el body (seguridad — DoS de memoria):
    // `req.formData()` carga el multipart ENTERO en RAM (undici; los route handlers de
    // Next no imponen límite de body). Un upload de 2 GB reventaría el heap ANTES de
    // llegar al cap de fichero. Se rechaza con 413 sin parsear el body.
    // DEUDA (una línea): una request `Transfer-Encoding: chunked` SIN Content-Length se
    // salta este precheck — el residual aceptable para una herramienta mono-usuario.
    const contentLength = Number(req.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      return Response.json(
        {
          code: 'validation_error',
          message: `El cuerpo de la petición supera el máximo de ${String(MAX_BYTES / (1024 * 1024))} MB`,
        },
        { status: 413 },
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError('validation_error', 'el body no es multipart/form-data');
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new AppError('validation_error', 'falta el fichero (campo `file`)', {
        formErrors: ['Selecciona una imagen'],
        fieldErrors: {},
      });
    }

    // ALLOWLIST de mime: solo imágenes.
    if (!isAllowedMime(file.type)) {
      throw new AppError(
        'validation_error',
        `tipo de imagen no permitido: ${file.type || 'desconocido'}`,
        {
          formErrors: ['Solo se permiten imágenes (JPEG, PNG, WebP, GIF, AVIF)'],
          fieldErrors: {},
        },
      );
    }

    // CAP de tamaño: rechaza ANTES de leer los bytes al almacén.
    if (file.size > MAX_BYTES) {
      throw new AppError(
        'validation_error',
        `imagen demasiado grande (${String(file.size)} bytes)`,
        {
          formErrors: [`La imagen supera el máximo de ${String(MAX_BYTES / (1024 * 1024))} MB`],
          fieldErrors: {},
        },
      );
    }

    // Sube al StorageAdapter (calcula bytes+checksum) y persiste la fila `asset`.
    const bytes = new Uint8Array(await file.arrayBuffer());
    // `file.type` ya se estrechó a `AllowedMime` (isAllowedMime); el lookup acierta.
    const ext = MIME_TO_EXT[file.type];
    // storage_key con prefijo del dominio + nombre único: id ULID generado antes del
    // INSERT (db.md §1) para un key estable.
    const id = newUlid();
    const storageKey = `intake/${id}.${ext}`;
    const put = await getStorage().put(storageKey, bytes, { mime: file.type });

    const row = await createAsset(getDb(), {
      id,
      kind: 'reference_image',
      storageKey,
      mime: file.type,
      bytes: put.bytes,
      checksum: put.checksum,
    });

    const body = AssetUploadResponseSchema.parse({
      id: row.id,
      url: `/api/assets/${row.id}/download`,
    });
    return Response.json(body, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
});
