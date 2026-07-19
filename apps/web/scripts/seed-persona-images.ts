// ESCALADO de referencias IA de Personas (T4.12 Pase B): genera con fal REAL las referencias de identity
// lock de cada persona que aún no las tiene (las 8 nuevas del catálogo; LUCIA/MARCUS ya las tienen del
// sample) y LIMPIA las referencias sintéticas del seed, de modo que cada persona quede SOLO con ≥2
// referencias IA del MISMO sujeto — la cláusula 1 de la Verificación («10 Personas activas con
// referencias consistentes»).
//
// ┌─ GASTO REAL (crítico) ──────────────────────────────────────────────────────────────────────────┐
// │ Este script SUBMITE a fal (FLUX.2 + nano-banana-2/edit) y FACTURA. Coste ~ (base FLUX + 3×NB2 2K  │
// │ a ~12¢) ≈ $0.40/persona. El bucle lo corre con presupuesto autorizado (journal 2026-07-19: 3      │
// │ encuadres/persona, acumulado ~$5.1). Es IDEMPOTENTE/RESUMIBLE: una persona que ya tiene ≥2         │
// │ referencias IA se SALTA (no re-gasta). Re-correrlo tras un corte solo genera lo que falta.         │
// └───────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// ⚠ ONE-SHOT DE ESCALADO, NO RUTINA: la limpieza borra `reference_image` con `generationId === null`. En
// el dev-DB eso es exactamente «sintética del seed». Pero una referencia SUBIDA A MANO por el CRUD también
// tiene `generationId` null → NO correr este script contra una BD con uploads manuales (borraría el
// trabajo del usuario). Ver `persona-reference-cleanup.ts` para el detalle del discriminador.
//
// Env: DATABASE_URL, ASSETS_DIR, FAL_KEY (mismo contrato que `smoke:generate`). Turnkey:
// `pnpm --filter @ugc/web seed:persona-images`. Requiere la galería sembrada (model_profiles FLUX.2 y
// nano-banana-2/edit) y las personas sembradas (`pnpm seed`).
import { makeLogger } from '@ugc/core/observability';
import { REFERENCE_FRAMINGS } from '@ugc/core/persona';
import {
  createDb,
  getAssetsByIds,
  getPersona,
  listPersonas,
  makeLocalStorageAdapter,
  removeReferenceImage,
} from '@ugc/db';
import {
  MIN_AI_REFERENCES,
  partitionPersonaReferences,
  runGeneratePersonaImages,
} from '@ugc/services';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`seed:persona-images: falta ${name}`);
    process.exit(1);
  }
  return v;
}

/** Cuenta las referencias IA (generationId no-null) actuales de una persona leyendo sus assets. */
async function countAiReferences(
  db: ReturnType<typeof createDb>,
  personaId: string,
): Promise<number> {
  const persona = await getPersona(db, personaId);
  if (persona === undefined) return 0;
  const assets = await getAssetsByIds(db, persona.referenceImageIds);
  return partitionPersonaReferences(assets).aiRefIds.length;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv('DATABASE_URL');
  const assetsDir = requireEnv('ASSETS_DIR');
  const falKey = requireEnv('FAL_KEY');

  const db = createDb(databaseUrl);
  const storage = makeLocalStorageAdapter({ root: assetsDir });
  const logger = makeLogger({ name: 'worker', level: 'info' });

  const personas = await listPersonas(db);
  console.log(
    `seed:persona-images: ${String(personas.length)} personas · objetivo ≥${String(MIN_AI_REFERENCES)} referencias IA cada una (RED REAL, GASTA)\n`,
  );

  let totalCostCents = 0;
  const strandedWarnings: string[] = [];

  for (const persona of personas) {
    const existingAi = await countAiReferences(db, persona.id);

    // 1) GENERAR lo que falte (idempotente: si ya tiene ≥MIN, no re-gasta).
    if (existingAi >= MIN_AI_REFERENCES) {
      console.log(
        `  [skip] ${persona.name}: ya tiene ${String(existingAi)} referencias IA (no re-genera)`,
      );
    } else {
      console.log(
        `  [gen ] ${persona.name}: ${String(existingAi)} referencias IA → generando ${String(REFERENCE_FRAMINGS.length)} encuadres…`,
      );
      const result = await runGeneratePersonaImages(
        { db, storage, falKey, logger },
        { personaId: persona.id },
      );
      totalCostCents += result.costCents;
      console.log(
        `         +${String(result.images.length)} referencias IA · ${String(result.costCents)}¢` +
          (result.warnings.length > 0 ? ` · warnings: ${result.warnings.join('; ')}` : ''),
      );
    }

    // 2) LIMPIAR las sintéticas del seed — SOLO en la FASE DE CLEANUP (`PERSONA_CLEANUP=1`). La
    //    generación (fase 1) es ADITIVA: no borra nada, solo gasta. El borrado va en una pasada
    //    SEPARADA tras verificar el estado (cada persona con EXACTAMENTE 3 AI refs), de modo que el
    //    primer-gasto-real y el primer-borrado-live nunca sean la misma ejecución. Sin el flag, este
    //    script solo genera lo que falte. Con el flag, la generación all-skip y solo se limpia.
    if (process.env.PERSONA_CLEANUP !== '1') continue;

    //    Guard anti-stranding: nunca dejar una persona con <MIN referencias IA por borrar sus sintéticas
    //    (protege contra un fallo parcial de generación previo).
    const fresh = await getPersona(db, persona.id);
    if (fresh === undefined) continue;
    const assets = await getAssetsByIds(db, fresh.referenceImageIds);
    const { aiRefIds, syntheticRefIds } = partitionPersonaReferences(assets);

    if (aiRefIds.length < MIN_AI_REFERENCES) {
      const warn = `${persona.name}: solo ${String(aiRefIds.length)} referencias IA (<${String(MIN_AI_REFERENCES)}) — NO se limpian las ${String(syntheticRefIds.length)} sintéticas (evitar stranding). Revisar/regenerar.`;
      console.warn(`         ⚠ ${warn}`);
      strandedWarnings.push(warn);
      continue;
    }

    for (const assetId of syntheticRefIds) {
      const removed = await removeReferenceImage(db, persona.id, assetId);
      if (removed !== null) await storage.delete(removed.storageKey);
    }
    if (syntheticRefIds.length > 0) {
      console.log(
        `         limpiadas ${String(syntheticRefIds.length)} referencias sintéticas → quedan ${String(aiRefIds.length)} IA`,
      );
    }
  }

  console.log(
    `\nseed:persona-images: coste total = ${String(totalCostCents)}¢ (→ /spend)` +
      (strandedWarnings.length > 0
        ? `\n⚠ ${String(strandedWarnings.length)} personas con <${String(MIN_AI_REFERENCES)} referencias IA (revisar):\n  - ${strandedWarnings.join('\n  - ')}`
        : ''),
  );
  console.log('seed:persona-images: OK ✓ — inspecciona /personas y /spend');
  process.exit(strandedWarnings.length > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error('seed:persona-images: falló', err);
  process.exit(1);
});
