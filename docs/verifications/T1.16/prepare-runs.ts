// Preparación de ESCENARIO para la verificación CUA de T1.16 (cua.md, regla de oro 1:
// preparar el escenario por API está permitido; lo que se VERIFICA se hace en el navegador).
//
// Lanza contra el stack de :3100 (el mismo `e2e-stack.ts` que usa Playwright: web + worker +
// Postgres reales, y SOLO los proveedores externos —Firecrawl/Jina/Anthropic— falseados, así
// que el coste es $0):
//   A) un run de ANÁLISIS (N1→N2→N3) que se DETIENE en CP1 → sirve para el badge `N3 · CP1`
//      y para el lienzo comprimido por el editor de brief.
//   B) un run de DEMO cuyo N4 falla con un mensaje LARGO (>200 chars, con un marcador único
//      al final) → sirve para probar que la modal de error muestra el error ENTERO mientras
//      la caja del panel solo enseña el recorte de 200 del SSE.
import { createDb, createProject } from '@ugc/db';
import { makeProject } from '@ugc/test-utils';
import { analysisRunDefinition, demoCanvasRunDefinition } from '@ugc/core/orchestrator';
import { readFileSync } from 'node:fs';

const runtime = JSON.parse(
  readFileSync(new URL('../../../apps/web/e2e/.runtime.json', import.meta.url), 'utf8'),
) as { databaseUrl: string };

const db = createDb(runtime.databaseUrl);
const BASE = 'http://localhost:3100';

// Sesión: se autentica igual que un humano (POST /api/login) y se reutiliza la cookie.
const login = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'e2e-password' }),
});
const cookie = login.headers.get('set-cookie');
if (cookie === null) throw new Error(`login falló: ${String(login.status)}`);

async function postRun(def: unknown): Promise<string> {
  const res = await fetch(`${BASE}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(def),
  });
  if (res.status !== 201) throw new Error(`POST /api/runs → ${String(res.status)}: ${await res.text()}`);
  return ((await res.json()) as { runId: string }).runId;
}

// A) Run de análisis → se para en CP1 (N3 = checkpoint).
const p1 = await createProject(db, makeProject());
const analysisRunId = await postRun(analysisRunDefinition(p1.id, { source: 'url', url: 'https://glow.example/products/serum' }));

// B) Run de demo con un error LARGO. El marcador final (`MARCADOR_FINAL_DEL_ERROR_T116`)
// vive MUY por detrás del carácter 200: si aparece en la modal, el error viaja ENTERO.
const LONG_ERROR =
  'N3: config inválida: ' +
  Array.from({ length: 8 }, (_, i) =>
    `[{"code":"invalid_type","path":["angles",${String(i)},"hook"],"message":"Required"}]`,
  ).join(' ') +
  ' MARCADOR_FINAL_DEL_ERROR_T116';
const p2 = await createProject(db, makeProject());
const demoRunId = await postRun(
  demoCanvasRunDefinition(p2.id, { sleepMs: 300, autopilot: true, failMessage: LONG_ERROR }),
);

console.log(JSON.stringify({ analysisRunId, demoRunId, longErrorLen: LONG_ERROR.length }, null, 2));
process.exit(0);
