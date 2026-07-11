// VERIFIER T1.9 — extra del verifier (NO lo pide la Verificación literal, pero el repo AFIRMA
// que el `ON CONFLICT DO NOTHING` es la barrera ATÓMICA que hace que "dos análisis CONCURRENTES
// del mismo dominio no creen dos kits". Esa afirmación se comprueba, no se cree: 8 análisis del
// MISMO dominio EN PARALELO contra Postgres 16 real. La cláusula 3 dice "UNA SOLA VEZ" — si la
// concurrencia crea 2 filas, la cláusula se rompe en producción aunque el caso secuencial pase.
//
// Coste: $0.
import { createTestDatabase, startPostgresContainer } from '@ugc/test-utils';
import { upsertBrandKitByDomain } from '../../../packages/db/src/repos/brand-kit.repo';

async function main(): Promise<void> {
  const harness = await startPostgresContainer();
  const tdb = await createTestDatabase({
    label: 'T1.9-concurrency',
    serverUri: harness.serverUri,
    templateDb: harness.templateDb,
  });

  const N = 8;
  const t0 = new Date('2026-07-11T09:00:00.000Z');

  // 8 análisis CONCURRENTES del mismo dominio, cada uno con SU timestamp distinto.
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      upsertBrandKitByDomain(tdb.db, {
        projectId: null,
        domain: 'carrera.example',
        source: 'extracted',
        palette: [`#00000${i}`],
        typography: null,
        toneOfVoice: `analisis-${i}`,
        aesthetic: 'x',
        extractedAt: new Date(t0.getTime() + i * 60_000),
      }),
    ),
  );

  const extracted = results.filter((r) => !r.reused);
  const reused = results.filter((r) => r.reused);
  const rows = await tdb.pool.query(
    `SELECT id, tone_of_voice, extracted_at FROM brand_kit WHERE domain = 'carrera.example'`,
  );
  const ids = new Set(results.map((r) => r.kit.id));

  console.log(`${N} análisis CONCURRENTES del MISMO dominio (carrera.example):`);
  console.log(`  extrajeron (reused=false): ${extracted.length}`);
  console.log(`  reutilizaron (reused=true): ${reused.length}`);
  console.log(`  FILAS REALES en brand_kit: ${rows.rowCount}`);
  console.log(`  ids distintos devueltos: ${ids.size}`);
  console.log(`  fila ganadora: ${JSON.stringify(rows.rows[0])}`);

  let failures = 0;
  const check = (label: string, cond: boolean, detail: string): void => {
    if (!cond) failures += 1;
    console.log(`${cond ? 'OK  ' : 'FAIL'} | ${label} | ${detail}`);
  };

  console.log();
  check('CONC el BrandKit se extrajo UNA SOLA VEZ (1 sola fila)', rows.rowCount === 1, `rowCount=${rows.rowCount}`);
  check('CONC exactamente 1 análisis extrajo; los otros 7 reutilizaron', extracted.length === 1 && reused.length === N - 1, `extracted=${extracted.length} reused=${reused.length}`);
  check('CONC los 8 devuelven la MISMA fila (mismo id)', ids.size === 1, `ids=${ids.size}`);

  await tdb.close();
  await harness.stop();
  console.log();
  console.log(failures === 0 ? '=== TODO OK (0 fallos) ===' : `=== ${failures} FALLO(S) ===`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
