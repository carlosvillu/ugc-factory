// Test de MIGRACIÓN sobre BD SUCIA (T4.10). El hueco que cierra: el gate corre las migraciones sobre
// una BD LIMPIA (Testcontainers clona una template ya migrada), así que era CIEGO a una migración que
// falla sobre una BD CON HISTORIA. La 0020 crea un índice único parcial sobre `content_hash` cuya
// premisa misma es que el sistema PRE-dedup ya generó filas de producción con `content_hash` DUPLICADO:
// sin un backfill que colapse esos duplicados ANTES del CREATE UNIQUE INDEX, `db:migrate` aborta con
// 23505 en cualquier BD real (en producción NO hay `docker down -v`). Este test siembra esos duplicados
// entre la 0019 y la 0020 y afirma que la 0020 (1) NO aborta, (2) deja EXACTAMENTE un superviviente por
// grupo (el winner correcto: prefiere completed, luego id ASC), (3) demota los perdedores a `cancelled`
// SIN borrar sus `cost_entry` (la verdad histórica de /spend). El CONTROL NEGATIVO (documentado abajo)
// confirma que sin el backfill el test se pone ROJO — que MUERDE.
//
// NO usa `createTestDatabase` (que clona la template CON las 20 migraciones ya aplicadas — imposible
// sembrar duplicados que el índice de la 0020 ya rechaza). En su lugar crea una BD VACÍA propia sobre
// el MISMO servidor del contenedor (inject('pgServerUri')) y aplica las migraciones a mano hasta la
// 0019, siembra, y aplica la 0020 real leída de disco (el artefacto que guarda, no una copia).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Client } from 'pg';

const require = createRequire(import.meta.url);
const DRIZZLE_DIR = path.join(path.dirname(require.resolve('@ugc/db/package.json')), 'drizzle');

/** Lee una migración por su `tag` (nombre de fichero sin extensión) y la aplica MIMETIZANDO al migrator
 *  de drizzle: parte el fichero por el separador `--> statement-breakpoint` y ejecuta cada fragmento por
 *  separado (protocolo extendido = un statement por query). Es DELIBERADO no hacer un `query(fileEntero)`:
 *  el objetivo del test es guardar EXACTAMENTE el camino que corre `pnpm db:migrate` en producción, y ese
 *  camino usa este mismo split. (Un fichero corrido entero enmascararía la clase de bug que acaba de
 *  morder: un `--> statement-breakpoint` colado en un COMENTARIO que parte el fichero por un sitio inválido.) */
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';
async function applyMigration(client: Client, tag: string): Promise<void> {
  const sqlText = readFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), 'utf8');
  const statements = sqlText
    .split(STATEMENT_BREAKPOINT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) await client.query(stmt);
}

// Orden real del journal, hasta la 0019 INCLUSIVE (la 0020 se aplica aparte, tras sembrar).
const MIGRATIONS_UP_TO_0019 = [
  '0000_red_wild_child',
  '0001_curious_aqueduct',
  '0002_early_donald_blake',
  '0003_unique_richard_fisk',
  '0004_shallow_solo',
  '0005_tan_white_queen',
  '0006_flashy_hardball',
  '0007_magical_kingpin',
  '0008_product_brief_origin_step',
  '0009_cost_entry_step_run_idx',
  '0010_checkpoint_decision',
  '0011_batch_and_libraries',
  '0012_persona_and_variant_fk',
  '0013_backfill_cost_actual',
  '0014_clumsy_anthem',
  '0015_awesome_starjammers',
  '0016_free_bloodstorm',
  '0017_adorable_richard_fisk',
  '0018_redundant_miss_america',
  '0019_special_wolfpack',
];

const MIGRATION_0020 = '0020_equal_joshua_kane';

// ULIDs EXPLÍCITOS (26 chars Crockford base32). Los usamos para que el orden `id ASC` sea INEQUÍVOCO y
// las aserciones deterministas: si el backfill tuviera un bug de tiebreak (p.ej. `id ASC` puro sin
// preferir completed), una siembra con ids aleatorios podría PASAR por azar. Aquí los ids fijan el
// orden a mano. Orden Crockford: '0' < '1' < ... (base32), así que 01H...0001 < 01H...0002 < ...
const ID = (n: number): string => `01HZZZZZZZZZZZZZZZZZZZZ${n.toString().padStart(3, '0')}`;

const serverUri = (): string => inject('pgServerUri');

function withDb(uri: string, dbName: string): string {
  const url = new URL(uri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/** Crea una BD VACÍA en el servidor del contenedor y aplica las migraciones hasta la 0019. Devuelve un
 *  cliente conectado a ella y su teardown. */
async function freshDbUpTo0019(): Promise<{ client: Client; drop: () => Promise<void> }> {
  const name = `mig_${randomBytes(6).toString('hex')}`;
  const admin = new Client({ connectionString: serverUri() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const client = new Client({ connectionString: withDb(serverUri(), name) });
  await client.connect();
  for (const tag of MIGRATIONS_UP_TO_0019) await applyMigration(client, tag);

  return {
    client,
    drop: async () => {
      await client.end();
      const a = new Client({ connectionString: serverUri() });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}

/** INSERT crudo de una fila `generation` (pre-0020: aún no hay índice que lo rechace). */
async function seedGeneration(
  client: Client,
  row: {
    id: string;
    contentHash: string | null;
    status: string;
    voicePreview?: boolean;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO "generation" ("id", "model_profile_id", "content_hash", "status", "voice_preview")
     VALUES ($1, 'mp-flux', $2, $3, $4)`,
    [row.id, row.contentHash, row.status, row.voicePreview ?? false],
  );
}

/** INSERT crudo de un `cost_entry` atado a una generación (verdad de /spend que el demote DEBE preservar). */
async function seedCostEntry(client: Client, generationId: string): Promise<void> {
  await client.query(
    `INSERT INTO "cost_entry" ("id", "provider", "amount_cents", "generation_id")
     VALUES ($1, 'fal', 42, $2)`,
    [`ce_${randomBytes(8).toString('hex')}`, generationId],
  );
}

async function statusOf(client: Client, id: string): Promise<string | undefined> {
  const r = await client.query<{ status: string }>(
    `SELECT "status" FROM "generation" WHERE "id" = $1`,
    [id],
  );
  return r.rows[0]?.status;
}

describe('migración 0020 sobre BD SUCIA: backfill que colapsa duplicados antes del índice (T4.10)', () => {
  let h: { client: Client; drop: () => Promise<void> };

  beforeAll(async () => {
    h = await freshDbUpTo0019();

    // Grupo A — completed + in-flight, con el completed de id MAYOR (siembra primero el in-flight con
    // id menor). Prueba el tiebreak REAL: el winner debe ser el `completed` A PESAR de tener id mayor,
    // no la fila de id ASC. Si el ORDER BY fuese `id ASC` puro, ganaría el in-flight → aserción roja.
    const HASH_A = 'a'.repeat(64);
    await seedGeneration(h.client, { id: ID(1), contentHash: HASH_A, status: 'submitting' }); // loser (in-flight, id menor)
    await seedGeneration(h.client, { id: ID(2), contentHash: HASH_A, status: 'completed' }); // WINNER (completed, id mayor)
    await seedCostEntry(h.client, ID(1)); // el perdedor SÍ gastó: su cost_entry debe sobrevivir al demote.

    // Grupo B — 2 completed (+ una in-flight). Winner = completed de id MENOR. Verifica que entre dos
    // completed decide el id ASC.
    const HASH_B = 'b'.repeat(64);
    await seedGeneration(h.client, { id: ID(10), contentHash: HASH_B, status: 'completed' }); // WINNER (completed, id menor)
    await seedGeneration(h.client, { id: ID(11), contentHash: HASH_B, status: 'completed' }); // loser
    await seedGeneration(h.client, { id: ID(12), contentHash: HASH_B, status: 'in_progress' }); // loser

    // Grupo C — ALL-IN-FLIGHT (ningún completed). Winner = id ASC. Estados en vuelo variados.
    const HASH_C = 'c'.repeat(64);
    await seedGeneration(h.client, { id: ID(20), contentHash: HASH_C, status: 'submitting' }); // WINNER (id menor)
    await seedGeneration(h.client, { id: ID(21), contentHash: HASH_C, status: 'submitted' }); // loser
    await seedGeneration(h.client, { id: ID(22), contentHash: HASH_C, status: 'in_queue' }); // loser

    // Grupo D — DISJUNCIÓN DE ÍNDICES: una PREVIEW (voice_preview=true) y una fila de PRODUCCIÓN
    // comparten el MISMO hash. La 0019 ya creó el índice de previews (voice_preview=true), así que no
    // puede haber DOS previews con el mismo hash; pero una preview y una producción SÍ conviven (índices
    // disjuntos). El backfill de la 0020 opera SOLO sobre voice_preview=false → la preview NO se toca.
    // (La fila de producción de este hash es única en su scope, así que tampoco se demota.)
    const HASH_D = 'd'.repeat(64);
    await seedGeneration(h.client, {
      id: ID(30),
      contentHash: HASH_D,
      status: 'completed',
      voicePreview: true,
    });
    await seedGeneration(h.client, {
      id: ID(31),
      contentHash: HASH_D,
      status: 'submitting',
      voicePreview: false,
    });

    // Grupo E — filas con content_hash NULL: no colisionan en el índice, no se tocan.
    await seedGeneration(h.client, { id: ID(40), contentHash: null, status: 'submitting' });
    await seedGeneration(h.client, { id: ID(41), contentHash: null, status: 'submitting' });

    // Grupo F — failed duplicada en producción: FUERA de scope (status IN failed) → no se toca, y no
    // choca contra el índice de producción (su predicado excluye failed).
    const HASH_F = 'f'.repeat(64);
    await seedGeneration(h.client, { id: ID(50), contentHash: HASH_F, status: 'failed' });
    await seedGeneration(h.client, { id: ID(51), contentHash: HASH_F, status: 'failed' });

    // AHORA aplicar la 0020 REAL (backfill + índice). NO debe abortar.
    await applyMigration(h.client, MIGRATION_0020);
  });

  afterAll(async () => {
    await h.drop();
  });

  it('la 0020 NO aborta sobre una BD con duplicados de producción vivos', () => {
    // Si hubiera abortado (23505), el beforeAll habría lanzado y ningún test correría. Llegar aquí =
    // la migración se aplicó entera.
    expect(true).toBe(true);
  });

  it('Grupo A (completed + in-flight): sobrevive el COMPLETED aunque su id sea MAYOR (tiebreak: completed primero)', async () => {
    expect(await statusOf(h.client, ID(2))).toBe('completed'); // winner intacto
    expect(await statusOf(h.client, ID(1))).toBe('cancelled'); // loser demoted (NO borrado)
  });

  it('Grupo A: el cost_entry del PERDEDOR sobrevive al demote (verdad histórica de /spend intacta)', async () => {
    const r = await h.client.query(
      `SELECT count(*)::int AS n FROM "cost_entry" WHERE "generation_id" = $1`,
      [ID(1)],
    );
    expect(r.rows[0].n).toBe(1);
  });

  it('Grupo B (2 completed): sobrevive el completed de id MENOR; el otro completed y la in-flight se demotan', async () => {
    expect(await statusOf(h.client, ID(10))).toBe('completed'); // winner
    expect(await statusOf(h.client, ID(11))).toBe('cancelled');
    expect(await statusOf(h.client, ID(12))).toBe('cancelled');
  });

  it('Grupo C (all-in-flight): sobrevive la de id MENOR, el resto a cancelled', async () => {
    expect(await statusOf(h.client, ID(20))).toBe('submitting'); // winner: se MANTIENE su estado en vuelo
    expect(await statusOf(h.client, ID(21))).toBe('cancelled');
    expect(await statusOf(h.client, ID(22))).toBe('cancelled');
  });

  it('Grupo D (preview + producción mismo hash): la preview NO se toca; la producción única sobrevive', async () => {
    expect(await statusOf(h.client, ID(30))).toBe('completed'); // preview intacta (voice_preview=true, fuera del backfill)
    expect(await statusOf(h.client, ID(31))).toBe('submitting'); // producción única en su scope: se mantiene
  });

  it('Grupo E (content_hash NULL): no colisiona, ninguna fila se toca', async () => {
    expect(await statusOf(h.client, ID(40))).toBe('submitting');
    expect(await statusOf(h.client, ID(41))).toBe('submitting');
  });

  it('Grupo F (failed duplicada): fuera de scope, no se toca', async () => {
    expect(await statusOf(h.client, ID(50))).toBe('failed');
    expect(await statusOf(h.client, ID(51))).toBe('failed');
  });

  it('tras la 0020, cada grupo de producción tiene EXACTAMENTE 1 fila en el scope del índice', async () => {
    // El scope del índice: voice_preview=false AND status NOT IN (failed,cancelled). Por hash, debe
    // quedar a lo sumo 1.
    const r = await h.client.query<{ content_hash: string; n: number }>(
      `SELECT "content_hash", count(*)::int AS n
       FROM "generation"
       WHERE "voice_preview" = false
         AND "status" NOT IN ('failed','cancelled')
         AND "content_hash" IS NOT NULL
       GROUP BY "content_hash"
       HAVING count(*) > 1`,
    );
    expect(r.rows).toHaveLength(0);
  });

  it('el índice único de producción existe y BLOQUEA un nuevo duplicado en scope (la migración lo creó)', async () => {
    // Insertar una 2ª fila en scope con el hash del winner del grupo A debe chocar 23505.
    const err = await h.client
      .query(
        `INSERT INTO "generation" ("id", "model_profile_id", "content_hash", "status", "voice_preview")
         VALUES ($1, 'mp-flux', $2, 'submitting', false)`,
        [ID(99), 'a'.repeat(64)],
      )
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect((err as { code?: string } | undefined)?.code).toBe('23505');
  });
});
