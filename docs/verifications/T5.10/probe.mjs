// Probe SQL de valores esperados del escenario (verifier T5.10). Solo lectura.
const { createDbPool } = await import('../../../packages/db/src/index.ts');
const { pool } = createDbPool(process.env.DATABASE_URL);
const pid = process.argv[2] ?? '01KYGJC53NHM0YWDZ9ZB2RJZ8Q';
const q = async (label, text) => {
  const r = await pool.query(text, [pid]);
  console.log(label, JSON.stringify(r.rows));
};
await q(
  'project_month',
  `select coalesce(sum(ce.amount_cents),0)::int as c from cost_entry ce join step_run sr on ce.step_run_id=sr.id join pipeline_run pr on sr.run_id=pr.id where pr.project_id=$1 and ce.occurred_at >= date_trunc('month', now())`,
);
await q(
  'project_alltime',
  `select coalesce(sum(ce.amount_cents),0)::int as c from cost_entry ce join step_run sr on ce.step_run_id=sr.id join pipeline_run pr on sr.run_id=pr.id where pr.project_id=$1`,
);
await q(
  'per_batch_month',
  `select pr.batch_id, coalesce(sum(ce.amount_cents),0)::int as c from cost_entry ce join step_run sr on ce.step_run_id=sr.id join pipeline_run pr on sr.run_id=pr.id where pr.project_id=$1 and ce.occurred_at >= date_trunc('month', now()) group by pr.batch_id order by pr.batch_id`,
);
await q(
  'variants_by_status',
  `select v.status, count(*)::int as n from ad_variant v join ad_batch b on v.batch_id=b.id where b.project_id=$1 group by v.status order by v.status`,
);
await q(
  'global_month',
  `select coalesce(sum(amount_cents),0)::bigint as c from cost_entry where occurred_at >= date_trunc('month', now()) and $1 is not null`,
);
await pool.end();
