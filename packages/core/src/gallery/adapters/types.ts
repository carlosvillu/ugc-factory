// TIPOS COMPARTIDOS de los MODEL ADAPTERS (T3.6). Un adapter es una función PURA
// `(prompt canónico + assets + model_profile) → payload del endpoint fal`, determinista, sin red,
// sin BD, sin gasto. NO es un nodo del DAG ni un executor: es una LIBRERÍA que N7 (F4/T4.11)
// llamará al construir cada generación. El compilador N6 (T3.5) produce el prompt canónico
// (`CompiledPrompt.resolvedPrompt`); estos adapters lo transforman al dialecto de cada familia de
// modelos, respetando `capabilities` del `ModelProfile`.
//
// PATRÓN DE RETORNO: como todo el módulo gallery (compile-prompt, seed-validator), un adapter NO
// LANZA. Devuelve `{ ok: true, payload } | { ok: false, issues }`. Un aspect fuera de
// `capabilities.aspects` o un asset requerido ausente es un `AdapterIssue` accionable — nunca un
// throw en runtime ni un clamp silencioso (clampear cambiaría la intención creativa en silencio).
import type { ModelProfileSeed } from '../contracts';

/** El prompt canónico model-agnostic + los datos que el adapter necesita para el payload. Es la
 *  ENTRADA explícita de todo adapter: el `resolvedPrompt` de N6 más los assets resueltos (URLs de
 *  fal storage, ya subidos por T4.1 en producción) y el objetivo de aspect/duración de la variante. */
export interface AdapterInput {
  /** El prompt canónico ensamblado por N6 (`CompiledPrompt.resolvedPrompt`). */
  resolvedPrompt: string;
  /** El perfil del modelo destino (del catálogo sembrado): capabilities, endpoint, coste. */
  profile: ModelProfileSeed;
  /** Aspect objetivo de la variante (`9:16`…). Debe estar en `capabilities.aspects` si el profile
   *  las declara; si no, `AdapterIssue.aspect_unsupported`. */
  aspect: string;
  /** Duración objetivo del clip en segundos (ya ≤ maxDuration: el scene-planner trocea antes). */
  durationSeconds: number;
  /** Los assets resueltos de la variante. En producción son URLs de fal storage (T4.1); en test
   *  son ids/URLs fijos (input legítimo de una función pura, no un hand-fix). */
  assets?: AdapterAssets;
}

/** Los assets que un adapter puede inyectar en el payload, según lo que el modelo soporte
 *  (`capabilities.refImages/refVideos/refAudios`). Todos opcionales: un t2v puro no lleva ninguno. */
export interface AdapterAssets {
  /** Imágenes de referencia (identity lock de Persona, packshot del producto). Se recortan a
   *  `capabilities.refImages` (un modelo con refImages:1 usa la primera; refImages:0/ausente, ninguna). */
  refImages?: string[];
  /** Vídeos de referencia (r2v). Recortados a `capabilities.refVideos`. */
  refVideos?: string[];
  /** Audios de referencia (voz para lipsync/avatar). Recortados a `capabilities.refAudios`. */
  refAudios?: string[];
}

/** Un problema de adaptación (patrón `CompileIssue`/`GallerySeedIssue`): tipado y accionable. */
export interface AdapterIssue {
  code:
    | 'aspect_unsupported'
    | 'missing_required_asset'
    | 'unknown_prompt_adapter'
    | 'missing_prompt_adapter';
  message: string;
}

/** El payload listo para el endpoint de fal: un objeto JSON serializable con claves ordenadas al
 *  golden. Laxo a propósito (cada familia tiene su dialecto); la propiedad la fijan los asserts. */
export type AdapterPayload = Record<string, unknown>;

export type AdapterResult =
  { ok: true; payload: AdapterPayload } | { ok: false; issues: AdapterIssue[] };

/** La firma de un adapter de familia. Puro, sin red, no lanza. */
export type ModelAdapter = (input: AdapterInput) => AdapterResult;
