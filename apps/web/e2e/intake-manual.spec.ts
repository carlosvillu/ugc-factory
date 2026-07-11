// Regresión permanente de T1.6 (e2e.md §9/§10, DoD BLOQUEANTE): el intake por TEXTO
// LIBRE en navegador real contra el stack completo (Next + Postgres del testcontainer).
// El modo manual sigue haciendo su short-circuit (texto → RawContent sintético →
// url_analysis en `done`, CERO scraping) y sigue reutilizando su caché §7.4. Cubre:
//  - envío de texto SIN imágenes → crea el análisis manual y arranca su pipeline;
//  - envío de texto CON imágenes (fixtures locales) → las refs viajan en el análisis;
//  - validación visible del formulario (texto demasiado corto → error, no navega);
//  - reutilización OBSERVABLE: un 2.º envío del MISMO texto reutiliza el MISMO análisis
//    (la señal de que la caché §7.4 funciona).
//
// ACTUALIZADO EN T1.10a — lo que cambió y por qué (NO es una rebaja del test):
//  1. El formulario de texto libre vive ahora en la pestaña «Texto libre» de
//     `/analyses/new` (la de «Desde URL» es la de por defecto), así que hay que
//     seleccionarla antes de escribir.
//  2. El submit ya NO aterriza en `/analyses/:id`: arranca el DAG de análisis y navega
//     al CANVAS `/runs/:id`. Es un REQUISITO de T1.10a — la Verificación exige ver a N2
//     `skipped` EN EL GRAFO, y no hay grafo sin run. El id del análisis (que es lo que
//     estos tests observan) se lee ahora de la config de N1 del run vía la API.
//  Las PROPIEDADES que T1.6 protegía (short-circuit, caché, refs de imagen, validación)
//  se siguen aseverando todas — solo cambia por dónde se observan.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { Pool } from 'pg';

// La BD del stack (publicada por e2e-stack.ts), para las lecturas de aserción.
const runtime = JSON.parse(
  readFileSync(fileURLToPath(new URL('./.runtime.json', import.meta.url)), 'utf8'),
) as { databaseUrl: string };

/** Una consulta de aserción contra la BD del stack, con pool EFÍMERO. Se abre y se cierra
 *  por consulta a propósito: un pool de módulo compartido se cerraba dos veces cuando
 *  Playwright reparte los tests del fichero entre workers ("Called end on pool more than
 *  once"). Son 3 lecturas en toda la suite — el coste es irrelevante y no hay ciclo de
 *  vida que gestionar. */
async function queryStack<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const pool = new Pool({ connectionString: runtime.databaseUrl });
  try {
    const { rows } = await pool.query<T>(sql, params);
    return rows;
  } finally {
    await pool.end();
  }
}

// Fixtures de imagen locales (packages/test-utils/fixtures/media): PNGs válidos mínimos.
const REF_A = fileURLToPath(
  new URL('../../../packages/test-utils/fixtures/media/intake-ref-a.png', import.meta.url),
);
const REF_B = fileURLToPath(
  new URL('../../../packages/test-utils/fixtures/media/intake-ref-b.png', import.meta.url),
);

// Texto único por ejecución (evita colisión de caché entre reruns sobre la misma BD
// del stack). Suficientemente largo para pasar la validación (min 20 chars).
function uniqueText(tag: string): string {
  return `Sérum hidratante con ácido hialurónico para piel sensible — ${tag} ${String(Date.now())}-${String(Math.random()).slice(2)}`;
}

/** Abre el intake y selecciona la pestaña de TEXTO LIBRE (la de por defecto es «Desde
 *  URL»: el camino principal del producto, T1.10a). */
async function openFreeTextTab(page: Page): Promise<void> {
  await page.goto('/analyses/new');
  await page.getByRole('tab', { name: /texto libre/i }).click();
  await expect(page.getByRole('textbox', { name: /descripción del producto/i })).toBeVisible();
}

/** El id del análisis MANUAL sobre el que corre un run: viaja en la config de su nodo
 *  N1 (`{source:'manual', analysisId}`), que es justo lo que le dice a N1 "no scrapees,
 *  carga esta fila". Se lee de la BD del stack (mismo patrón que `support/runs.ts`: no
 *  hay endpoint que exponga la config de los steps, y añadir uno solo para el test sería
 *  ampliar el alcance). Es una LECTURA de aserción, no una siembra — los runs se siguen
 *  creando SIEMPRE por la app. */
async function analysisIdOfRun(runId: string): Promise<string> {
  const rows = await queryStack<{ config: { analysisId?: string } | null }>(
    `SELECT config FROM step_run WHERE run_id = $1 AND node_key = 'N1'`,
    [runId],
  );
  const id = rows[0]?.config?.analysisId;
  if (id === undefined) throw new Error('el run no lleva analysisId en la config de N1');
  return id;
}

/** El id del run al que aterrizó el submit (la URL es `/runs/:id`). */
function runIdFromUrl(page: Page): string {
  const id = page.url().split('/').pop();
  if (!id) throw new Error(`no se pudo leer el runId de la URL: ${page.url()}`);
  return id;
}

test.describe('intake manual por texto libre (T1.6)', () => {
  test(
    'validación visible: un texto demasiado corto muestra error y no navega',
    { tag: ['@f1'] },
    async ({ page }) => {
      await openFreeTextTab(page);
      await page.getByRole('textbox', { name: /descripción del producto/i }).fill('corto');
      await page.getByRole('button', { name: /analizar/i }).click();

      // El error de campo es visible (se localiza por su texto, no por role="alert":
      // Next monta su propio announcer role="alert" vacío → getByRole sería ambiguo).
      await expect(page.getByText(/al menos 20 caracteres/i)).toBeVisible();
      await expect(page).toHaveURL(/\/analyses\/new$/); // no navegó: no se creó nada
    },
  );

  test(
    'envío SÓLO texto (sin imágenes) crea el análisis manual en `done` y arranca su pipeline',
    { tag: ['@f1'] },
    async ({ page }) => {
      const text = uniqueText('sin-imgs');
      await openFreeTextTab(page);
      await page.getByRole('textbox', { name: /descripción del producto/i }).fill(text);
      await page.getByRole('button', { name: /analizar/i }).click();

      // Aterriza en el CANVAS del run (T1.10a): el texto libre también corre el pipeline.
      await expect(page).toHaveURL(/\/runs\/[0-9A-HJKMNP-TV-Z]{26}$/);

      // La PROPIEDAD de T1.6 que este test protege sigue en pie: el análisis manual se
      // creó con su short-circuit (source=manual, status=done, CERO scraping) y el run
      // apunta a él.
      const analysisId = await analysisIdOfRun(runIdFromUrl(page));
      const rows = await queryStack<{ source: string; status: string; raw_content: unknown }>(
        `SELECT source, status, raw_content FROM url_analysis WHERE id = $1`,
        [analysisId],
      );
      expect(rows[0]?.source).toBe('manual');
      expect(rows[0]?.status).toBe('done');
      // El texto del usuario es el contenido base del RawContent sintético.
      expect(JSON.stringify(rows[0]?.raw_content)).toContain(text.slice(0, 40));
    },
  );

  test(
    'envío CON imágenes (fixtures locales) adjunta las referencias al análisis',
    { tag: ['@f1'] },
    async ({ page }) => {
      const text = uniqueText('con-imgs');
      await openFreeTextTab(page);
      await page.getByRole('textbox', { name: /descripción del producto/i }).fill(text);

      // Sube 2 imágenes reales (fixtures locales); el input las manda a /api/assets.
      await page.getByLabel(/añadir imágenes/i).setInputFiles([REF_A, REF_B]);
      // Ambas quedan listadas (por su nombre de fichero) antes de enviar.
      await expect(page.getByRole('button', { name: /quitar intake-ref-a\.png/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /quitar intake-ref-b\.png/i })).toBeVisible();

      await page.getByRole('button', { name: /analizar/i }).click();
      await expect(page).toHaveURL(/\/runs\/[0-9A-HJKMNP-TV-Z]{26}$/);

      // Las 2 refs viajaron al análisis (la propiedad que T1.6 protege): están en su
      // RawContent, que es lo que N2 mirará para decidir si hay imágenes que analizar.
      const analysisId = await analysisIdOfRun(runIdFromUrl(page));
      const rows = await queryStack<{ raw_content: { images?: unknown[] } }>(
        `SELECT raw_content FROM url_analysis WHERE id = $1`,
        [analysisId],
      );
      expect(rows[0]?.raw_content.images).toHaveLength(2);
    },
  );

  test(
    'reutilización observable: reenviar el MISMO texto reutiliza el MISMO análisis (caché §7.4)',
    { tag: ['@f1'] },
    async ({ page }) => {
      const text = uniqueText('reuse');

      // 1.er envío: se crea el análisis.
      await openFreeTextTab(page);
      await page.getByRole('textbox', { name: /descripción del producto/i }).fill(text);
      await page.getByRole('button', { name: /analizar/i }).click();
      await expect(page).toHaveURL(/\/runs\/[0-9A-HJKMNP-TV-Z]{26}$/);
      const firstAnalysisId = await analysisIdOfRun(runIdFromUrl(page));

      // 2.º envío del MISMO texto: la caché §7.4 se reutiliza. El RUN es nuevo (cada
      // submit arranca su pipeline), pero el ANÁLISIS es EL MISMO — que es exactamente
      // la propiedad que T1.6 protege (no se re-crea la fila ni se re-sintetiza).
      await openFreeTextTab(page);
      await page.getByRole('textbox', { name: /descripción del producto/i }).fill(text);
      await page.getByRole('button', { name: /analizar/i }).click();
      await expect(page).toHaveURL(/\/runs\/[0-9A-HJKMNP-TV-Z]{26}$/);
      const secondAnalysisId = await analysisIdOfRun(runIdFromUrl(page));

      expect(secondAnalysisId).toBe(firstAnalysisId);
      // Y no se duplicó la fila en BD (la caché es lookup-then-insert atómico).
      const rows = await queryStack<{ n: string }>(
        `SELECT count(*)::text AS n FROM url_analysis WHERE id = $1`,
        [firstAnalysisId],
      );
      expect(rows[0]?.n).toBe('1');
    },
  );
});
