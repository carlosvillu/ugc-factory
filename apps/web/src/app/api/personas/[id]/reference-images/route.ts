// `POST /api/personas/:id/reference-images` — T2.0: upload MANUAL de una imagen de referencia
// (identity lock, §11), con la VALIDACIÓN ≥2K.
//
// ¿POR QUÉ NO SE REUSA `POST /api/assets` (T1.6)? Porque el requisito es distinto y meterlo allí
// lo rompería: aquel endpoint sube las imágenes del INTAKE MANUAL (fotos del producto que el
// usuario tiene en el móvil) y NO puede exigir 2K — una foto de producto de 1200px es
// perfectamente utilizable. La referencia de identity lock SÍ lo exige (§11), porque de su
// resolución depende que el avatar mantenga la cara entre escenas. Dos requisitos, dos rutas.
// Lo que sí se reutiliza es TODO lo demás: el StorageAdapter y la fila `asset` (T0.5) — no se
// reinventa ni el almacenamiento ni el download proxificado (`/api/assets/:id/download` sirve
// estas imágenes igual que las demás).
//
// LA VALIDACIÓN ≥2K NO VIVE AQUÍ: vive en `validateReferenceImage` (@ugc/core/persona), que LEE
// LAS DIMENSIONES DEL FICHERO con sharp. Este handler le pasa los BYTES; no puede mentirle
// diciendo «mide 2048». Es el mismo guard que ejecuta el seed — el arnés no es más cómodo que
// la realidad (principio 9 de la skill testing).
import { z } from 'zod';
import { AppError, newUlid, UlidSchema } from '@ugc/core/contracts';
// De `persona/server` (NO del barrel `persona`): usa sharp, y el barrel lo importa el
// navegador — meter sharp ahí rompe el build del cliente (lo cazó el E2E). Ver `persona/server.ts`.
import { validateReferenceImage } from '@ugc/core/persona/server';
import { addReferenceImage, createAsset, getPersona } from '@ugc/db';
import { getDb, toErrorResponse } from '@/server';
import { getStorage } from '@/server/storage';
import { withAuth } from '@/server/with-auth';
import { toPersonaResponse } from '@/server/persona-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cap de tamaño por fichero. Más generoso que el del intake (8 MiB) porque una referencia ≥2K
 *  pesa de por sí: un PNG de 2048×2560 sin comprimir ronda los 5–15 MB. */
const MAX_BYTES = 24 * 1024 * 1024;
/** Cap del BODY para el precheck de Content-Length: el cap de fichero + margen del multipart
 *  (misma defensa del heap que en `POST /api/assets`: `formData()` bufferiza el body ENTERO). */
const MAX_BODY_BYTES = MAX_BYTES + 1024 * 1024;

/** Allowlist de mime → extensión. Solo formatos que `sharp` decodifica y que sirven de
 *  referencia fotográfica. Sin GIF (animado, no es un retrato). */
const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
} as const;
type AllowedMime = keyof typeof MIME_TO_EXT;

function isAllowedMime(mime: string): mime is AllowedMime {
  return mime in MIME_TO_EXT;
}

const ParamsSchema = z.object({ id: UlidSchema });

/** `safeParse` sobre la ENTRADA (api.md §1: nunca `.parse` a pelo sobre input del cliente): un
 *  `:id` que no es un ULID es un 400 tipado, no un 500 con stack trace. */
function parseParams(raw: unknown): z.infer<typeof ParamsSchema> {
  const result = ParamsSchema.safeParse(raw);
  if (!result.success) {
    throw new AppError(
      'validation_error',
      'el id de persona no es válido',
      z.flattenError(result.error),
    );
  }
  return result.data;
}

// NO usa `withRoute` (el body es multipart, no JSON): construye su try/catch delegando en
// `toErrorResponse` para el envelope único — mismo patrón que `POST /api/assets` (api.md §1).
export const POST = withAuth(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> => {
    try {
      const { id: personaId } = parseParams(await ctx.params);

      const persona = await getPersona(getDb(), personaId);
      if (!persona) throw new AppError('not_found', 'persona no encontrada');

      // PRECHECK del heap ANTES de bufferizar el multipart entero.
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
          formErrors: ['Selecciona una imagen de referencia'],
          fieldErrors: {},
        });
      }

      if (!isAllowedMime(file.type)) {
        throw new AppError(
          'validation_error',
          `tipo de imagen no permitido: ${file.type || 'desconocido'}`,
          {
            formErrors: ['Solo se permiten imágenes JPEG, PNG, WebP o AVIF'],
            fieldErrors: {},
          },
        );
      }

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

      const bytes = new Uint8Array(await file.arrayBuffer());

      // ── EL GUARD ≥2K (§11 identity lock) ────────────────────────────────────
      // Lee las dimensiones DEL FICHERO (sharp) y lanza `validation_error` con un mensaje que
      // dice cuánto mide y cuánto hace falta. Va ANTES de tocar el almacén: una imagen
      // rechazada no deja ni un byte en disco ni una fila en la BD.
      const dims = await validateReferenceImage(bytes);

      const assetId = newUlid();
      const storageKey = `personas/${personaId}/${assetId}.${MIME_TO_EXT[file.type]}`;
      const put = await getStorage().put(storageKey, bytes, { mime: file.type });

      const db = getDb();
      await createAsset(db, {
        id: assetId,
        kind: 'reference_image',
        storageKey,
        mime: file.type,
        bytes: put.bytes,
        checksum: put.checksum,
      });
      const updated = await addReferenceImage(db, personaId, assetId);
      if (!updated) throw new AppError('not_found', 'persona no encontrada');

      // Se devuelve la PERSONA entera (no solo el asset): la ficha del navegador se repinta con
      // la lista de referencias ya actualizada, sin un segundo GET.
      return Response.json(
        {
          persona: toPersonaResponse(updated),
          image: {
            id: assetId,
            url: `/api/assets/${assetId}/download`, // el download proxificado de T0.5, sin cambios
            width: dims.width,
            height: dims.height,
          },
        },
        { status: 201 },
      );
    } catch (err) {
      return toErrorResponse(err);
    }
  },
);
