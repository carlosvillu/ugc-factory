// LA PARTE DETERMINISTA Y GRATUITA de la Verificación de T6.2 que vive en la CAPA DB (regla de trabajo 8):
// PERSISTIR el marcado del checklist y el estado del checkpoint CP5. Contra Postgres REAL (Testcontainers).
//
// Lo que se prueba aquí y no en otra capa:
//   1. Leer una variante SIN fila devuelve el default (nada marcado, CP5 off, flujo `ready`) SIN crearla.
//   2. Marcar un ítem PERSISTE (upsert) y RE-LEERLO lo devuelve marcado — el marcado sobrevive (era el gap
//      de F6: el bundle emitía los pasos pero marcarlos «hechos» no se guardaba en ningún sitio).
//   3. Marcar varios ítems FUSIONA el jsonb (no se pisan entre sí); desmarcar uno no borra los otros.
//   4. Idempotencia: marcar el mismo ítem al mismo valor dos veces = mismo estado (upsert por variant_id).
//   5. CP5: activar/desactivar y fijar el estado del flujo PERSISTEN y son ortogonales al marcado.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestDatabase,
  makeAdBatch,
  makeAdVariant,
  makeProductBrief,
  makeProject,
  makeUrlAnalysis,
  type TestDatabase,
} from '@ugc/test-utils';
import { adBatch, adVariant, productBrief, project, urlAnalysis } from '@ugc/db/schema';
import {
  getPublishingState,
  markChecklistItem,
  setCp5Enabled,
  setPublishFlowState,
} from '../../src/repos/publishing.repo';

let tdb: TestDatabase;

/** Crea una variante APROBADA (con su lote/brief/proyecto) y devuelve su id. */
async function seedApprovedVariant(): Promise<string> {
  const [p] = await tdb.db.insert(project).values(makeProject()).returning();
  const [ua] = await tdb.db
    .insert(urlAnalysis)
    .values(makeUrlAnalysis({ projectId: p!.id }))
    .returning();
  const [brief] = await tdb.db
    .insert(productBrief)
    .values(makeProductBrief({ urlAnalysisId: ua!.id }))
    .returning();
  const [batch] = await tdb.db
    .insert(adBatch)
    .values(makeAdBatch({ projectId: p!.id, briefId: brief!.id }))
    .returning();
  const [variant] = await tdb.db
    .insert(adVariant)
    .values(makeAdVariant({ batchId: batch!.id, status: 'approved' }))
    .returning();
  return variant!.id;
}

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'publishing-repo' });
});

afterAll(async () => {
  await tdb.close();
});

describe('publishing.repo — marcado del checklist (T6.2)', () => {
  it('leer una variante SIN fila devuelve el default y NO crea la fila', async () => {
    const variantId = await seedApprovedVariant();
    const state = await getPublishingState(tdb.db, variantId);
    expect(state).toEqual({
      variantId,
      marks: {},
      cp5Enabled: false,
      flowState: 'ready',
    });
    // Segundo read: sigue siendo el default (leer no escribió una fila).
    const again = await getPublishingState(tdb.db, variantId);
    expect(again.marks).toEqual({});
  });

  it('marcar un ítem PERSISTE y sobrevive a la re-lectura', async () => {
    const variantId = await seedApprovedVariant();
    await markChecklistItem(tdb.db, variantId, 'aigc_disclosure', true);
    const state = await getPublishingState(tdb.db, variantId);
    expect(state.marks).toEqual({ aigc_disclosure: true });
  });

  it('marcar varios ítems FUSIONA el jsonb; desmarcar uno no toca los otros', async () => {
    const variantId = await seedApprovedVariant();
    await markChecklistItem(tdb.db, variantId, 'aigc_disclosure', true);
    await markChecklistItem(tdb.db, variantId, 'c2pa_present', true);
    let state = await getPublishingState(tdb.db, variantId);
    expect(state.marks).toEqual({ aigc_disclosure: true, c2pa_present: true });

    // Desmarcar uno: el otro se conserva.
    await markChecklistItem(tdb.db, variantId, 'aigc_disclosure', false);
    state = await getPublishingState(tdb.db, variantId);
    expect(state.marks).toEqual({ aigc_disclosure: false, c2pa_present: true });
  });

  it('IDEMPOTENCIA: marcar el mismo ítem al mismo valor dos veces = mismo estado', async () => {
    const variantId = await seedApprovedVariant();
    const first = await markChecklistItem(tdb.db, variantId, 'c2pa_present', true);
    const second = await markChecklistItem(tdb.db, variantId, 'c2pa_present', true);
    expect(second.marks).toEqual(first.marks);
    const state = await getPublishingState(tdb.db, variantId);
    expect(state.marks).toEqual({ c2pa_present: true });
  });
});

describe('publishing.repo — CP5 (T6.2)', () => {
  it('activar/desactivar CP5 PERSISTE y es ortogonal al marcado', async () => {
    const variantId = await seedApprovedVariant();
    await markChecklistItem(tdb.db, variantId, 'aigc_disclosure', true);
    await setCp5Enabled(tdb.db, variantId, true);
    let state = await getPublishingState(tdb.db, variantId);
    expect(state.cp5Enabled).toBe(true);
    // La marca sigue ahí (activar CP5 no la borró).
    expect(state.marks).toEqual({ aigc_disclosure: true });

    await setCp5Enabled(tdb.db, variantId, false);
    state = await getPublishingState(tdb.db, variantId);
    expect(state.cp5Enabled).toBe(false);
    expect(state.marks).toEqual({ aigc_disclosure: true });
  });

  it('fijar el estado del flujo PERSISTE (ready → waiting_confirmation → confirmed)', async () => {
    const variantId = await seedApprovedVariant();
    await setPublishFlowState(tdb.db, variantId, 'waiting_confirmation');
    let state = await getPublishingState(tdb.db, variantId);
    expect(state.flowState).toBe('waiting_confirmation');

    await setPublishFlowState(tdb.db, variantId, 'confirmed');
    state = await getPublishingState(tdb.db, variantId);
    expect(state.flowState).toBe('confirmed');
  });
});
