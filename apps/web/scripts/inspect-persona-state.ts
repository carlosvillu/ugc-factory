// INSPECCIÓN read-only del dev-DB para T4.12 Pase B (pre-gasto, NO borra, NO gasta). Responde:
//  · cuántas personas hay (roster) y si hay residuo de test;
//  · por persona: cuántos reference_image AI (generationId no-null) vs sintéticos (null);
//  · la query CRÍTICA de seguridad: TODOS los reference_image con generationId null — para confirmar
//    que son sintéticas del seed (2/persona) y NO uploads manuales (que el cleanup borraría por error).
import { createDb, listPersonas, getAssetsByIds } from '@ugc/db';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`FALTA env ${name}`);
  return v;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv('DATABASE_URL'));
  const personas = await listPersonas(db);
  console.log(`\n=== ROSTER: ${String(personas.length)} personas ===`);

  let nullGenTotal = 0;
  const nullGenByPersona: Record<string, number> = {};
  for (const p of personas) {
    const refIds = p.referenceImageIds;
    const assets = refIds.length > 0 ? await getAssetsByIds(db, refIds) : [];
    const ai = assets.filter((a) => a.generationId !== null);
    const synthetic = assets.filter((a) => a.generationId === null);
    nullGenTotal += synthetic.length;
    nullGenByPersona[p.name] = synthetic.length;
    const dims = ai.map((a) => `${String(a.width ?? '?')}x${String(a.height ?? '?')}`).join(',');
    console.log(
      `  ${p.name.padEnd(24)} refs=${String(refIds.length)}  AI=${String(ai.length)} [${dims}]  synthetic(null gen)=${String(synthetic.length)}`,
    );
  }

  console.log(`\n=== SEGURIDAD DEL CLEANUP: reference_image con generationId null ===`);
  console.log(`Total null-generationId reference assets: ${String(nullGenTotal)}`);
  console.log(
    `Esperado si TODO son sintéticas del seed: 2 × ${String(personas.length)} = ${String(personas.length * 2)}`,
  );
  console.log(
    nullGenTotal === personas.length * 2
      ? '✓ Coincide con 2/persona → todos son sintéticas del seed, NO uploads manuales. Cleanup seguro.'
      : `⚠ NO coincide (${String(nullGenTotal)} vs ${String(personas.length * 2)}). Revisar: puede haber uploads manuales o personas con refs desiguales.`,
  );
  console.log('Detalle por persona (null-gen count):', JSON.stringify(nullGenByPersona, null, 2));
}

main().catch((e: unknown) => {
  console.error('INSPECT FALLÓ:', e);
  process.exit(1);
});
