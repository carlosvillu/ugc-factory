// FINALIZER SINGLE-CALL-PER-SECOND COMPARTIDO bajo lock (T4.11, deuda T4.8a + fold de altitud T4.11). El
// tail de liquidación de una generación de UNA sola llamada fal facturada POR SEGUNDO estaba DUPLICADO
// byte-a-byte (salvo `asset.kind` y la derivación de duración) entre `runGenerateAvatar` (N7c, avatar),
// `runGenerateBroll` (N7d, broll) y `runGenerateMusic` (N7e, música). Se extrae aquí — molde del
// finalizer de imagen `finalizeGeneration` (T4.2), pero para el output de vídeo/audio y con `kind`
// parametrizado.
//
// EL NOMBRE HONESTO. Antes se llamaba `finalizeVideoGeneration`, pero su tipo YA era
// `SingleCallPerSecondAssetKind` (incluía `music_bed`) y la vía del sweeper YA liquidaba música por
// aquí: "Video" era deshonesto. T4.11 funde también el path LIVE de `runGenerateMusic` por este helper
// (era el TERCER clon) y renombra a `finalizeSingleCallPerSecondGeneration` — lo que de verdad hace:
// UNA llamada fal → coste `unit:'seconds'` → UN asset → `completed` bajo lock, para cualquiera de los
// tres `assetKind`.
//
// POR QUÉ NO REUSAR `finalizeGeneration`. Ese es el finalizer SOLO-IMAGEN (`extractImageOutput` +
// `kind:'keyframe'`), COMPARTIDO por 4 callers concurrentes de imagen (webhook+poll+sweeper+redelivery)
// con blast radius enorme. Su unidad de coste es POR IMAGEN, no por segundo, y no divide `assetKind`.
// Mantener `finalizeGeneration` intacto es la invariante que importa.
//
// QUÉ SE PARAMETRIZA vs QUÉ NO:
//   · `assetKind`: `'avatar_clip'` (N7c) | `'broll_clip'` (N7d) | `'cta_clip'` (N7f, T5.5a: mismo
//     servicio `runGenerateBroll` con el kind del clip de CTA) | `'music_bed'` (N7e) — la ÚNICA
//     divergencia de datos.
//   · `durationSeconds`: se pasa YA CALCULADA por el servicio (avatar: `videoOut.duration ?? audio`,
//     fraccionaria; broll: `input.durationSeconds`, enum entero; música: `input.durationSeconds`, el
//     número enviado a ace-step). La DERIVACIÓN se queda por servicio; aquí solo se persiste. `quantity`
//     = `Math.round(durationSeconds)` (integer del ledger): en broll/música el round es idempotente
//     (duración entera); en avatar redondea la fraccionaria — el `amount_cents` ya se computó desde la
//     duración EXACTA (`falVideoCostOf`/`falMusicCostOf`), este es solo el rastro granular.
//   · el catch de degradación (`degradeGenerationOnError`) se extrae aparte: PRESERVA la distinción
//     anti-T1.8 (el error de fal — causa raíz — SIEMPRE sobrevive; el fallo de la tx de degradación se
//     LOGUEA pero NUNCA se propaga en su lugar).
import type { Logger, StorageAdapter } from '@ugc/core';
import { FalResponseError } from '@ugc/core/generation';
import {
  createAsset,
  getAssetByGenerationKind,
  getGenerationForUpdate,
  recordCost,
  updateGeneration,
  type Asset,
  type DbClient,
  type Generation,
} from '@ugc/db';

/** El `kind` de asset que este finalizer crea: los tres deliverables de UNA llamada fal facturada POR
 *  SEGUNDO — `avatar_clip` (N7c), `broll_clip` (N7d, vídeo) y `music_bed` (N7e, audio). A nivel de
 *  HELPER las tres son la MISMA operación: UNA llamada fal → coste `unit:'seconds'` → UN asset →
 *  `completed` bajo lock. Lo consumen los servicios LIVE (avatar/broll/música) Y la vía de
 *  reconciliación kind-aware de `output.download` (finalize-download.ts).
 *  Interno (no se re-exporta desde el barrel): solo lo consumen las firmas de este módulo. */
type SingleCallPerSecondAssetKind = 'avatar_clip' | 'broll_clip' | 'cta_clip' | 'music_bed';

export interface FinalizeSingleCallPerSecondDeps {
  db: DbClient;
  logger: Logger;
}

export interface FinalizeSingleCallPerSecondArgs {
  /** La fila `generation` viva (en `submitted`, tras el poll a completed). */
  generation: Generation;
  /** El `kind` del asset a crear (`avatar_clip`/`broll_clip`/`music_bed`). */
  assetKind: SingleCallPerSecondAssetKind;
  /** La duración en segundos, YA derivada por el servicio (avatar: output/audio; broll/música: input). */
  durationSeconds: number;
  /** El coste en céntimos (por segundo), YA computado por el servicio (`falVideoCostOf`/`falMusicCostOf`). */
  costCents: number;
  /** El resultado de `storage.put` del .mp4/.mp3 ya descargado a nuestro storage. */
  put: Awaited<ReturnType<StorageAdapter['put']>>;
  /** La `storageKey` bajo la que se guardó el fichero. */
  storageKey: string;
  /** El mime del asset (`video/mp4`, `audio/mpeg`…). */
  mime: string;
  /** LINAJE (§12 `asset.parent_asset_ids`): los ids de los assets ORIGEN de los que deriva este clip.
   *  OPCIONAL, default `[]` (la mayoría de outputs de fal no tienen padres). N7f (T5.5a) pasa aquí el
   *  keyframe de N7a que se animó — el linaje que T5.7 recorre. Se aplica SOLO en la rama de CREACIÓN:
   *  en la rama `alreadyFinalized`/reuse el asset es el del GANADOR (dedup §9.6), y mutar su linaje
   *  corromperia una fila compartida — la creación es el único punto correcto (el reuse nunca crea). */
  parentAssetIds?: string[];
  /** El último payload de status del poll (para `fal_status_payload`). */
  statusPayload: unknown;
}

export interface FinalizeSingleCallPerSecondResult {
  /** La fila `generation` finalizada (`completed`). */
  generation: Generation;
  /** El id del asset. NUNCA null: si la rama `alreadyFinalized` no encuentra el asset ajeno, se LANZA
   *  (invariante roto) en vez de devolver null — una generación `completed` DEBE tener su asset. */
  assetId: string;
}

/**
 * LIQUIDA una generación single-call-per-second (avatar/broll/música) en UNA tx BAJO EL LOCK DE FILA
 * (misma barrera anti-doble-cobro que `finalizeGeneration`): re-chequea `completed` bajo el lock antes
 * de crear asset/coste/completed. Si otra ruta ya finalizó (mundo concurrente de T4.11:
 * webhook+poll+sweeper), NO-OP GRACIOSO — devuelve el asset ajeno SIN re-crear ni re-cobrar y, crítico,
 * SIN lanzar (un throw caería en el catch del servicio y VOLTEARÍA a `failed` una fila legítimamente
 * `completed`). Tras la tx valida el invariante `assetId !== null` (una `completed` DEBE tener su
 * asset): si falla, LANZA — el catch del servicio NO la degradará (su UPDATE es condicional a
 * `!= completed`). Descarga + `storage.put` quedan FUERA de este helper (los hace el servicio antes):
 * sostener un lock de BD durante la descarga serializaría el worker.
 */
export async function finalizeSingleCallPerSecondGeneration(
  deps: FinalizeSingleCallPerSecondDeps,
  args: FinalizeSingleCallPerSecondArgs,
): Promise<FinalizeSingleCallPerSecondResult> {
  const { db, logger } = deps;
  const { generation, assetKind, durationSeconds, costCents, put, storageKey, mime } = args;
  const completedAt = new Date();

  const settled = await db.transaction(async (tx) => {
    const locked = await getGenerationForUpdate(tx, generation.id);
    if (locked?.status === 'completed') {
      // NO-OP GRACIOSO (como `finalizeGeneration`): otra ruta ya finalizó bajo el lock. NO se re-crea
      // asset ni se re-cobra, y —crítico— NO se lanza (un throw voltearía a `failed` una fila
      // legítimamente `completed`). El .mp4 que ESTA llamada descargó queda huérfano en storage (deuda
      // menor conocida, igual que en `finalizeGeneration`).
      const existing: Asset | undefined = await getAssetByGenerationKind(
        tx,
        generation.id,
        assetKind,
      );
      return { asset: existing ?? null, updated: locked, alreadyFinalized: true } as const;
    }
    const asset = await createAsset(tx, {
      kind: assetKind,
      storageKey,
      mime,
      bytes: put.bytes,
      checksum: put.checksum,
      durationS: durationSeconds,
      generationId: generation.id,
      // LINAJE §12 (solo en la rama de creación): default `[]` deja las filas de N7c/N7d/N7e intactas
      // (mismo comportamiento previo); N7f pasa el keyframe de N7a que se animó.
      ...(args.parentAssetIds !== undefined ? { parentAssetIds: args.parentAssetIds } : {}),
    });
    await recordCost(tx, {
      provider: 'fal',
      amountCents: costCents,
      // `quantity` es INTEGER en el ledger → segundos ENTEROS (redondeados); `amount_cents` YA se
      // computó desde la duración EXACTA por segundo (`falVideoCostOf`/`falMusicCostOf`), rastro granular.
      quantity: Math.round(durationSeconds),
      unit: 'seconds',
      ...(generation.stepRunId !== null ? { stepRunId: generation.stepRunId } : {}),
      generationId: generation.id,
    });
    const updated = await updateGeneration(tx, generation.id, {
      status: 'completed',
      costActual: costCents,
      falStatusPayload: args.statusPayload,
      durationS: durationSeconds,
      completedAt,
    });
    return { asset, updated, alreadyFinalized: false } as const;
  });

  const assetId = settled.asset?.id ?? null;
  if (assetId === null) {
    // La rama `alreadyFinalized` no encontró el asset de la ruta ganadora: invariante roto (una
    // generación `completed` DEBE tener su asset). Surface honesto — pero NO se marca `failed` (la fila
    // está legítimamente `completed`): se re-lanza y el catch del servicio NO la degradará (su UPDATE es
    // condicional a `!= completed`).
    throw new FalResponseError(
      `finalizeSingleCallPerSecondGeneration: la generación ${generation.id} está completed pero sin asset ${assetKind} (invariante roto)`,
    );
  }

  logger.info(
    {
      event: 'fal_single_call_per_second_generation_finalized',
      generationId: generation.id,
      assetId,
      assetKind,
      costCents,
      durationSeconds,
      alreadyFinalized: settled.alreadyFinalized,
    },
    'asset single-call-per-second generado: descargado, coste por segundo registrado, completed',
  );

  return { generation: settled.updated, assetId };
}

/**
 * Degrada una generación a `failed` tras un fallo de fal, SIN ENTERRAR LA CAUSA RAÍZ (lección T1.8).
 * Marca `failed` SOLO si la fila NO es ya terminal (`completed`): una ruta concurrente (T4.11) pudo
 * haberla completado legítimamente (mismo criterio de gracia que la rama `alreadyFinalized`). Si la tx
 * de degradación LANZA (conexión caída/timeout justo en el fallo), ese error secundario NO se propaga:
 * se LOGUEA (observabilidad del daño colateral) y el caller re-lanza SIEMPRE el `err` ORIGINAL (la causa
 * raíz de fal), nunca el error de la degradación. El caller usa este helper en su `catch` y hace
 * `throw err` después.
 */
export async function degradeGenerationOnError(
  deps: FinalizeSingleCallPerSecondDeps,
  args: { generationId: string; originalError: unknown; event: string },
): Promise<void> {
  const { db, logger } = deps;
  try {
    await db.transaction(async (tx) => {
      const locked = await getGenerationForUpdate(tx, args.generationId);
      if (locked !== undefined && locked.status !== 'completed') {
        await updateGeneration(tx, args.generationId, {
          status: 'failed',
          completedAt: new Date(),
        });
      }
    });
  } catch (degradeErr) {
    logger.error(
      {
        event: args.event,
        generationId: args.generationId,
        degradeError: degradeErr instanceof Error ? degradeErr.message : String(degradeErr),
        originalError:
          args.originalError instanceof Error
            ? args.originalError.message
            : String(args.originalError),
      },
      'no se pudo marcar la generación como failed tras un fallo de fal: la fila puede quedar en un estado no terminal (reconciliable por el sweeper)',
    );
  }
}
