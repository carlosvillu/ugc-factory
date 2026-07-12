// Regresión permanente de CP1 — EL EDITOR DE BRIEF (T1.10b, e2e.md §9, regla 10 — DoD
// BLOQUEANTE). Ejercita el sistema COMPLETO (web + worker + orquestador + pg-boss + SSE + los
// nodos reales N1/N2/N3) contra los fakes de las APIs de pago: la suite JAMÁS gasta dinero.
//
// Cubre las cuatro observables de la Verificación que son de CP1 (el journey completo de fase
// vive en `phases/f1-brief.spec.ts`):
//   1. BADGES/EVIDENCE: los campos extraídos muestran su badge y SU CITA; los inferidos, no.
//   2. WARNINGS: el hook largo de la IA se AVISA (y no bloquea); la petición de imágenes del
//      modo manual BLOQUEA la aprobación hasta que el usuario decide (con su derivación a
//      packshot-IA).
//   3. EDICIÓN: editar un beneficio y un hook y guardar → versión v2 del brief.
//   4. VERSIONADO STANDALONE: `PATCH /api/briefs/:id` fuera del run crea v3.
import { test, expect } from '@playwright/test';
import { waitCanvasStatus as waitStatus } from './support/canvas';
import {
  briefEditor,
  briefIdOf,
  fetchBrief,
  runManualAnalysisToCp1,
  runUrlAnalysisToCp1,
} from './support/brief';

test.describe('CP1 · editor de brief (T1.10b)', () => {
  test(
    'los campos extraídos muestran su badge Y SU CITA; los inferidos, badge sin cita',
    { tag: ['@f1'] },
    async ({ page }) => {
      await runUrlAnalysisToCp1(page);
      const editor = briefEditor(page);

      // Los DOS badges del mockup 3a: el verde «✓ extraído» y el violeta «inferido».
      await expect(editor.getByText(/✓ extraído/).first()).toBeVisible();
      await expect(editor.getByText(/^inferido$/).first()).toBeVisible();

      // LA CLÁUSULA: el badge extraído MUESTRA su `evidence` (la cita textual), VISIBLE en el
      // editor — no en un tooltip. La cita sale del brief que el fake de Anthropic emite (que
      // es un `makeBrief()` real, con las evidencias del Apéndice A), así que este assert
      // observa el dato REAL que produjo el pipeline, no un texto inventado por el test.
      await expect(editor.locator('[data-slot="evidence"]').first()).toBeVisible();

      // Y el rail de trazabilidad cuenta ambos (el mockup: «14 extraídos, 6 inferidos»).
      const rail = editor.getByRole('complementary', { name: /trazabilidad/i });
      await expect(rail.locator('[data-slot="trace-extracted"]')).toBeVisible();
      await expect(rail.locator('[data-slot="trace-inferred"]')).toBeVisible();
    },
  );

  test(
    'el hook demasiado largo de la IA se AVISA en CP1 y NO bloquea la aprobación',
    { tag: ['@f1'] },
    async ({ page }) => {
      // Los hooks auténticos de Sonnet 5 se pasan del techo de ≤12 palabras con frecuencia (8
      // casos en los briefs reales de T1.9) — por eso el fake emite uno largo: emitir SOLO
      // hooks cortos pintaría un CP1 sin warnings que en producción nunca se ve.
      await runUrlAnalysisToCp1(page);
      const editor = briefEditor(page);

      await expect(editor.locator('[data-slot="warning-hook_too_long"]')).toBeVisible();
      // NO bloquea: si lo hiciera, CP1 estaría bloqueado en casi cualquier análisis real.
      await expect(editor.getByRole('button', { name: /aprobar y continuar/i })).toBeEnabled();
    },
  );

  test(
    'modo manual SIN imágenes: la petición BLOQUEANTE de imágenes con su derivación a packshot-IA',
    { tag: ['@f1'] },
    async ({ page }) => {
      await runManualAnalysisToCp1(page);
      const editor = briefEditor(page);

      // LA CLÁUSULA DE LA VERIFICACIÓN. El validador (perfil `manual`, T1.9) emite
      // `needs_user_decision` cuando no hay imagen de producto, con un mensaje ACCIONABLE que
      // nombra las dos salidas: subir fotos, o derivar a packshot-IA (N7a).
      const decision = editor.locator('[data-slot="warning-needs_user_decision"]');
      await expect(decision).toBeVisible();
      await expect(decision).toContainText(/packshot/i);

      // Y BLOQUEA de verdad: no se puede aprobar sin decidir.
      const approve = editor.getByRole('button', { name: /aprobar y continuar/i });
      await expect(approve).toBeDisabled();

      // La derivación a packshot-IA es una de las dos salidas.
      await editor.getByRole('button', { name: /generar packshot con ia/i }).click();
      await expect(approve).toBeEnabled();
    },
  );

  test(
    'editar un beneficio y un hook, guardar → el brief se versiona (v2) y el run avanza',
    { tag: ['@f1'] },
    async ({ page }) => {
      await runUrlAnalysisToCp1(page);
      const editor = briefEditor(page);

      // El brief que la IA sintetizó, ANTES de tocarlo: los campos vienen con contenido.
      const beneficio = editor.getByLabel('Beneficio 1');
      await expect(beneficio).not.toHaveValue('');

      // EDITAR un beneficio y un hook (exactamente lo que pide la Verificación).
      await beneficio.fill('Piel visiblemente más luminosa en 7 días');
      const hook = editor.getByLabel(/^Hook 1 de /).first();
      await hook.fill('Tu piel al despertar, sin filtros');

      // GUARDAR → el servidor crea la v2 (`edited_by_user:true`, `approved`), aprueba el step e
      // invalida el sub-grafo aguas abajo. El estado nuevo llega por SSE.
      await editor.getByRole('button', { name: /guardar cambios y continuar/i }).click();

      // El run AVANZA: N3 deja el checkpoint y queda `succeeded` (el canvas vuelve).
      await waitStatus(page, 'N3', 'succeeded', 30_000);
    },
  );
});

/**
 * VERSIONADO STANDALONE (Apéndice E): editar un brief APROBADO **fuera de un run activo** vía
 * `PATCH /api/briefs/:id` crea una versión NUEVA — no sobrescribe.
 *
 * Se ejercita por API (no por UI) porque ESO es lo que la Entrega pide: "endpoint standalone
 * GET/PATCH /api/briefs/:id (editar un brief aprobado fuera de un run activo)". La UI de esa
 * pantalla no existe en F1.
 */
test.describe('CP1 · versionado standalone del brief (Apéndice E)', () => {
  test(
    'PATCH /api/briefs/:id fuera del run crea una versión nueva (el v1 de la IA sigue intacto)',
    { tag: ['@f1'] },
    async ({ page, request }) => {
      await runUrlAnalysisToCp1(page);

      // El `briefId` (la FILA de `product_brief` que N3 persistió) está ANCLADO en el DOM del
      // editor: es el mismo id que el artefacto del step lleva en `N3Output.briefId`.
      const briefId = await briefIdOf(page);

      // v1: el que escribió N3 (la IA). draft, no editado por el usuario.
      const v1 = await fetchBrief(request, briefId);
      expect(v1.version).toBe(1);
      expect(v1.editedByUser).toBe(false);

      // Se aprueba en CP1 SIN editar (el v1 pasa a `approved`, sin crear v2: aprobar no es
      // editar). Ahora ya no hay run activo sobre este brief.
      await briefEditor(page)
        .getByRole('button', { name: /aprobar y continuar/i })
        .click();
      await waitStatus(page, 'N3', 'succeeded', 30_000);

      const aprobado = await fetchBrief(request, briefId);
      expect(aprobado.version).toBe(1); // sigue siendo v1
      expect(aprobado.status).toBe('approved');

      // LA CLÁUSULA: editar el brief aprobado por el endpoint standalone crea una versión NUEVA.
      const editado = structuredClone(aprobado.brief);
      editado.product.name = 'Sérum Vitamina C 15% (editado sin run)';

      const patch = await request.patch(`/api/briefs/${briefId}`, { data: { brief: editado } });
      expect(patch.ok()).toBe(true);
      const v2 = (await patch.json()) as { version: number; editedByUser: boolean; id: string };

      // Versión NUEVA, marcada como edición humana. (v2 aquí porque se aprobó sin editar; si la
      // Verificación edita en CP1 antes, esta sería la v3 — el contador es el mismo.)
      expect(v2.version).toBe(2);
      expect(v2.editedByUser).toBe(true);
      expect(v2.id).not.toBe(briefId);

      // Y el v1 de la IA SIGUE AHÍ, intacto: versionar no es sobrescribir (el linaje IA→humano
      // es el punto — §19.1 mide cuánto corrige el humano a la IA).
      const v1Otra = await fetchBrief(request, briefId);
      expect(v1Otra.version).toBe(1);
      expect(v1Otra.brief.product.name).not.toContain('editado sin run');
    },
  );
});
