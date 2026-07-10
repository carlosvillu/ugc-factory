// Servicio del intake manual (T1.6, §7.4): orquesta el SHORT-CIRCUIT del modo texto
// libre — hash del texto → lookup de caché → (si no hay) synth + insert. Es la lógica
// de aplicación que el route handler delega (api.md §1: el handler es fino, la
// decisión vive en core). NO scrapea: no hay ni un fetch aquí ni en `synthManualRawContent`.
//
// La CACHÉ es lookup-then-insert a nivel de aplicación (NO un constraint de BD): el
// hash cubre SOLO el texto (§7.4) → mismo texto + imágenes distintas SIGUE reutilizando
// (es el spec). El override "re-análisis solo explícito" de §7.4 queda como deuda: aquí
// solo la reutilización simple.
import { contentHash } from './url';
import { synthManualRawContent } from './manual';
import type { ManualIntakeConfig } from '../contracts/intake';

/** Puerto de persistencia del intake manual (lo implementa @ugc/db sobre
 *  `url_analysis`). `AnalysisRow` es opaco para core: solo necesita el `id` para la
 *  respuesta, pero se devuelve entero para que el handler serialice lo que precise. */
export interface ManualAnalysisRow {
  id: string;
  status: string;
  source: string;
  [key: string]: unknown;
}

export interface ManualIntakeStore {
  /** Lookup de caché: análisis manual previo del MISMO proyecto con el MISMO hash. */
  findByHash(projectId: string, contentHash: string): Promise<ManualAnalysisRow | undefined>;
  /**
   * Inserta un análisis manual nuevo (source='manual', status='done') SOLO si no
   * existe ya uno con el mismo `(projectId, contentHash)` — escritura ATÓMICA contra
   * el UNIQUE parcial (ON CONFLICT DO NOTHING). Devuelve la fila creada, o `undefined`
   * si otra transacción concurrente la insertó primero (el servicio re-lee la caché).
   */
  insertIfAbsent(input: {
    projectId: string;
    contentHash: string;
    rawContent: unknown;
  }): Promise<ManualAnalysisRow | undefined>;
}

export interface ManualIntakeResult {
  analysis: ManualAnalysisRow;
  /** `true` si se reutilizó una fila de caché (no se insertó nada). Observable en
   *  logs y útil para el handler; el spec de reutilización se verifica por la
   *  AUSENCIA de fila nueva (psql) y por el MISMO id de destino (navegador). */
  reused: boolean;
}

/**
 * Ejecuta el intake manual: hash del texto → lookup de caché → si existe, se reutiliza
 * (reused); si no, synth + INSERT atómico (ON CONFLICT DO NOTHING). La atomicidad cierra
 * la carrera lookup-then-insert: dos requests concurrentes con el mismo texto NO crean
 * dos filas — el perdedor de la carrera recibe `undefined` del insert y RE-LEE la caché,
 * devolviendo el MISMO análisis (reused). Determinista respecto al store.
 */
export async function runManualIntake(
  store: ManualIntakeStore,
  config: ManualIntakeConfig,
): Promise<ManualIntakeResult> {
  // §7.4: el hash cubre SOLO el texto. `contentHash` (T1.3) acepta string tal cual.
  const hash = contentHash(config.freeText);

  // 1) Lookup optimista: la mayoría de reutilizaciones no llegan al INSERT.
  const cached = await store.findByHash(config.projectId, hash);
  if (cached) return { analysis: cached, reused: true };

  // 2) Miss: sintetiza e intenta insertar ATÓMICAMENTE.
  const rawContent = synthManualRawContent({
    text: config.freeText,
    imageRefs: config.imageRefs,
  });
  const created = await store.insertIfAbsent({
    projectId: config.projectId,
    contentHash: hash,
    rawContent,
  });
  if (created) return { analysis: created, reused: false };

  // 3) Perdimos la carrera (otra tx insertó entre nuestro lookup y nuestro insert):
  //    el ON CONFLICT no devolvió fila → re-leemos la caché y reutilizamos su fila.
  const raced = await store.findByHash(config.projectId, hash);
  if (raced) return { analysis: raced, reused: true };

  // Inalcanzable en la práctica (insert falló Y el re-lookup no encuentra la fila que
  // causó el conflicto): sería una inconsistencia del store, no un flujo normal.
  throw new Error('runManualIntake: conflicto de inserción sin fila reutilizable');
}
