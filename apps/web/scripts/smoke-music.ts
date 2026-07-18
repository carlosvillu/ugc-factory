// Smoke de la Verificación de T4.9 (§7.2 N7e): genera UN bed musical IA contra fal REAL con ace-step
// (`fal-ai/ace-step`, text-to-music). Es el MISMO camino de PRODUCCIÓN que el executor N7e
// (`getModelProfileByEndpoint` → guard de catálogo (`kind:'music'`) → `runGenerateMusic`), conducido
// STEPLESS (sin run/DAG — eso es T4.11). Imprime lo que el verifier comprueba: generation completed,
// asset `music_bed` descargable, duración = los segundos enviados, cost_entry por segundo, y —a JUICIO
// HUMANO— si el bed suena con el MOOD pedido (§14: instrumental, para poner debajo del voiceover).
//
// La Verificación pide un bed de 30 s con el mood pedido. El COSTE es determinista (0,02¢/s × 30 s =
// 0,6¢ → 1¢) y lo fija el test de integración del executor (`n7e-music.test.ts`, gate permanente); este
// smoke prueba en VIVO el eslabón que gasta: que ace-step genera un bed real del mood en la duración
// pedida.
//
// RED REAL, GASTA DINERO (ace-step = $0,0002/s; un bed de 30s ≈ $0,006 ≈ 0,6¢ — baratísimo). El
// `audio_source=ai_bed` en la VARIANTE que menciona la Verificación es cableado al DAG (T4.11): aquí no
// hay variante — la procedencia "bed IA" ya la lleva el asset `music_bed` que este smoke genera.
//
// Env: DATABASE_URL, ASSETS_DIR, FAL_KEY, [MUSIC_ENDPOINT=fal-ai/ace-step], MOOD, [DURATION=30], [LYRICS].
// Turnkey: MOOD="upbeat, energetic, commercial, uplifting" pnpm --filter @ugc/web smoke:music
import { spawnSync } from 'node:child_process';
import { makeLogger } from '@ugc/core/observability';
import { isMusicModelKind } from '@ugc/core/gallery';
import { createDb, getAsset, getModelProfileByEndpoint, makeLocalStorageAdapter } from '@ugc/db';
import { runGenerateMusic } from '@ugc/services';

const DEFAULT_MUSIC_ENDPOINT = 'fal-ai/ace-step';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`smoke:music: falta ${name}`);
    process.exit(1);
  }
  return v;
}

/** Mide la duración del bed con ffprobe si está disponible (el verifier corre esto en la imagen Docker
 *  del worker, que sí trae ffprobe). Devuelve segundos o null. */
function probeDurationS(filePath: string): number | null {
  const res = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { encoding: 'utf8' },
  );
  if (res.error !== undefined || res.status !== 0) {
    console.log(
      'smoke:music:   (ffprobe no disponible en local — se salta la medición; el verifier la hace)',
    );
    return null;
  }
  const parsed = Number.parseFloat(res.stdout.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const assetsDir = requireEnv('ASSETS_DIR');
  const falKey = requireEnv('FAL_KEY');
  const musicEndpoint = process.env.MUSIC_ENDPOINT ?? DEFAULT_MUSIC_ENDPOINT;
  const mood = requireEnv('MOOD');
  const durationSeconds = Number.parseInt(process.env.DURATION ?? '30', 10);
  const lyrics = process.env.LYRICS;

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const logger = makeLogger({ name: 'worker', level: 'info' });

  const profile = await getModelProfileByEndpoint(db, musicEndpoint);
  if (profile === undefined) {
    console.error(
      `smoke:music: no existe el model_profile ${musicEndpoint}. Siembra: pnpm seed:gallery`,
    );
    process.exit(1);
  }
  if (!isMusicModelKind(profile.kind)) {
    console.error(
      `smoke:music: ${musicEndpoint} es kind '${profile.kind}', no un modelo de música`,
    );
    process.exit(1);
  }

  console.log(
    `smoke:music: ${musicEndpoint} (kind ${profile.kind}) — mood "${mood}", duración ${String(durationSeconds)}s — RED REAL…\n`,
  );

  const res = await runGenerateMusic(
    { db, storage, falKey, logger },
    {
      musicModelProfileId: profile.id,
      mood,
      durationSeconds,
      ...(lyrics !== undefined ? { lyrics } : {}),
    },
  );

  const asset = await getAsset(db, res.assetId);
  console.log(
    `smoke:music: generation ${res.generation.id} (${res.generation.status}), ` +
      `asset ${res.assetId} (music_bed, ${res.durationSeconds.toFixed(2)}s), ` +
      `coste ${String(res.costCents)}¢ (→ /spend) — GET /api/assets/${res.assetId}/download`,
  );

  if (asset !== undefined) {
    const filePath = `${assetsDir}/${asset.storageKey}`;
    const probed = probeDurationS(filePath);
    if (probed !== null) {
      const delta = Math.abs(probed - res.durationSeconds);
      console.log(
        `smoke:music:   duración bed=${probed.toFixed(2)}s vs enviado=${String(res.durationSeconds)}s → Δ=${delta.toFixed(2)}s ` +
          (delta <= 1.0 ? 'OK ✓' : 'REVISAR (Δ>1s)'),
      );
    }
  }
  if (res.warnings.length > 0) {
    console.log(`smoke:music:   warnings: ${res.warnings.join('; ')}`);
  }

  console.log(
    `\nsmoke:music: OK ✓ — bed generado, coste ${String(res.costCents)}¢. ` +
      `Descárgalo y JÚZGALO: ¿suena con el mood pedido ("${mood}") y es un bed instrumental de ~${String(durationSeconds)}s ` +
      `apto para poner bajo el voiceover?`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('smoke:music: falló', err);
  process.exit(1);
});
