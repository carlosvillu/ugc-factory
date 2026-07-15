// EL DISPATCHER DE ADAPTERS (T3.6). Lee `model_profile.promptAdapter` y despacha al adapter de esa
// FAMILIA. El dispatch es POR EL CAMPO DE DATOS `promptAdapter`, NO por matching de prefijo de
// endpoint en código (PRD l.207 "config data en BD, no hardcode"; l.449 "lo específico del modelo
// vive en el promptAdapter"). Añadir un modelo nuevo de una familia conocida = sembrar su profile
// con el `promptAdapter` correcto, sin tocar código.
//
// Un `promptAdapter` ausente o desconocido = ERROR TIPADO ACCIONABLE que nombra el endpoint (no un
// fallback silencioso): un profile sin dialecto declarado no se puede convertir a payload, y taparlo
// con un default enviaría el dialecto equivocado a fal y quemaría presupuesto.
import { avatarAdapter, i2vAdapter, imageEditAdapter, seedanceAdapter } from './families';
import type { AdapterInput, AdapterResult, ModelAdapter } from './types';

/** Las FAMILIAS de adapter conocidas (valor de `model_profile.promptAdapter`). Son CONTRATO con
 *  F4/T4.11 y con el seed: renombrarlas obliga a re-sembrar. El `Record` es exhaustivo — añadir
 *  una familia al tipo obliga a cablear su adapter aquí. */
export type AdapterFamily = 'avatar' | 'i2v' | 'seedance' | 'image-edit';

export const ADAPTER_FAMILIES: Readonly<Record<AdapterFamily, ModelAdapter>> = {
  avatar: avatarAdapter,
  i2v: i2vAdapter,
  seedance: seedanceAdapter,
  'image-edit': imageEditAdapter,
};

function isKnownFamily(value: string): value is AdapterFamily {
  return Object.prototype.hasOwnProperty.call(ADAPTER_FAMILIES, value);
}

/**
 * Selecciona y ejecuta el adapter de la familia declarada por `input.profile.promptAdapter`. NO
 * lanza: un `promptAdapter` ausente → `missing_prompt_adapter`; uno desconocido →
 * `unknown_prompt_adapter`. Ambos nombran el endpoint (el "de qué modelo" del error accionable).
 */
export function adaptToPayload(input: AdapterInput): AdapterResult {
  const family = input.profile.promptAdapter;
  if (family === undefined || family === '') {
    return {
      ok: false,
      issues: [
        {
          code: 'missing_prompt_adapter',
          message: `El model_profile "${input.profile.falEndpoint}" no declara promptAdapter: no hay dialecto con el que construir su payload.`,
        },
      ],
    };
  }
  if (!isKnownFamily(family)) {
    return {
      ok: false,
      issues: [
        {
          code: 'unknown_prompt_adapter',
          message: `El model_profile "${input.profile.falEndpoint}" declara promptAdapter "${family}", que no es una familia conocida ([${Object.keys(ADAPTER_FAMILIES).join(', ')}]).`,
        },
      ],
    };
  }
  return ADAPTER_FAMILIES[family](input);
}
