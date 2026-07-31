// `POST /api/assets` (T1.6 · imágenes; T6.2b · audio): upload de un asset del usuario.
// multipart/form-data (campo `file`; campo `kind` OPCIONAL) → StorageAdapter.put → fila
// `asset` → devuelve `{ id, url }` (la URL de descarga proxificada, api.md §7). Es un
// endpoint NUEVO (T0.5 solo cubría el download).
//
// KIND (T6.2b): el campo `kind` del form elige QUÉ clase de asset se crea, dentro de una
// allowlist CERRADA (`reference_image` | `music_bed`). Por DEFECTO `reference_image` — los
// callers existentes (intake manual, personas) no cambian ni una línea. `music_bed` es la
// pista de música licenciada que sube el usuario para usarla como bed de una variante
// (§14 `own_license`). Cada kind tiene su PROPIA allowlist de mime, cap de tamaño y prefijo
// de storage: un audio no comparte ni el mime ni el cap de una imagen.
//
// VALIDACIÓN (la única superficie de riesgo del upload): aunque sea mono-usuario
// autenticado, un upload sin límites es el riesgo. Se imponen tres barreras POR KIND:
//  - ALLOWLIST de mime: solo los tipos del kind (imágenes / audio). Nada más.
//  - CAP de tamaño por fichero (distinto por kind: un WAV pesa más que un JPEG).
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

// Los `kind` que ESTE endpoint sabe crear (allowlist CERRADA). Un `kind` fuera de esta
// unión es 400 validation_error — nunca se cuela un `final_video`/`keyframe` que solo el
// pipeline debe producir. `reference_image` es el default (callers de T1.6 sin `kind`).
const UploadKindSchema = z.enum(['reference_image', 'music_bed']);
type UploadKind = z.infer<typeof UploadKindSchema>;

// La CONFIG por kind: allowlist de mime→extensión (barrera de tipo Y fuente de la
// extensión en un solo mapa), cap de tamaño, y prefijo de storage. Un fichero fuera de
// las claves de mime de su kind es 400 validation_error — nunca llega al almacén.
interface KindConfig {
  // `string | undefined`: el lookup de un mime FUERA de la allowlist devuelve `undefined` (la barrera de
  // tipo). Con `Record<string, string>` a secas TS creería que todo mime resuelve y el `=== undefined` sería
  // «comparación imposible».
  mimeToExt: Record<string, string | undefined>;
  maxBytes: number;
  storagePrefix: string;
  /** Etiqueta legible del tipo de fichero para los mensajes de error. */
  label: string;
}

const KIND_CONFIG = {
  // Imagen de referencia del intake manual (T1.6): 8 MiB, imágenes.
  reference_image: {
    mimeToExt: {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/avif': 'avif',
    },
    maxBytes: 8 * 1024 * 1024,
    storagePrefix: 'intake',
    label: 'imagen',
  },
  // Bed musical propio (T6.2b): 32 MiB (un WAV/MP3 de ~60 s cabe holgado), audio. WAV
  // incluido porque el bed de ace-step ya es WAV y la normalización de canal de N8
  // (`aformat=channel_layouts=stereo`) trata cualquier bed igual (agnóstica al origen).
  music_bed: {
    mimeToExt: {
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/ogg': 'ogg',
    },
    maxBytes: 32 * 1024 * 1024,
    storagePrefix: 'music',
    label: 'audio',
  },
} as const satisfies Record<UploadKind, KindConfig>;

// El cap de BODY del precheck de Content-Length (413) usa el cap MÁS GRANDE de todos los
// kinds + margen de overhead del multipart: rechazar aquí evita bufferizar en RAM un body
// gigante ANTES de parsear el fichero. El cap REAL por kind se aplica después, sobre el
// fichero ya parseado.
const MAX_KIND_BYTES = Math.max(...Object.values(KIND_CONFIG).map((c) => c.maxBytes));
const MAX_BODY_BYTES = MAX_KIND_BYTES + 1024 * 1024;

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
          message: `El cuerpo de la petición supera el máximo de ${String(MAX_KIND_BYTES / (1024 * 1024))} MB`,
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

    // KIND: ausente → `reference_image` (contrato de T1.6, callers sin `kind`). Presente y
    // fuera de la allowlist cerrada → 400 (nunca crea un kind que el pipeline debe producir).
    const kindRaw = form.get('kind');
    const kindParsed = UploadKindSchema.safeParse(kindRaw ?? 'reference_image');
    if (!kindParsed.success) {
      throw new AppError(
        'validation_error',
        `kind de asset no permitido: ${typeof kindRaw === 'string' ? kindRaw : 'desconocido'}`,
        {
          formErrors: ['Solo se permiten los tipos: reference_image, music_bed'],
          fieldErrors: {},
        },
      );
    }
    const kind = kindParsed.data;
    // Anotado como `KindConfig` (no el literal union `KIND_CONFIG[kind]`): así `mimeToExt` es un
    // `Record` indexable por `string`, no la unión de shapes literales que TS rechaza indexar.
    const config: KindConfig = KIND_CONFIG[kind];

    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new AppError('validation_error', 'falta el fichero (campo `file`)', {
        formErrors: [`Selecciona un fichero (${config.label})`],
        fieldErrors: {},
      });
    }

    // ALLOWLIST de mime del KIND: solo los tipos que ese kind admite.
    const ext = config.mimeToExt[file.type];
    if (ext === undefined) {
      const allowed = Object.keys(config.mimeToExt).join(', ');
      throw new AppError(
        'validation_error',
        `tipo de ${config.label} no permitido: ${file.type || 'desconocido'}`,
        {
          formErrors: [`Tipos permitidos para ${config.label}: ${allowed}`],
          fieldErrors: {},
        },
      );
    }

    // CAP de tamaño del KIND: rechaza ANTES de leer los bytes al almacén.
    if (file.size > config.maxBytes) {
      throw new AppError(
        'validation_error',
        `${config.label} demasiado grande (${String(file.size)} bytes)`,
        {
          formErrors: [
            `El fichero supera el máximo de ${String(config.maxBytes / (1024 * 1024))} MB`,
          ],
          fieldErrors: {},
        },
      );
    }

    // Sube al StorageAdapter (calcula bytes+checksum) y persiste la fila `asset`.
    const bytes = new Uint8Array(await file.arrayBuffer());
    // storage_key con prefijo del dominio + nombre único: id ULID generado antes del
    // INSERT (db.md §1) para un key estable.
    const id = newUlid();
    const storageKey = `${config.storagePrefix}/${id}.${ext}`;
    const put = await getStorage().put(storageKey, bytes, { mime: file.type });

    const row = await createAsset(getDb(), {
      id,
      kind,
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
