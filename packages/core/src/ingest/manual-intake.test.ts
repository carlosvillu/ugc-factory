// Suite de runManualIntake (T1.6): la orquestación del short-circuit con un store
// en memoria. Verifica lookup-then-insert (miss → insert; hit → reuse sin insert),
// que el hash cubre SOLO el texto y que las imágenes NO afectan a la caché (§7.4).
import { describe, expect, it, vi } from 'vitest';

import { contentHash } from './url';
import { runManualIntake, type ManualIntakeStore, type ManualAnalysisRow } from './manual-intake';
import type { ManualIntakeConfig } from '../contracts/intake';

// Store en memoria gateado por (projectId, contentHash) — el equivalente puro del
// UNIQUE parcial `(project_id, content_hash) WHERE source='manual'` de @ugc/db.
// `insertIfAbsent` modela el ON CONFLICT DO NOTHING: si la clave ya existe, devuelve
// `undefined` (no inserta), como hace el índice parcial contra una carrera.
function makeMemoryStore() {
  const rows = new Map<string, ManualAnalysisRow>();
  let seq = 0;
  const findByHash = vi.fn(
    (projectId: string, hash: string): Promise<ManualAnalysisRow | undefined> =>
      Promise.resolve(rows.get(`${projectId}:${hash}`)),
  );
  const insertIfAbsent = vi.fn(
    (input: {
      projectId: string;
      contentHash: string;
      rawContent: unknown;
    }): Promise<ManualAnalysisRow | undefined> => {
      const key = `${input.projectId}:${input.contentHash}`;
      if (rows.has(key)) return Promise.resolve(undefined); // conflicto: no inserta
      seq += 1;
      const row: ManualAnalysisRow = {
        id: `analysis-${String(seq)}`,
        status: 'done',
        source: 'manual',
        rawContent: input.rawContent,
      };
      rows.set(key, row);
      return Promise.resolve(row);
    },
  );
  const store: ManualIntakeStore = { findByHash, insertIfAbsent };
  return { store, findByHash, insertIfAbsent, size: () => rows.size };
}

const config = (over: Partial<ManualIntakeConfig> = {}): ManualIntakeConfig => ({
  source: 'manual',
  projectId: 'proj-1',
  freeText: 'Un sérum hidratante con ácido hialurónico para piel sensible.',
  imageRefs: [],
  ...over,
});

describe('runManualIntake', () => {
  it('primer submit: sintetiza e inserta (reused=false, fila nueva)', async () => {
    const { store, insertIfAbsent, size } = makeMemoryStore();
    const res = await runManualIntake(store, config());
    expect(res.reused).toBe(false);
    expect(res.analysis.source).toBe('manual');
    expect(res.analysis.status).toBe('done');
    expect(insertIfAbsent).toHaveBeenCalledTimes(1);
    expect(size()).toBe(1);
  });

  it('segundo submit del MISMO texto: reutiliza la caché (reused=true, sin insertar)', async () => {
    const { store, insertIfAbsent, size } = makeMemoryStore();
    const first = await runManualIntake(store, config());
    const second = await runManualIntake(store, config());
    expect(second.reused).toBe(true);
    expect(second.analysis.id).toBe(first.analysis.id); // MISMO id (señal de reutilización)
    expect(insertIfAbsent).toHaveBeenCalledTimes(1); // solo el primero insertó
    expect(size()).toBe(1);
  });

  it('perdedor de la carrera: insertIfAbsent devuelve undefined → re-lee la caché y reutiliza', async () => {
    // Store donde YA existe la fila (la insertó el ganador de la carrera): el lookup
    // inicial la ve como miss UNA vez (simulando el instante previo al insert rival),
    // insertIfAbsent devuelve undefined (conflicto), y el re-lookup la encuentra.
    const existing: ManualAnalysisRow = { id: 'winner', status: 'done', source: 'manual' };
    const findByHash = vi
      .fn<(p: string, h: string) => Promise<ManualAnalysisRow | undefined>>()
      .mockResolvedValueOnce(undefined) // lookup inicial: miss (aún no veíamos la fila)
      .mockResolvedValue(existing); // re-lookup tras el conflicto: la encuentra
    const insertIfAbsent = vi
      .fn<() => Promise<ManualAnalysisRow | undefined>>()
      .mockResolvedValue(undefined); // ON CONFLICT DO NOTHING: perdimos la carrera
    const store: ManualIntakeStore = { findByHash, insertIfAbsent };

    const res = await runManualIntake(store, config());
    expect(res.reused).toBe(true);
    expect(res.analysis.id).toBe('winner'); // MISMO análisis del ganador
    expect(insertIfAbsent).toHaveBeenCalledTimes(1);
    expect(findByHash).toHaveBeenCalledTimes(2); // lookup + re-lookup
  });

  it('mismo texto + imágenes DISTINTAS: SIGUE reutilizando (el hash cubre solo el texto, §7.4)', async () => {
    const { store, size } = makeMemoryStore();
    const first = await runManualIntake(
      store,
      config({ imageRefs: [{ url: '/api/assets/a/download' }] }),
    );
    const second = await runManualIntake(
      store,
      config({ imageRefs: [{ url: '/api/assets/b/download' }] }),
    );
    expect(second.reused).toBe(true);
    expect(second.analysis.id).toBe(first.analysis.id);
    expect(size()).toBe(1);
  });

  it('textos DISTINTOS: no colisionan (dos filas)', async () => {
    const { store, size } = makeMemoryStore();
    await runManualIntake(
      store,
      config({ freeText: 'Producto A con descripción suficientemente larga.' }),
    );
    await runManualIntake(
      store,
      config({ freeText: 'Producto B con otra descripción bien distinta aquí.' }),
    );
    expect(size()).toBe(2);
  });

  it('hashea SOLO el texto (contentHash(freeText))', async () => {
    const { store, insertIfAbsent } = makeMemoryStore();
    const cfg = config();
    await runManualIntake(store, cfg);
    expect(insertIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ contentHash: contentHash(cfg.freeText) }),
    );
  });
});
