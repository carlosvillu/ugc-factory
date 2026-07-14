// Contrato del listado `GET /api/runs` (T1.17, Apéndice E). Es la vista PÚBLICA de la
// lista de runs: lo que el route handler serializa y la página `/runs` (RSC vía
// api-server) valida y pinta. Definido UNA vez en core; handler y cliente lo comparten
// (un drift servidor↔página revienta en test, no en producción). Mismo patrón que
// `SpendSummarySchema` (T0.12).
//
// ────────────────────────────────────────────────────────────────────────────────────
// EL ESTADO DEL RUN SE DERIVA DE SUS STEPS. NO SE LEE DE `pipeline_run.status`.
// ────────────────────────────────────────────────────────────────────────────────────
//
// `pipeline_run.status` EXISTE en el schema (§12) pero NADIE LO MANTIENE: el orquestador
// (`transition()`) mueve `step_run.status` y nunca recomputa el agregado del run — deuda
// diferida de T0.8, ya anotada por el verifier de T1.15 y documentada en el propio
// `readRunSnapshot` («NO computa run.status derivado: la verdad son los estados de STEP»).
// En la BD local de desarrollo los CUATRO runs reales dicen `pending`, incluidos los dos
// que completaron sus 3 steps y los dos que murieron en N3. Un listado que pintara esa
// columna a pelo MENTIRÍA en el 100 % de las filas.
//
// Por eso T1.17 DERIVA el agregado de los steps (`deriveRunStatus`, aquí abajo), que es
// exactamente lo que ya hace el SSE del canvas: la verdad vive donde vive hoy. Arreglar el
// agregado (que `transition()` lo mantenga) es una tarea de ORQUESTADOR, no de listado:
// queda como deuda explícita, y el día que se haga, esta derivación seguirá siendo el
// oráculo contra el que comprobar que la columna dice la verdad.
//
// LAS COLUMNAS DEL DINERO (`pipeline_run.total_cost_actual`, `step_run.cost_actual`) MENTÍAN
// IGUAL — y eso SÍ se arregló, en T1.20. Hasta entonces, el rollup (T1.10b) vivía en el consumer
// del worker y solo corría al CERRAR BIEN un step, de modo que un step que FALLABA dejaba la
// columna NULL **habiendo gastado** (los dos N3 muertos: NULL en la columna, 16 y 13 céntimos en
// `cost_entry`), y el agregado por run no lo mantenía nadie. T1.20 movió el rollup a
// `applyTransition` —el embudo por el que pasan TODOS los cierres— y backfilló los datos viejos.
//
// AUN ASÍ el coste de este listado se agrega del LEDGER (`cost_entry`, append-only), no de las
// columnas: el ledger es la VERDAD del dinero y las columnas una proyección de él. Ver
// `packages/db/src/repos/run-list.repo.ts`. El ESTADO agregado sigue derivándose (arriba), porque
// esa columna sigue sin mantenerse.
import { z } from 'zod';

/**
 * Los 7 estados de un run (§7.1.e / pgEnum `run_status`), verbatim. Se declara aquí —y no
 * se importa de db— porque este es el contrato PÚBLICO del listado y `apps/web` no puede
 * importar el schema de persistencia en un componente. La unión es cerrada: un estado nuevo
 * es una decisión de contrato.
 */
const RunStatusSchema = z.enum([
  'pending',
  'running',
  'waiting_approval',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * El ORIGEN del run: qué se analizó. Discriminado por `source`, el mismo discriminante que
 * el intake (`AnalysisN1Config`) y que `url_analysis.source`:
 *
 *   · `url`    → la URL que N1 scrapeó (la que el usuario pegó en el intake).
 *   · `manual` → texto libre: no hay URL que enseñar (el análisis ya existía, N1 solo lo cargó).
 *   · `other`  → el run no es de análisis (los DAGs de demo de F0, o los lotes de F2+): no
 *                hay origen que mostrar. NO se inventa uno.
 *
 * De dónde sale: de la `config` del step N1 del run (`{source, url}` / `{source, analysisId}`),
 * que es el INPUT del intake y está persistida desde la creación del run. NO hay FK
 * `pipeline_run → url_analysis` (comprobado en el schema): la única atadura real entre un run
 * y lo que analizó es esa config — y a diferencia del `output_refs` de N1, existe desde el
 * INSTANTE en que el run se crea (un run que aún no ha scrapeado, o que murió scrapeando, ya
 * sabe decir qué URL le pidieron).
 */
const RunOriginSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('url'), url: z.string() }),
  z.object({ source: z.literal('manual') }),
  z.object({ source: z.literal('other') }),
]);
// No se declara un alias `RunOrigin`: sus consumidores (la tabla de `/runs`, el repo) lo
// estrechan desde `RunListItem['origin']`, que es la única forma en que se usa. Un alias
// exportado sin consumidor lo veta knip; uno sin exportar es código muerto.

/** Una fila del listado `/runs`. */
export const RunListItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['full', 'partial', 'regen']),
  createdAt: z.string(), // ISO 8601 (el JSON no tiene tipo fecha; la UI la formatea)
  /** Estado AGREGADO, DERIVADO de los steps (ver `deriveRunStatus`). Nunca `pipeline_run.status`. */
  status: RunStatusSchema,
  /** Qué se analizó (o `other` si el run no es de análisis). */
  origin: RunOriginSchema,
  /** Coste REAL acumulado en céntimos enteros, agregado desde el LEDGER (`cost_entry`), NO desde
   *  `step_run.cost_actual` (que queda NULL en los steps que fallaron habiendo gastado). Incluye
   *  el gasto de los intentos `superseded`: el dinero del intento invalidado se gastó de verdad. */
  costActualCents: z.number().int(),
  /** El paso en curso / el que decide el estado (`node_key`), o `null` si no hay ninguno relevante. */
  currentStep: z.string().nullable(),
  /** Mensaje del error del step que hizo fallar el run, recortado. `null` si el run no falló. */
  error: z.string().nullable(),
});
export type RunListItem = z.infer<typeof RunListItemSchema>;

/** Página del listado: los runs + el total (paginación simple por `limit`/`offset`). */
export const RunListSchema = z.object({
  runs: z.array(RunListItemSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type RunList = z.infer<typeof RunListSchema>;

/** Límites de la paginación simple (sin filtros ni búsqueda: eso es T5.10). */
export const RUN_LIST_DEFAULT_LIMIT = 25;
export const RUN_LIST_MAX_LIMIT = 100;

/**
 * Query params de `GET /api/runs`. Vienen del querystring (strings) → se coercen a enteros.
 * `limit` se acota a `RUN_LIST_MAX_LIMIT` en el schema (un `?limit=1000000` no puede tumbar
 * la BD desde fuera).
 */
export const RunListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(RUN_LIST_MAX_LIMIT).default(RUN_LIST_DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});
// El TIPO de la query no se exporta: su único consumidor es el route handler, que lo INFIERE
// del schema vía `withRoute` (knip veta el export sin consumidor).

// ────────────────────────────────────────────────────────────────────────────────────────
// LA DERIVACIÓN
// ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Los 13 estados de `step_run.status` (§7.1), verbatim: la ENTRADA de la derivación.
 *
 * Unión de tipos y no un `const` + `z.enum`: esto NO valida datos de la frontera (los estados de
 * step llegan del propio `step_run`, ya tipados por el repo — no de un cliente HTTP), así que un
 * schema Zod aquí sería peso muerto. Lo que sí hace falta es que la derivación sea TOTAL sobre
 * los 13: el `switch`/`some` de abajo lo garantiza con este tipo, y el test lo recorre entero.
 */
export type RunStepStatus =
  | 'awaiting_deps'
  | 'pending'
  | 'queued'
  | 'submitting'
  | 'running'
  | 'waiting_approval'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'skipped'
  | 'cancelled'
  | 'expired'
  | 'superseded';

/**
 * Estado AGREGADO del run derivado de los estados de sus steps (T1.17). Función PURA: es la
 * decisión central de la tarea y por eso vive en core con su unit test, no enterrada en un
 * `CASE` de SQL que solo se puede probar con una BD levantada.
 *
 * REGLA, por PRECEDENCIA (el primero que casa gana). Cada rama responde a «¿qué le pasa a
 * este run AHORA, en una palabra?», que es la pregunta que el listado contesta:
 *
 *   1. `failed`           — algún step está `failed` o `expired` (timeout del sweeper, T0.9).
 *                           Un fallo TERMINAL domina: da igual que otros steps completaran, el
 *                           run no va a producir su artefacto. Es lo que hace que los dos runs
 *                           muertos en N3 se vean muertos.
 *   2. `cancelled`        — algún step está `cancelled` o `rejected` (el humano lo paró/rechazó
 *                           en un checkpoint) y ninguno falló. Terminal por decisión humana:
 *                           NO es un fallo del sistema y no debe pintarse como tal.
 *   3. `waiting_approval` — algún step espera decisión humana (CP1…). El run está VIVO pero
 *                           bloqueado en TI: es la señal más accionable del listado, así que
 *                           gana a `running` (un run parado en un checkpoint con otro step
 *                           corriendo en paralelo sigue necesitando que entres).
 *   4. `running`          — algún step está `running`, `submitting` o `queued`: hay trabajo en
 *                           vuelo. (`queued` = ya encolado en pg-boss ⇒ el run ARRANCÓ; pintarlo
 *                           `pending` diría que no ha empezado, y sí ha empezado.)
 *   5. `succeeded`        — TODOS los steps terminaron OK (`succeeded` o `skipped` — un nodo
 *                           auto-descartado, como N2 sin imágenes, SATISFACE su dependencia:
 *                           T0.8). Se exige al menos un step: un run sin steps no es un éxito.
 *   6. `pending`          — el resto: solo `awaiting_deps`/`pending` (recién creado, nada
 *                           encolado aún). También el run SIN steps (imposible por
 *                           `createRun`, pero la función es total).
 *
 * `superseded` NO PUNTÚA (se filtra): la invalidación de T0.8 crea una fila NUEVA con el
 * mismo `node_key` y marca la vieja `superseded`. Contar la vieja haría que un run reintentado
 * con éxito arrastrase para siempre el estado del intento anterior. La verdad de un nodo es su
 * fila VIVA. (Consecuencia: un run cuyos steps sean TODOS `superseded` cae a `pending` — no
 * existe en la práctica, pero la regla es total y no lanza.)
 *
 * `expired` (estado de RUN) no se emite nunca: el timeout de un step lo observamos como fallo
 * del run (rama 1) — un run cuyo N3 expiró está, para el usuario, tan muerto como uno que falló,
 * y la distinción vive en el step, que es donde se puede accionar (retry).
 */

/**
 * LA TABLA DE PRECEDENCIA, **UNA SOLA VEZ**. Ordenada: gana el primer rango con algún step vivo.
 *
 * Es la fuente ÚNICA de las DOS funciones de abajo, y eso no es higiene cosmética — es la
 * corrección de un fallo SILENCIOSO. Antes cada función llevaba su propia copia (una como cadena
 * de `if/some`, otra como `Record<RunStatus, …>`), y bastaba con añadir un estado al rango
 * `running` de una y olvidar la otra para que `deriveCurrentStep` devolviera `null` en un run
 * VIVO: la fila del listado diría «en curso» señalando el paso «—», sin que ningún test se
 * enterase. Con una tabla, ese desajuste ya no se puede escribir.
 *
 * Solo aparecen los rangos que **EXPLICAN** el estado con un step concreto. `succeeded` y
 * `pending` no están a propósito: en un run completado o recién creado no hay «paso actual» —el
 * run entero es la respuesta—, y por eso `deriveCurrentStep` devuelve `null` en ellos. `expired`
 * (estado de RUN) tampoco: esta derivación NO lo emite jamás (un step expirado es un run
 * `failed`, rama 1).
 */
const PRECEDENCE = [
  ['failed', ['failed', 'expired']],
  ['cancelled', ['cancelled', 'rejected']],
  ['waiting_approval', ['waiting_approval']],
  ['running', ['running', 'submitting', 'queued']],
] as const satisfies readonly (readonly [RunStatus, readonly RunStepStatus[]])[];

/** Los steps que CUENTAN: `superseded` fuera (ver la nota de `deriveRunStatus`). */
function liveOnly<T extends { status: RunStepStatus }>(steps: readonly T[]): T[] {
  return steps.filter((s) => s.status !== 'superseded');
}

export function deriveRunStatus(stepStatuses: readonly RunStepStatus[]): RunStatus {
  const live = liveOnly(stepStatuses.map((status) => ({ status })));
  if (live.length === 0) return 'pending';

  for (const [status, explained] of PRECEDENCE) {
    if (live.some((s) => (explained as readonly RunStepStatus[]).includes(s.status))) return status;
  }
  // Ningún rango de la tabla casa ⇒ o todos terminaron OK, o el run aún no ha arrancado.
  // (`skipped` cuenta como OK: un nodo auto-descartado SATISFACE su dependencia, T0.8.)
  if (live.every((s) => s.status === 'succeeded' || s.status === 'skipped')) return 'succeeded';
  return 'pending';
}

/**
 * El step que EXPLICA el estado derivado: el que hizo fallar el run, el que espera aprobación, el
 * que está corriendo… `null` si ninguno lo explica (run `succeeded` o `pending`: ahí no hay «paso
 * actual», el run entero es la respuesta).
 *
 * Consume LA MISMA `PRECEDENCE` que `deriveRunStatus` —de verdad, no «según el comentario»—, así
 * que el listado NO PUEDE decir «fallido» y señalar a la vez un step que corre. Entre varios
 * candidatos del mismo rango gana el PRIMERO en el orden que le llega (los steps se leen
 * ordenados por id = orden de creación = orden topológico del DAG).
 */
export function deriveCurrentStep<T extends { status: RunStepStatus; nodeKey: string }>(
  steps: readonly T[],
): T | null {
  const live = liveOnly(steps);
  const status = deriveRunStatus(live.map((s) => s.status));

  const tier = PRECEDENCE.find(([s]) => s === status);
  if (!tier) return null; // `succeeded`/`pending`: no hay paso que señalar

  const explained = tier[1] as readonly RunStepStatus[];
  return live.find((s) => explained.includes(s.status)) ?? null;
}
