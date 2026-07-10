// Smoke de la Verificación de T0.5: sube un fichero real → aparece en el almacén
// (ASSETS_DIR) con su fila en `asset` → lo descarga por `/api/assets/:id/download`
// con checksum idéntico; sin sesión, el endpoint devuelve 401.
//
// Es un DEMO runnable para el verifier (que puede usarlo o reescribirlo); el rigor
// permanente (regresión del gate) vive en el test handler-level y en el spec
// Playwright. Corre contra una web YA LEVANTADA (el verifier arranca el stack o
// `pnpm dev`): siembra directo con el StorageAdapter + repo contra la MISMA
// DATABASE_URL/ASSETS_DIR que usa web, obtiene una cookie por POST /api/login (no
// importa internals de sesión de web) y prueba el roundtrip HTTP.
//
// Env: BASE_URL (default http://localhost:3000), DATABASE_URL, ASSETS_DIR,
// AUTH_BOOTSTRAP_PASSWORD (el password sembrado). Turnkey: `pnpm smoke:assets`.
import { createHash, randomBytes } from 'node:crypto';
import { createDb, createAsset, makeLocalStorageAdapter } from '@ugc/db';
import { newUlid } from '@ugc/core/contracts';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`smoke:assets: falta ${name}`);
    process.exit(1);
  }
  return v;
}

/** Extrae el valor de la cookie ugc_session de un header Set-Cookie. */
function sessionCookieFrom(setCookie: string | null): string {
  if (!setCookie) throw new Error('login no devolvió Set-Cookie');
  const match = /(ugc_session=[^;]+)/.exec(setCookie);
  if (!match?.[1]) throw new Error(`Set-Cookie sin ugc_session: ${setCookie}`);
  return match[1];
}

async function main(): Promise<void> {
  const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
  const databaseUrl = requireEnv('DATABASE_URL');
  const assetsDir = requireEnv('ASSETS_DIR');
  const password = requireEnv('AUTH_BOOTSTRAP_PASSWORD');

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });

  // 1) Sube un fichero real y persiste la fila (fila↔fichero consistentes).
  const bytes = randomBytes(5000);
  const expectedChecksum = createHash('sha256').update(bytes).digest('hex');
  const storageKey = `smoke/${newUlid()}.bin`;
  const put = await storage.put(storageKey, bytes, { mime: 'application/octet-stream' });
  if (put.checksum !== expectedChecksum) {
    console.error('smoke:assets: el checksum de put NO coincide');
    process.exit(1);
  }
  const asset = await createAsset(db, {
    kind: 'other',
    storageKey,
    mime: 'application/octet-stream',
    bytes: put.bytes,
    checksum: put.checksum,
  });
  console.log(
    `smoke:assets: asset ${asset.id} subido (${String(put.bytes)} bytes, sha256=${put.checksum})`,
  );
  console.log(`smoke:assets: fichero en ${assetsDir}/${storageKey}`);

  // 2) Login → cookie de sesión.
  const loginRes = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (loginRes.status !== 200) {
    console.error(
      `smoke:assets: login falló (${String(loginRes.status)}) — ¿password/seed correctos?`,
    );
    process.exit(1);
  }
  const cookie = sessionCookieFrom(loginRes.headers.get('set-cookie'));

  // 3) Descarga autenticada → 200 + checksum idéntico.
  const dlRes = await fetch(`${baseUrl}/api/assets/${asset.id}/download`, { headers: { cookie } });
  if (dlRes.status !== 200) {
    console.error(
      `smoke:assets: descarga autenticada devolvió ${String(dlRes.status)}, esperaba 200`,
    );
    process.exit(1);
  }
  const downloaded = Buffer.from(await dlRes.arrayBuffer());
  const gotChecksum = createHash('sha256').update(downloaded).digest('hex');
  if (gotChecksum !== expectedChecksum) {
    console.error(`smoke:assets: checksum descargado ${gotChecksum} != ${expectedChecksum}`);
    process.exit(1);
  }
  console.log('smoke:assets: descarga autenticada OK — checksum idéntico extremo-a-extremo');

  // 4) Sin sesión → 401 sin exponer la ruta de storage.
  const anonRes = await fetch(`${baseUrl}/api/assets/${asset.id}/download`);
  if (anonRes.status !== 401) {
    console.error(`smoke:assets: sin sesión devolvió ${String(anonRes.status)}, esperaba 401`);
    process.exit(1);
  }
  const anonBody = await anonRes.text();
  if (anonBody.includes(storageKey) || anonBody.includes(assetsDir)) {
    console.error('smoke:assets: el 401 EXPUSO la ruta de storage');
    process.exit(1);
  }
  console.log('smoke:assets: sin sesión → 401 sin filtrar la ruta de storage');
  console.log('smoke:assets: OK ✓');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('smoke:assets: falló', err);
  process.exit(1);
});
