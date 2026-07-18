// PURA: del `node_key` de un sub-step del sub-DAG de generación (N6→N7) + su `output_refs`
// COMPLETO (el que `GET /api/steps/:id` devuelve, NO el excerpt truncado del SSE) →
// lo que el inspector pinta de ese asset: el `resolvedPrompt` de N6 y/o la lista de assets
// con su tipo de media. Testeada sin render (frontend.md §3a).
//
// POR QUÉ AQUÍ y no en el panel: es transformación de datos (la inteligencia del canvas vive
// en funciones puras; los componentes solo pintan). El panel hace UN fetch y delega el parseo.
//
// EL TIPO DE MEDIA SALE DEL node_key, no del output: cada nodo N7 produce un tipo fijo (N7a
// imágenes, N7b/N7e audio, N7c/N7d vídeo). El download endpoint sirve el asset con su mime
// real, así que el `<video>/<audio>/<img>` solo necesita saber QUÉ elemento montar. Se deriva
// del node_key canónico (§7.2), robusto al prefijo de DAG (`demo.canvas.N7a`).
import { canonicalNodeKey } from './node-titles';

type MediaKind = 'image' | 'audio' | 'video';

export interface StepAsset {
  assetId: string;
  mediaKind: MediaKind;
}

export interface StepAssetsView {
  /** El prompt resuelto de N6 (§7.2), o `null` si el step no es N6 / no lo trae. */
  resolvedPrompt: string | null;
  /** Los assets generados por el step (con su tipo de media), en orden de aparición. */
  assets: StepAsset[];
}

// Qué tipo de media produce cada nodo N7 (§7.2). N6 no produce assets (es $0, compila el
// prompt). Un node_key fuera de este mapa no aporta assets al inspector (degradación honesta).
const MEDIA_KIND_BY_NODE: Record<string, MediaKind> = {
  N7a: 'image', // product shots / keyframes
  N7b: 'audio', // voiceover (TTS→ASR)
  N7c: 'video', // clip de avatar
  N7d: 'video', // b-roll
  N7e: 'audio', // bed musical
};

/** Recolecta TODOS los `assetId` (string no vacío) del output, en orden estable de recorrido.
 *  Genérico a propósito: N7a los lleva en `shots[].assetId`, N7b/N7d en `clips[].assetId`, N7c/N7e
 *  en la raíz (`assetId`). Un recorrido recursivo cubre las tres formas sin acoplarse a cada schema
 *  (que vive como interface local en el worker, fuera del alcance del frontend). */
function collectAssetIds(value: unknown, out: string[], seen: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectAssetIds(item, out, seen);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (key === 'assetId' && typeof v === 'string' && v.length > 0) {
        if (!seen.has(v)) {
          seen.add(v);
          out.push(v);
        }
      } else {
        collectAssetIds(v, out, seen);
      }
    }
  }
}

/** El `resolvedPrompt` de un output de N6, o `null`. Se lee por estructura (el schema N6 vive en
 *  core, pero el panel no valida — solo pinta un string si está). */
function resolvedPromptOf(output: unknown): string | null {
  if (output !== null && typeof output === 'object' && 'resolvedPrompt' in output) {
    const p: unknown = output.resolvedPrompt;
    if (typeof p === 'string' && p.length > 0) return p;
  }
  return null;
}

/** Proyecta el output COMPLETO de un sub-step de generación a lo que el inspector pinta. Para un
 *  node_key que no es del sub-DAG N6→N7, devuelve la vista vacía (sin prompt, sin assets). */
export function stepAssetsView(nodeKey: string, output: unknown): StepAssetsView {
  const canon = canonicalNodeKey(nodeKey);
  const resolvedPrompt = canon === 'N6' ? resolvedPromptOf(output) : null;
  const mediaKind = MEDIA_KIND_BY_NODE[canon];
  if (mediaKind === undefined) return { resolvedPrompt, assets: [] };
  const ids: string[] = [];
  collectAssetIds(output, ids, new Set());
  return { resolvedPrompt, assets: ids.map((assetId) => ({ assetId, mediaKind })) };
}
