const { createDbPool } = await import('../../../packages/db/src/index.ts');
const { pool } = createDbPool(process.env.DATABASE_URL);
const { rows } = await pool.query(`select id,name,status from project where name=$1`, [process.argv[2]]);
console.log(JSON.stringify(rows));
await pool.end();
