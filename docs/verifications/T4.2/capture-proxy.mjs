// Proxy de captura para la verificación de T4.2 (verifier, NO es código de producto).
// cloudflared apunta AQUÍ (no a :3000). Este proxy:
//   1. Captura los BYTES EXACTOS del body + los 4 headers x-fal-webhook-* del POST entrante.
//   2. Los persiste a disco (rawBody byte-a-byte + headers JSON) SOLO para /api/webhooks/fal.
//   3. Reenvía la request SIN TOCAR los bytes a http://localhost:3000 y devuelve su respuesta.
// Un único punto de ingreso ⇒ los bytes congelados como fixture son EXACTAMENTE los que el
// handler verificó. No re-serializa nada.
import http from 'node:http';
import { writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const UPSTREAM = { host: '127.0.0.1', port: 3000 };
const LISTEN_PORT = Number(process.env.PROXY_PORT ?? 8799);
const logFile = `${HERE}proxy.log`;
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  appendFileSync(logFile, line);
  process.stdout.write(line);
}

let webhookSeq = 0;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const bodyBuf = Buffer.concat(chunks);
    const isWebhook = req.method === 'POST' && (req.url ?? '').startsWith('/api/webhooks/fal');
    if (isWebhook) {
      webhookSeq += 1;
      const seq = webhookSeq;
      const h = {
        requestId: req.headers['x-fal-webhook-request-id'] ?? '',
        userId: req.headers['x-fal-webhook-user-id'] ?? '',
        timestamp: req.headers['x-fal-webhook-timestamp'] ?? '',
        signature: req.headers['x-fal-webhook-signature'] ?? '',
      };
      // Bytes exactos, byte a byte. La forma raw (binaria) y la utf8 (para el fixture).
      writeFileSync(`${HERE}webhook-${seq}-body.raw`, bodyBuf);
      writeFileSync(`${HERE}webhook-${seq}-headers.json`, JSON.stringify(h, null, 2));
      writeFileSync(`${HERE}webhook-${seq}-all-headers.json`, JSON.stringify(req.headers, null, 2));
      log(
        `WEBHOOK #${seq} entrante: ${req.method} ${req.url} · ${bodyBuf.length} bytes · ` +
          `reqId=${h.requestId} ts=${h.timestamp} sigLen=${String(h.signature).length}`,
      );
    } else {
      log(`passthrough: ${req.method} ${req.url} (${bodyBuf.length} bytes)`);
    }

    const proxyReq = http.request(
      {
        host: UPSTREAM.host,
        port: UPSTREAM.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `${UPSTREAM.host}:${UPSTREAM.port}` },
      },
      (upRes) => {
        const upChunks = [];
        upRes.on('data', (c) => upChunks.push(c));
        upRes.on('end', () => {
          const upBody = Buffer.concat(upChunks);
          if (isWebhook) {
            log(`WEBHOOK respuesta upstream: ${upRes.statusCode} · ${upBody.toString('utf8')}`);
          }
          res.writeHead(upRes.statusCode ?? 502, upRes.headers);
          res.end(upBody);
        });
      },
    );
    proxyReq.on('error', (err) => {
      log(`ERROR upstream: ${err.message}`);
      res.writeHead(502);
      res.end('proxy upstream error');
    });
    if (bodyBuf.length > 0) proxyReq.write(bodyBuf);
    proxyReq.end();
  });
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  log(`capture-proxy escuchando en http://127.0.0.1:${LISTEN_PORT} → upstream :${UPSTREAM.port}`);
});
