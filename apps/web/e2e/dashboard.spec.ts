// Regresión permanente del DASHBOARD y la vista de proyecto (T5.10, e2e.md §10, DoD
// BLOQUEANTE). Ejercita contra el sistema real (web + BD):
//   · CRUD MÍNIMO de proyecto: crear desde la UI (`/projects`) → aparece; editar el nombre;
//     archivar → desaparece de la lista.
//   · LANZAMIENTO de un lote: el lote se SIEMBRA por repo (data en reposo; recorrer el
//     pipeline gastaría fal — coste $0). Lo que se verifica es que el dashboard lo MUESTRE.
//   · Dashboard `/`: el lote activo sembrado aparece por su proyecto (nombre único), y las
//     tarjetas KPI (gasto del mes, lotes activos) renderizan un valor real formateado.
//   · `/projects/[id]`: lista los briefs y variantes del proyecto con estados correctos, y
//     el gasto del proyecto EXACTO (importe propio del spec, scoped a su proyecto único).
//   · CONTROL NEGATIVO: un proyecto recién creado SIN lotes muestra el empty-state y NO
//     aporta un lote activo falso al dashboard.
//
// ISOLATION SIN SERIALIZAR: los KPIs de `/` son agregados GLOBALES (todo el ledger/lotes),
// así que bajo `fullyParallel` un assert de valor EXACTO en `/` sería flaky en cuanto otro
// spec siembre coste. Por eso en `/` solo se afirma PRESENCIA por nombre único; los valores
// EXACTOS se afirman en `/projects/[id]`, scoped al proyecto único de este spec.
//
// La lista de `/projects` es igual de GLOBAL: cuenta TODOS los proyectos activos, y los
// propios tests hermanos de ESTE fichero (`seedProjectWithBatch` crea «E2E …», los tests de
// CRUD/control crean los suyos) la mutan bajo `fullyParallel`. Nadie debe añadir un
// `expect(count).toBe(N)` sobre esa lista: la ÚNICA aserción determinista es la presencia
// (o ausencia, tras archivar) por nombre único con `exact: true`.
//
// APERTURA DE DIÁLOGOS PRE-HIDRATACIÓN: bajo `fullyParallel` la página tarda en hidratar;
// un click al botón que abre un diálogo puede caer antes de que React adjunte el handler y
// no dispara nada. `createProjectViaUi` reintenta SOLO la interacción de apertura con
// `.toPass` (la explicación vive ahí, en un único sitio). Ninguna aserción se debilita.
import { test, expect, type Page } from '@playwright/test';
import { createDb, createProject, recordCost } from '@ugc/db';
import {
  makeAdBatch,
  makeAdVariant,
  makeProductBrief,
  makeProject,
  makeStepRun,
  makeUrlAnalysis,
} from '@ugc/test-utils';
import { newUlid } from '@ugc/core/contracts';
import {
  adBatch,
  adVariant,
  pipelineRun,
  productBrief,
  stepRun,
  urlAnalysis,
} from '@ugc/db/schema';
import { stackDatabaseUrl } from './support/stack-db';

const db = createDb(stackDatabaseUrl);

/** Un sufijo único por ejecución: cada nombre de proyecto es localizable sin colisionar con
 *  otros specs ni con otras corridas de ESTE spec (fullyParallel + sin truncar datos). */
const RUN = newUlid().slice(-8);

/** Siembra un proyecto con un análisis, un brief aprobado, un lote RUNNING con variantes, y
 *  un cargo de coste atribuido a su run — todo en reposo, coste $0. Devuelve los ids/nombres
 *  únicos que la UI localizará. */
async function seedProjectWithBatch(label: string, spendCents: number) {
  const projectName = `E2E ${label} ${RUN}`;
  const projectRow = await createProject(db, makeProject({ name: projectName }));
  const realProjectId = projectRow.id;

  const ua = makeUrlAnalysis({ projectId: realProjectId });
  await db.insert(urlAnalysis).values(ua);
  const brief = makeProductBrief({
    urlAnalysisId: ua.id!,
    status: 'approved',
    data: { product: { name: `Producto ${label} ${RUN}` } },
  });
  await db.insert(productBrief).values(brief);

  const batch = makeAdBatch({
    projectId: realProjectId,
    briefId: brief.id!,
    status: 'running',
    objective: 'conversion',
  });
  await db.insert(adBatch).values(batch);
  // DOS variantes en estados DISTINTOS para poder afirmar el estado POR VARIANTE (no el
  // agregado del lote): una `approved`, otra `rejected`. `rejected` a propósito — su etiqueta
  // «rechazada» no colisiona con ninguna etiqueta de lote/brief de la página.
  const approvedVariant = makeAdVariant({ batchId: batch.id!, status: 'approved' });
  const rejectedVariant = makeAdVariant({ batchId: batch.id!, status: 'rejected' });
  await db.insert(adVariant).values([approvedVariant, rejectedVariant]);

  // Coste real atribuido al lote/proyecto vía su run (batch_id/project_id).
  const run = makePipelineRunRow(realProjectId, batch.id!);
  await db.insert(pipelineRun).values(run);
  const step = makeStepRun({ runId: run.id, nodeKey: 'N7', status: 'succeeded' });
  await db.insert(stepRun).values(step);
  await recordCost(db, { provider: 'fal', amountCents: spendCents, stepRunId: step.id! });

  return {
    projectName,
    projectId: realProjectId,
    briefId: brief.id!,
    batchId: batch.id!,
    approvedVariantId: approvedVariant.id!,
    rejectedVariantId: rejectedVariant.id!,
  };
}

function makePipelineRunRow(projectId: string, batchId: string) {
  return { id: newUlid(), projectId, batchId, kind: 'full' as const, status: 'running' as const };
}

/** Crea un proyecto por la UI de `/projects` (asume que ya se navegó ahí). Abre el diálogo,
 *  rellena el nombre y confirma; deja el proyecto localizable por su nombre exacto.
 *
 *  El click de apertura se reintenta con `.toPass` porque bajo `fullyParallel` puede aterrizar
 *  ANTES de que React hidrate `/projects` (~9s hasta el primer paint del h1): en esa ventana
 *  no-interactiva no dispara `setDialog` y el diálogo nunca abre. Se reintenta SOLO la apertura,
 *  ninguna aserción; si el diálogo genuinamente no abriera nunca, esto sigue fallando. */
async function createProjectViaUi(page: Page, name: string): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: /nuevo proyecto/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/nombre/i).fill(name);
  await dialog.getByRole('button', { name: /crear proyecto/i }).click();
}

test.describe('dashboard y vista de proyecto (T5.10)', () => {
  test('CRUD mínimo de proyecto desde la UI: crear → editar → archivar', async ({ page }) => {
    const name = `CRUD ${RUN}`;
    const renamed = `CRUD editado ${RUN}`;

    await page.goto('/projects');
    await expect(page.getByRole('heading', { level: 1, name: 'Proyectos' })).toBeVisible();

    // CREAR desde la UI.
    await createProjectViaUi(page, name);

    // Aparece en la lista (localizado por su nombre único; `exact` evita que «CRUD …» matchee
    // por substring a «CRUD editado …» tras el rename).
    const card = page.getByRole('link', { name, exact: true });
    await expect(card).toBeVisible();

    // EDITAR: renombrar.
    const listItem = page.locator('li', { has: page.getByRole('link', { name, exact: true }) });
    await listItem.getByRole('button', { name: /editar/i }).click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel(/nombre/i).fill(renamed);
    await editDialog.getByRole('button', { name: /guardar/i }).click();
    await expect(page.getByRole('link', { name: renamed, exact: true })).toBeVisible();

    // ARCHIVAR: desaparece de la lista activa.
    const renamedItem = page.locator('li', {
      has: page.getByRole('link', { name: renamed, exact: true }),
    });
    await renamedItem.getByRole('button', { name: /archivar/i }).click();
    const confirm = page.getByRole('alertdialog');
    // Se espera a que el server ACEPTE el archivar (PATCH ok) antes de seguir: sin esto,
    // `reload()` puede adelantar al PATCH en vuelo (el reload no espera los fetch de la página
    // anterior) → el RSC releería `listProjects` PRE-archivado y el proyecto seguiría activo.
    await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'PATCH' && r.url().includes('/api/projects/') && r.ok(),
      ),
      confirm.getByRole('button', { name: /archivar/i }).click(),
    ]);
    await expect(page.getByRole('link', { name: renamed, exact: true })).toHaveCount(0);

    // Y tras recargar: sigue ausente. Como el PATCH ya está confirmado (waitForResponse arriba),
    // el reload no puede adelantarlo → este assert prueba de verdad la persistencia server-side,
    // no un ocultado transitorio del cliente.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Proyectos' })).toBeVisible();
    await expect(page.getByRole('link', { name: renamed, exact: true })).toHaveCount(0);
  });

  test('ARCHIVAR que FALLA: superficie el error en el diálogo y NO oculta el proyecto (regla 5a)', async ({
    page,
  }) => {
    const name = `Archivo falla ${RUN}`;

    await page.goto('/projects');
    await expect(page.getByRole('heading', { level: 1, name: 'Proyectos' })).toBeVisible();

    // Crear el proyecto por la UI.
    await createProjectViaUi(page, name);
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();

    // El PATCH de archivar responde 500 con envelope de core: NO se gasta (no llega al server)
    // y ejercita exactamente la rama de error que antes se tragaba (promesa rechazada silenciosa).
    await page.route('**/api/projects/**', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'internal',
            message: 'No se pudo archivar (fallo simulado)',
          }),
        });
        return;
      }
      await route.continue();
    });

    const item = page.locator('li', { has: page.getByRole('link', { name, exact: true }) });
    await item.getByRole('button', { name: /archivar/i }).click();
    const confirm = page.getByRole('alertdialog');
    await confirm.getByRole('button', { name: /archivar/i }).click();

    // El error se SUPERFICIA (Alert danger, role=alert) dentro del diálogo, que sigue abierto…
    await expect(confirm.getByRole('alert')).toContainText(/no se pudo archivar/i);
    await expect(confirm).toBeVisible();
    // …y el proyecto NO se oculta de la lista (no se archivó). Se cancela para cerrar.
    await confirm.getByRole('button', { name: /cancelar/i }).click();
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  });

  test('el dashboard muestra el lote activo del proyecto y KPIs reales', async ({ page }) => {
    const { projectName } = await seedProjectWithBatch('Dashboard', 777);

    await page.goto('/');
    // El h1 de la home se conserva (navigation.spec.ts lo exige).
    await expect(page.getByRole('heading', { level: 1, name: 'UGC Factory' })).toBeVisible();

    // El lote activo aparece por su proyecto (nombre único) en la sección «Lotes activos».
    const activeSection = page.getByRole('region', { name: 'Lotes activos' });
    await expect(activeSection.getByRole('link', { name: projectName })).toBeVisible();

    // GASTO DEL MES DEL LOTE (mes ∧ proyecto que pide la Verificación): valor EXACTO
    // scoped al lote de este spec — no un agregado global, así que es determinista bajo
    // fullyParallel. 777 céntimos → «$7.77». Se localiza en la fila (li) del proyecto único.
    const batchRow = activeSection.locator('li', {
      has: page.getByRole('link', { name: projectName }),
    });
    await expect(batchRow.getByText('$7.77')).toBeVisible();

    // Los KPIs renderizan un valor real formateado (no un valor exacto: es agregado global).
    const kpis = page.getByRole('region', { name: 'Indicadores del mes' });
    await expect(kpis.getByText('Gasto del mes')).toBeVisible();
    await expect(kpis.getByText(/^\$\d/).first()).toBeVisible();
    await expect(kpis.getByText('Lotes activos')).toBeVisible();
  });

  test('/projects/[id] lista briefs y variantes con estados correctos y gasto exacto', async ({
    page,
  }) => {
    const { projectId, projectName, approvedVariantId, rejectedVariantId } =
      await seedProjectWithBatch('Detalle', 1234);

    await page.goto(`/projects/${projectId}`);
    await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();

    // Métricas exactas del proyecto (scoped → deterministas).
    const metrics = page.getByRole('region', { name: 'Métricas del proyecto' });
    await expect(metrics.getByText('Gasto total')).toBeVisible();
    await expect(metrics.getByText('$12.34')).toBeVisible(); // 1234 céntimos, solo de ESTE proyecto

    // Lote con su badge de estado.
    const batches = page.getByRole('region', { name: 'Lotes del proyecto' });
    await expect(batches.getByText(/generando/i)).toBeVisible();
    await expect(batches.getByText(/2 variantes/i)).toBeVisible();

    // VARIANTES con su ESTADO INDIVIDUAL (§8.1) — el corazón de este assert. Cada estado se
    // localiza SCOPED a la tarjeta de SU variante (`data-testid`), no en la página entera: así
    // el assert falla si el estado no se pinta POR VARIANTE (un recuento agregado no bastaría).
    const variantsRegion = page.getByRole('region', { name: 'Variantes del proyecto' });
    await expect(variantsRegion).toBeVisible();
    const approvedCard = page.getByTestId(`project-variant-${approvedVariantId}`);
    const rejectedCard = page.getByTestId(`project-variant-${rejectedVariantId}`);
    await expect(approvedCard.getByText('aprobada')).toBeVisible();
    await expect(rejectedCard.getByText('rechazada')).toBeVisible();
    // Y NO al revés: la variante aprobada NO muestra «rechazada» ni viceversa (los estados
    // están en la fila CORRECTA, no simplemente presentes en la página).
    await expect(approvedCard.getByText('rechazada')).toHaveCount(0);
    await expect(rejectedCard.getByText('aprobada')).toHaveCount(0);

    // Brief aprobado, con el nombre del producto.
    const briefs = page.getByRole('region', { name: 'Briefs del proyecto' });
    await expect(briefs.getByText(`Producto Detalle ${RUN}`)).toBeVisible();
    await expect(briefs.getByText(/aprobado/i)).toBeVisible();
  });

  test('CONTROL NEGATIVO: un proyecto sin lotes muestra empty-state, no un lote falso', async ({
    page,
  }) => {
    // Proyecto creado por la UI, SIN lotes.
    const name = `Vacío ${RUN}`;
    await page.goto('/projects');
    await expect(page.getByRole('heading', { level: 1, name: 'Proyectos' })).toBeVisible();
    await createProjectViaUi(page, name);

    // Entrar a su vista: empty-state de lotes, NO un lote inventado.
    await page.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    const batches = page.getByRole('region', { name: 'Lotes del proyecto' });
    await expect(batches.getByText(/aún no hay lotes/i)).toBeVisible();
    // Y la sección de variantes muestra SU empty-state, no una fila de variante falsa.
    const variantsRegion = page.getByRole('region', { name: 'Variantes del proyecto' });
    await expect(variantsRegion.getByText(/aún no hay variantes/i)).toBeVisible();

    // Y en el dashboard, ese proyecto NO aparece como lote activo (no tiene lotes).
    await page.goto('/');
    const activeSection = page.getByRole('region', { name: 'Lotes activos' });
    await expect(activeSection.getByRole('link', { name })).toHaveCount(0);
  });
});
