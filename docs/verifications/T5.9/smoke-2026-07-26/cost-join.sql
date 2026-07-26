-- Coste REAL por endpoint del smoke-test: cost_entry ⨝ generation ⨝ step_run
-- Filtrado por el run de generación del smoke (parametrizar :run_id via psql -v).
-- Muestra: node_key, provider, amount_cents, duración facturada (generation.duration_s),
-- fal_request_id real, model_profile (endpoint).
\pset format aligned
SELECT
  sr.node_key,
  ce.provider,
  ce.amount_cents,
  ce.quantity,
  ce.unit,
  g.duration_s      AS gen_duration_s,
  g.cost_actual     AS gen_cost_actual,
  g.model_profile_id,
  mp.fal_endpoint,
  g.fal_request_id,
  g.status          AS gen_status,
  ce.occurred_at
FROM cost_entry ce
LEFT JOIN generation g   ON g.id = ce.generation_id
LEFT JOIN step_run sr    ON sr.id = ce.step_run_id
LEFT JOIN model_profile mp ON mp.id = g.model_profile_id
WHERE sr.run_id = :'run_id'
ORDER BY ce.occurred_at, sr.node_key;

-- Total del run
SELECT ce.provider, count(*) AS n, sum(ce.amount_cents) AS total_cents
FROM cost_entry ce
LEFT JOIN step_run sr ON sr.id = ce.step_run_id
WHERE sr.run_id = :'run_id'
GROUP BY ce.provider
ORDER BY ce.provider;
