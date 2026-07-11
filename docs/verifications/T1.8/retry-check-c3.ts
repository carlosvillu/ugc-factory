// $0 — Comprobación del REINTENTO (ajuste de alcance aprobado, nota 4 del planning) contra el
// SERVICIO REAL (`runSynthesizeBrief`, el que escribe `cost_entry`), con un servidor HTTP local que
// hace de Anthropic. NO se toca el código de producto: se inyecta `anthropicBaseUrl` + `fetch`.
//
// Tres escenarios, los tres a coste $0 de Anthropic (pero SÍ escriben en `cost_entry`, que es
// justo lo que hay que auditar):
//   A) parse_error → parse_error : debe REINTENTAR (2 llamadas) y el `cost_entry` debe SUMAR ambas.
//   B) api_error (400 determinista): NO debe reintentar (reintentar un 400 es quemar dinero).
//   C) parse_error → OK : reintenta y el brief sale; el coste registrado suma los dos intentos.
import { createServer } from 'node:http';

import { runSynthesizeBrief } from '../../../apps/web/src/server/synthesize-brief';
import { deriveSecretsKey } from '../../../packages/core/src/secrets/index';
import { createDb, createProject } from '../../../packages/db/src/index';
import type { RawContent } from '../../../packages/core/src/contracts/index';

const log = (s: string): void => process.stderr.write(s + '\n');

const RAW: RawContent = {
  source: 'manual', url: null, platform: 'manual',
  markdown: 'Lámpara plegable Lumen Fold. 79 euros. Aluminio, USB-C, CRI 95.',
  images: [], branding: null, product: null, screenshotRef: null,
};

/** Un brief mínimo que SÍ valida contra el Zod de T1.1 se construye a partir del brief real que
 *  produjo la corrida de pago — así el escenario C prueba el camino de éxito de verdad. */
import { readFileSync } from 'node:fs';
const briefOk = (JSON.parse(readFileSync('docs/verifications/T1.8/briefs-c3-stage1.json', 'utf8')) as {
  results: { brief: unknown }[];
}).results[0].brief;

interface Call { body: unknown }

/** Servidor que hace de Anthropic. `plan` decide qué devuelve en cada llamada. */
function fakeAnthropic(plan: ('bad_json' | 'ok' | 'http400')[], calls: Call[]) {
  let n = 0;
  return createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += String(c)));
    req.on('end', () => {
      calls.push({ body: JSON.parse(body) as unknown });
      const step = plan[Math.min(n, plan.length - 1)];
      n++;
      if (step === 'http400') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'compiled grammar too large' } }));
        return;
      }
      // Respuesta con `usage` REAL (tokens ficticios pero concretos) para poder auditar la SUMA.
      const text = step === 'ok' ? JSON.stringify(briefOk) : '{"esto": "no valida contra el Zod"}';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn', stop_sequence: null,
        // 1000 in / 100 out por llamada: si SUMA los dos intentos, `quantity` = 2200 y no 1100.
        usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }));
    });
  });
}

async function withServer(plan: ('bad_json' | 'ok' | 'http400')[], fn: (baseUrl: string, calls: Call[]) => Promise<void>): Promise<void> {
  const calls: Call[] = [];
  const server = fakeAnthropic(plan, calls);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  try {
    await fn(`http://127.0.0.1:${String(addr.port)}`, calls);
  } finally {
    server.close();
  }
}

async function main(): Promise<void> {
  const db = createDb(process.env.DATABASE_URL ?? '');
  const secretsKey = deriveSecretsKey(process.env.APP_MASTER_KEY ?? '');
  const projectId = (await createProject(db, { name: `verify-T1.8-c3-retry ${new Date().toISOString()}` })).id;
  log(`retry-check: project ${projectId}\n`);

  const rows = async (): Promise<{ amount_cents: number; quantity: number }[]> => {
    const r = await db.execute(
      `SELECT amount_cents, quantity FROM cost_entry WHERE project_id = '${projectId}' ORDER BY occurred_at`,
    );
    return (r as unknown as { rows?: unknown[] }).rows as { amount_cents: number; quantity: number }[] ?? (r as unknown as { amount_cents: number; quantity: number }[]);
  };

  // ── A) parse_error → parse_error: reintenta, y el coste SUMA los dos intentos ──
  await withServer(['bad_json', 'bad_json'], async (baseUrl, calls) => {
    const r = await runSynthesizeBrief(
      { db, secretsKey, anthropicBaseUrl: baseUrl },
      { projectId, raw: RAW, targetLanguage: 'es' },
    );
    log(`[A] parse_error x2 → status=${r.status} llamadas=${String(calls.length)} usage=${JSON.stringify(r.usage)}`);
    log(`    warnings: ${JSON.stringify(r.warnings)}`);
    log(`    ¿reintentó? ${calls.length === 2 ? 'SÍ ✓' : 'NO ✗'} | ¿usage SUMA ambos (2000 in / 200 out)? ${r.usage?.inputTokens === 2000 && r.usage.outputTokens === 200 ? 'SÍ ✓' : 'NO ✗'}`);
  });

  // ── B) api_error 400: NO debe reintentar ──
  await withServer(['http400', 'http400'], async (baseUrl, calls) => {
    const r = await runSynthesizeBrief(
      { db, secretsKey, anthropicBaseUrl: baseUrl },
      { projectId, raw: RAW, targetLanguage: 'es' },
    );
    log(`\n[B] api_error 400 → status=${r.status} llamadas=${String(calls.length)}`);
    log(`    warnings: ${JSON.stringify(r.warnings)}`);
    log(`    ¿NO reintentó (1 sola llamada)? ${calls.length === 1 ? 'SÍ ✓ (correcto: un 400 es determinista)' : `NO ✗ (${String(calls.length)} llamadas: quema dinero)`}`);
  });

  // ── C) parse_error → OK: absorbe la deriva y el coste suma los dos ──
  await withServer(['bad_json', 'ok'], async (baseUrl, calls) => {
    const r = await runSynthesizeBrief(
      { db, secretsKey, anthropicBaseUrl: baseUrl },
      { projectId, raw: RAW, targetLanguage: 'es' },
    );
    log(`\n[C] parse_error → ok → status=${r.status} llamadas=${String(calls.length)} usage=${JSON.stringify(r.usage)}`);
    log(`    warnings: ${JSON.stringify(r.warnings)}`);
    log(`    ¿brief recuperado? ${r.brief ? 'SÍ ✓' : 'NO ✗'} | ¿usage SUMA ambos? ${r.usage?.inputTokens === 2000 ? 'SÍ ✓' : 'NO ✗'}`);
  });

  log('\n--- cost_entry del proyecto de retry (la BD, no la memoria) ---');
  const all = await rows();
  log(JSON.stringify(all));
  const totalQty = all.reduce((a, x) => a + Number(x.quantity), 0);
  log(`filas=${String(all.length)} quantity total=${String(totalQty)}`);
  log(`(esperado: A=2200 tok, B=sin fila (400 sin usage), C=2200 tok → 2 filas, 4400 tok)`);
  process.exit(0);
}

main().catch((e: unknown) => { log(`retry-check threw: ${String(e)}`); process.exit(1); });
