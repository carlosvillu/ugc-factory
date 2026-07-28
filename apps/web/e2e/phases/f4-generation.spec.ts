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
import { randomUUID } from 'node:crypto';
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

  // BLINDAJE del matching (T4.11, invariante corregido 2026-07-23 regla 6): lo que el run EXIGE es que la
  // persona que N4 selecciona —el candidato de MAYOR score, `matchPersonas` ordena desc— sea Nora F4 Premium
  // Y que tenga imagen de referencia (N7c avatar necesita `referenceImageIds[0]`; sin ella, 500 opaco aguas
  // abajo). El assert ORIGINAL afirmaba `toEqual(['Nora F4 Premium'])` (Nora es la ÚNICA candidata con
  // imagen), que era más estricto que el requisito real: al CRECER `PERSONA_SEEDS`, personas placeholder
  // que SÍ traen imagen (Nerea, Rosa) casan por tokens genéricos ('mujer', 'luminoso') con score MENOR —
  // candidatas con imagen, sí, pero N4 nunca cae en ellas porque Nora puntúa más alto. El journey pasa
  // (verificado). El invariante que protege el run es «el top-1 es Nora Y tiene imagen», no «Nora es la
  // única con imagen». (regla 6: se afina la aserción al requisito real, NO se relaja para tapar un fallo.)
  const personas = await listPersonas(stackDb);
  const candidates = matchPersonas(personas, FAKE_BEAUTY_AVATAR_HINT);
  expect(candidates.length, 'el hint beauty debe casar con al menos una persona').toBeGreaterThan(
    0,
  );
  const top = candidates[0]?.persona;
  expect(top?.name, 'N4 usa el candidato de mayor score: debe ser Nora F4 Premium').toBe(
    'Nora F4 Premium',
  );
  expect(
    (top?.referenceImageIds.length ?? 0) > 0,
    'el top-1 (Nora F4 Premium) debe traer imagen de referencia: N7c avatar la exige o el run 500ea',
  ).toBe(true);
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
      //
      // URL RUN-ÚNICA (T5.23): `?run=<nonce>` con un nonce ÚNICO POR EJECUCIÓN. El fake lo deriva de la
      // síntesis e inyecta un `[run <nonce>]` en `product.name` → el `resolvedPrompt` del packshot N7a (y
      // su `content_hash`) es DISTINTO cada corrida → la dedup de generación cross-run NO acierta sobre un
      // stack REUSADO/warm → f4 submitea el packshot y el fallo determinista existe. Sin esto, la corrida 2
      // sobre el mismo stack vivo hit-ea dedup, N7a nunca submitea y `waitForFailedStep` vuelve vacío (rojo
      // que contamina el gate). La constante exportada NO se muta (otros specs la importan): se construye
      // local. `randomUUID` es legítimo aquí (spec Playwright, no script de workflow).
      const runNonce = randomUUID().slice(0, 8);
      const runUrl = `${FAKE_URL_BEAUTY}?run=${runNonce}`;
      await runUrlAnalysisToCp1(page, runUrl);

      // CONTROL POSITIVO del canal de inyección (T5.23): el editor de CP1 muestra el `product.name` con el
      // nonce inyectado. Si el `?run=` se perdiera por el camino (normalización de URL, brief sourced del
      // scrape…), el brief degradaría al buggy de hoy y el fallo saldría como un timeout OPACO de
      // `waitForFailedStep` 3 min después; este assert lo hace fallar en el ORIGEN con la causa real.
      await expect(
        page.getByRole('form', { name: /editor de brief/i }).getByLabel('Nombre', { exact: true }),
      ).toHaveValue(new RegExp(`\\[run ${runNonce}\\]`), { timeout: 15_000 });

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

      // ── 4.5 GUARDA DEL CANAL DEL NONCE (T5.23, regla 5a) — el marcador de corrida LLEGA a N7a ──
      // El fallo determinista + su doom keyed-por-corrida dependen de que el `[run <nonce>]` que el fake
      // inyecta en `product.name` viaje intacto brief → `buildPackshotPrompt` → `resolvedPrompt` del submit
      // de N7a (de ahí lo lee el doom, `fake-apis.ts`). El control positivo de CP1 (:124-126) cubre solo
      // URL → brief; ESTE cubre el tramo que falta, brief → prompt → submit. Si esa cadena se rompe en el
      // futuro (alguien cambia `runMarker` sin `RUN_MARKER_RE`, `product.name` deja de llegar a
      // `buildPackshotPrompt`, o se mete un `trimForPrompt` sobre `name`), el nonce se pierde: el doom NO se
      // re-arma sobre stack warm y el spec moriría con un TIMEOUT OPACO de 120s en `waitForFailedStep`
      // culpando al pipeline — justo el fallo que T5.23 existe para eliminar. Esta guarda lo caza en
      // SEGUNDOS con la causa real. El `resolved_prompt` está PERSISTIDO en `generation` (columna
      // `resolved_prompt`, escrita en `submitting` ANTES del submit) y se une a N7a por `step_run_id`.
      // Timeout 20s: la fila N7a con prompt aparece a ~1-2,1s (medido warm), ~10× de margen.
      await expect
        .poll(
          async () => {
            const rows = await queryStack<{ resolved_prompt: string | null }>(
              `SELECT g.resolved_prompt
                 FROM generation g
                 JOIN step_run sr ON sr.id = g.step_run_id
                WHERE sr.run_id = $1 AND sr.node_key LIKE 'N7a%' AND g.resolved_prompt IS NOT NULL
                LIMIT 1`,
              [generationRunId],
            );
            return rows[0]?.resolved_prompt ?? '';
          },
          {
            timeout: 20_000,
            intervals: [250],
            message:
              'el marcador de corrida [run <nonce>] NO llegó al resolvedPrompt de N7a — el canal ' +
              'brief→prompt→submit del nonce está roto (¿runMarker vs RUN_MARKER_RE?, ¿product.name no ' +
              'aterriza en buildPackshotPrompt?), así el doom keyed caería al global one-shot y sobre ' +
              'stack warm el fallo determinista desaparecería (timeout opaco de 120s en waitForFailedStep)',
          },
        )
        .toContain(`[run ${runNonce}]`);

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
      // El botón vive en el inspector del nodo fallido; aquí se abre por la API de retry directamente para
      // no depender de qué variante quedó visible. El retry re-submitea con un request_id NUEVO (no
      // doomed) → succeeds. El retry recupera la variante doomed → su cadena N7→N8→N9 avanza y su N9
      // acaba pausando en CP4 (necesario para el DRENADO del paso 7: si la variante doomed quedara
      // parked, su N9 nunca pausaría y el conteo de CP4 nunca llegaría a `variantCount`).
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

      // ── 7. DRENAR CP4: aprobar TODOS los N9 → el slot único queda libre para el `StepPanel` ──────
      // POR QUÉ (T5.23, corrección al reorden fallido): el `StepPanel` (inspector de nodo) y el `QaPanel`
      // (CP4) comparten UN slot con precedencia de checkpoint (`run-shell.tsx:84-99`): con CUALQUIER N9 en
      // `waiting_approval`, `QaPanel` gana y `StepPanel` NO monta → el inspector de N6/vídeo es INALCANZABLE.
      // En el DAG de generación N9 es UNO POR VARIANTE (`useQaCheckpoints`) y, sobre stack warm, la dedup de
      // N7b-e acelera el pipeline: CP4 abre MUY pronto (~38-45s, medido por el verifier). NINGÚN reorden
      // temporal lo evita — es una precedencia ESTRUCTURAL, no una carrera. La única forma robusta de
      // inspeccionar el panel es alcanzar el estado en que NINGÚN checkpoint puede estar pendiente: N9 es
      // uno-por-variante y TERMINAL (nada depende de él, `generation-dag.ts`), así que en cuanto TODOS los
      // N9 están resueltos, CP4 no puede reabrir. Esto es SETUP (se drena por API — e2e.md §6), la
      // aserción sigue siendo del PANEL (no se re-ancla a BD).
      //
      // Se espera al conteo COMPLETO de N9 pausados (== variantCount) ANTES de aprobar: si se aprobara a
      // medida que aparecen, un N9 tardío (el de la variante doomed, que solo pausa tras retry→N7→N8)
      // pausaría DESPUÉS del drenado y CP4 estaría abierto otra vez cuando corre el bloque de paneles.
      const n9StepIds = await waitForAllN9Waiting(generationRunId, variantCount, 120_000);
      expect(
        n9StepIds,
        'todos los N9 (uno por variante) deben pausar en CP4 antes de drenar',
      ).toHaveLength(variantCount);
      for (const n9Id of n9StepIds) {
        const approveRes = await page.request.post(`/api/steps/${n9Id}/approve`);
        expect(approveRes.ok(), `aprobar N9 ${n9Id} debe responder ok`).toBe(true);
      }

      // ── 8. El canvas muestra el sub-DAG por variante con su contenido rico (CP4 ya drenado) ──────
      // Recargar para partir de un snapshot limpio con los N9 ya resueltos (el store refleja el drenado).
      await page.goto(generationRunPath);
      // GUARDA DEL DRENADO: el `QaPanel` YA NO está en el DOM → el slot lo ocupa el `StepPanel`. Sin esto,
      // un drenado que fallara en silencio daría el MISMO `toBeVisible` opaco aguas abajo; aquí falla con
      // la causa real («CP4 sigue abierto») antes de tocar ningún nodo.
      await expect(page.locator('[data-slot="qa-panel"]')).toHaveCount(0, { timeout: 30_000 });

      // El player de vídeo se inspecciona sobre un sub-step de vídeo YA `succeeded` (N7c avatar o N7d
      // b-roll), NO sobre la variante que se retriteó (su N7c cascada-reinició tras el retry del paso 6 y
      // puede seguir `awaiting_deps`). Se DESCUBRE por la BD qué variante tiene un vídeo succeeded y se
      // expande ESE grupo — así el nodo que se clica está listo y su preview existe.
      const videoStep = await waitForSucceededVideoStep(generationRunId, 120_000);
      expect(videoStep.variantId, 'debe haber un N7c/N7d succeeded que inspeccionar').not.toBe('');

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
 *  cascada-reinició tras el retry del paso 6 y puede seguir `awaiting_deps`. La consulta devuelve
 *  NATURALMENTE una variante limpia (la retriteada tarda más en llegar a succeeded), sorteando el backoff
 *  del retry. */
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

/** Sondea la BD hasta que TODOS los N9 del run (uno por variante) estén en `waiting_approval` y devuelve
 *  sus step ids, o `[]` si expira antes de llegar al conteo esperado (T5.23, drenado de CP4). Se espera al
 *  conteo COMPLETO —no a los que van llegando— porque aprobar a medias dejaría reabrir CP4 con un N9
 *  tardío (el de la variante doomed, que solo pausa tras el retry→N7→N8). Es SETUP por API (e2e.md §6). */
async function waitForAllN9Waiting(
  runId: string,
  expectedCount: number,
  timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await queryStack<{ id: string }>(
      `SELECT id FROM step_run WHERE run_id = $1 AND status = 'waiting_approval' AND node_key = 'N9'`,
      [runId],
    );
    if (rows.length >= expectedCount) return rows.map((r) => r.id);
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return [];
}
