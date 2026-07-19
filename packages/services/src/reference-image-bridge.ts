// PUENTE URL→ASSET de las fotos hero del brief (T4.4b, N7a ruta de referencias, deuda planning:299/357).
//
// POR QUÉ EXISTE. La ruta de referencias reales de N7a (`upload_images`/`promote_scraped`) toma las
// fotos hero que viven en `brief.assets` como URLs (subidas por el usuario en CP1 o promovidas de una
// imagen scrapeada) y las manda a `fal-ai/bytedance/seedream/v4.5/edit` como `image_urls`. fal NO lee
// nuestras URLs ni nuestro storage: exige subir el input a SU storage (`uploadInput` → fal-url). Y
// `uploadInputCached` (T4.1, la caché §9.6 de subida a fal) opera sobre una FILA `asset` de NUESTRO
// storage (necesita `assetId`+`storageKey`+`fal_url`). Entre «una URL del brief» y «una fila asset
// subible a fal» faltaba un puente — este módulo lo tiende: descarga la URL a bytes, los normaliza a
// PNG y crea la fila `asset` (`kind:'product_image'`).
//
// DOS COSAS QUE ESTE PUENTE HACE Y POR QUÉ (ambas son SCOPE de T4.4b, no deuda diferida):
//
//  1. RE-VALIDACIÓN ANTES DE GASTAR (planning:352). Una URL que respondía 200 cuando CP1 la eligió
//     puede dar 403/404 cuando N7a corre (CDN efímero, hotlink protection de AliExpress, etc.). Si el
//     hero no se puede DESCARGAR, este puente REHÚSA con `HeroReferenceUnavailableError` — ANTES de
//     cualquier `submit` a fal. Rehusar aquí evita el anti-patrón del proyecto: gastar dinero en fal
//     para descubrir a mitad que la referencia ya no existe. Es un fallo DETERMINISTA y NO-reintentable
//     (re-descargar un 403 da 403): el executor lo mapea a `PermanentStepError`.
//
//  2. NORMALIZACIÓN A PNG (defensa AVIF). Las fotos hero pueden venir en AVIF (miniaturas de CDN).
//     `fal-ai/bytedance/seedream/v4.5/edit` NO documenta soporte AVIF, así que en vez de arriesgar un
//     4xx de formato (que se disfrazaría de «label ilegible»), se re-codifica SIEMPRE a PNG con
//     `rescaleImage` (@ugc/core/analyze, ya AVIF→PNG, puro). `withoutEnlargement` preserva la
//     resolución del input (una miniatura 220px sigue 220px — no se amplía basura), solo cambia el
//     contenedor a PNG. Un input corrupto/no-imagen hace que `sharp` lance → se traduce a
//     `HeroReferenceUnavailableError` (misma familia: la referencia no es usable, no se gasta).
import { rescaleImage } from '@ugc/core/analyze';
import { newUlid } from '@ugc/core/contracts';
import type { Logger, StorageAdapter } from '@ugc/core';
import { createAsset, type Asset, type DbClient } from '@ugc/db';

import { NOOP_LOGGER } from './noop-logger';

/**
 * La referencia hero del brief NO se puede materializar en un asset subible a fal: la descarga falló
 * (404/403/timeout/red) o los bytes no son una imagen decodificable. Es DETERMINISTA y NO-reintentable
 * (re-descargar un 403 vuelve a dar 403), y ocurre ANTES de cualquier gasto en fal — el executor la
 * mapea a `PermanentStepError` (rehúsa el step sin re-pagar). Clase PROPIA (no `FalResponseError`) para
 * NO confundir «la referencia de entrada no existe» con «fal devolvió un output malformado»: son fallos
 * de capas distintas y colapsarlos degradaría la observabilidad (anti-patrón T1.8).
 */
export class HeroReferenceUnavailableError extends Error {
  /** El status HTTP de la descarga fallida, si lo hubo (undefined en timeout/red/decode). */
  readonly status: number | undefined;
  constructor(message: string, opts: { status?: number } = {}) {
    super(message);
    this.name = 'HeroReferenceUnavailableError';
    this.status = opts.status;
  }
}

export interface ReferenceImageBridgeDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** `fetch` inyectable (msw en tests); default global en producción. Descarga la URL del brief. */
  fetch?: typeof globalThis.fetch;
  logger?: Logger;
}

/** Una foto hero materializada como fila `asset` de nuestro storage, lista para `uploadInputCached`. */
export interface BridgedReferenceImage {
  assetId: string;
  storageKey: string;
  /** `null` SIEMPRE al recién crear (la caché de upload a fal aún no se pobló); `uploadInputCached`
   *  la estampará en la primera subida. Se devuelve para pasarlo tal cual a `uploadInputCached`. */
  falUrl: string | null;
  mime: string;
  bytes: number;
}

/**
 * Descarga UNA URL de referencia (foto hero del brief), re-valida que es descargable (planning:352),
 * la normaliza a PNG (defensa AVIF) y la persiste como fila `asset` (`kind:'product_image'`) de nuestro
 * storage. Devuelve el asset listo para `uploadInputCached`. LANZA `HeroReferenceUnavailableError` si la
 * URL no se puede descargar o los bytes no son una imagen — ANTES de cualquier gasto en fal.
 *
 * `briefId` solo se usa para el `storageKey` (namespacing legible); no se lee de BD aquí.
 */
export async function bridgeReferenceImageUrl(
  deps: ReferenceImageBridgeDeps,
  args: { url: string; briefId: string },
): Promise<BridgedReferenceImage> {
  const log = deps.logger ?? NOOP_LOGGER;
  const doFetch = deps.fetch ?? globalThis.fetch;

  // 1) RE-VALIDACIÓN: descargar la URL. Un status de error o un fallo de red = referencia no usable →
  //    REHÚSA (sin gastar en fal). Se distingue el status HTTP (accionable en el log) del fallo de red.
  let res: Response;
  try {
    res = await doFetch(args.url);
  } catch (err) {
    throw new HeroReferenceUnavailableError(
      `referencia hero no descargable (${args.url}): fallo de red — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new HeroReferenceUnavailableError(
      `referencia hero no descargable (${args.url}): HTTP ${String(res.status)}`,
      { status: res.status },
    );
  }
  const rawBytes = new Uint8Array(await res.arrayBuffer());
  if (rawBytes.byteLength === 0) {
    throw new HeroReferenceUnavailableError(
      `referencia hero vacía (${args.url}): 0 bytes descargados`,
    );
  }

  // 2) NORMALIZAR A PNG (defensa AVIF). `rescaleImage` re-codifica a PNG conservando la resolución
  //    (withoutEnlargement: una miniatura 220px sigue 220px). Un input no-imagen hace que sharp lance →
  //    misma familia de error: la referencia no es usable, no se gasta.
  let png: { data: Uint8Array; mime: string };
  try {
    png = await rescaleImage(rawBytes);
  } catch (err) {
    throw new HeroReferenceUnavailableError(
      `referencia hero no decodificable (${args.url}): no es una imagen válida — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3) PERSISTIR el asset en NUESTRO storage (fal no lo lee; `uploadInputCached` lo subirá después).
  const assetId = newUlid();
  const storageKey = `briefs/${args.briefId}/references/${assetId}.png`;
  const put = await deps.storage.put(storageKey, png.data, { mime: png.mime });
  const asset: Asset = await createAsset(deps.db, {
    id: assetId,
    kind: 'product_image',
    storageKey,
    mime: png.mime,
    bytes: put.bytes,
    checksum: put.checksum,
  });

  log.info(
    {
      event: 'reference_image_bridged',
      assetId: asset.id,
      briefId: args.briefId,
      sourceUrl: args.url,
      bytes: put.bytes,
    },
    'foto hero del brief descargada, normalizada a PNG y materializada como asset subible a fal',
  );

  return {
    assetId: asset.id,
    storageKey: asset.storageKey,
    falUrl: asset.falUrl,
    mime: asset.mime,
    bytes: asset.bytes,
  };
}
