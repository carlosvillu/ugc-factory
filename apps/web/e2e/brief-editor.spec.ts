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
//   5. DECISIÓN DEL CHECKPOINT (T1.11): la decisión del modo manual (packshot-IA) VIAJA al
//      servidor, se PERSISTE con la transición y SOBREVIVE a un reload (hasta T1.11 era un
//      `useState` que se evaporaba: habilitaba el botón y no salía nunca del cliente).
//   6. PERFIL URL SIN HERO (T1.15): una web de SERVICIO (el caso stayforlong) ya NO mata el run en
//      N3 — llega a CP1 con las TRES salidas, y PROMOVER una de sus imágenes scrapeadas a hero
//      persiste las dos mitades: la decisión (`checkpoint_decision`) y el artefacto (el brief v2,
//      cuyo `hero_image_url` es la imagen elegida).
import { test, expect } from '@playwright/test';
import { waitCanvasStatus as waitStatus } from './support/canvas';
import {
  briefEditor,
  briefIdOf,
  fetchBrief,
  runManualAnalysisToCp1,
  runUrlAnalysisToCp1,
  stepIdOf,
} from './support/brief';
// La URL que hace que el fake de síntesis devuelva el brief de una web de SERVICIO (T1.15): con
// imágenes, pero sin ninguna que sirva de hero. Se IMPORTA —no se copia— porque el fake y el spec
// tienen que hablar de LA MISMA url.
import { FAKE_URL_NO_HERO, FAKE_FORBIDDEN_IMAGE_PATH } from '@ugc/test-utils';
// La BD del stack, para el SELECT de aserción de T1.11: la Verificación pide ver la decisión EN
// LA BD, no en un endpoint que podría estar mintiendo.
import { queryStack } from './support/stack-db';

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

      // ── T1.11: LA DECISIÓN SALE DEL CLIENTE Y SE PERSISTE ──────────────────────────────
      // Hasta T1.11 la historia acababa en la línea de arriba: el botón se habilitaba y la
      // decisión se EVAPORABA (era `useState` local, no viajaba a ningún endpoint). Su
      // consumidor real —N7a (T4.4), que decide si genera un packshot-IA o usa fotos reales— no
      // habría tenido nada que leer.
      const stepId = await stepIdOf(page);
      await approve.click();
      await waitStatus(page, 'N3', 'succeeded', 30_000);

      // LA CLÁUSULA: la decisión está EN LA BD, asociada al step del checkpoint.
      const rows = await queryStack<{ kind: string; decision: { images: string } }>(
        `SELECT kind, decision FROM checkpoint_decision WHERE step_run_id = $1`,
        [stepId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('brief');
      expect(rows[0]?.decision.images).toBe('ai_packshot');

      // Y SOBREVIVE A UN RELOAD: es persistencia, no memoria del cliente. Tras recargar, el run
      // sigue con N3 aprobado (CP1 ya no está abierto) y la decisión sigue en su fila.
      await page.reload();
      await waitStatus(page, 'N3', 'succeeded', 30_000);
      const trasReload = await queryStack<{ decision: { images: string } }>(
        `SELECT decision FROM checkpoint_decision WHERE step_run_id = $1`,
        [stepId],
      );
      expect(trasReload[0]?.decision.images).toBe('ai_packshot');
    },
  );

  test(
    'T1.15 · URL de web de servicio SIN hero: el run NO muere, CP1 ofrece las 3 salidas y se promueve una imagen',
    { tag: ['@f1'] },
    async ({ page }) => {
      // EL CASO REAL (es.stayforlong.com): una web de SERVICIO. Sus imágenes existen —un sello de
      // award, un about-us, un banner— pero ninguna es un packshot, así que Haiku (N2) las
      // clasificó honestamente `broll`/`unusable` y el brief salió sin hero. Hasta T1.15 eso era
      // un warning BLOQUEANTE: N3 moría con la síntesis de Sonnet YA PAGADA y el usuario no tenía
      // NADA que hacer salvo leer logs. El fallo duro se diseñó para e-commerce; el uso real
      // incluye SaaS/servicios, donde no tener packshot es lo normal.
      //
      // 1) EL RUN LLEGA A CP1. Si esta línea falla, el run murió en N3 — que es exactamente la
      //    regresión que este test existe para impedir.
      await runUrlAnalysisToCp1(page, FAKE_URL_NO_HERO);
      const editor = briefEditor(page);

      // 2) LA PETICIÓN DE DECISIÓN, la misma que ya funcionaba en modo manual (es el mismo warning
      //    tipado: `needs_user_decision`). Y BLOQUEA la aprobación hasta que el usuario elija.
      const decision = editor.locator('[data-slot="warning-needs_user_decision"]');
      await expect(decision).toBeVisible();
      const approve = editor.getByRole('button', { name: /aprobar y continuar/i });
      await expect(approve).toBeDisabled();

      // 3) LAS TRES SALIDAS — la nueva es PROMOVER una de las imágenes que el scrape SÍ trajo.
      //    Se ofrecen TODAS (incluidas las que N2 descartó): fue justamente ese veredicto el que
      //    dejó al brief sin hero, y filtrarlas aquí volvería a esconder las únicas que hay.
      await expect(
        editor.getByRole('button', { name: /subir imágenes del producto/i }),
      ).toBeVisible();
      await expect(editor.getByRole('button', { name: /generar packshot con ia/i })).toBeVisible();
      const candidatas = editor.locator('[data-slot="hero-candidate"]');
      await expect(candidatas).toHaveCount(3);

      // 4) SE PROMUEVE UNA — de las PROMOVIBLES (T1.18: las que el servidor SÍ puede descargar;
      //    ver el test de abajo). La elegida es un dato del DOM, no un literal del test: el brief
      //    lo produce el pipeline (fake de Anthropic → validador → SSE), y hard-codear la URL aquí
      //    haría pasar el test aunque el editor pintase otra cosa.
      const elegida = editor.locator('[data-slot="hero-candidate"][data-usable="true"]').first();
      await expect(elegida).toBeVisible();
      await expect(elegida).toHaveAttribute('data-url', /^https?:\/\//);
      const heroElegido = await elegida.getAttribute('data-url');
      await elegida.getByRole('button', { name: /usar como imagen principal/i }).click();
      await expect(approve).toBeEnabled();

      // 5) SE APRUEBA → el run COMPLETA (N3 sale del checkpoint).
      const stepId = await stepIdOf(page);
      // El brief v1 (el de la IA) que este CP1 tiene delante: es la ANCLA del linaje. La v2 que
      // crea la promoción cuelga del mismo `url_analysis_id`, y filtrar por él —en vez de coger
      // «la última fila de la tabla»— hace el assert inmune a los otros specs que corren en
      // paralelo contra la MISMA base de datos del stack.
      const briefV1 = await briefIdOf(page);
      await approve.click();
      await waitStatus(page, 'N3', 'succeeded', 30_000);

      // 6) LA DECISIÓN está en la BD, asociada al step de CP1, con la imagen elegida (el canal de
      //    T1.11: `checkpoint_decision`, NUNCA `output_refs`). La leerá N7a en T4.4.
      const decisiones = await queryStack<{
        kind: string;
        decision: { images: string; hero_image_url?: string };
      }>(`SELECT kind, decision FROM checkpoint_decision WHERE step_run_id = $1`, [stepId]);
      expect(decisiones).toHaveLength(1);
      expect(decisiones[0]?.kind).toBe('brief');
      expect(decisiones[0]?.decision.images).toBe('promote_scraped');
      expect(decisiones[0]?.decision.hero_image_url).toBe(heroElegido);

      // 7) Y EL ARTEFACTO: el brief APROBADO tiene ESA imagen como hero. Es la otra mitad, y sin
      //    ella la decisión sería papel mojado — el resto del pipeline lee el brief, no la
      //    decisión. Se mira la ÚLTIMA versión (promover es una edición humana ⇒ v2).
      const briefs = await queryStack<{
        version: number;
        edited_by_user: boolean;
        status: string;
        data: { assets: { hero_image_url: string | null } };
      }>(
        `SELECT version, edited_by_user, status, data FROM product_brief
          WHERE url_analysis_id = (SELECT url_analysis_id FROM product_brief WHERE id = $1)
          ORDER BY version DESC LIMIT 1`,
        [briefV1],
      );
      expect(briefs[0]?.data.assets.hero_image_url).toBe(heroElegido);
      expect(briefs[0]?.version).toBe(2); // promover ES una edición: crea versión nueva
      expect(briefs[0]?.edited_by_user).toBe(true); // la hizo el humano, no la IA
      expect(briefs[0]?.status).toBe('approved');
    },
  );

  test(
    'T1.18 · una candidata que el SERVIDOR no puede descargar NO se ofrece (y la promovible sí funciona)',
    { tag: ['@f1'] },
    async ({ page }) => {
      // EL CASO REAL, la otra mitad del de arriba. De las candidatas de es.stayforlong.com, la de
      // `/_next/image?url=…` devuelve 403 a cualquier fetch de FUERA de su web (el worker sí la
      // bajó —por eso N2 la clasificó y está en el brief—, el navegador NO). Hasta T1.18: su
      // miniatura se veía ROTA en la galería cuyo propósito es «elige con criterio», y seguía
      // siendo PROMOVIBLE — elegirla persistía decisión + brief v2 con un hero que nadie podría
      // descargar, y quien lo descubría era N7a (F4) PAGANDO fal.ai.
      //
      // El fixture es honesto (principio 9): el fake sirve unas imágenes DE VERDAD (PNG real) y
      // NIEGA una con 403 — no un mock que "finge" fallar.
      await runUrlAnalysisToCp1(page, FAKE_URL_NO_HERO);
      const editor = briefEditor(page);

      const candidatas = editor.locator('[data-slot="hero-candidate"]');
      await expect(candidatas).toHaveCount(3);

      // 1) LA INSERVIBLE: NO es promovible, y el MOTIVO viaja en el nombre accesible (no en un
      //    `title`, que no llega ni a teclado ni a lector de pantalla).
      const inservible = editor.locator(
        `[data-slot="hero-candidate"][data-url*="${FAKE_FORBIDDEN_IMAGE_PATH}"]`,
      );
      await expect(inservible).toHaveCount(1);
      await expect(inservible).toHaveAttribute('data-usable', 'false', { timeout: 15_000 });
      const botonInservible = inservible.getByRole('button', {
        name: /no se puede usar \(el servidor no puede descargarla\)/i,
      });
      await expect(botonInservible).toBeVisible();
      await expect(botonInservible).toBeDisabled();

      // 2) Y SU MINIATURA NO SE VE ROTA: la primitiva `Image` del DS pinta su estado de error
      //    («⚠ no disponible»), que es lo que el usuario tiene que leer.
      await expect(inservible.getByText('⚠ no disponible')).toBeVisible();

      // 3) NINGUNA CANDIDATA OFRECIDA tiene la miniatura rota: las que SÍ se ofrecen (promovibles)
      //    han cargado su imagen de verdad — la del proxy, servida desde nuestro origen. Un <img>
      //    roto tiene naturalWidth 0; este assert es la cláusula literal de la Verificación.
      const promovibles = editor.locator('[data-slot="hero-candidate"][data-usable="true"]');
      await expect(promovibles).toHaveCount(2, { timeout: 15_000 });
      for (const card of await promovibles.all()) {
        const img = card.locator('img');
        await expect(img).toHaveJSProperty('complete', true);
        expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      }

      // 4) LA PROMOVIBLE SIGUE FUNCIONANDO: elegirla desbloquea la aprobación y el run COMPLETA.
      const approve = editor.getByRole('button', { name: /aprobar y continuar/i });
      await expect(approve).toBeDisabled();
      const elegida = promovibles.first();
      const heroElegido = await elegida.getAttribute('data-url');
      await elegida.getByRole('button', { name: /usar como imagen principal/i }).click();
      await expect(approve).toBeEnabled();

      const stepId = await stepIdOf(page);
      await approve.click();
      await waitStatus(page, 'N3', 'succeeded', 30_000);

      // Y el hero persistido es la URL ORIGINAL de la imagen (la del CDN), NO la del proxy: el
      // proxy es solo para MOSTRAR. N7a la bajará desde el servidor, que sí puede.
      const decisiones = await queryStack<{ decision: { hero_image_url?: string } }>(
        `SELECT decision FROM checkpoint_decision WHERE step_run_id = $1`,
        [stepId],
      );
      expect(decisiones[0]?.decision.hero_image_url).toBe(heroElegido);
      expect(heroElegido).not.toContain('/api/thumbnails');
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
