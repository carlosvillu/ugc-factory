// Pricing de fal (imagen) → `cost_entry` (T4.1). Espeja `anthropic-pricing.ts`: el precio y el
// registro del gasto son I/O de dinero, la frontera prohibida de core (architecture §1). Core
// devuelve el output (dimensiones); AQUÍ se calcula el coste en céntimos y (en `fal-service.ts`)
// se escribe el ledger.
//
// FLUX.2 dev (y los modelos `image` en general) facturan por MEGAPÍXEL: coste = suma de
// (width×height/1e6) de cada imagen × `model_profile.cost.amountCents` (céntimos/MP). El precio
// unitario vive en el seed `model_profile` (§13.1, multi-unidad); NO se hardcodea aquí — se pasa.
import type { FalImageOutput } from '@ugc/core/generation';
import { ModelCostSchema } from '@ugc/core/gallery';

export interface FalImageCost {
  /** `amount_cents` ENTERO del `cost_entry` (invariante del ledger: nunca float). Redondeado. */
  cents: number;
  /** Megapíxeles totales facturados (la VERDAD granular → `quantity`, unit='megapixels'). */
  megapixels: number;
  /** Nº de imágenes generadas (contexto). */
  imageCount: number;
  /** Aviso si NO se pudo calcular el coste (dimensiones ausentes o unidad inesperada). null si OK. */
  warning: string | null;
}

/**
 * Coste de un output de imagen de fal, dado el precio POR MEGAPÍXEL del `model_profile`.
 *
 * INVARIANTE DE DINERO (record-first, como anthropic-pricing): NUNCA lanza. La llamada de pago
 * YA se hizo cuando esto se ejecuta; si lanzara, `recordCost` no correría y el gasto real quedaría
 * SIN fila en `/spend`. Un coste incalculable (imágenes sin dimensiones) degrada a 0 con `warning`
 * OBSERVABLE, y la fila se registra igual — perder el importe es malo, perder la fila es peor.
 *
 * `unit` DEBE ser 'megapixel' (los modelos `image` de §13.1 facturan así). Si el perfil declarara
 * otra unidad, es un warning (no sabemos convertir) y coste 0 — nunca un cálculo silencioso erróneo.
 */
export function falImageCostOf(args: {
  output: FalImageOutput;
  unit: string;
  centsPerUnit: number;
}): FalImageCost {
  const imageCount = args.output.images.length;

  if (args.unit !== 'megapixel') {
    return {
      cents: 0,
      megapixels: 0,
      imageCount,
      warning:
        `fal-pricing: unidad inesperada '${args.unit}' para un output de imagen (se esperaba ` +
        "'megapixel'): el cost_entry se registra con amount_cents=0. Revisa el model_profile.",
    };
  }

  let megapixels = 0;
  let missingDims = false;
  for (const img of args.output.images) {
    if (img.width === undefined || img.height === undefined) {
      missingDims = true;
      continue;
    }
    megapixels += (img.width * img.height) / 1e6;
  }

  if (missingDims && megapixels === 0) {
    return {
      cents: 0,
      megapixels: 0,
      imageCount,
      warning:
        'fal-pricing: el output no trae width/height en ninguna imagen: no se puede calcular el ' +
        'coste por megapixel. El cost_entry se registra con amount_cents=0.',
    };
  }

  return {
    cents: Math.round(megapixels * args.centsPerUnit),
    megapixels,
    imageCount,
    warning: missingDims
      ? 'fal-pricing: alguna imagen no traía dimensiones; el coste omite esas imágenes.'
      : null,
  };
}

// ── T4.5 (N7b · TTS + ASR): dos unidades de coste DISTINTAS por escena ────────────────────────────
// La cadena N7b hace DOS llamadas fal facturadas por separado (anti-doble-cobro: un `cost_entry` por
// cada una): el TTS por `1k_chars` (kokoro 2¢, turbo 5¢, eleven-v3 10¢/1000 chars) y el ASR por
// `minute` (`speech-to-text` 3¢/min). Mismo INVARIANTE DE DINERO que `falImageCostOf`: NUNCA lanzan
// (la llamada de pago YA ocurrió; perder el importe con warning es malo, perder la fila es peor), y
// degradan a 0¢ con warning OBSERVABLE si la unidad del perfil no es la esperada.
//
// REDONDEO SUB-CÉNTIMO (`amount_cents` es INTEGER): un clip corto factura fracciones de céntimo
// (55 chars a 2¢/1k = 0,11¢; 3,2 s de audio a 3¢/min = 0,16¢) → `Math.round` los lleva a 0¢. Es
// CORRECTO para el ledger AGREGADO (el importe real de fal de un clip así ES ~0¢, y el SUM de muchas
// filas recupera el total con error de sub-céntimo por fila); `quantity`/`unit` guardan la VERDAD
// granular (chars, minutos) para poder recomputar sin el redondeo. Mismo criterio que el megapíxel
// de imagen: los MP son el input del precio, no la unidad del ledger.

export interface FalTtsCost {
  /** `amount_cents` ENTERO del `cost_entry` (redondeado; puede ser 0 en clips muy cortos). */
  cents: number;
  /** La VERDAD granular → `quantity` (unit='chars'): nº de caracteres facturados. */
  chars: number;
  warning: string | null;
}

/**
 * Coste de una llamada TTS de fal (por 1000 CARACTERES). El insumo facturado es la LONGITUD del texto
 * que se sintetiza. Recibe el `cost` jsonb CRUDO del `model_profile` y valida `ModelCostSchema`
 * INTERNAMENTE — su casa natural: la degradación "cost inválido → 0¢ + warning" es la MISMA política
 * de invariante de dinero que "unidad inesperada → 0¢ + warning" que ya vive aquí. NUNCA lanza (la
 * llamada de pago YA ocurrió: perder el importe con warning es malo, perder la FILA es peor).
 */
export function falTtsCostOf(args: { cost: unknown; chars: number }): FalTtsCost {
  const parsed = ModelCostSchema.safeParse(args.cost);
  if (!parsed.success) {
    return {
      cents: 0,
      chars: args.chars,
      warning: 'fal-pricing: model_profile TTS.cost inválido o ausente: amount_cents=0.',
    };
  }
  if (parsed.data.unit !== '1k_chars') {
    return {
      cents: 0,
      chars: args.chars,
      warning:
        `fal-pricing: unidad inesperada '${parsed.data.unit}' para un TTS (se esperaba '1k_chars'): ` +
        'el cost_entry se registra con amount_cents=0. Revisa el model_profile.',
    };
  }
  return {
    cents: Math.round((args.chars / 1000) * parsed.data.amountCents),
    chars: args.chars,
    warning: null,
  };
}

export interface FalAsrCost {
  /** `amount_cents` ENTERO del `cost_entry` (redondeado; puede ser 0 en audios de pocos segundos). */
  cents: number;
  /** La VERDAD granular → `quantity` (unit='seconds'): SEGUNDOS de audio transcritos. Es EXACTAMENTE
   *  lo que el caller registra en el ledger (`quantity` es INTEGER: `Math.round(durationSeconds)`), no
   *  los minutos internos del cálculo — así el rastro granular del interface coincide con la fila. */
  durationSeconds: number;
  warning: string | null;
}

/**
 * Coste de una llamada ASR de fal (por MINUTO). El insumo facturado es la DURACIÓN del audio (derivada
 * del último `end` de los word timestamps — el TTS de kokoro no emite duración). Recibe el `cost` jsonb
 * CRUDO del `model_profile` y valida `ModelCostSchema` INTERNAMENTE (misma política que `falTtsCostOf`).
 * El precio es por minuto, pero el `durationSeconds` que devuelve es lo que va al ledger en `unit='seconds'`.
 */
export function falAsrCostOf(args: { cost: unknown; durationSeconds: number }): FalAsrCost {
  const parsed = ModelCostSchema.safeParse(args.cost);
  if (!parsed.success) {
    return {
      cents: 0,
      durationSeconds: args.durationSeconds,
      warning: 'fal-pricing: model_profile ASR.cost inválido o ausente: amount_cents=0.',
    };
  }
  if (parsed.data.unit !== 'minute') {
    return {
      cents: 0,
      durationSeconds: args.durationSeconds,
      warning:
        `fal-pricing: unidad inesperada '${parsed.data.unit}' para un ASR (se esperaba 'minute'): ` +
        'el cost_entry se registra con amount_cents=0. Revisa el model_profile.',
    };
  }
  return {
    cents: Math.round((args.durationSeconds / 60) * parsed.data.amountCents),
    durationSeconds: args.durationSeconds,
    warning: null,
  };
}

// ── T4.7 (N7c · avatar image+audio): coste por SEGUNDO de vídeo ────────────────────────────────────
// Los avatares Kling AI Avatar Std (5,62¢/s) y OmniHuman v1.5 (16¢/s) facturan por SEGUNDO de clip
// (`unit='second'`). El `amountCents` del perfil es FLOAT a propósito (5,62 no cabe en un entero — ver
// `ModelCostSchema`): el precio unitario sub-céntimo se multiplica por los segundos del clip y se
// redondea al final (el ledger `amount_cents` es INTEGER). Mismo INVARIANTE DE DINERO que las cost fns
// de arriba: NUNCA lanza (la llamada de pago YA ocurrió), degrada a 0¢ con warning OBSERVABLE si la
// unidad no es la esperada o el `cost` jsonb no valida.
//
// DIFERENCIA con `falImageCostOf`: un clip de avatar NO es sub-céntimo (un OmniHuman de 4 s son 64¢),
// así que la duración DEBE venir del output de fal (o, en su defecto, del audio de entrada — `duración
// = audio automáticamente`). El caller resuelve esa duración ANTES de llamar aquí; esta fn solo pone el
// precio. Registrar 0¢ sobre un clip de 64¢ sería un ledger deshonesto — por eso el caller nunca pasa 0.

export interface FalVideoCost {
  /** `amount_cents` ENTERO del `cost_entry` (redondeado). */
  cents: number;
  /** La VERDAD granular → `quantity` (unit='seconds'): SEGUNDOS de vídeo facturados (redondeados por el
   *  caller a INTEGER para el ledger). */
  durationSeconds: number;
  warning: string | null;
}

/**
 * Coste de una llamada de avatar image+audio de fal (por SEGUNDO). El insumo facturado es la DURACIÓN
 * del clip (del output de fal, o del audio de entrada si el modelo no la emite). Recibe el `cost` jsonb
 * CRUDO del `model_profile` y valida `ModelCostSchema` INTERNAMENTE (misma política que `falAsrCostOf`).
 */
export function falVideoCostOf(args: { cost: unknown; durationSeconds: number }): FalVideoCost {
  const parsed = ModelCostSchema.safeParse(args.cost);
  if (!parsed.success) {
    return {
      cents: 0,
      durationSeconds: args.durationSeconds,
      warning: 'fal-pricing: model_profile de avatar .cost inválido o ausente: amount_cents=0.',
    };
  }
  if (parsed.data.unit !== 'second') {
    return {
      cents: 0,
      durationSeconds: args.durationSeconds,
      warning:
        `fal-pricing: unidad inesperada '${parsed.data.unit}' para un avatar (se esperaba 'second'): ` +
        'el cost_entry se registra con amount_cents=0. Revisa el model_profile.',
    };
  }
  return {
    cents: Math.round(args.durationSeconds * parsed.data.amountCents),
    durationSeconds: args.durationSeconds,
    warning: null,
  };
}
