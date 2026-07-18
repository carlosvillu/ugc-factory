// VERIFIER script T4.10 — Deduplicación de generación (§9.6, economía Hook×Body×CTA).
// Escrito por el verifier (NO por el implementer). Conduce a mano el escenario que un lote de 3
// variantes del MISMO ÁNGULO emitiría, contra fal REAL (tier keyframe flux-2), y comprueba CONTEOS
// y AHORRO. NO usa el canvas ni el DAG (T4.10 corre STEPLESS).
//
// Escenario: 3 variantes comparten body+CTA+shot, difieren en el hook.
//   V1 (primera pasada): hook1, body, cta, shot  → 4 submits REALES (reused:false, cost>0)
//   V2:                  hook2, body, cta, shot  → hook2 real; body/cta/shot REUTILIZAN (reused:true, 0)
//   V3:                  hook3, body, cta, shot  → hook3 real; body/cta/shot REUTILIZAN (reused:true, 0)
// Piezas ÚNICAS = 3 hooks + 1 body + 1 cta + 1 shot = 6 submits reales.
// Re-peticiones = body×2 + cta×2 + shot×2 = 6 reúsos.
// Counterfactual sin dedup = 12 submits/cost_entry.
//
// Env: DATABASE_URL, ASSETS_DIR, FAL_KEY. Corre SECUENCIAL (runGenerate pollea inline a completion,
// así la re-petición pega en la fila `completed` del ganador — no en la carrera).
import { makeLogger } from '@ugc/core/observability';
import {
  createDb,
  getModelProfileByEndpoint,
  makeLocalStorageAdapter,
} from '@ugc/db';
import { runGenerate } from '@ugc/services';

type GenerateResult = Awaited<ReturnType<typeof runGenerate>>;

const FLUX2_ENDPOINT = 'fal-ai/flux-2';
// NONCE único de esta corrida: garantiza que ningún first-call colisione con historia previa.
const NONCE = `t410-verify-${Date.now()}`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`verify-dedup: falta ${name}`);
    process.exit(1);
  }
  return v;
}

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
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
    console.error(`verify-dedup: no existe model_profile ${FLUX2_ENDPOINT}. pnpm seed:gallery`);
    process.exit(1);
  }

  // Prompts ÚNICOS (con nonce → no colisionan con historia). inputs IDÉNTICOS en re-peticiones.
  const inputs = { image_size: 'square' as const, num_images: 1 };
  const prompts = {
    hook1: `${NONCE} hook-1: excited person pointing at a red gadget, ugc style`,
    hook2: `${NONCE} hook-2: surprised person holding a red gadget, ugc style`,
    hook3: `${NONCE} hook-3: happy person unboxing a red gadget, ugc style`,
    body: `${NONCE} body: close-up demo of a red gadget features on a desk`,
    cta: `${NONCE} cta: red gadget with a discount banner, buy now`,
    shot: `${NONCE} shot: clean product packshot of a red gadget on white`,
  };

  async function gen(label: string, prompt: string): Promise<GenerateResult> {
    console.log(`\n[submit] ${label} :: "${prompt.slice(0, 48)}…"`);
    const res = await runGenerate(
      { db, storage, falKey, logger },
      { modelProfileId: profile!.id, resolvedPrompt: prompt, inputs },
    );
    console.log(
      `  → gen ${res.generation.id} status=${res.generation.status} reused=${String(res.reused)} cost=${res.costCents}¢ asset=${res.assetId} outUrl=${res.falOutputUrl ? 'set' : 'EMPTY'}`,
    );
    return res;
  }

  // ── V1: primera pasada — TODO debe ser submit real (reused:false, cost>0) ──
  console.log('\n=== VARIANTE 1 (primera pasada: 4 submits reales) ===');
  const v1hook = await gen('V1.hook1', prompts.hook1);
  const v1body = await gen('V1.body', prompts.body);
  const v1cta = await gen('V1.cta', prompts.cta);
  const v1shot = await gen('V1.shot', prompts.shot);

  console.log('\n--- Asserts V1 (todas nuevas) ---');
  for (const [name, r] of [
    ['hook1', v1hook],
    ['body', v1body],
    ['cta', v1cta],
    ['shot', v1shot],
  ] as const) {
    assert(r.reused === false, `V1.${name} reused=false (asset nuevo)`);
    assert(r.costCents > 0, `V1.${name} cost>0 (${r.costCents}¢, submit real)`);
    assert(r.generation.status === 'completed', `V1.${name} generation completed`);
    assert(r.falOutputUrl !== '', `V1.${name} falOutputUrl no vacío`);
  }

  // ── V2 y V3: hook nuevo real; body/cta/shot REUTILIZAN (reused:true, 0) ──
  const reuseChecks: Array<{ v: string; first: GenerateResult; again: GenerateResult; piece: string }> =
    [];
  for (const variant of ['V2', 'V3'] as const) {
    const hookKey = variant === 'V2' ? 'hook2' : 'hook3';
    console.log(`\n=== ${variant} (hook nuevo real + body/cta/shot reutilizados) ===`);
    const hook = await gen(`${variant}.${hookKey}`, prompts[hookKey]);
    assert(hook.reused === false, `${variant}.${hookKey} reused=false (hook único, submit real)`);
    assert(hook.costCents > 0, `${variant}.${hookKey} cost>0 (${hook.costCents}¢)`);

    const body = await gen(`${variant}.body`, prompts.body);
    reuseChecks.push({ v: variant, first: v1body, again: body, piece: 'body' });
    const cta = await gen(`${variant}.cta`, prompts.cta);
    reuseChecks.push({ v: variant, first: v1cta, again: cta, piece: 'cta' });
    const shot = await gen(`${variant}.shot`, prompts.shot);
    reuseChecks.push({ v: variant, first: v1shot, again: shot, piece: 'shot' });
  }

  console.log('\n--- Asserts REÚSO (body/cta/shot en V2/V3) ---');
  for (const { v, first, again, piece } of reuseChecks) {
    assert(again.reused === true, `${v}.${piece} reused=true`);
    assert(again.costCents === 0, `${v}.${piece} cost=0 (${again.costCents}¢, 0 gasto)`);
    // Reúso apunta al asset REAL del ganador (no una factory-clean):
    assert(
      again.generation.id === first.generation.id,
      `${v}.${piece} reusa la MISMA generation (${again.generation.id} === ${first.generation.id})`,
    );
    assert(
      again.assetId === first.assetId,
      `${v}.${piece} reusa el MISMO asset (${again.assetId})`,
    );
    assert(again.falOutputUrl !== '', `${v}.${piece} falOutputUrl del asset reutilizado no vacío`);
  }

  console.log('\n=== NONCE de esta corrida (para las queries SQL) ===');
  console.log(NONCE);
  console.log(`\n=== RESULTADO: ${failures === 0 ? 'TODOS LOS ASSERTS OK ✓' : `${failures} FALLO(S) ✗`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('verify-dedup: falló', err);
  process.exit(1);
});
