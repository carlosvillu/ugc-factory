// E2E PERMANENTE de la GENERACIÓN DE GALERÍA (T4.12, pase A). Contra el stack real (Postgres + web) y
// con fal FINGIDO (startFakeExternalApis vía FAL_BASE_URL → CERO gasto real), prueba las piezas de $0
// del pase A:
//   1. THUMBNAIL + GUARD: un template `kind:'image'` SIN thumbnail NO se puede publicar (el guard §10.2
//      regla 2 muerde con 400); tras generar su thumbnail (`POST /api/templates/:id/thumbnail`), pasa a
//      `published` (y su fila queda con `thumbnail_asset_id` poblado — «ninguno publicado sin thumbnail»).
//   2. PROBAR TEMPLATE: el botón «Probar template» de la ficha genera una IMAGEN de prueba visible con su
//      COSTE, y ese coste aparece en el ledger de fal (visible en /spend). El conteo del ledger está
//      SCOPED a `template_test=true` (FK `cost_entry.generation_id → generation.template_test`), como
//      voice-preview.spec scope-a `voice_preview`: un conteo GLOBAL de `provider='fal'` sumaría el ruido
//      de otros specs @f4 en la BD compartida (el falso rojo «2 vs 9» de T4.11).
//
// CONTROL NEGATIVO del guard (demostrado por el implementer, NO commiteado roto): revertir la validación
// de `setTemplateStatus` → un template sin thumbnail se publica → el assert «publicar sin thumbnail da
// 400» se pone ROJO. Documentado en el informe; el guard también está cubierto por los tests de
// integración (`gallery-repo.test.ts`, `api/templates.test.ts`), que son la red permanente.
//
// PASE B (curación de referencias de Personas IA): FUERA de este pase — ver el `test.skip` anotado al
// final. NO se implementa aquí ($ + juicio del usuario).
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiCall } from './support/http';
import { queryStack } from './support/stack-db';

/** Sufijo único por ejecución para slugs (la BD del stack es COMPARTIDA por toda la suite). */
function tag(): string {
  return `${String(Date.now())}-${String(Math.random()).slice(2, 7)}`;
}

/** Crea un template `kind:'image'` vía `POST /api/templates` (hereda la cookie de sesión). Devuelve id. */
async function createImageTemplate(
  request: APIRequestContext,
  slug: string,
  title: string,
): Promise<string> {
  const res = await apiCall(
    () =>
      request.post('/api/templates', {
        data: {
          slug,
          title,
          kind: 'image',
          body: 'Producto {product.name} sobre un fondo limpio y luminoso.',
          language: 'es',
          verticals: ['beauty'],
        },
      }),
    'POST /api/templates',
  );
  if (res.status() !== 201) {
    throw new Error(`POST /api/templates falló (${String(res.status())}): ${await res.text()}`);
  }
  return ((await res.json()) as { id: string }).id;
}

/** Cuenta las `cost_entry` de fal de PRUEBAS de template (`generation.template_test = true`) — la
 *  métrica scoped que la generación de una prueba incrementa (y un cache-hit NO). El JOIN scoped evita
 *  el ruido de otros specs @f4 que también escriben `cost_entry` de fal (con `template_test = false`). */
async function templateTestFalEntries(): Promise<number> {
  const [row] = await queryStack<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM cost_entry c
       JOIN generation g ON g.id = c.generation_id
      WHERE c.provider = 'fal' AND g.template_test = true`,
  );
  return Number(row?.n ?? '0');
}

/** El `thumbnail_asset_id` de un template por su id (o null). */
async function thumbnailOf(templateId: string): Promise<string | null> {
  const rows = await queryStack<{ thumbnail_asset_id: string | null }>(
    `SELECT thumbnail_asset_id FROM prompt_template WHERE id = $1`,
    [templateId],
  );
  return rows[0]?.thumbnail_asset_id ?? null;
}

test.describe('Generación de galería (T4.12 pase A) — fal fake, $0', () => {
  test(
    'thumbnail: un template sin thumbnail NO se publica; con thumbnail generado, sí',
    { tag: ['@f4', '@gallery'] },
    async ({ request }) => {
      const t = tag();
      const id = await createImageTemplate(request, `e2e-thumb-${t}`, `E2E thumb ${t}`);

      // Pasar a `review` (no exige thumbnail).
      const toReview = await apiCall(
        () => request.patch(`/api/templates/${id}/status`, { data: { status: 'review' } }),
        'PATCH status review',
      );
      expect(toReview.status()).toBe(200);

      // GUARD: publicar SIN thumbnail → 400 validation_error (el template sigue en review).
      const publishNoThumb = await apiCall(
        () => request.patch(`/api/templates/${id}/status`, { data: { status: 'published' } }),
        'PATCH status published (sin thumbnail)',
      );
      expect(publishNoThumb.status()).toBe(400);
      expect(await thumbnailOf(id)).toBeNull();

      // Generar el thumbnail con fal (fake) → el template queda con su `thumbnail_asset_id`.
      const thumb = await apiCall(
        () => request.post(`/api/templates/${id}/thumbnail`),
        'POST thumbnail',
      );
      expect(thumb.status()).toBe(200);
      const thumbBody = (await thumb.json()) as { assetId: string };
      expect(thumbBody.assetId).toBeTruthy();
      expect(await thumbnailOf(id)).toBe(thumbBody.assetId);

      // Ahora SÍ se puede publicar (§10.2 regla 2 satisfecha).
      const publishOk = await apiCall(
        () => request.patch(`/api/templates/${id}/status`, { data: { status: 'published' } }),
        'PATCH status published (con thumbnail)',
      );
      expect(publishOk.status()).toBe(200);
      expect(((await publishOk.json()) as { status: string }).status).toBe('published');

      // INVARIANTE «ninguno publicado sin thumbnail»: no existe ningún template published sin thumbnail.
      const [orphan] = await queryStack<{ n: string }>(
        `SELECT count(*)::text AS n FROM prompt_template WHERE status = 'published' AND thumbnail_asset_id IS NULL`,
      );
      expect(Number(orphan?.n ?? '0')).toBe(0);
    },
  );

  test(
    'probar template: el botón de la ficha genera una imagen de prueba con coste visible en /spend',
    { tag: ['@f4', '@gallery'] },
    async ({ page, request }) => {
      const t = tag();
      const title = `E2E probar ${t}`;
      const id = await createImageTemplate(request, `e2e-test-${t}`, title);

      // Abrir la ficha del template en la galería.
      await page.goto('/gallery');
      await page.getByRole('button', { name: `Abrir template ${title}` }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: title })).toBeVisible();

      // El botón «Probar template» existe para un template image (no para vídeo).
      const testButton = dialog.locator('[data-slot="template-test-button"]');
      await expect(testButton).toBeVisible();

      // ── Probar → genera una imagen de prueba + 1 cost_entry de fal (template_test) ──
      const before = await templateTestFalEntries();
      const waitTest = page.waitForResponse(
        (r) => r.url().includes(`/templates/${id}/test`) && r.request().method() === 'POST',
      );
      await testButton.click();
      const testRes = await waitTest;
      expect(testRes.status()).toBe(200);

      // La imagen generada se muestra en la ficha, y su coste también.
      await expect(dialog.locator('[data-slot="template-test-image"]')).toBeVisible({
        timeout: 30_000,
      });
      await expect(dialog.locator('[data-slot="template-test-cost"]')).toBeVisible();

      // El ledger scoped a pruebas subió en EXACTAMENTE 1 (la generación de la prueba pagó una vez).
      const after = await templateTestFalEntries();
      expect(after).toBe(before + 1);

      // El coste es visible en /spend: la fila de fal.ai existe con un total no-cero.
      await page.goto('/spend');
      const providerTable = page.getByRole('table').first();
      const falRow = providerTable.getByRole('row').filter({ hasText: 'fal.ai' });
      await expect(falRow).toBeVisible({ timeout: 30_000 });
      await expect(falRow).not.toContainText('$0.00');
    },
  );

  // ── PASE B (NO en este pase): curación de las imágenes de referencia de Personas IA. ──
  // La Verificación completa de T4.12 incluye «10 personas activas con referencias curadas»; eso es la
  // generación IA de Personas (identity-lock), que el pase B implementa con gasto real y juicio del
  // usuario. Aquí se deja anotado explícitamente para no fingir cobertura que no existe.
  test.skip('PASE B: curación de imágenes de referencia de Personas IA (identity-lock)', () => {
    // Implementar en el pase B de T4.12 (generación IA de Personas, sample-first, gasto + juicio).
  });
});
