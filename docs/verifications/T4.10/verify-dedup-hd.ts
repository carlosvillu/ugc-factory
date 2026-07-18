// VERIFIER script T4.10 — RE-VERIFY puntos (b) reúso end-to-end + (c) ahorro en DÓLARES.
// Escrito por el verifier (NO por el implementer). Conduce a mano, contra fal REAL, tier flux-2 pero con
// image_size = 'square_hd' (1024², ≥1MP) para que cada submit facture ≥1¢ (el 1er pase usó 'square' 512²
// que redondeó a 0¢ → el ahorro solo se vio por conteo, no por dólares). Diferencia con verify-dedup.ts:
// menos submits (2 piezas únicas + 2 reúsos idénticos, no 6+6) y coste NO-cero para el delta en /spend.
//
// Escenario (§9.6):
//   pieceA (1er submit) → asset real, fal_url real, cost_entry real (>0¢), reused:false
//   pieceB (1er submit) → asset real, cost_entry real (>0¢), reused:false
//   pieceA' (misma prompt+model+inputs) → reused:true, cost:0, MISMA generation.id+assetId
//   pieceB' (misma) → reused:true, cost:0, MISMA generation.id+assetId
// Assert: exactamente 1 cost_entry(fal) por cada pieza única (2 en total para las 4 llamadas),
//         2 generaciones completed (no 4), reúsos cost 0.
import { makeLogger } from '@ugc/core/observability';
import { createDb, getModelProfileByEndpoint, makeLocalStorageAdapter } from '@ugc/db';
import { runGenerate } from '@ugc/services';

type GenerateResult = Awaited<ReturnType<typeof runGenerate>>;
const FLUX2_ENDPOINT = 'fal-ai/flux-2';
const NONCE = `t410-reverify-hd-${Date.now()}`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`verify-dedup-hd: falta ${name}`);
    process.exit(1);
  }
  return v;
}

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ FALLO: ${msg}`);
    failures += 1;
  }
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const assetsDir = requireEnv('ASSETS_DIR');
  const falKey = requireEnv('FAL_KEY');

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const logger = makeLogger({ name: 'worker', level: 'info' });

  const profile = await getModelProfileByEndpoint(db, FLUX2_ENDPOINT);
  if (profile === undefined) {
    console.error(`verify-dedup-hd: no existe model_profile ${FLUX2_ENDPOINT}`);
    process.exit(1);
  }

  // image_size square_hd = 1024² → ≥1¢ por submit (rareza sub-céntimo de flux-2 square resuelta).
  const inputs = { image_size: 'square_hd' as const, num_images: 1 };
  const prompts = {
    A: `${NONCE} pieceA: close-up demo of a red gadget on a desk, ugc style`,
    B: `${NONCE} pieceB: clean product packshot of a red gadget on white`,
  };

  async function gen(label: string, prompt: string): Promise<GenerateResult> {
    console.log(`\n[submit] ${label} :: "${prompt.slice(0, 52)}…"`);
    const res = await runGenerate(
      { db, storage, falKey, logger },
      { modelProfileId: profile!.id, resolvedPrompt: prompt, inputs },
    );
    console.log(
      `  → gen ${res.generation.id} status=${res.generation.status} reused=${String(res.reused)} cost=${res.costCents}¢ asset=${res.assetId}`,
    );
    return res;
  }

  console.log('\n=== PIEZAS ÚNICAS (2 submits reales, cost>0) ===');
  const a1 = await gen('pieceA (unique)', prompts.A);
  const b1 = await gen('pieceB (unique)', prompts.B);

  console.log('\n--- Asserts piezas únicas ---');
  for (const [n, r] of [['A', a1], ['B', b1]] as const) {
    assert(r.reused === false, `piece${n} reused=false (submit real)`);
    assert(r.costCents > 0, `piece${n} cost>0 (${r.costCents}¢ — square_hd factura ≥1¢)`);
    assert(r.generation.status === 'completed', `piece${n} generation completed`);
    assert(typeof r.assetId === 'string' && r.assetId.length > 0, `piece${n} assetId real (${r.assetId})`);
  }

  console.log('\n=== REÚSOS (2 re-peticiones idénticas, reused:true cost:0) ===');
  const a2 = await gen("pieceA' (reuse)", prompts.A);
  const b2 = await gen("pieceB' (reuse)", prompts.B);

  console.log('\n--- Asserts reúso (dedup muerde end-to-end) ---');
  for (const { n, first, again } of [
    { n: 'A', first: a1, again: a2 },
    { n: 'B', first: b1, again: b2 },
  ]) {
    assert(again.reused === true, `piece${n}' reused=true`);
    assert(again.costCents === 0, `piece${n}' cost=0 (0 gasto, ${again.costCents}¢)`);
    assert(
      again.generation.id === first.generation.id,
      `piece${n}' MISMA generation.id (${again.generation.id} === ${first.generation.id})`,
    );
    assert(again.assetId === first.assetId, `piece${n}' MISMO assetId (${again.assetId})`);
  }

  console.log('\n=== NONCE de esta corrida (para queries SQL) ===');
  console.log(NONCE);
  console.log(`\n=== IDs únicos: A=${a1.generation.id} B=${b1.generation.id} ===`);
  console.log(`\n=== RESULTADO: ${failures === 0 ? 'TODOS LOS ASSERTS OK ✓' : `${failures} FALLO(S) ✗`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-dedup-hd: falló', err);
  process.exit(1);
});
