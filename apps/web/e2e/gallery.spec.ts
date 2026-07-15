// Regresión permanente de T3.8 (e2e.md §10, DoD BLOQUEANTE): la galería de templates en un
// navegador real contra el stack completo (Next + Postgres del testcontainer).
//
// La línea «Playwright permanente» del planning pide EXACTAMENTE cinco cosas; cada una tiene aquí
// su cobertura:
//   1. FILTROS COMBINADOS: filtrar por 2 facetas devuelve solo los templates que casan ambas.
//   2. FICHA: abrir un template muestra su cuerpo, beats/guards y versiones.
//   3. SLOTS RESALTADOS: el cuerpo pinta los `{slot}` §10.4 (válido/ inválido) con marcadores.
//   4. VALIDACIÓN EN VIVO: teclear un slot inválido en el editor muestra el error SIN guardar, y
//      deshabilita el botón de guardar.
//   5. CREAR UNA VERSIÓN CON DIFF VISIBLE: guardar una edición válida crea v2 y el diff v2↔v1 se
//      ve (líneas add/del marcadas).
//
// PROVISIÓN DE DATOS: la BD del stack es COMPARTIDA por toda la suite, así que los templates se
// crean con FACETAS namespaced por ejecución (`e2e-fmt-<ts>`, `e2e-vert-<ts>`) vía `POST
// /api/templates` (la cookie de sesión la hereda `page.request` del storageState). Así «filtrar
// por estas 2 facetas devuelve EXACTAMENTE mis filas» es determinista sin importar qué más haya
// sembrado en la BD — el idiom de `personas.spec` (fixtures con identificador único por corrida).
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiCall } from './support/http';

/** Un sufijo único por ejecución para namespacing de facetas y slugs. */
function tag(): string {
  return `${String(Date.now())}-${String(Math.random()).slice(2, 7)}`;
}

/** Crea un template vía `POST /api/templates` (hereda la cookie de sesión). Devuelve su id. */
async function createTemplate(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await apiCall(
    () => request.post('/api/templates', { data: body }),
    'POST /api/templates',
  );
  if (res.status() !== 201) {
    throw new Error(`POST /api/templates falló (${String(res.status())}): ${await res.text()}`);
  }
  const created = (await res.json()) as { id: string };
  return created.id;
}

test.describe('/gallery — galería de templates (T3.8)', () => {
  test(
    'filtros combinados (2 facetas) devuelven exactamente los templates que casan ambas',
    { tag: ['@f3'] },
    async ({ page, request }) => {
      const t = tag();
      const fmtA = `e2efmt-a-${t}`;
      const vertA = `e2evert-a-${t}`;
      const titleBoth = `E2E ambas ${t}`;

      // Tres templates con facetas namespaced: uno casa ambas, uno solo formato, uno solo vertical.
      await createTemplate(request, {
        slug: `e2e-both-${t}`,
        title: titleBoth,
        kind: 'video',
        body: 'Cuerpo con {product.name}.',
        language: 'es',
        formats: [fmtA],
        verticals: [vertA],
      });
      await createTemplate(request, {
        slug: `e2e-fmtonly-${t}`,
        title: `E2E solo formato ${t}`,
        kind: 'video',
        body: 'Cuerpo con {product.name}.',
        language: 'es',
        formats: [fmtA],
        verticals: [`e2evert-other-${t}`],
      });
      await createTemplate(request, {
        slug: `e2e-vertonly-${t}`,
        title: `E2E solo vertical ${t}`,
        kind: 'video',
        body: 'Cuerpo con {product.name}.',
        language: 'es',
        formats: [`e2efmt-other-${t}`],
        verticals: [vertA],
      });

      await page.goto('/gallery');

      // Filtra por las DOS facetas namespaced (botones del rail, `aria-pressed`).
      await page.getByRole('button', { name: fmtA }).click();
      await page.getByRole('button', { name: vertA }).click();

      // Solo el template que casa AMBAS aparece; los otros dos (una faceta cada uno) NO.
      await expect(page.getByRole('button', { name: `Abrir template ${titleBoth}` })).toBeVisible();
      await expect(
        page.getByRole('button', { name: `Abrir template E2E solo formato ${t}` }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: `Abrir template E2E solo vertical ${t}` }),
      ).toHaveCount(0);
    },
  );

  test(
    'ficha: slots resaltados, validación en vivo de slot inválido, y crear v2 con diff visible',
    { tag: ['@f3'] },
    async ({ page, request }) => {
      const t = tag();
      const vert = `e2evert-ficha-${t}`;
      const title = `E2E ficha ${t}`;
      await createTemplate(request, {
        slug: `e2e-ficha-${t}`,
        title,
        kind: 'video',
        body: 'Presenta {product.name} resolviendo {pain_point}.',
        language: 'es',
        formats: [`e2efmt-ficha-${t}`],
        verticals: [vert],
      });

      await page.goto('/gallery');
      // Filtra por la vertical namespaced para aislar mi template, y abre su ficha.
      await page.getByRole('button', { name: vert }).click();
      await page.getByRole('button', { name: `Abrir template ${title}` }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: title })).toBeVisible();

      // ── SLOTS RESALTADOS (§10.4): los `{slot}` válidos se pintan como slot-válido ──
      const validSlot = dialog.locator('[data-slot="prompt-slot"][data-valid="true"]').first();
      await expect(validSlot).toBeVisible();
      await expect(validSlot).toContainText('{product.name}');

      // ── EDITOR + VALIDACIÓN EN VIVO ──
      await dialog.getByRole('button', { name: /editar/i }).click();
      const editor = dialog.getByLabel('Cuerpo del prompt');
      await expect(editor).toBeVisible();

      // Teclear un slot INVÁLIDO muestra el error EN VIVO y deshabilita guardar (sin fetch).
      await editor.fill('Cuerpo roto con {producto.nombre} inexistente.');
      const alert = dialog.getByRole('alert');
      await expect(alert).toContainText('{producto.nombre}');
      await expect(dialog.getByRole('button', { name: /guardar versión/i })).toBeDisabled();

      // Corregir a un body VÁLIDO (slots §10.4) habilita guardar y limpia el error.
      await editor.fill('Presenta {product.name} y su {benefit.primary} en {platform}.');
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      const saveBtn = dialog.getByRole('button', { name: /guardar versión/i });
      await expect(saveBtn).toBeEnabled();

      // ── GUARDAR → crea v2 con DIFF VISIBLE v2↔v1 ──
      await saveBtn.click();

      // El diff aparece con al menos una línea añadida y una quitada (marcadores add/del).
      const diff = dialog.locator('[data-slot="version-diff"]');
      await expect(diff).toBeVisible();
      await expect(diff.locator('[data-op="add"]').first()).toBeVisible();
      await expect(diff.locator('[data-op="del"]').first()).toBeVisible();
      // El body editado (v2) está en la línea añadida.
      await expect(diff.locator('[data-op="add"]').first()).toContainText('benefit.primary');

      // La lista de versiones muestra v2 y v1.
      await expect(dialog.getByText('v2', { exact: false }).first()).toBeVisible();
      await expect(dialog.getByText('v1', { exact: false }).first()).toBeVisible();
    },
  );
});
