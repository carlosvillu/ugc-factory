// E2E PERMANENTE de la GENERACIÓN DE GALERÍA (T4.12, pases A y B). Contra el stack real (Postgres + web)
// y con fal FINGIDO (startFakeExternalApis vía FAL_BASE_URL → CERO gasto real), prueba las piezas de $0
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
// PASE B (generación IA de reference-images de Personas · identity-lock): el ÚLTIMO test de este fichero
// lo cubre con fal fake ($0). La CONSISTENCIA «mismo sujeto» es juicio humano (no automatizable aquí);
// se prueba el MECANISMO: «Generar variación» → aparecen reference-images ≥2K con coste en /spend.
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

/** Cuenta las `cost_entry` de fal de GENERACIONES DE REFERENCE-IMAGE de persona (la generación produjo un
 *  asset `kind='reference_image'`). El JOIN scoped evita el ruido de otros specs @f4 que también escriben
 *  `cost_entry` de fal (keyframes, thumbnails, clips…): solo cuenta las que materializaron una referencia.
 *  El retrato base (flux-2) NO produce reference_image → su cost_entry no cuenta aquí, pero cada ENCUADRE
 *  sí, así que una generación real siempre sube este contador. */
async function personaReferenceFalEntries(): Promise<number> {
  const [row] = await queryStack<{ n: string }>(
    `SELECT count(DISTINCT c.id)::text AS n
       FROM cost_entry c
       JOIN asset a ON a.generation_id = c.generation_id
      WHERE c.provider = 'fal' AND a.kind = 'reference_image'`,
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
    async ({ page, request }) => {
      const t = tag();
      const thumbTitle = `E2E thumb ${t}`;
      const id = await createImageTemplate(request, `e2e-thumb-${t}`, thumbTitle);

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

      // OBSERVABLE en `/gallery` (cláusula 2 de la Verificación: «published con thumbnail EN
      // /gallery»): la tarjeta del template published NO pinta el hatch-placeholder — renderiza la
      // MINIATURA real servida por `GET /api/assets/:id/download`. No basta con que exista el `<img>`
      // (la primitiva `Image` lo monta en `opacity-0` mientras carga y `toBeVisible` ignora la
      // opacidad): el observable que prueba los BYTES es `data-status="loaded"` del wrapper, que solo
      // se alcanza cuando el round-trip a `/api/assets/.../download` devolvió una imagen con
      // `naturalWidth > 0`. El `src` con el path real prueba el WIRING (no el hatch).
      await page.goto('/gallery');
      const card = page.getByRole('button', { name: `Abrir template ${thumbTitle}` });
      await expect(card).toBeVisible();
      const cardImage = card.locator('[data-slot="image"]');
      await expect(cardImage.locator('img')).toHaveAttribute(
        'src',
        new RegExp(`/api/assets/${thumbBody.assetId}/download`),
      );
      await expect(cardImage).toHaveAttribute('data-status', 'loaded', { timeout: 30_000 });
    },
  );

  test(
    'probar template: el botón de la ficha genera una imagen de prueba con coste visible en /spend',
    { tag: ['@f4', '@gallery'] },
    async ({ page, request }) => {
      const t = tag();
      const title = `E2E probar ${t}`;
      const id = await createImageTemplate(request, `e2e-test-${t}`, title);

      // CONTROL NEGATIVO del fallback: este template es un DRAFT sin thumbnail generado. Su tarjeta
      // monta la primitiva `Image` del DS en su estado VACÍO (`src={undefined}` → `data-status="empty"`),
      // que pinta el hatch-placeholder del DS — NO una imagen cargada. El discriminador fuerte
      // anti-falso-PASS es `data-status="empty"` (≠ "loaded"): distingue «placeholder vacío» de
      // «miniatura real» tan estrictamente como antes. (Nota: `.hatch` YA NO discrimina — tras adoptar
      // la primitiva, su wrapper lleva la clase `hatch` en TODOS los estados; el peso recae en
      // `data-status`.)
      await page.goto('/gallery');
      const draftCard = page.getByRole('button', { name: `Abrir template ${title}` });
      await expect(draftCard).toBeVisible();
      await expect(draftCard.locator('[data-slot="image"]')).toHaveAttribute(
        'data-status',
        'empty',
      );

      // Abrir la ficha del template en la galería.
      await draftCard.click();
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

  // ── PASE B: generación IA de reference-images de Personas (identity-lock), con fal fake, $0 ──
  // El botón «Generar variación» de la ficha genera 2–3 referencias del MISMO sujeto (retrato base
  // FLUX.2 → encuadres NB2 ≥2K) y las añade a la persona, con su coste. Contra el stack real + fal fake:
  // el fake sirve un PNG ≥2048 REAL para `nano-banana-2/edit` (que el servidor VALIDA por bytes) y
  // registra un cost_entry por imagen. CERO gasto real ($0). La CONSISTENCIA «mismo sujeto» es juicio
  // humano (fuera del alcance de este assert); aquí se prueba el MECANISMO: dispara → aparece una nueva
  // reference-image con coste, y el ledger scoped a referencias sube.
  test(
    'generar variación: el botón de la ficha genera reference-images IA con coste visible',
    { tag: ['@f4', '@gallery'] },
    async ({ page }) => {
      const name = `E2E genref ${tag()}`;

      // Crear una persona fresca (sin depender del seed): abre su ficha al crearla.
      await page.goto('/personas');
      await page.getByRole('button', { name: /nueva persona/i }).click();
      await page.getByLabel('Nombre').fill(name);
      await page.getByLabel('Rango de edad').fill('25-34');
      await page.getByLabel('Etnia').fill('latina');
      await page.getByLabel('Estilo').fill('casual');
      await page.getByLabel('Descriptor').fill('mujer de 29 años, latina, look casual');
      await page.getByLabel('Escenario').fill('baño con luz natural, encimera con productos');
      await page.getByLabel('Personalidad').fill('Cercana y directa.');
      await page.getByLabel('Voice ID · Español').fill('v_es_genref');
      await page.getByLabel('Voice ID · English').fill('v_en_genref');
      await page.getByRole('button', { name: /crear persona/i }).click();

      const detail = page.getByRole('article');
      await expect(detail.getByRole('heading', { name, level: 2 })).toBeVisible();
      // Recién creada: sin reference-images.
      await expect(detail.locator('[data-testid^="persona-reference-"]')).toHaveCount(0);

      // ── Generar variación → genera reference-images IA + cost_entry(s) de fal (reference_image) ──
      const before = await personaReferenceFalEntries();
      const generateButton = detail.locator('[data-slot="persona-generate-button"]');
      await expect(generateButton).toBeVisible();
      const waitGen = page.waitForResponse(
        (r) => r.url().includes('/reference-images/generate') && r.request().method() === 'POST',
      );
      await generateButton.click();
      const genRes = await waitGen;
      expect(genRes.status()).toBe(200);

      // Al menos una reference-image nueva aparece en la ficha, y el coste se muestra.
      await expect(detail.locator('[data-testid^="persona-reference-"]').first()).toBeVisible({
        timeout: 60_000,
      });
      await expect(detail.locator('[data-slot="persona-generate-cost"]')).toBeVisible();

      // La persona quedó «activa»: ≥ REFERENCE_IMAGES_MIN (2) reference-images IA en la BD.
      const [refRow] = await queryStack<{ n: string }>(
        `SELECT array_length(reference_image_ids, 1)::text AS n FROM persona WHERE name = $1`,
        [name],
      );
      expect(Number(refRow?.n ?? '0')).toBeGreaterThanOrEqual(2);

      // El ledger scoped a referencias subió (la generación pagó por imagen; base + encuadres).
      const after = await personaReferenceFalEntries();
      expect(after).toBeGreaterThan(before);

      // El coste es visible en /spend: la fila de fal.ai existe con un total no-cero.
      await page.goto('/spend');
      const providerTable = page.getByRole('table').first();
      const falRow = providerTable.getByRole('row').filter({ hasText: 'fal.ai' });
      await expect(falRow).toBeVisible({ timeout: 30_000 });
      await expect(falRow).not.toContainText('$0.00');
    },
  );
});
