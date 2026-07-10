// `POST /api/analyses` (T1.6, N0 §9.1): crea un `url_analysis` en modo MANUAL (texto
// libre). Es el SHORT-CIRCUIT del intake manual — texto → RawContent sintético →
// persist con status='done', SIN pasar por el fast-path ingester de T1.3 (que hace
// probe HTTP `.json`). CERO llamadas de scraping: el verifier lo confirma leyendo los
// logs.
//
// La CACHÉ (§7.4) es lookup-then-insert a nivel de aplicación: hash del texto →
// lookup `(project_id, content_hash, source='manual')` → si existe, se reutiliza (NO
// se inserta fila nueva); si no, synth + insert. La decisión vive en core
// (`runManualIntake`); el handler solo cablea el store de @ugc/db y serializa.
//
// SEÑAL de reutilización: la respuesta lleva el `id` del análisis. Un 2.º submit del
// mismo texto devuelve el MISMO id → el usuario acaba en el mismo análisis. `reused`
// lo expone explícito para observabilidad.
//
// `withAuth` por fuera (401 antes de parsear) + `withRoute` por dentro (safeParse del
// body con el MISMO schema de core que valida el cliente, envelope único).
import { z } from 'zod';
import { ManualIntakeConfigSchema } from '@ugc/core/contracts';
import { runManualIntake, type ManualIntakeStore } from '@ugc/core/ingest';
import { insertManualUrlAnalysisIfAbsent, findManualUrlAnalysisByHash } from '@ugc/db';
import { withRoute, getDb, getRequestLogger } from '@/server';
import { withAuth } from '@/server/with-auth';

// pg vive en el runtime Node, no en edge.
export const runtime = 'nodejs';
// Muta la BD en cada request: jamás se cachea.
export const dynamic = 'force-dynamic';

// Contrato de salida (lo valida el api-client del cliente): el id del análisis, su
// estado, y si se reutilizó una entrada previa (caché §7.4).
const AnalysisResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  source: z.string(),
  reused: z.boolean(),
});

/** Adapta los repos de @ugc/db al puerto `ManualIntakeStore` de core (lookup + insert
 *  de la caché). El servicio de core compone el short-circuit sin conocer Drizzle. */
function makeManualIntakeStore(db: ReturnType<typeof getDb>): ManualIntakeStore {
  return {
    findByHash: (projectId, hash) => findManualUrlAnalysisByHash(db, projectId, hash),
    insertIfAbsent: (input) =>
      insertManualUrlAnalysisIfAbsent(db, {
        projectId: input.projectId,
        contentHash: input.contentHash,
        rawContent: input.rawContent,
      }),
  };
}

export const POST = withAuth(
  withRoute(
    async ({ body }) => {
      const store = makeManualIntakeStore(getDb());
      // El short-circuit puro (hash → caché → synth + insert). NO scrapea.
      const { analysis, reused } = await runManualIntake(store, body);

      getRequestLogger().info(
        { analysis_id: analysis.id, project_id: body.projectId, reused, source: 'manual' },
        reused ? 'intake manual reutilizado (caché)' : 'intake manual creado',
      );

      const payload = AnalysisResponseSchema.parse({
        id: analysis.id,
        status: analysis.status,
        source: analysis.source,
        reused,
      });
      // 200 si se reutilizó (nada nuevo), 201 si se creó una fila.
      return Response.json(payload, { status: reused ? 200 : 201 });
    },
    { body: ManualIntakeConfigSchema },
  ),
);
