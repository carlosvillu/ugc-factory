// `pnpm fal:verify` (T3.4): contrasta cada `model_profile` sembrado contra los METADATOS PÚBLICOS
// de fal y reporta OK / DIVERGENCIA / no-verificable por perfil, marcando `verified_at` (y
// `status=deprecated` si fal retiró el endpoint).
//
// ┌─ RESTRICCIÓN DE GASTO (crítica) ────────────────────────────────────────────────────────────┐
// │ LEE SOLO `https://fal.ai/models/<endpoint>/llms.txt` — un fichero de metadatos ESTÁTICO y     │
// │ PÚBLICO (gratis). NUNCA toca `queue.fal.run` ni `fal.subscribe` ni ningún endpoint de         │
// │ GENERACIÓN. No submete jobs, no factura. La generación empieza en F4, no aquí. `FAL_KEY` se   │
// │ envía en el header solo por si una lectura de catálogo la pidiera; leer el llms.txt no gasta. │
// └──────────────────────────────────────────────────────────────────────────────────────────────┘
//
// SEPARACIÓN gate/red: el PARSEO y la COMPARACIÓN son puros y viven en @ugc/core/gallery
// (`compareModelProfile`), testeados en el gate con fixtures reales SIN red. Este script solo
// hace el I/O: fetch del llms.txt + escritura del veredicto en BD. El gate NUNCA lo ejecuta.
import {
  compareModelProfile,
  RAW_GALLERY_SEED,
  validateGallerySeed,
  type ModelVerifyResult,
} from '@ugc/core/gallery';
import { createDb } from '../src/client';
import { markModelVerified } from '../src/repos/gallery-seed.repo';

const FAL_MODELS_BASE = 'https://fal.ai/models';
const FETCH_TIMEOUT_MS = 20_000;

/** Lee el llms.txt PÚBLICO de un modelo. Devuelve null (no lanza) ante 404/timeout/red → `unverifiable`. */
async function fetchLlmsTxt(
  falEndpoint: string,
  falKey: string | undefined,
): Promise<string | null> {
  const url = `${FAL_MODELS_BASE}/${falEndpoint}/llms.txt`;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // Header de auth solo por si una lectura de catálogo lo pidiera; NO es un endpoint de generación.
      headers: falKey ? { Authorization: `Key ${falKey}` } : {},
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function icon(outcome: ModelVerifyResult['outcome']): string {
  return outcome === 'ok' ? 'OK ' : outcome === 'divergence' ? 'DIV' : '?? ';
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('fal:verify: falta DATABASE_URL (¿copiaste .env.example a .env?)');
    process.exit(1);
  }
  const falKey = process.env.FAL_KEY;

  // El seed versionado es la fuente de verdad de QUÉ perfiles verificar (mismo camino que el gate).
  const validation = validateGallerySeed(RAW_GALLERY_SEED);
  if (!validation.ok || !validation.seed) {
    console.error('fal:verify: el seed de galería NO valida — corrige el seed antes de verificar.');
    process.exit(1);
  }
  const profiles = validation.seed.modelProfiles;

  const db = createDb(connectionString);
  console.log(
    `fal:verify: contrastando ${String(profiles.length)} perfiles contra fal.ai (metadatos públicos)…\n`,
  );

  const results: ModelVerifyResult[] = [];
  for (const profile of profiles) {
    const llmsTxt = await fetchLlmsTxt(profile.falEndpoint, falKey);
    const result = compareModelProfile(profile, llmsTxt);
    results.push(result);

    // Marca `verified_at` SOLO en lo que se pudo contrastar contra fal (OK o divergencia: en ambos
    // casos se LEYÓ el llms.txt). Un perfil `unverifiable` (404/timeout/red) se REPORTA y NO se
    // marca — y NO se degrada a `deprecated`: `fetchLlmsTxt` no distingue un 404 permanente (modelo
    // retirado) de un blip de red transitorio, y auto-degradar por un `null` volcaría TODO el
    // catálogo a `deprecated` ante un hipo de 30s de fal, dejando a F4 sin modelos activos. El brief
    // lo separa a propósito: "timeout/404 → no verificable, no crash". La baja a `deprecated` exige
    // una señal POSITIVA de retiro (p. ej. un 410/"model retired" explícito), que no tenemos aquí;
    // se hace a mano cuando fal retira un endpoint, no por ausencia de respuesta.
    if (result.outcome !== 'unverifiable') {
      await markModelVerified(db, profile.falEndpoint);
    }

    console.log(`  [${icon(result.outcome)}] ${profile.falEndpoint} — ${result.detail}`);
  }

  const div = results.filter((r) => r.outcome === 'divergence');
  const unver = results.filter((r) => r.outcome === 'unverifiable');
  const ok = results.filter((r) => r.outcome === 'ok');
  console.log(
    `\nfal:verify: ${String(ok.length)} OK · ${String(div.length)} divergencias · ` +
      `${String(unver.length)} no verificables.`,
  );
  if (div.length > 0) {
    console.log('Divergencias (revisar y recalibrar el seed / recipes — regla de trabajo 5):');
    for (const r of div) console.log(`  - ${r.falEndpoint}: ${r.detail}`);
  }

  // Exit 0 aunque haya divergencias: el comando REPORTA, no es un gate que rompa el build. El
  // valor está en el reporte por perfil + el marcado de verified_at (Entrega de T3.4).
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('fal:verify: falló', err);
  process.exit(1);
});
