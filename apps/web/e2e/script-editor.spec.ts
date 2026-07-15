// E2E de CP3 — EL EDITOR DE GUIONES, DISECADO (T2.6, e2e.md §7). Hermano de `f2-scripts.spec.ts`:
// aquel prueba el journey feliz (todas limpias → todas scripted); ESTE prueba el ARCO BLOQUEANTE,
// que es la razón de ser de CP3 y lo único que el journey no puede ejercitar (el fake escribe
// guiones LIMPIOS, así que sin intervención no hay ni un flag).
//
// EL PROBLEMA Y CÓMO SE RESUELVE (patrón híbrido, e2e.md §6). Un flag bloqueante REAL exige un claim
// prohibido en el texto, y ni el fake lo escribe ni CP1 deja editar `banned_or_risky_claims`. Así
// que: (1) se conduce el sistema REAL hasta un CP3 de verdad (cero riesgo de sembrar mal un
// checkpoint pausado — lo construye el sistema), (2) se INYECTA el claim en la narración de una
// escena hook de UNA variante + su flag bloqueante (dato en reposo, por SQL, nunca por clicks), y
// (3) se recarga: CP3 re-abre y re-lee, ahora con la variante bloqueada.
//
// LO QUE ESTE SPEC PRUEBA (y no re-prueba lo de otras capas): el LAZO disabled→editar→enable. El
// guard server-side (rechazo del POST directo) ya lo cubre `scripts-checkpoint.test.ts`; la lógica
// de cliente, `scripts-panel.test.tsx`. Aquí se prueba, de punta a punta, que editar la NARRACIÓN de
// una escena para quitar el claim re-habilita la aprobación y la variante acaba `scripted` — el
// re-lint desde las escenas (`rebuildEditedScript`) corriendo en el servidor de verdad.
import { test, expect, type Page } from '@playwright/test';
import { createDb, upsertPersonaByName } from '@ugc/db';
import { waitCanvasStatus } from './support/canvas';
import { briefEditor, runUrlAnalysisToCp1 } from './support/brief';
import { queryStack, stackDatabaseUrl } from './support/stack-db';

const stackDb = createDb(stackDatabaseUrl);

const MATCHING_PERSONA = {
  name: 'Nora E2E CP3',
  ageRange: '25-35',
  gender: 'female' as const,
  ethnicity: 'mediterránea',
  style: 'natural',
  descriptor: 'creadora de 30 años, estilo natural, baño luminoso',
  setting: 'baño luminoso',
  personality: 'cercana y directa',
};

const BANNED_CLAIM = 'cura el acné'; // el `banned_or_risky_claims` del brief del fake (factories.ts).

test.beforeAll(async () => {
  await upsertPersonaByName(stackDb, MATCHING_PERSONA);
});

function cp3(page: Page) {
  return page.locator('[data-slot="scripts-panel"]');
}

/** Conduce el sistema REAL hasta un CP3 de verdad: URL → CP1 aprobar → CP2 confirmar → navega al run
 *  de N5 → N5 guioniza y pausa. Devuelve el `batchId` del lote creado. */
async function driveToCp3(page: Page): Promise<{ batchId: string; variantCount: number }> {
  await runUrlAnalysisToCp1(page);
  await briefEditor(page)
    .getByRole('button', { name: /aprobar y continuar/i })
    .click();
  await waitCanvasStatus(page, 'N4', 'waiting_approval', 60_000);
  await expect(page.locator('[data-slot="matrix-panel"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('status', { name: /coste estimado/i })).not.toHaveText('—', {
    timeout: 30_000,
  });
  const variantCount = await page.locator('[data-slot="planned-matrix"] tbody tr').count();

  const analysisPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: /confirmar y crear/i }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/runs/') && u.pathname !== analysisPath, {
    timeout: 30_000,
  });
  await waitCanvasStatus(page, 'N5', 'waiting_approval', 90_000);
  await expect(cp3(page)).toBeVisible({ timeout: 30_000 });
  // Espera a que el panel cargue (una tarjeta renderizada) — solo entonces expone `data-batch-id`.
  await expect(cp3(page).locator('[data-slot="variant-card"]').first()).toBeVisible({
    timeout: 30_000,
  });

  // El batchId del lote de ESTE run, leído del panel — NO un `SELECT ... ORDER BY id DESC LIMIT 1`
  // global: los specs de F2 corren en paralelo contra el mismo stack y varios crean lotes, así que
  // «el último» no es determinista. El del panel es el del run al que navegó ESTE `page`.
  const batchId = await cp3(page).getAttribute('data-batch-id');
  if (batchId === null || batchId === '') throw new Error('el panel de CP3 no expone el batchId');
  return { batchId, variantCount };
}

/**
 * INYECTA un claim prohibido en la narración de la ESCENA hook de una variante del lote + su flag
 * bloqueante. Dato en reposo (SQL), no clicks. Devuelve el `filename_code` de la variante tocada
 * para poder localizar su tarjeta tras recargar.
 *
 * El flag es SCHEMA-VÁLIDO (los cinco campos): `parseFlags` en el servidor de lectura descarta un
 * flag malformado y caería a `[]` — la variante saldría SIN bloqueo y el test fallaría de forma
 * confusa. Se construye entero.
 */
async function injectBlockingClaim(batchId: string): Promise<string> {
  // La v vigente de una variante del lote (la de filename_code más bajo, determinista).
  const rows = await queryStack<{ id: string; filename_code: string; scenes: unknown }>(
    `SELECT s.id, v.filename_code, s.scenes
       FROM ad_script s JOIN ad_variant v ON v.id = s.variant_id
      WHERE v.batch_id = $1
      ORDER BY v.filename_code ASC
      LIMIT 1`,
    [batchId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('no hay guion que contaminar');

  // Mete el claim en la narración de la PRIMERA escena hook (conservando su forma).
  const scenes = (row.scenes as { segment: string; narration: string }[]).map((scene, i) =>
    i === 0 ? { ...scene, narration: `Esta crema ${BANNED_CLAIM} en tres días.` } : scene,
  );
  const flag = {
    rule: 'banned_claim',
    blocking: true,
    excerpt: BANNED_CLAIM,
    explanation: 'La marca prohíbe este claim médico sin respaldo.',
    suggestion: 'Reformula como cuidado de la piel, sin prometer curación.',
  };
  await queryStack(
    `UPDATE ad_script
        SET scenes = $2::jsonb,
            guardrail_flags = $3::jsonb
      WHERE id = $1`,
    [row.id, JSON.stringify(scenes), JSON.stringify([flag])],
  );
  return row.filename_code;
}

test.describe('CP3 · editor de guiones: el arco bloqueante (T2.6)', () => {
  test(
    'una variante con claim prohibido no se aprueba hasta editar la escena; editada, queda scripted',
    { tag: ['@f2', '@checkpoint'] },
    async ({ page }) => {
      const { batchId, variantCount } = await driveToCp3(page);

      // Inyecta el bloqueo en una variante y recarga: CP3 re-abre (el mismo mecanismo que ya detecta
      // el checkpoint pausado) y re-lee los guiones, ahora con la variante bloqueada.
      const blockedCode = await injectBlockingClaim(batchId);
      await page.reload();
      await expect(cp3(page)).toBeVisible({ timeout: 30_000 });

      const blockedCard = cp3(page).locator(
        `[data-slot="variant-card"][data-filename-code="${blockedCode}"]`,
      );
      await expect(blockedCard).toBeVisible({ timeout: 30_000 });

      // ── El flag bloqueante se ve y su aprobar está DESHABILITADO (con el motivo a la vista) ──
      await expect(blockedCard).toHaveAttribute('data-blocking', 'true');
      await expect(blockedCard.locator('[data-slot="flag-banned_claim"]')).toContainText(
        BANNED_CLAIM,
      );
      const approve = blockedCard.getByRole('checkbox', { name: 'Aprobar esta variante' });
      await expect(approve).toBeDisabled();
      await expect(blockedCard.locator('[data-slot="approve-blocked"]')).toBeVisible();

      // ── «Aprobar todas las aptas» NO fuerza la bloqueada: cubre todas menos esa ──
      await cp3(page)
        .getByRole('button', { name: /aprobar todas las aptas/i })
        .click();
      await expect(cp3(page).locator('[data-slot="approved-count"]')).toContainText(
        `${String(variantCount - 1)} / ${String(variantCount)}`,
      );

      // ── EDITAR la narración de la escena hook para quitar el claim → el aprobar se re-habilita ──
      // (el cliente no re-lintea: cede al servidor. Al editar, el guard local suelta el candado.)
      const hookScene = blockedCard.locator('[data-slot="scene-narration"]').first();
      await hookScene.fill('Esta crema cuida tu piel a diario.');
      await expect(approve).toBeEnabled({ timeout: 10_000 });
      await approve.check();

      // ── Confirmar: el servidor re-lintea la edición (limpia) y transiciona TODAS a scripted ──
      await cp3(page)
        .getByRole('button', { name: /confirmar guiones/i })
        .click();
      await waitCanvasStatus(page, 'N5', 'succeeded', 30_000);

      // ── CONTRA LA BD: todas las variantes del lote quedaron `scripted` ──
      const variants = await queryStack<{ status: string }>(
        `SELECT status FROM ad_variant WHERE batch_id = $1`,
        [batchId],
      );
      expect(variants).toHaveLength(variantCount);
      expect(variants.every((v) => v.status === 'scripted')).toBe(true);

      // Y la variante editada tiene una v2 `edited_by_user` (el linaje IA→humano, §19.1) sin el
      // claim: el re-lint desde la escena editada corrió en el servidor y la dejó limpia.
      const edited = await queryStack<{
        version: number;
        edited_by_user: boolean;
        full_text: string;
      }>(
        `SELECT s.version, s.edited_by_user, s.full_text
           FROM ad_script s JOIN ad_variant v ON v.id = s.variant_id
          WHERE v.batch_id = $1 AND v.filename_code = $2
          ORDER BY s.version DESC
          LIMIT 1`,
        [batchId, blockedCode],
      );
      expect(edited[0]?.version).toBe(2);
      expect(edited[0]?.edited_by_user).toBe(true);
      expect(edited[0]?.full_text).not.toContain(BANNED_CLAIM);
    },
  );
});
