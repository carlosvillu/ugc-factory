const { createDbPool } = await import('../../../packages/db/src/index.ts');
const { pool } = createDbPool(process.env.DATABASE_URL);
const { rows } = await pool.query(`select id,name,status from project where name like 'REVERIF%'`);
console.log('remaining REVERIF projects:', JSON.stringify(rows));
for (const r of rows) {
  await pool.query(`delete from cost_entry where step_run_id in (select sr.id from step_run sr join pipeline_run pr on sr.run_id=pr.id where pr.project_id=$1)`,[r.id]);
  await pool.query(`delete from step_run where run_id in (select id from pipeline_run where project_id=$1)`,[r.id]);
  await pool.query(`delete from pipeline_run where project_id=$1`,[r.id]);
  await pool.query(`delete from project where id=$1`,[r.id]);
}
const { rows: after } = await pool.query(`select id,name from project where name like 'REVERIF%'`);
console.log('after cleanup REVERIF projects:', JSON.stringify(after));
await pool.end();
