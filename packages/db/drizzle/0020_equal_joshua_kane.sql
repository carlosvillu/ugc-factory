-- T4.10 — DEDUP GLOBAL DE PRODUCCIÓN. Migración de DATOS + DDL en un solo fichero (drizzle ejecuta
-- ambos statements en orden, separados por un breakpoint de statement).
--
-- POR QUÉ EL BACKFILL. La premisa MISMA de T4.10 es que el sistema PRE-dedup ya generó filas de
-- producción con `content_hash` DUPLICADO (un lote de 3 variantes del mismo ángulo comparte body/CTA
-- → 3 generaciones con el mismo hash). Crear el índice único parcial directamente sobre una BD con
-- historia ABORTA con `23505 duplicate key`: en producción NO hay `docker down -v`, así que hay que
-- COLAPSAR los duplicados vivos ANTES del CREATE UNIQUE INDEX. El gate usa Testcontainers (BD limpia)
-- y por eso no lo veía; un test de migración sobre BD sucia (integración) cierra ese hueco de clase.
--
-- ALCANCE = EL MISMO PREDICADO DEL ÍNDICE: `voice_preview = false AND status NOT IN
-- ('failed','cancelled')`. Ese scope INCLUYE las filas EN VUELO (submitting/submitted/in_queue/
-- in_progress), no solo las `completed`. NO se tocan las previews (`voice_preview = true`: su índice
-- de T4.6 es disjunto y ya funciona) ni las `failed`/`cancelled` (ya fuera del scope). Las filas sin
-- `content_hash` (`IS NOT NULL`) no colisionan en el índice → no se tocan.
--
-- WINNER POR GRUPO: `ORDER BY (status = 'completed') DESC, id ASC`. Prefiere una fila `completed`
-- (en Postgres, boolean DESC pone TRUE primero); entre iguales, el `id` más pequeño. `id` es un ULID
-- (`ulidPk()`), así que `id ASC` = la fila más ANTIGUA por creación (NO hay `created_at` en
-- `generation`; `started_at` es nullable). Se mantiene el winner de cada grupo.
--
-- LOSERS → DEMOTE a `status = 'cancelled'` (NO delete). `asset.generation_id` y
-- `cost_entry.generation_id` son nullable SIN FK, así que demote es trivialmente seguro y —clave—
-- PRESERVA los `cost_entry` de los perdedores: el dinero se gastó DE VERDAD, y borrar la generación
-- corrompería la verdad histórica de `/spend`. Demote saca al perdedor del scope del índice (queda
-- `cancelled`) sin destruir el ledger. Un grupo all-in-flight (sin ninguna `completed`) se resuelve
-- igual: sobrevive la de `id ASC`, el resto se demotan. (Consistencia conocida y correcta: un
-- superviviente demoted-pero-in-flight es invisible a `getCompletedGenerationByContentHash` —que
-- filtra `status='completed'`—; el runtime ON CONFLICT + el sweeper de T4.3 lo manejan.)
WITH ranked AS (
	SELECT "id", ROW_NUMBER() OVER (
		PARTITION BY "content_hash"
		ORDER BY ("status" = 'completed') DESC, "id" ASC
	) AS rn
	FROM "generation"
	WHERE "voice_preview" = false
		AND "status" NOT IN ('failed', 'cancelled')
		AND "content_hash" IS NOT NULL
)
UPDATE "generation" SET "status" = 'cancelled'
WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);--> statement-breakpoint
CREATE UNIQUE INDEX "generation_production_content_hash_key" ON "generation" USING btree ("content_hash") WHERE "generation"."voice_preview" = false and "generation"."status" not in ('failed', 'cancelled');