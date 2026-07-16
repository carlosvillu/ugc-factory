// `finalizeGeneration` (T4.2, §9.6): el TAIL compartido de una generación de imagen — validar el
// output → descargar el PNG a NUESTRO storage → registrar el `cost_entry` → liquidar la fila como
// `completed`. Lo llaman DOS caminos:
//   1. `runGenerate` (T4.1, camino POLLING): tras pollear hasta COMPLETED, con el output leído de
//      `response_url`.
//   2. El consumer `output.download` (T4.2, camino WEBHOOK): tras que el webhook handler persistió
//      el `fal_status_payload`, con el output que fal mandó en el webhook.
// Extraer este helper evita DUPLICAR el tail en el consumer (simplify lo marcaría): una sola verdad
// sobre "de output de fal a asset + coste + completed".
//
// IDEMPOTENCIA (crítico: NO doble-cobro). fal reintenta 10×/2 h y pg-boss redelivera → este tail
// puede re-entrar. Dos barreras:
//   · El caller (consumer) NO-OPEA si la generación ya está `completed` ANTES de llamar.
//   · asset + cost + completed van en UNA transacción: un crash a media deja "no completed, sin
//     asset, sin cost" (la re-entrega rehace todo limpio), NUNCA "cost registrado pero no completed"
//     (que re-cobraría al reintentar).
//
// LANZA en fallo (output fuera de contrato, descarga caída) — NO se auto-marca `failed`. Cada
// caller decide: `runGenerate` mapea a `failed` terminal (su contrato de T4.1); el consumer deja
// que el throw propague para que pg-boss reintente con backoff (una descarga caída es transitoria).
import { newUlid } from '@ugc/core/contracts';
import { extractImageOutput, FalResponseError } from '@ugc/core/generation';
import { ModelCostSchema } from '@ugc/core/gallery';
import type { Logger, StorageAdapter } from '@ugc/core';
import {
  createAsset,
  getGenerationForUpdate,
  getModelProfile,
  recordCost,
  updateGeneration,
  type DbClient,
  type Generation,
} from '@ugc/db';

import { falImageCostOf } from './fal-pricing';

/** El puerto de red que `finalizeGeneration` necesita: solo descargar la URL de output de fal.
 *  El `FalClient` de core lo cumple (`download`), pero se declara mínimo para no acoplar el tail al
 *  cliente entero — el consumer del webhook puede inyectar un download más simple si quisiera. */
export interface OutputDownloader {
  /** Descarga la URL de output (pública, firmada) y devuelve la `Response` con `body` streameable. */
  download(url: string): Promise<Response>;
}

export interface FinalizeDeps {
  db: DbClient;
  storage: StorageAdapter;
  downloader: OutputDownloader;
  logger: Logger;
}

export interface FinalizeResult {
  generation: Generation;
  /** El asset del PNG, o `null` cuando otra liquidación concurrente ya llevó la fila a `completed`
   *  bajo el lock FOR UPDATE (esta llamada perdió la carrera y NO escribió asset/cost/completed).
   *  `assetId === null` ES la señal de "ya estaba finalizada": el blob que ESTA llamada descargó
   *  queda huérfano en storage (deuda menor conocida). No-null ⇒ esta llamada finalizó la generación. */
  assetId: string | null;
  falOutputUrl: string;
  costCents: number;
  warnings: string[];
}

/**
 * Liquida una generación desde el OUTPUT de fal (venga del poll o del webhook). Valida el output,
 * descarga el PNG a nuestro storage, registra el coste y marca `completed` — TODO en una sola
 * transacción para que la re-entrada sea segura. `output` es el payload OPACO de fal (`{ images:
 * [...] }`); `statusPayload` es lo que se persiste en `fal_status_payload` (el status del poll o el
 * body del webhook). LANZA (FalResponseError/FalProviderError) si el output no cumple o la descarga
 * falla — el caller decide el estado de fallo.
 */
export async function finalizeGeneration(
  deps: FinalizeDeps,
  args: { generation: Generation; output: unknown; statusPayload: unknown },
): Promise<FinalizeResult> {
  const { db, storage, downloader, logger } = deps;
  const { generation } = args;
  const warnings: string[] = [];

  // 1) Validar el output (rama de VALIDACIÓN §9.6: fal ya respondió/facturó, pero el contrato debe
  //    cumplirse). Un output sin `images[]` es `FalResponseError` (no reintentable por red).
  const parsed = extractImageOutput(args.output);
  if (parsed === null) {
    throw new FalResponseError(
      `finalizeGeneration: el output de la generación ${generation.id} no trae images[]: ${JSON.stringify(args.output)}`,
    );
  }
  const firstImage = parsed.images[0];
  if (firstImage === undefined) {
    throw new FalResponseError(
      `finalizeGeneration: el output de la generación ${generation.id} no trae imágenes`,
    );
  }
  const falOutputUrl = firstImage.url;

  // 2) Precio del perfil (para el `cost_entry`). Se lee FUERA de la tx (solo lectura); si el perfil
  //    o su `cost` no valida, se degrada a 0 con warning — la llamada de pago YA ocurrió, la fila se
  //    escribe igual (record-first, mismo criterio que runGenerate).
  const profile = await getModelProfile(db, generation.modelProfileId);
  const costParsed = profile
    ? ModelCostSchema.safeParse(profile.cost)
    : { success: false as const };
  const cost = costParsed.success
    ? falImageCostOf({
        output: parsed,
        unit: costParsed.data.unit,
        centsPerUnit: costParsed.data.amountCents,
      })
    : {
        cents: 0,
        megapixels: 0,
        imageCount: parsed.images.length,
        warning: 'fal-pricing: model_profile.cost inválido o ausente',
      };
  if (cost.warning !== null) warnings.push(cost.warning);

  // 3) DESCARGAR el output a NUESTRO storage. Fuera de la tx (I/O de red potencialmente de cientos
  //    de MB): un lock de BD abierto durante la descarga serializaría el worker. El asset se escribe
  //    DENTRO de la tx de abajo, después de que los bytes estén en storage.
  const outRes = await downloader.download(firstImage.url);
  if (outRes.body === null) {
    throw new FalResponseError(
      `finalizeGeneration: el output ${firstImage.url} no trae cuerpo descargable`,
    );
  }
  const mime = firstImage.content_type ?? 'image/png';
  const ext = mime.includes('jpeg') ? 'jpg' : 'png';
  const storageKey = `generations/${generation.id}/${newUlid()}.${ext}`;
  const put = await storage.put(storageKey, outRes.body, { mime });

  // 4) asset + cost + completed en UNA transacción, BAJO EL LOCK DE FILA (§9.0). El `SELECT … FOR
  //    UPDATE` sobre la generación al abrir la tx SERIALIZA dos liquidaciones concurrentes de la
  //    MISMA fila (webhook-handler de web vs consumer del worker, o dos jobs `output.download`
  //    solapados por redelivery a media descarga con `localConcurrency>1`): sin él, ambos leen
  //    `!= completed` a la vez, ambos insertan un `cost_entry` → DOBLE-COBRO. El ganador escribe
  //    asset+cost+completed y commitea; el PERDEDOR bloquea en el lock, lo adquiere, RE-CHEQUEA
  //    `completed` y sale sin escribir nada (el check top-of-job del consumer es solo un fast-path;
  //    ESTE recheck bajo lock es la barrera AUTORITATIVA). La descarga + `storage.put` quedan FUERA
  //    del lock a propósito: sostener un lock de BD durante un fetch de cientos de MB serializaría el
  //    worker entero. `duration_s` se mide desde `started_at`.
  const completedAt = new Date();
  const startedAt = generation.startedAt ?? completedAt;
  const settled = await db.transaction(async (tx) => {
    const locked = await getGenerationForUpdate(tx, generation.id);
    // Carrera: otra liquidación concurrente ya llevó la fila a `completed` mientras descargábamos.
    // NO se re-inserta asset/cost ni se re-marca completed: se devuelve el estado ya finalizado.
    if (locked?.status === 'completed') {
      return { asset: null, updated: locked, alreadyFinalized: true } as const;
    }
    const asset = await createAsset(tx, {
      kind: 'keyframe',
      storageKey,
      mime,
      bytes: put.bytes,
      checksum: put.checksum,
      width: firstImage.width,
      height: firstImage.height,
      generationId: generation.id,
    });
    // `quantity` = nº de imágenes facturadas (unit='images'); `amount_cents` ya incorpora el
    // precio por megapíxel (los MP son el input del precio, no la unidad del ledger — §T4.1).
    await recordCost(tx, {
      provider: 'fal',
      amountCents: cost.cents,
      quantity: cost.imageCount,
      unit: 'images',
      ...(generation.stepRunId !== null ? { stepRunId: generation.stepRunId } : {}),
      generationId: generation.id,
    });
    const updated = await updateGeneration(tx, generation.id, {
      status: 'completed',
      costActual: cost.cents,
      falStatusPayload: args.statusPayload,
      durationS: (completedAt.getTime() - startedAt.getTime()) / 1000,
      completedAt,
    });
    return { asset, updated, alreadyFinalized: false } as const;
  });

  if (settled.alreadyFinalized) {
    logger.info(
      { event: 'fal_generation_already_finalized', generationId: generation.id },
      'finalize: la generación ya estaba completed bajo el lock (carrera concurrente); no-op sin re-cobrar',
    );
    return {
      generation: settled.updated,
      assetId: null,
      falOutputUrl,
      costCents: settled.updated.costActual ?? 0,
      warnings,
    };
  }

  logger.info(
    {
      event: 'fal_generation_finalized',
      generationId: generation.id,
      assetId: settled.asset.id,
      costCents: cost.cents,
    },
    'generación finalizada: output descargado, coste registrado, completed',
  );

  return {
    generation: settled.updated,
    assetId: settled.asset.id,
    falOutputUrl,
    costCents: cost.cents,
    warnings,
  };
}
