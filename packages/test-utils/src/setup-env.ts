// setupFile universal de Vitest (stack-setup.md §4): carga .env.test(.local).
// .env.test.local (gitignored, claves reales SOLO para test:live) se carga
// primero; .env.test (committeado, claves falsas) después SIN override: lo
// local gana. Ninguno pisa variables ya presentes en el entorno.
// Nota: .env.test nace en T0.2 — hasta entonces ambos ficheros pueden faltar.
import { existsSync, readFileSync } from 'node:fs';
// URL de node explícita: bajo el entorno jsdom (apps/web) el `URL` global es el
// de jsdom, cuya base es http://localhost:3000/ — resolvería la ruta relativa
// contra esa base y fileURLToPath rechazaría el esquema http. Importar el URL de
// node preserva el file: y es no-op en el resto de paquetes (entorno node).
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { parseEnv } from 'node:util';

const repoRoot = new NodeURL('../../../', import.meta.url);

function loadEnvFileIfPresent(name: string): void {
  const path = fileURLToPath(new NodeURL(name, repoRoot));
  if (!existsSync(path)) return;
  const parsed = parseEnv(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] ??= value;
  }
}

loadEnvFileIfPresent('.env.test.local');
loadEnvFileIfPresent('.env.test');
