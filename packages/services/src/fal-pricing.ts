// Pricing de fal (imagen) → `cost_entry` (T4.1). Espeja `anthropic-pricing.ts`: el precio y el
// registro del gasto son I/O de dinero, la frontera prohibida de core (architecture §1). Core
// devuelve el output (dimensiones); AQUÍ se calcula el coste en céntimos y (en `fal-service.ts`)
// se escribe el ledger.
//
// FLUX.2 dev (y los modelos `image` en general) facturan por MEGAPÍXEL: coste = suma de
// (width×height/1e6) de cada imagen × `model_profile.cost.amountCents` (céntimos/MP). El precio
// unitario vive en el seed `model_profile` (§13.1, multi-unidad); NO se hardcodea aquí — se pasa.
import type { FalImageOutput } from '@ugc/core/generation';

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
