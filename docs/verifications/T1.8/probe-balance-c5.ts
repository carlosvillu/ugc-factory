// VERIFIER-OWNED (ciclo 5). Probe mínimo (5 tokens de Haiku, ~$0.00001) para confirmar que la
// cuenta de Anthropic YA FACTURA tras la recarga del usuario, ANTES de lanzar las 4 llamadas de
// pago (~$0,50) del ciclo 5. Si sigue el `credit balance too low`, se para sin gastar.
import { loadAnthropicKey } from '../../../apps/web/src/server/anthropic-service';
import { deriveSecretsKey } from '../../../packages/core/src/secrets/index';
import { createDb } from '../../../packages/db/src/index';

const db = createDb(process.env.DATABASE_URL ?? '');
const secretsKey = deriveSecretsKey(process.env.APP_MASTER_KEY ?? '');
const key = await loadAnthropicKey(db, secretsKey, 'probe-c5');
const r = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: 5,
    messages: [{ role: 'user', content: 'hi' }],
  }),
});
process.stderr.write(`HTTP ${String(r.status)}\n${(await r.text()).slice(0, 400)}\n`);
process.exit(0);
