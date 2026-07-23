// `GET /api/variants/:id/bundle?audio=with_bed|no_bed` (T5.7, §9.7 N10 / §15.4): el EXPORT BUNDLE de una
// variante aprobada — un ZIP con el MP4 del máster + `metadata.json` (los metadatos de compliance:
// `ad_caption` ≤100 sin @/#/links, `brand_name` ≤20, hook/ángulo/duración/objetivo/plataforma, flags AIGC,
// audio_source, checklist §15.4). Es el botón «↓ descargar» del mockup 4c.
//
// EXPORT DUAL con/sin bed (§14): `audio=with_bed` empaqueta el MÁSTER FINAL persistido tal cual (orgánico,
// con bed); `audio=no_bed` empaqueta la versión SIN bed (paid). El bundle NO genera media en la request (web
// no corre ffmpeg/c2patool): sirve BYTES YA EN STORAGE, igual que `/api/assets/:id/download`. El máster con
// bed es `ad_variant.master_asset_id`; la versión sin bed es un asset PRE-MATERIALIZADO en la key convención
// `masters/:variantId/master-no-bed.mp4` (la produce `exportNoBedVersion` de @ugc/services; su cableado a un
// executor del worker es F6/N10 — deuda de fase anotada, misma forma que T5.5 difirió el executor N8/N9). Si
// esa versión no está materializada, la ruta responde 409 `invalid_transition` (no un 500 ni un bundle a medias).
//
// ⚠ DESVIACIÓN MENOR (regla 6, T5.7): `ad_caption` HOY se DERIVA del hook (no hay generador de copy de ad —
// es F6/N10); `brand_name` sale del brief. Ambos pasan `ExportBundleMetadataSchema` por construcción.
//
// ZIP DETERMINISTA: `zipSync` store-only (`level:0`) con `mtime` fijo por entrada → los mismos bytes de
// entrada dan el MISMO ZIP. El e2e no checksumea el ZIP (envoltorio) sino la ENTRADA MP4 extraída contra el
// `asset.checksum` real (paridad con assets-download).
import { zipSync, strToU8 } from 'fflate';
import { z } from 'zod';
import {
  AppError,
  UlidSchema,
  buildExportBundleMetadata,
  type AudioVersion,
  type BundleAudioSource,
} from '@ugc/core/contracts';
import { getAsset, getBrief, getVariantLineage } from '@ugc/db';
import { materializeToBytes, noBedStorageKey } from '@ugc/services';
import { getDb, withRoute } from '@/server';
import { getStorage } from '@/server/storage';
import { withAuth } from '@/server/with-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ParamsSchema = z.object({ id: UlidSchema });
const QuerySchema = z.object({
  audio: z.enum(['with_bed', 'no_bed']).default('with_bed'),
});

/** Extrae `product.{name, brand_name}` del brief (jsonb opaco) de forma TOLERANTE: si falta, defaults. */
const BriefProductShape = z.object({
  product: z
    .object({ name: z.string().optional(), brand_name: z.string().nullable().optional() })
    .optional(),
});

export const GET = withAuth(
  withRoute(
    async ({ params, query }) => {
      const db = getDb();
      const audioVersion: AudioVersion = query.audio;

      const lineage = await getVariantLineage(db, params.id);
      if (lineage === undefined) throw new AppError('not_found', 'variante no encontrada');
      // Solo variantes APROBADAS tienen bundle (§9.7 N10: «por variante aprobada»).
      if (lineage.variant.status !== 'approved') {
        throw new AppError(
          'invalid_transition',
          'la variante no está aprobada: no hay bundle que exportar',
        );
      }
      if (lineage.variant.masterAssetId === null || lineage.master === null) {
        throw new AppError('invalid_transition', 'la variante no tiene máster compuesto');
      }

      const storage = getStorage();

      // 1) RESOLVER EL MP4 según la versión de audio (§14).
      let mp4Bytes: Uint8Array;
      let mp4Checksum: string;
      if (audioVersion === 'with_bed') {
        // El máster final persistido tal cual (ya firmado, con bed).
        const master = await getAsset(db, lineage.variant.masterAssetId);
        if (master === undefined) throw new AppError('not_found', 'máster no encontrado');
        mp4Bytes = await materializeToBytes(storage, master.storageKey);
        mp4Checksum = master.checksum;
      } else {
        // La versión SIN bed: asset pre-materializado en la key convención. Si no está, 409 not_ready.
        const key = noBedStorageKey(params.id);
        const stat = await storage.stat(key);
        if (stat === null) {
          throw new AppError(
            'invalid_transition',
            'la versión sin bed (paid) aún no está materializada para esta variante',
          );
        }
        mp4Bytes = await materializeToBytes(storage, key);
        mp4Checksum = stat.checksum;
      }

      // 2) CONSTRUIR el JSON de metadatos (validado por su schema en `buildExportBundleMetadata`).
      const brief = await getBrief(db, lineage.batch.briefId);
      const parsedBrief = brief ? BriefProductShape.safeParse(brief.data) : undefined;
      const product = parsedBrief?.success ? parsedBrief.data.product : undefined;

      const hookText = lineage.hook?.text ?? lineage.variant.angleName;
      const metadata = buildExportBundleMetadata({
        variantId: lineage.variant.id,
        filenameCode: lineage.variant.filenameCode,
        hookText,
        angleName: lineage.variant.angleName,
        durationSeconds: lineage.variant.durationTarget,
        objective: lineage.batch.objective as 'hook_test',
        platforms: lineage.variant.platformTargets,
        destination: lineage.batch.destination as 'both',
        audioVersion,
        variantAudioSource: lineage.variant.audioSource as BundleAudioSource | null,
        c2paSigned: true,
        brief: {
          name: product?.name ?? lineage.variant.filenameCode,
          brand_name: product?.brand_name ?? null,
        },
      });

      // 3) EMPAQUETAR el ZIP determinista (store-only, mtime fijo). El nombre del MP4 lleva el sufijo de la
      //    versión de audio para que las dos salidas del dual no colisionen al descargarlas juntas.
      const suffix = audioVersion === 'no_bed' ? '-nobed' : '';
      const mp4Name = `${lineage.variant.filenameCode}${suffix}.mp4`;
      const FIXED_MTIME = new Date('2020-01-01T00:00:00Z');
      const zipped = zipSync(
        {
          [mp4Name]: [mp4Bytes, { level: 0, mtime: FIXED_MTIME }],
          'metadata.json': [
            strToU8(JSON.stringify(metadata, null, 2)),
            { level: 0, mtime: FIXED_MTIME },
          ],
        },
        { level: 0 },
      );

      // El checksum del MP4 viaja en una cabecera para que el cliente (y el e2e) puedan verificarlo sin
      // descomprimir dos veces — es el checksum del PRODUCTOR real (fila `asset`), no un valor inventado.
      return new Response(zipped, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': String(zipped.byteLength),
          'Content-Disposition': `attachment; filename="${lineage.variant.filenameCode}${suffix}.zip"`,
          'X-Bundle-Mp4-Checksum': mp4Checksum,
          'X-Bundle-Mp4-Name': mp4Name,
          'Cache-Control': 'private, no-store',
        },
      });
    },
    { params: ParamsSchema, query: QuerySchema },
  ),
);
