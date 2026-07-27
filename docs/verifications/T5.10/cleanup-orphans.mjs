// Borra los proyectos REVERIF huérfanos de intentos de seed fallidos, conservando SOLO
// el escenario bueno (arg 1 = projectId a conservar). Solo toca proyectos cuyo nombre
// empieza por 'REVERIF T5.10'. Cascade: project → url_analysis → product_brief → ad_batch
// → ad_variant. cost_entry/pipeline_run/step_run se limpian a mano por si quedaron.
const { createDbPool } = await import('../../../packages/db/src/index.ts');
const { pool } = createDbPool(process.env.DATABASE_URL);
const keep = process.argv[2];
const { rows } = await pool.query(
  `select id, name from project where name like 'REVERIF T5.10%' and id <> $1`,
  [keep],
);
console.log(
  'orphans to delete:',
  rows.map((r) => `${r.id}(${r.name})`),
);
for (const r of rows) {
  // limpiar ledger/runs colgados de sus lotes primero
  await pool.query(
    `delete from cost_entry where step_run_id in (select sr.id from step_run sr join pipeline_run pr on sr.run_id=pr.id where pr.project_id=$1)`,
    [r.id],
  );
  await pool.query(
    `delete from step_run where run_id in (select id from pipeline_run where project_id=$1)`,
    [r.id],
  );
  await pool.query(`delete from pipeline_run where project_id=$1`, [r.id]);
  await pool.query(`delete from project where id=$1`, [r.id]);
}
console.log('done, kept:', keep);
await pool.end();
