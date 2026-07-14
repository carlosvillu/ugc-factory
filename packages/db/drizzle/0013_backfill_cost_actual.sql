-- T1.20 — BACKFILL del coste real ya gastado. Migración de DATOS (no toca el schema).
--
-- POR QUÉ. Hasta T1.20, `step_run.cost_actual` solo se escribía al cerrar BIEN un step (el
-- rollup vivía en el consumer del worker). Un step que FALLÓ HABIENDO GASTADO se quedaba con
-- la columna a NULL, y el nodo del canvas mostraba $0,00 con dinero real en el ledger. Lo
-- mismo, un nivel arriba, con `pipeline_run.total_cost_actual` (NULL en todos los runs: nadie
-- lo mantenía). Arreglar el código NO repara los datos históricos: los runs ya muertos del
-- usuario seguirían mostrando $0,00 en su historial para siempre. Eso lo arregla esto.
--
-- LA VERDAD ES `cost_entry` (append-only, escrito record-first por los servicios que pagan).
-- Las dos columnas son una PROYECCIÓN recomputable de él, así que el backfill es exactamente
-- lo mismo que hace el rollup en vivo: recomputar desde el ledger. Idempotente por
-- construcción (correrlo N veces da el mismo resultado).
--
-- LA DECISIÓN QUE HAY QUE DOCUMENTAR: NULL vs 0. El rollup EN VIVO escribe 0 a un step que
-- cerró sin cargos ("se ejecutó y no gastó" — información real). Pero para los datos
-- HISTÓRICOS, un `cost_actual` NULL NO significa "no gastó": significa "no se sabe" (nadie lo
-- calculó nunca). Poner 0 ahí sería INVENTARSE un dato. Por eso el backfill solo toca las
-- filas que tienen cargos en el ledger (`WHERE EXISTS`): a esas les escribe su gasto REAL;
-- las que no tienen ninguno se quedan como estaban (NULL = desconocido, 0 = ya sabido). Esto
-- no rompe ninguna suma: una fila sin cargos aporta 0 al total venga de NULL o de 0.

UPDATE "step_run"
SET "cost_actual" = (
  SELECT sum("cost_entry"."amount_cents")::int
  FROM "cost_entry"
  WHERE "cost_entry"."step_run_id" = "step_run"."id"
)
WHERE EXISTS (
  SELECT 1 FROM "cost_entry" WHERE "cost_entry"."step_run_id" = "step_run"."id"
);
--> statement-breakpoint
-- El AGREGADO del run: se suma del LEDGER (vía step_run), NO sumando `step_run.cost_actual`
-- — así el agregado no puede heredar una mentira de la proyección de abajo, y los dos rollups
-- cuadran al céntimo porque leen la misma verdad. Mismo criterio NULL/0: solo se tocan los
-- runs que tienen cargos.
UPDATE "pipeline_run"
SET "total_cost_actual" = (
  SELECT sum("cost_entry"."amount_cents")::int
  FROM "cost_entry"
  JOIN "step_run" ON "step_run"."id" = "cost_entry"."step_run_id"
  WHERE "step_run"."run_id" = "pipeline_run"."id"
)
WHERE EXISTS (
  SELECT 1
  FROM "cost_entry"
  JOIN "step_run" ON "step_run"."id" = "cost_entry"."step_run_id"
  WHERE "step_run"."run_id" = "pipeline_run"."id"
);
