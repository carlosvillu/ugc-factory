// setupFile universal de Vitest (stack-setup.md §4): carga .env.test(.local).
// .env.test.local (gitignored, claves reales SOLO para test:live) se carga
// primero; .env.test (committeado, claves falsas) después SIN override: lo
// local gana. Ninguno pisa variables ya presentes en el entorno.
// Nota: .env.test nace en T0.2 — hasta entonces ambos ficheros pueden faltar.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const repoRoot = new URL('../../../', import.meta.url);

function loadEnvFileIfPresent(name: string): void {
  const path = fileURLToPath(new URL(name, repoRoot));
  if (!existsSync(path)) return;
  const parsed = parseEnv(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] ??= value;
  }
}

loadEnvFileIfPresent('.env.test.local');
loadEnvFileIfPresent('.env.test');
