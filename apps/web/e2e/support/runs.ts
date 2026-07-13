// Soporte del spec del canvas (T0.11, e2e.md §166): crea un `pipeline_run` VIVO que
// el worker ejecutará de verdad. Regla dura: un run insertado por SQL NO se mueve
// (se salta al orquestador y nunca encola en pg-boss) → los runs SIEMPRE se crean
// vía `POST /api/runs`, que hace el INSERT + encolado de roots en una tx. El
// PROJECT sí se siembra por repo directo (es una fila sin orquestación).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext } from '@playwright/test';
import { createDb, createProject } from '@ugc/db';
import { makeProject } from '@ugc/test-utils';
import { analysisRunDefinition, demoCanvasRunDefinition } from '@ugc/core/orchestrator';

const runtime = JSON.parse(
  readFileSync(fileURLToPath(new URL('../.runtime.json', import.meta.url)), 'utf8'),
) as { databaseUrl: string };

const db = createDb(runtime.databaseUrl);

/**
 * Siembra un project y lanza un run del DAG de demo del canvas vía `POST /api/runs`
 * (autenticado con la cookie del storageState). `sleepMs` largo por defecto para que
 * la Verificación vea el paso por `running` con holgura; `autopilot` arranca el run
 * en autopilot. Devuelve el `runId` para navegar a `/runs/:id`.
 */
export async function launchDemoCanvasRun(
  request: APIRequestContext,
  opts: { sleepMs?: number; autopilot?: boolean; failMessage?: string } = {},
): Promise<string> {
  const project = await createProject(db, makeProject());
  const def = demoCanvasRunDefinition(project.id, {
    sleepMs: opts.sleepMs ?? 1200,
    autopilot: opts.autopilot ?? false,
    // `failMessage` (T1.16): con qué mensaje falla N4. Se inyecta uno LARGO (>200 chars) para
    // probar que el visor de error sirve el error ENTERO — con el corto de por defecto, un
    // visor que truncara pasaría igual.
    ...(opts.failMessage === undefined ? {} : { failMessage: opts.failMessage }),
  });
  const res = await request.post('/api/runs', { data: def });
  if (res.status() !== 201) {
    throw new Error(`POST /api/runs falló (${String(res.status())}): ${await res.text()}`);
  }
  const body = (await res.json()) as { runId: string; steps: { key: string; stepId: string }[] };
  return body.runId;
}

/**
 * Lanza un run del DAG de ANÁLISIS REAL (N1 ingesta → N2 visión → N3 síntesis, que es el
 * checkpoint CP1) por el mismo canal que el intake de la UI (`POST /api/runs`). No gasta un
 * céntimo: el stack E2E apunta Firecrawl/Anthropic a las APIs falsas locales
 * (startFakeExternalApis), igual que `analysis-pipeline.spec.ts`.
 *
 * Por qué existe (T1.16): el DAG de DEMO no produce `output_refs` (su executor no devuelve
 * nada) NI abre CP1 (el editor de brief se activa por la FORMA del artefacto —N3OutputSchema—,
 * no por `isCheckpoint`). Los dos observables de T1.16 —una modal con un artefacto GRANDE que
 * el excerpt trunca, y el lienzo comprimido con CP1 abierto— solo existen en un run con brief
 * de verdad.
 */
export async function launchAnalysisRun(
  request: APIRequestContext,
  url = 'https://glow.example/products/serum',
): Promise<string> {
  const project = await createProject(db, makeProject());
  const def = analysisRunDefinition(project.id, { source: 'url', url });
  const res = await request.post('/api/runs', { data: def });
  if (res.status() !== 201) {
    throw new Error(
      `POST /api/runs (análisis) falló (${String(res.status())}): ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { runId: string };
  return body.runId;
}
