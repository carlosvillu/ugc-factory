// TIPOS COMPARTIDOS de los MODEL ADAPTERS (T3.6). Un adapter es una función PURA
// `(prompt canónico + assets + model_profile) → payload del endpoint fal`, determinista, sin red,
// sin BD, sin gasto. NO es un nodo del DAG ni un executor: es una LIBRERÍA que N7 (F4/T4.11)
// llamará al construir cada generación. El compilador N6 (T3.5) produce UN prompt canónico
// (`CompiledPrompt.resolvedPrompt`) que estos adapters SABEN transformar al dialecto de cada familia de
// modelos, respetando `capabilities` del `ModelProfile`. OJO (auditoría 2026-08-01): pese al nombre del
// campo `resolvedPrompt`, el prompt que N7 pasa HOY a estos adapters NO sale de N6 — N7a usa
// `buildPackshotPrompt(brief)` (`generation.ts:272,379`) y N7d/N7f caen a `DEFAULT_BROLL_PROMPT`. El
// adapter es agnóstico a la procedencia; el cableado del prompt de escena de N6 es deuda T5b.1b.
//
// PATRÓN DE RETORNO: como todo el módulo gallery (compile-prompt, seed-validator), un adapter NO
// LANZA. Devuelve `{ ok: true, payload } | { ok: false, issues }`. Un aspect fuera de
// `capabilities.aspects` o un asset requerido ausente es un `AdapterIssue` accionable — nunca un
// throw en runtime ni un clamp silencioso (clampear cambiaría la intención creativa en silencio).
import type { ModelProfileSeed } from '../contracts';

/** El prompt canónico model-agnostic + los datos que el adapter necesita para el payload. Es la
 *  ENTRADA explícita de todo adapter: el `resolvedPrompt` de la variante más los assets resueltos (URLs
 *  de fal storage, ya subidos por T4.1 en producción) y el objetivo de aspect/duración de la variante. */
export interface AdapterInput {
  /** El prompt canónico que el adapter transforma. El TIPO que N6 emite (`CompiledPrompt.resolvedPrompt`)
   *  encaja aquí, pero HOY el caller NO lo llena con N6: N7a pasa `buildPackshotPrompt(brief)` y N7d/N7f
   *  `DEFAULT_BROLL_PROMPT` (auditoría 2026-08-01). Cablear el prompt de escena de N6 es deuda T5b.1b. */
  resolvedPrompt: string;
  /** El perfil del modelo destino (del catálogo sembrado): capabilities, endpoint, coste. */
  profile: ModelProfileSeed;
  /** Aspect objetivo de la variante (`9:16`…). Debe estar en `capabilities.aspects` si el profile
   *  las declara; si no, `AdapterIssue.aspect_unsupported`. */
  aspect: string;
  /** Duración objetivo del clip en segundos (ya ≤ maxDuration: el scene-planner trocea antes). */
  durationSeconds: number;
  /** Resolución objetivo (`720p|1080p`…), del `capabilities.resolutions` del profile. OPCIONAL: solo
   *  el dialecto avatar (OmniHuman) la usa hoy — si el input la trae, el adapter la refleja en el
   *  payload; si no, se omite (Kling la ignora). Los dialectos i2v/seedance/image-edit no la leen. */
  resolution?: string;
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
