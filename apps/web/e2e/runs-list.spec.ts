// Regresión permanente del LISTADO de runs (T1.17, e2e.md §10 — DoD BLOQUEANTE): dos runs de
// demo en estados TERMINALES DISTINTOS (uno `failed`, uno `succeeded`) → `/runs` los lista en
// orden, con su estado, y el click en uno lleva a SU canvas. Cubre además la entrada «Runs» de
// la nav global: se llega al listado sin escribir una sola URL (que es LA queja que originó la
// tarea — tras lanzar un run no había forma de volver a él).
//
// El COSTE exacto se assertá en la INTEGRACIÓN, no aquí (BD compartida: `spend.spec.ts` trunca
// el ledger a propósito). El porqué, con detalle, sobre el primer test.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// POR QUÉ ESTE SPEC SIEMBRA POR SQL, ROMPIENDO LA REGLA DE `support/runs.ts`
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// La regla («los runs SIEMPRE se crean vía POST /api/runs, nunca por SQL») existe porque un run
// insertado por SQL NO SE EJECUTA: se salta al orquestador y nunca encola en pg-boss. Para el
// spec del CANVAS, que necesita ver los nodos MOVERSE, eso lo invalidaría.
//
// Aquí es al revés, y por eso la excepción es correcta y no una comodidad: `/runs` es una FOTO
// ESTÁTICA del servidor (un RSC, sin SSE), así que los runs tienen que estar YA en su estado
// terminal ANTES de navegar. Conducir el worker hasta dos estados terminales distintos —uno
// completado, uno muerto— exigiría orquestar checkpoints, esperas y fallos provocados, y el
// test acabaría probando el WORKER en vez del listado, con toda la flakiness de una carrera.
// Lo que este spec verifica es LA LECTURA: dado este estado en la BD, ¿la lista dice la verdad?
// Sembrar el estado directamente es la forma HONESTA de hacer esa pregunta. (Que el orquestador
// llegue a esos estados ya lo prueban `runs-canvas.spec.ts` y `analysis-pipeline.spec.ts`.)
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// LO QUE DE VERDAD SE BLINDA AQUÍ: QUE EL LISTADO NO MIENTA
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// Los DOS runs se siembran con `pipeline_run.status` en su DEFAULT (`pending`) A PROPÓSITO: es
// exactamente lo que hay en la BD REAL (los 4 runs del 2026-07-13 dicen `pending`, incluidos los
// dos que completaron y los dos que murieron — el orquestador nunca mantiene el agregado, deuda
// de T0.8). Uno acabó BIEN y el otro MURIÓ, y la columna dice lo MISMO de los dos.
//
// Así, una implementación que leyera esa columna —la tentación evidente— SUSPENDE aquí: pintaría
// los dos runs IGUALES («pendiente»), y el test exige verlos DISTINTOS (`succeeded` vs `failed`).
import { test, expect, type Page } from '@playwright/test';
import { createDb, createProject } from '@ugc/db';
import { newUlid } from '@ugc/core/contracts';
import { makeProject } from '@ugc/test-utils';
import { queryStack, stackDatabaseUrl } from './support/stack-db';
import { waitCanvasStatus } from './support/canvas';

const db = createDb(stackDatabaseUrl);

interface SeedStep {
  nodeKey: string;
  status: string;
  /** Céntimos que el step dejó en el LEDGER (`cost_entry`) — el dinero gastado DE VERDAD. */
  ledgerCents?: number;
  /** Lo que `rollupStepCost` habría escrito en `step_run.cost_actual` (NULL si el step falló). */
  costActual?: number | null;
  error?: string;
}

/** Siembra un run TERMINAL con sus steps y sus cargos. `pipeline_run.status` se deja en su
 *  DEFAULT (`pending`): la columna que nadie mantiene (ver cabecera). */
async function seedTerminalRun(opts: {
  projectId: string;
  url: string;
  steps: SeedStep[];
}): Promise<string> {
  // `created_at` va a su DEFAULT (now()): el orden del listado lo da la PK (ULID), y `newUlid()`
  // es monotónico — el orden de siembra ES el orden de la lista.
  const runId = newUlid();
  await queryStack(`INSERT INTO pipeline_run (id, project_id, kind) VALUES ($1, $2, 'full')`, [
    runId,
    opts.projectId,
  ]);
  for (const [i, step] of opts.steps.entries()) {
    const stepId = newUlid();
    await queryStack(
      `INSERT INTO step_run (id, run_id, node_key, status, cost_actual, error, config)
       VALUES ($1, $2, $3, $4::step_status, $5, $6::jsonb, $7::jsonb)`,
      [
        stepId,
        runId,
        step.nodeKey,
        step.status,
        step.costActual ?? null,
        step.error === undefined ? null : JSON.stringify({ message: step.error }),
        // El ORIGEN del run sale de la config de N1 (el input del intake): es lo que hace que la
        // fila muestre QUÉ se analizó y no un ULID opaco.
        i === 0
          ? JSON.stringify({ source: 'url', projectId: opts.projectId, url: opts.url })
          : null,
      ],
    );
    if (step.ledgerCents !== undefined) {
      await queryStack(
        `INSERT INTO cost_entry (id, provider, step_run_id, amount_cents) VALUES ($1, 'anthropic', $2, $3)`,
        [newUlid(), stepId, step.ledgerCents],
      );
    }
  }
  return runId;
}

/**
 * La fila del listado de un run, anclada a su ENLACE AL CANVAS (`href="/runs/:id"`).
 *
 * Por el HREF y no por el texto: el texto de la fila cambia según el estado (un run fallido
 * muestra el motivo del fallo donde uno vivo muestra su ULID), así que anclarse al texto haría
 * que el localizador dependiera de lo que el test está intentando comprobar. El href es la
 * identidad estable de la fila — y además es SU contrato: la fila existe para llevarte al run.
 */
function rowLinkOf(page: Page, runId: string) {
  return page.locator(`a[href="/runs/${runId}"]`);
}

function rowOf(page: Page, runId: string) {
  return page.getByRole('row').filter({ has: rowLinkOf(page, runId) });
}

test.describe('listado de runs /runs (T1.17)', () => {
  // `serial`: los dos runs se siembran UNA vez y los tests los observan. La lista muestra TODOS
  // los runs de la BD (otros specs crean los suyos), así que cada assert se ancla a SU fila por
  // el id — nunca a «la primera fila de la tabla».
  test.describe.configure({ mode: 'serial' });

  let deadRunId: string;
  let okRunId: string;
  const DEAD_URL = 'https://muerto.example/producto';
  const OK_URL = 'https://completado.example/producto';

  // LOS RUNS SE SIEMBRAN CON LA FECHA DE AHORA (el default de la tabla) Y EN ESTE ORDEN: primero
  // el muerto, después el completado. Eso basta para que el test sea determinista, y conviene
  // entender por qué:
  //
  //   · El listado ordena por la **PK** (`ORDER BY id DESC`), que es un ULID —monotónico con el
  //     tiempo— y por eso equivale a ordenar por fecha SIN pagar un seq scan (ver `listRuns`).
  //   · `newUlid()` se llama aquí en secuencia ⇒ el ULID del completado es MAYOR que el del
  //     muerto ⇒ el completado sale ARRIBA. Que es exactamente lo que el test afirma.
  //   · Y como son los ULIDs más NUEVOS de la BD del stack en el momento de sembrarlos, caen en
  //     la primera página aunque los demás specs (`runs-canvas`, `analysis-pipeline`…) creen sus
  //     propios runs — el listado PAGINA de 25 en 25 y la BD es COMPARTIDA. (Antes esto se
  //     forzaba con un `created_at` en 2099; ya no hace falta, y así la fila no muestra una fecha
  //     inventada que además ya no es la clave de orden.)

  test.beforeAll(async () => {
    const project = await createProject(db, makeProject());

    // El run MUERTO: N1/N2 OK, N3 falló. `cost_actual` NULL en el step fallido (el rollup no
    // corre en el fallo) pero 13 céntimos EN EL LEDGER: gastó de verdad. Un listado que sumara
    // `step_run.cost_actual` diría $0.00 aquí — ocultaría gasto real. Se siembra ANTES (más
    // antiguo) para poder afirmar el ORDEN.
    deadRunId = await seedTerminalRun({
      projectId: project.id,
      url: DEAD_URL,
      steps: [
        { nodeKey: 'N1', status: 'succeeded', costActual: 0, ledgerCents: 0 },
        { nodeKey: 'N2', status: 'succeeded', costActual: 0, ledgerCents: 0 },
        {
          nodeKey: 'N3',
          status: 'failed',
          costActual: null,
          ledgerCents: 13,
          error: 'N3: el brief no supera la validación determinista (T1.9)',
        },
      ],
    });

    // El run COMPLETADO: los 3 steps OK, 18 céntimos. Más RECIENTE que el muerto.
    okRunId = await seedTerminalRun({
      projectId: project.id,
      url: OK_URL,
      steps: [
        { nodeKey: 'N1', status: 'succeeded', costActual: 0, ledgerCents: 0 },
        { nodeKey: 'N2', status: 'succeeded', costActual: 0, ledgerCents: 0 },
        { nodeKey: 'N3', status: 'succeeded', costActual: 18, ledgerCents: 18 },
      ],
    });

    // LA PREMISA DEL SPEC, afirmada contra la BD: las columnas del agregado MIENTEN. Si algún
    // día alguien las arregla (tarea de orquestador), este assert cae y hay que revisar la
    // derivación — no borrar el test: la derivación seguiría siendo el oráculo de la columna.
    const rows = await queryStack<{ status: string; total_cost_actual: number | null }>(
      `SELECT status, total_cost_actual FROM pipeline_run WHERE id = ANY($1)`,
      [[deadRunId, okRunId]],
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('pending'); // …incluidos el completado y el muerto
      expect(row.total_cost_actual).toBeNull();
    }
  });

  test.afterAll(async () => {
    // Los runs sembrados se van (el `cost_entry` NO cae por CASCADE: no hay FK, el ledger
    // sobrevive a propósito al run que lo generó — así que se limpia explícito).
    await queryStack(
      `DELETE FROM cost_entry WHERE step_run_id IN (SELECT id FROM step_run WHERE run_id = ANY($1))`,
      [[deadRunId, okRunId]],
    );
    await queryStack(`DELETE FROM pipeline_run WHERE id = ANY($1)`, [[deadRunId, okRunId]]);
  });

  // ⚠ EL COSTE EXACTO **NO** SE ASSERTA AQUÍ, Y NO ES UNA REBAJA: ES LA CAPA EQUIVOCADA.
  //
  // `spend.spec.ts` hace `TRUNCATE cost_entry` en su `beforeAll` —deliberadamente, y su cabecera
  // lo argumenta: necesita POSEER el ledger para afirmar sumas exactas—. Con `fullyParallel`, ese
  // TRUNCATE cae entre la siembra y los asserts de ESTE fichero, en otro worker. Ninguna cantidad
  // de reintentos gana esa carrera: los cargos ya no están.
  //
  // Y esa es exactamente la razón por la que el assert de dinero no vive en un e2e de BD
  // COMPARTIDA: una suma exacta solo se puede afirmar donde se POSEE la tabla. Donde sí se posee
  // es en la integración (`apps/web/test/integration/api/runs.test.ts`, BD clonada por suite), y
  // ahí está —con el caso duro incluido: el run muerto cuyo step tiene `cost_actual` NULL y 13
  // céntimos en el ledger DEBE listar $0.13, no $0.00—. Cobertura perdida: cero. Lo que este
  // fichero blinda es lo que la tarea le pide y lo que solo un navegador puede ver: que los runs
  // se LISTEN, con estados DISTINTOS, en ORDEN, y que el click lleve a su canvas.
  //
  // (Que el TRUNCATE de `spend.spec.ts` sea una mina para cualquier spec futuro que necesite
  // cargos vivos en `cost_entry` es deuda REAL — este spec es el primero en pisarla. Se reporta;
  // arreglarla —p. ej. acotando spend.spec a sus propias filas— es otra tarea, no T1.17.)
  test(
    'lista los runs con ESTADOS DISTINTOS (aunque pipeline_run.status diga pending en los dos)',
    { tag: ['@f1'] },
    async ({ page }) => {
      await page.goto('/runs');
      await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();

      // El run COMPLETADO. El estado se afirma por `data-status` (el estado CRUDO, la misma API
      // observable que los nodos del canvas), NUNCA por color: el color es verificación
      // visual/CUA, no un assert estable aquí. En la BD, este run dice `pending`.
      const okRow = rowOf(page, okRunId);
      await expect(okRow).toBeVisible();
      await expect(okRow.locator('[data-status]')).toHaveAttribute('data-status', 'succeeded');
      // Y QUÉ se analizó: la URL, no un ULID opaco (es lo que hace útil el listado).
      await expect(okRow).toContainText(OK_URL);

      // El run MUERTO: estado `failed` — DISTINTO del anterior, que es el corazón del test. En la
      // BD dice `pending`, igual que el completado: un listado que leyera la columna los pintaría
      // IGUALES, y este assert es lo que lo impide.
      const deadRow = rowOf(page, deadRunId);
      await expect(deadRow).toBeVisible();
      await expect(deadRow.locator('[data-status]')).toHaveAttribute('data-status', 'failed');
      await expect(deadRow).toContainText(DEAD_URL);
      // El paso que EXPLICA el fallo, y el motivo: sin ellos habría que abrir el run para saber
      // siquiera si vale la pena abrirlo.
      await expect(deadRow).toContainText('N3');
      await expect(deadRow).toContainText(/validación determinista/i);

      // …Y EL ORDEN (DESC por creación), sobre ESTA MISMA carga de página: es otra afirmación
      // sobre la misma foto, y darle un `test` propio solo compraría una navegación más contra
      // un stack e2e que ya va justo de concurrencia. La tabla contiene también los runs de
      // OTROS specs, así que se comparan las POSICIONES de los dos de este fichero — nunca se
      // asume que sean las filas 1 y 2.
      const hrefs = await page
        .getByRole('row')
        .evaluateAll((els) =>
          els.map(
            (el) => el.querySelector('[data-slot="run-row-link"]')?.getAttribute('href') ?? '',
          ),
        );
      const okIndex = hrefs.indexOf(`/runs/${okRunId}`);
      const deadIndex = hrefs.indexOf(`/runs/${deadRunId}`);
      expect(okIndex).toBeGreaterThanOrEqual(0);
      expect(deadIndex).toBeGreaterThanOrEqual(0);
      // El COMPLETADO se sembró DESPUÉS ⇒ ULID mayor ⇒ va ARRIBA. El último lanzado, primero.
      expect(okIndex).toBeLessThan(deadIndex);
    },
  );

  test('el click en una fila lleva al CANVAS de ESE run', { tag: ['@f1'] }, async ({ page }) => {
    await page.goto('/runs');
    await rowLinkOf(page, deadRunId).click();

    // Su canvas, no el de otro: la URL lleva SU id, y el canvas pinta SU N3 fallido (el
    // contrato de testabilidad del canvas vive en `support/canvas.ts`, compartido).
    await expect(page).toHaveURL(`/runs/${deadRunId}`);
    await waitCanvasStatus(page, 'N3', 'failed', 30_000);
  });

  test(
    'se llega al listado desde la nav global, sin escribir ninguna URL',
    { tag: ['@f1'] },
    async ({ page }) => {
      // LA QUEJA QUE ORIGINÓ LA TAREA: tras lanzar un run no había forma de volver a él. Se
      // parte de la HOME (no de `/runs`) y se llega a golpe de click.
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: 'Navegación principal' });
      await nav.getByRole('link', { name: 'Runs' }).click();

      await expect(page).toHaveURL('/runs');
      await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible();
      await expect(rowOf(page, okRunId)).toBeVisible();
    },
  );

  // El RESALTADO de «Runs» dentro del canvas de un run (`data-highlighted` sí, `aria-current` no)
  // NO se prueba aquí: ya lo hace `navigation.spec.ts` («dentro de un run se RESALTA «Runs» (su
  // área) y NO se anuncia como página actual»), que es donde vive el contrato de la nav global —
  // y lo prueba sobre un run REAL del worker, no sobre uno sembrado. Duplicarlo solo compraría
  // dos navegaciones más contra un stack e2e que ya va justo de concurrencia. La regla pura
  // (`isHighlighted`/`isCurrentPage` sobre `/runs/:id`) la fija además `src/lib/routes.test.ts`
  // en el gate, sin navegador.
});
