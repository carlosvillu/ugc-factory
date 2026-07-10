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
import { demoCanvasRunDefinition } from '@ugc/core/orchestrator';

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
  opts: { sleepMs?: number; autopilot?: boolean } = {},
): Promise<string> {
  const project = await createProject(db, makeProject());
  const def = demoCanvasRunDefinition(project.id, {
    sleepMs: opts.sleepMs ?? 1200,
    autopilot: opts.autopilot ?? false,
  });
  const res = await request.post('/api/runs', { data: def });
  if (res.status() !== 201) {
    throw new Error(`POST /api/runs falló (${String(res.status())}): ${await res.text()}`);
  }
  const body = (await res.json()) as { runId: string; steps: { key: string; stepId: string }[] };
  return body.runId;
}
