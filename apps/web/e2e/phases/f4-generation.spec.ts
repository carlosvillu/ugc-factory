// E2E DE FASE — F4 · GENERACIÓN DE ASSETS (T4.11, §7.2 N6→N7; e2e.md §9, regla 10 — DoD BLOQUEANTE).
// El journey COMPLETO del sub-DAG de generación, con el sistema entero vivo (web + worker + orquestador
// + pg-boss + SSE + los nodos reales N1..N7) y fal FINGIDO ($0):
//
//   URL → N1/N2/N3 → CP1 (aprobar) → N4 matriz → CP2 (tier PREMIUM, confirmar) → N5 guiona → CP3
//   (aprobar todas) → arranca el RUN DE GENERACIÓN N6→N7a-e POR VARIANTE → el canvas lo materializa.
//
// QUÉ AFIRMA (las cláusulas de la Entrega de T4.11 que se pueden ver con fal FAKE):
//   · el nodo compuesto N7 se expande a N7a–N7e POR VARIANTE (grupos distintos por variante);
//   · N6 expone su `resolvedPrompt` inspeccionable en el panel;
//   · cada sub-step muestra su coste (estimado/real) y sus previews/players de asset;
//   · UN sub-step falla de forma DETERMINISTA (el fake devuelve un output malformado para el primer
//     submit de imagen → PermanentStepError) y su RETRY GRANULAR lo recupera SIN reiniciar los
//     hermanos sanos (control anti-T1.8: se captura el `finished_at` de un hermano succeeded ANTES del
//     retry y se afirma que NO cambia — un retry que reiniciara hermanos lo movería y la spec se pone ROJA).
//
// LO QUE NO ESTÁ AQUÍ: los bounds de coste live (±15 % vs CP2) y los assets REALES de fal los mide el
// verifier con fal REAL (E2E de fase live). Aquí se prueba la CADENA y la mecánica del canvas, $0.
//
// TIER PREMIUM a propósito: es el ÚNICO cuyo recipe tiene los 4 componentes con endpoint fal resoluble
// (test/standard dejan `broll` como etiqueta → `buildVariantGenerationPlan` lanzaría money-safe). Con
// premium el sub-DAG trae N7a–N7e completos, que es lo que la cláusula «expansión N7a–N7e» exige ver.
import { test, expect, type Page } from '@playwright/test';
import { createDb, makeLocalStorageAdapter, seedPersonas, listPersonas } from '@ugc/db';
import { FAKE_URL_BEAUTY, FAKE_BEAUTY_AVATAR_HINT } from '@ugc/test-utils';
import { matchPersonas } from '@ugc/core/persona';
import type { PersonaSeed } from '@ugc/core/persona/server';
import { waitCanvasStatus, canvasNode } from '../support/canvas';
import { runUrlAnalysisToCp1 } from '../support/brief';
import { queryStack, stackDatabaseUrl, assetsDir } from '../support/stack-db';

const stackDb = createDb(stackDatabaseUrl);

// La persona compatible con `FAKE_BEAUTY_AVATAR_HINT`, COMPLETA: voiceMap es+en + 1 imagen de referencia
// sintética. Premium las EXIGE (N7c avatar necesita `referenceImageIds[0]`; N7b voz necesita el
// voice_map del idioma) — sin ellas `buildVariantGenerationPlan` lanzaría money-safe y CP3 no arrancaría
// el run. Se siembra con `seedPersonas` (genera la imagen real ≥2K, igual que producción), idempotente.
// El `descriptor` casa EXACTAMENTE con `FAKE_BEAUTY_AVATAR_HINT` (farmacéutica cosmética / laboratorio
// dermatológico / bata blanca) y con NADIE más del pool de test (ver la nota del hint en fake-apis):
// así `matchPersonas` para el brief beauty devuelve SOLO a Nora → la rotación de persona de N4 no puede
// caer en una «Vera» sin imagen de referencia. El assert de `beforeAll` lo blinda contra regresión.
const MATCHING_PERSONA: PersonaSeed = {
  name: 'Nora F4 Premium',
  ageRange: '25-35',
  gender: 'female',
  ethnicity: 'mediterránea',
  style: 'natural',
  descriptor: 'farmacéutica cosmética en laboratorio dermatológico, bata blanca',
  setting: 'laboratorio dermatológico luminoso',
  personality: 'cercana y directa',
  wardrobeNotes: 'Bata blanca de laboratorio; misma ropa en todos los cuts.',
  voiceMap: {
    es: { provider: 'elevenlabs', voiceId: 'placeholder-es', label: 'Placeholder ES' },
    en: { provider: 'elevenlabs', voiceId: 'placeholder-en', label: 'Placeholder EN' },
  },
  referenceImageCount: 1,
};

test.beforeAll(async () => {
  await seedPersonas(stackDb, makeLocalStorageAdapter({ root: assetsDir }), [MATCHING_PERSONA]);

  // BLINDAJE del matching (T4.11): con las personas que HAY ahora en la BD del stack (la mía + las que
  // otros @f4 specs hayan sembrado antes), `matchPersonas` contra el hint del brief beauty debe devolver
  // EXACTAMENTE a Nora. Si una persona futura compartiera tokens con el hint —y no tuviera imagen de
  // referencia— la rotación de N4 caería en ella y el run petaría con un 500 opaco aguas abajo; este
  // assert lo convierte en un fallo ROJO en el origen, con el nombre del intruso. (La disjunción de
  // tokens del hint ya protege el run por diseño; esto es la red contra regresión.)
  const personas = await listPersonas(stackDb);
  const candidates = matchPersonas(personas, FAKE_BEAUTY_AVATAR_HINT);
  expect(
    candidates.map((c) => c.persona.name),
    'el hint beauty debe casar SOLO con Nora F4 Premium (persona con imagen de referencia)',
  ).toEqual(['Nora F4 Premium']);
});

function cp2(page: Page) {
  return page.locator('[data-slot="matrix-panel"]');
}
function cp3(page: Page) {
  return page.locator('[data-slot="scripts-panel"]');
}

test.describe('F4 · journey de generación: CP3 aprobado → sub-DAG N6→N7a-e por variante en el canvas', () => {
  test(
    'el canvas expande N7 por variante, expone resolvedPrompt/coste/previews y recupera un sub-step con retry granular',
    { tag: ['@f4', '@phase'] },
    async ({ page }) => {
      test.setTimeout(240_000);

      // ── 1. URL (vertical beauty) → CP1 → aprobar ────────────────────────────────────────
      // Se analiza `FAKE_URL_BEAUTY`: el brief del fake trae `category: 'beauty'` (la única vertical con
      // template + guard pack sembrados). El default `makeBrief` usa `skincare`, que NINGÚN template de
      // galería lista → N6 no casaría template y el sub-DAG N7 fallaría en el compilador. Se fija el
      // INPUT real (la vertical del brief), no el vertical DERIVADO (eso sería la trampa T1.13). El hueco
      // de completitud (verticals fuera de la lista de los pain_point templates no casan) es un hallazgo
      // de producto de F4, anotado en el informe — no bloquea esta cadena.
      await runUrlAnalysisToCp1(page, FAKE_URL_BEAUTY);
      await page
        .getByRole('form', { name: /editor de brief/i })
        .getByRole('button', { name: /aprobar y continuar/i })
        .click();

      // ── 2. N4 matriz → CP2: elegir TIER PREMIUM y confirmar ─────────────────────────────
      await waitCanvasStatus(page, 'N4', 'waiting_approval', 60_000);
      await expect(cp2(page)).toBeVisible({ timeout: 30_000 });
      // Premium: el único tier con el sub-DAG N7a-e completo resoluble.
      await page.getByLabel('Tier', { exact: true }).selectOption('premium');
      // El estimado se recalcula al cambiar el tier: esperar a que el coste deje de ser «—».
      await expect(page.getByRole('status', { name: /coste estimado/i })).not.toHaveText('—', {
        timeout: 30_000,
      });

      const variantCount = await page.locator('[data-slot="planned-matrix"] tbody tr').count();
      expect(variantCount).toBeGreaterThan(0);

      const analysisPath = new URL(page.url()).pathname;
      await page.getByRole('button', { name: /confirmar y crear/i }).click();
      await page.waitForURL((u) => u.pathname.startsWith('/runs/') && u.pathname !== analysisPath, {
        timeout: 30_000,
      });

      // ── 3. N5 guiona → CP3: aprobar todas → arranca el RUN DE GENERACIÓN ─────────────────
      await waitCanvasStatus(page, 'N5', 'waiting_approval', 120_000);
      await expect(cp3(page)).toBeVisible({ timeout: 30_000 });
      await expect(cp3(page).locator('[data-slot="variant-card"]')).toHaveCount(variantCount, {
        timeout: 30_000,
      });
      // El lote de ESTE run (anclado en el panel): con él se localiza el run de generación creado. El
      // `toHaveAttribute` garantiza que ya está poblado antes de leerlo.
      await expect(cp3(page)).toHaveAttribute('data-batch-id', /.+/);
      const batchId = await cp3(page).getAttribute('data-batch-id');

      await cp3(page)
        .getByRole('button', { name: /aprobar todas las aptas/i })
        .click();
      await expect(cp3(page).locator('[data-slot="approved-count"]')).toContainText(
        `${String(variantCount)} / ${String(variantCount)}`,
      );
      await cp3(page)
        .getByRole('button', { name: /confirmar guiones/i })
        .click();

      // El confirm crea el run de generación en su tx (buildVariantGenerationPlan incluido): si algo ahí
      // revienta (p. ej. una persona sin imagen de referencia por la rotación de N4), el panel pinta
      // `scripts-error` y N5 NUNCA sale de `waiting_approval`. Sin este guard, ese 500 se enmascararía en
      // el timeout de 30 s del `waitCanvasStatus` de N5 — se afirma su AUSENCIA para que el fallo salga
      // en el ORIGEN, con el mensaje real.
      await expect(cp3(page).locator('[data-slot="scripts-error"]')).toHaveCount(0);

      // Aprobar CP3 crea el RUN DE GENERACIÓN en la MISMA tx que los veredictos, PERO la app NO navega a
      // él (el usuario se queda en el run de N5, que queda `succeeded`). El run de generación se localiza
      // por la BD: es el run cuyos `step_run.variant_id` son las variantes del lote (N6 los lleva). Se
      // sondea hasta que exista (la creación es síncrona con la aprobación, pero se da margen).
      await waitCanvasStatus(page, 'N5', 'succeeded', 30_000);
      const generationRunId = await waitForGenerationRun(batchId ?? '', 30_000);
      expect(generationRunId, 'CP3 debe haber creado el run de generación').not.toBe('');
      const generationRunPath = `/runs/${generationRunId}`;

      // ── 4. El run de generación existe con su sub-DAG N6→N7 POR VARIANTE, contra la BD ──
      // Un N6 por variante + N7a-e por variante (§7.2). Se leen las filas `step_run` del run: cada una
      // lleva su `variant_id` (T4.11) — la columna que el canvas usa para agrupar.
      const stepRows = await queryStack<{ node_key: string; variant_id: string | null }>(
        `SELECT node_key, variant_id FROM step_run WHERE run_id = $1`,
        [generationRunId],
      );
      expect(stepRows.length).toBeGreaterThan(0);
      const variantIds = [...new Set(stepRows.map((r) => r.variant_id).filter((v) => v !== null))];
      // Premium expande N7a–N7e: al menos N6 + los 5 N7 por variante.
      const nodeKeys = new Set(stepRows.map((r) => r.node_key));
      for (const k of ['N6', 'N7a', 'N7b', 'N7c', 'N7d', 'N7e']) {
        expect(nodeKeys, `el sub-DAG premium debe incluir ${k}`).toContain(k);
      }
      // Cada step de generación lleva su variante (no NULL) — es lo que agrupa el canvas.
      expect(variantIds).toHaveLength(variantCount);

      // ── 5. UN sub-step FALLA de forma determinista (el fake malforma el 1.er submit de imagen) ──
      // Se espera a que algún N7a caiga en `failed` por SSE (sin reload). No se hardcodea la variante:
      // se DESCUBRE cuál falló (el fake designa el primer submit de imagen, del orden real del worker).
      const failedStepId = await waitForFailedStep(generationRunId, 120_000);
      expect(failedStepId, 'un sub-step de generación debe fallar de forma determinista').not.toBe(
        '',
      );

      // El nodo fallido pertenece a UNA variante; sus HERMANOS SANOS (misma variante, otros node_key)
      // que ya llegaron a `succeeded` son el control anti-T1.8 del retry.
      const failedRow = await queryStack<{ variant_id: string | null; node_key: string }>(
        `SELECT variant_id, node_key FROM step_run WHERE id = $1`,
        [failedStepId],
      );
      const failedVariant = failedRow[0]?.variant_id ?? null;
      expect(failedVariant).not.toBeNull();

      // Foto de los hermanos SANOS de la variante fallida ANTES del retry: sus `finished_at` (como TEXTO
      // ISO, no Date — dos Date iguales fallan `toBe` por identidad de instancia). Un retry granular NO
      // debe tocarlos; si reiniciara la variante, su `finished_at` cambiaría (control anti-T1.8).
      const siblingsBefore = await queryStack<{ id: string; finished_at: string | null }>(
        `SELECT id, finished_at::text AS finished_at FROM step_run
          WHERE run_id = $1 AND variant_id = $2 AND id <> $3 AND status = 'succeeded'`,
        [generationRunId, failedVariant, failedStepId],
      );
      // El control MUERDE de verdad solo si hay al menos un hermano sano que observar.
      expect(siblingsBefore.length).toBeGreaterThan(0);

      // ── 6. RETRY GRANULAR del sub-step fallido: se recupera SIN reiniciar los hermanos ──────
      // El botón vive en el inspector del nodo fallido. Se selecciona por su step id (el canvas lo
      // dirige por node_key; aquí se abre por la API de retry directamente para no depender de qué
      // variante quedó visible). El retry re-submitea con un request_id NUEVO (no doomed) → succeeds.
      const retryRes = await page.request.post(`/api/steps/${failedStepId}/retry`);
      expect(retryRes.ok()).toBe(true);

      // El step fallido acaba `succeeded` (el fake sirve un output correcto en el re-submit).
      await expect
        .poll(
          async () => {
            const rows = await queryStack<{ status: string }>(
              `SELECT status FROM step_run WHERE id = $1`,
              [failedStepId],
            );
            return rows[0]?.status ?? '';
          },
          { timeout: 120_000, intervals: [1_000] },
        )
        .toBe('succeeded');

      // CONTROL anti-T1.8: los hermanos sanos NO se reiniciaron — su `finished_at` es EXACTAMENTE el de
      // antes del retry. Si el retry reiniciara la variante (o el sub-grafo), estos timestamps
      // cambiarían y este assert se pondría ROJO — es la mordida de la cláusula «sin reiniciar los
      // hermanos sanos».
      for (const before of siblingsBefore) {
        // Cierra el ÚNICO camino de pase vacuo (null===null): un hermano `succeeded` DEBE tener un
        // `finished_at` real. Con esto, el `toBe` de abajo MUERDE de verdad — cualquier retry que
        // re-ejecutara o reiniciara al hermano le pondría un `finished_at` nuevo (o null) y, como se
        // relee la MISMA fila por id, la igualdad exacta de string se pondría ROJA. (El control es
        // permanente; no depende de un flip transitorio del orquestador.)
        expect(
          before.finished_at,
          `el hermano sano ${before.id} debe tener finished_at real`,
        ).not.toBeNull();
        const after = await queryStack<{ finished_at: string | null }>(
          `SELECT finished_at::text AS finished_at FROM step_run WHERE id = $1`,
          [before.id],
        );
        expect(after[0]?.finished_at, `el hermano sano ${before.id} NO debe reiniciarse`).toBe(
          before.finished_at,
        );
      }

      // ── 7. El canvas muestra el sub-DAG por variante con su contenido rico ──────────────────
      // El player de vídeo se inspecciona sobre un sub-step de vídeo YA `succeeded` (N7c avatar o N7d
      // b-roll), NO sobre la variante que se retriteó (su N7c cascada-reinició y puede seguir
      // `awaiting_deps` cuando se llega aquí). Se DESCUBRE por la BD qué variante tiene un vídeo
      // succeeded y se expande ESE grupo — así el nodo que se clica está listo y su preview existe.
      const videoStep = await waitForSucceededVideoStep(generationRunId, 120_000);
      expect(videoStep.variantId, 'debe haber un N7c/N7d succeeded que inspeccionar').not.toBe('');

      // Recargar para partir de un snapshot limpio del run de generación ya avanzado.
      await page.goto(generationRunPath);
      // El grupo compuesto de la variante del vídeo succeeded aparece como nodo (accessible name =
      // variantId crudo). Colapsado, sus hijos N7a–N7e NO se pintan (steps-to-graph): así, al
      // expandir SOLO este grupo, el único `article` con ese node_key en el DOM es el suyo.
      const groupNode = canvasNode(page, videoStep.variantId);
      await expect(groupNode).toBeVisible({ timeout: 30_000 });
      await expect(groupNode).toHaveAttribute('data-slot', 'n7-group-node');

      // Expandir el grupo: aparecen sus sub-steps N7a–N7e como nodos.
      await groupNode.getByRole('button', { name: /expandir/i }).click();
      await expect(canvasNode(page, 'N7a')).toBeVisible({ timeout: 15_000 });

      // Inspeccionar N6 (compilación de prompt, siempre succeeded y top-level): su panel muestra el
      // `resolvedPrompt`. El aside del inspector se identifica por su node_key (control positivo: si
      // se abriera otro nodo, el aria-label no casaría y el assert se pondría rojo).
      await page
        .getByRole('article', { name: /\bN6\b/ })
        .first()
        .click();
      await expect(page.getByRole('complementary', { name: /\bN6\b/ })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator('[data-slot="resolved-prompt"]')).toBeVisible({ timeout: 15_000 });

      // Inspeccionar el sub-step de vídeo succeeded (`data-status="succeeded"` desambigua del resto):
      // su panel muestra un player de vídeo + el coste. El control positivo es el aria-label del
      // inspector: debe ser el del node_key del vídeo (N7c/N7d), no otro nodo solapado.
      await page
        .getByRole('article', { name: new RegExp(`\\b${videoStep.nodeKey}\\b`) })
        .and(page.locator('[data-status="succeeded"]'))
        .first()
        .click();
      await expect(
        page.getByRole('complementary', { name: new RegExp(`\\b${videoStep.nodeKey}\\b`) }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-slot="asset-video"]').first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator('[data-slot="panel-cost"]')).toBeVisible();
    },
  );
});

/** Sondea la BD hasta que un sub-step de VÍDEO (N7c avatar o N7d b-roll) del run alcanza `succeeded` y
 *  devuelve su `{variantId, nodeKey}`, o `{variantId:'', nodeKey:''}` si expira. El player de vídeo se
 *  inspecciona sobre un nodo ya terminado (con output real), NO sobre la variante retriteada — cuyo N7c
 *  cascada-reinició y puede seguir `awaiting_deps`. La consulta devuelve NATURALMENTE una variante
 *  limpia (la retriteada tarda más en llegar a succeeded), sorteando además el backoff del retry. */
async function waitForSucceededVideoStep(
  runId: string,
  timeoutMs: number,
): Promise<{ variantId: string; nodeKey: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await queryStack<{ variant_id: string | null; node_key: string }>(
      `SELECT variant_id, node_key FROM step_run
        WHERE run_id = $1 AND status = 'succeeded' AND node_key IN ('N7c', 'N7d')
          AND variant_id IS NOT NULL
        LIMIT 1`,
      [runId],
    );
    const row = rows[0];
    if (row?.variant_id != null) return { variantId: row.variant_id, nodeKey: row.node_key };
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return { variantId: '', nodeKey: '' };
}

/** Sondea la BD hasta que exista el RUN DE GENERACIÓN del lote y devuelve su run_id, o '' si expira. Se
 *  identifica por sus filas `step_run`: son las que llevan un `variant_id` de una variante de ESTE lote
 *  (N6/N7 por variante, T4.11). Es el run distinto del de N5 (cuyos steps no llevan variant_id de estas
 *  variantes en su node_key N5, sino en ad_script). Se elige el run con nodo `N6` para esas variantes. */
async function waitForGenerationRun(batchId: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await queryStack<{ run_id: string }>(
      `SELECT DISTINCT sr.run_id
         FROM step_run sr
         JOIN ad_variant v ON v.id = sr.variant_id
        WHERE v.batch_id = $1 AND sr.node_key = 'N6'
        LIMIT 1`,
      [batchId],
    );
    if (rows[0]?.run_id !== undefined) return rows[0].run_id;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return '';
}

/** Sondea la BD hasta que ALGÚN N7a del run cae en `failed` (el fallo determinista del fake) y devuelve
 *  su step id, o '' si expira. No usa la UI: el fallo es un estado de BD observable, y así el assert no
 *  depende de qué variante quedó visible en el canvas. */
async function waitForFailedStep(runId: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Acotado a N7a (el sub-step de imagen que el fake dooma): el fallo determinista es de N7a, y ceñir
    // el query a `node_key LIKE 'N7a%'` evita que un failed ajeno (p. ej. la deuda N4-tier: una variante
    // sin imagen) desvíe el retry al step equivocado y mida el control de hermanos sobre otra variante.
    const rows = await queryStack<{ id: string }>(
      `SELECT id FROM step_run WHERE run_id = $1 AND status = 'failed' AND node_key LIKE 'N7a%' LIMIT 1`,
      [runId],
    );
    if (rows[0]?.id !== undefined) return rows[0].id;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return '';
}
