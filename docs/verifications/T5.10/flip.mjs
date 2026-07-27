const { createDbPool } = await import('../../../packages/db/src/index.ts');
const { pool } = createDbPool(process.env.DATABASE_URL);
const vid = process.argv[2];
const to = process.argv[3];
await pool.query(`update ad_variant set status=$2 where id=$1`, [vid, to]);
const { rows } = await pool.query(`select id,status from ad_variant where id=$1`, [vid]);
console.log('flipped', JSON.stringify(rows));
await pool.end();
