// Regresión permanente de CP2 — LA MATRIZ Y LA CONFIRMACIÓN DE GASTO (T2.3, e2e.md §8). Ejercita
// el sistema COMPLETO (web + worker + orquestador + pg-boss + SSE + los nodos reales N1/N2/N3/N4)
// contra los fakes de las APIs de pago: la suite JAMÁS gasta dinero.
//
// Cubre las tres observables de la Verificación de T2.3:
//   1. RECÁLCULO AL VUELO: cambiar el tier de Test a Standard actualiza el coste sin recargar.
//   2. PERSONAS COMPATIBLES: el selector muestra las que el `avatar_hint` del segmento sugiere
//      (las del endpoint de T2.0, sembradas de verdad en el stack).
//   3. CONFIRMAR CREA EXACTAMENTE LAS VARIANTES DE LA MATRIZ, con `filename_code` únicos y
//      legibles — y eso se comprueba EN LA BD (un SELECT, no un endpoint que podría estar
//      mintiendo), igual que hizo T1.11 con la decisión del checkpoint.
//
// Y la selección de ángulos/idiomas, que es lo que MUEVE el número de variantes.
import { test, expect, type Page } from '@playwright/test';
import { createDb, upsertPersonaByName } from '@ugc/db';
import { waitCanvasStatus } from './support/canvas';
import { briefEditor, runUrlAnalysisToCp1 } from './support/brief';
import { queryStack, stackDatabaseUrl } from './support/stack-db';

/** Cliente TIPADO contra la BD del stack, para SEMBRAR por repo (e2e.md §6). El SQL crudo de
 *  `queryStack` se reserva para ASEVERAR (que es lo que la Verificación pide: ver la fila). */
const stackDb = createDb(stackDatabaseUrl);

/**
 * UNA PERSONA QUE DE VERDAD CASA CON EL SEGMENTO DEL BRIEF DEL FAKE — y por qué el spec la siembra
 * en vez de confiar en las del seed.
 *
 * HALLAZGO (T2.3, cazado por este mismo spec en su primera pasada): las DOS personas placeholder de
 * `PERSONA_SEEDS` (T2.0) puntúan **0** contra el `avatar_hint` del brief que emite el fake de
 * síntesis («Creadora 30 años, estilo natural, baño luminoso»), así que `matchPersonas` devuelve
 * CERO candidatas — ni siquiera Lucía (mujer, 25-34, latina), porque su `style` es `casual`, su
 * descriptor no comparte tokens con el hint, y «30 años» no es un RANGO que `parseAgeRange` sepa
 * leer. Está reportado como hallazgo de producto sobre la regla de T2.0; CP2 se comporta
 * correctamente ante ello (el plan declara `no_match` y el panel lo DICE), pero con cero candidatas
 * la cláusula de la Verificación que este spec tiene que probar —«el selector muestra las personas
 * compatibles con el segmento»— no se ejercitaría: el test pasaría enseñando una lista vacía.
 *
 * Así que el spec siembra SU dato (e2e.md §6: los datos en reposo se insertan directos, nunca por
 * clicks) con una persona que la regla REAL —sin tocarla— sí acepta. Lo que se prueba sigue siendo
 * el sistema de verdad: `matchPersonas` corriendo en el servidor sobre la BD del stack.
 */
const MATCHING_PERSONA = {
  name: 'Nora E2E CP2',
  ageRange: '25-35',
  gender: 'female' as const,
  ethnicity: 'mediterránea',
  style: 'natural',
  descriptor: 'creadora de 30 años, estilo natural, baño luminoso',
  setting: 'baño luminoso',
  personality: 'cercana y directa',
};

test.beforeAll(async () => {
  // Se siembra por el REPO TIPADO (`upsertPersonaByName`, @ugc/db) y no con SQL crudo: la PK de
  // `persona` es un ULID que genera la APLICACIÓN (`ulidPk()` con `$defaultFn`), no un default de
  // Postgres — un `INSERT` a mano sin `id` muere con «null value in column "id"». (Lo hizo: es lo
  // que destapó la segunda pasada de este spec.) El upsert además lo hace IDEMPOTENTE: la suite
  // puede correr varias veces contra el mismo stack.
  await upsertPersonaByName(stackDb, MATCHING_PERSONA);
});

/** El contenedor entero de CP2 (config + rail de coste + matriz planificada). Su `data-slot` ES el
 *  contrato de testabilidad del panel. */
function cp2(page: Page) {
  return page.locator('[data-slot="matrix-panel"]');
}

/** El total en grande del rail de coste. Es un `role="status"` con nombre: la API de test lo
 *  localiza por su nombre accesible, no por su texto (que es justo lo que cambia). */
function totalCost(page: Page) {
  return page.getByRole('status', { name: /coste estimado/i });
}

/** Las filas de la matriz planificada (sin la cabecera). La tabla es la primitiva `MetricsTable`
 *  del DS, que rinde un `<table>` semántico: las filas de datos son los `<tr>` de su `<tbody>`,
 *  dentro de la sección de la matriz. Se localiza así —y no por un `data-slot` por fila— para no
 *  pedirle a la primitiva un atributo que no tiene; el ORDEN de las columnas sigue siendo
 *  contractual (los `td:nth-child(...)` de abajo dependen de él, y `MATRIX_COLUMNS` lo dice). */
function matrixRows(page: Page) {
  return page.locator('[data-slot="planned-matrix"] tbody tr');
}

/**
 * Lleva el run hasta CP2: análisis por URL → CP1 → «Aprobar y continuar» → N4 compone la matriz y
 * pausa. Es el camino REAL del usuario (CP1 es el único que puede abrir CP2: N4 depende de N3).
 */
async function runToCp2(page: Page): Promise<void> {
  await runUrlAnalysisToCp1(page);
  await briefEditor(page)
    .getByRole('button', { name: /aprobar y continuar/i })
    .click();
  // N3 pasa a `succeeded` y N4 arranca: determinista y $0, así que llega enseguida a su checkpoint.
  await waitCanvasStatus(page, 'N4', 'waiting_approval', 60_000);
  await expect(cp2(page)).toBeVisible({ timeout: 30_000 });
  // El primer estimado ya está: el coste deja de ser «—».
  await expect(totalCost(page)).not.toHaveText('—', { timeout: 30_000 });
}

test.describe('CP2 · matriz y confirmación de gasto (T2.3)', () => {
  test(
    'cambiar el tier de Test a Standard actualiza el coste AL VUELO (sin recargar)',
    { tag: ['@f2', '@checkpoint'] },
    async ({ page }) => {
      await runToCp2(page);

      const before = await totalCost(page).textContent();
      expect(before).toMatch(/\$\d/); // hay un número, no un guion

      await page.getByRole('combobox', { name: /tier/i }).selectOption('standard');

      // EL NÚMERO CAMBIA, y cambia hacia ARRIBA: Standard cuesta más que Test en el Apéndice B
      // ($1,8–5 vs $0,3–1,7 por 30 s). No se compara contra una constante copiada —el coste sale de
      // la tabla `recipe` REAL, que T3.4 puede recalibrar—, sino contra el valor ANTERIOR: la
      // cláusula de la Verificación es que el coste SE ACTUALIZA al vuelo, no que valga X.
      //
      // Se espera con `toPass` (polling) y NO con un `not.toHaveText(before)`: entre el cambio de
      // tier y la respuesta del servidor el rail está RECALCULANDO, y ese estado intermedio también
      // «no es el texto anterior» — el assert pasaría leyendo un valor a medias y luego mediría 0
      // céntimos. (Ocurrió: es lo que la primera pasada de este spec destapó.) Lo que se espera es
      // el hecho REAL: que el total nuevo sea MAYOR que el viejo.
      await expect(async () => {
        expect(centsOf(await totalCost(page).textContent())).toBeGreaterThan(centsOf(before));
      }).toPass({ timeout: 20_000 });
    },
  );

  test(
    'el selector muestra las personas COMPATIBLES con el segmento del brief',
    { tag: ['@f2'] },
    async ({ page }) => {
      await runToCp2(page);

      // Las candidatas salen de `GET /api/personas/candidates` (T2.0), que aplica `matchPersonas`
      // sobre las personas de la BD del stack. El panel NO filtra la librería por su cuenta.
      const personas = page.getByRole('radiogroup', { name: /persona del lote/i });
      await expect(personas).toBeVisible();
      // La rotación (§11) es lo que N4 propone por defecto.
      await expect(personas.getByRole('radio', { name: /rote/i })).toBeChecked();

      // LA CLÁUSULA: la persona COMPATIBLE con el segmento aparece…
      await expect(
        personas.getByRole('radio', { name: new RegExp(MATCHING_PERSONA.name, 'i') }),
      ).toBeVisible();
      // …y las INCOMPATIBLES, no. `Marcus` (el placeholder masculino del seed) está EN LA BD y el
      // panel NO lo ofrece: es la mitad negativa de la regla (el género descalifica, §11) — sin este
      // assert, «el selector muestra las compatibles» se cumpliría enseñándolas TODAS.
      await expect(personas.getByRole('radio', { name: /marcus/i })).toHaveCount(0);

      // Y fijarla la pone en TODAS las variantes de la matriz (el «fijar» de §11).
      await personas.getByRole('radio', { name: new RegExp(MATCHING_PERSONA.name, 'i') }).click();
      await expect(async () => {
        const cells = await matrixRows(page).locator('td:nth-child(3)').allInnerTexts();
        expect(cells.length).toBeGreaterThan(0);
        expect(cells.every((c) => c.includes(MATCHING_PERSONA.name))).toBe(true);
      }).toPass({ timeout: 20_000 });
    },
  );

  test(
    'seleccionar ángulos e idiomas mueve el número de variantes de la matriz',
    { tag: ['@f2'] },
    async ({ page }) => {
      await runToCp2(page);

      const initial = await matrixRows(page).count();
      expect(initial).toBeGreaterThan(0);

      // Un idioma más MULTIPLICA la matriz (§17: cada idioma se genera nativo).
      await cp2(page)
        .getByRole('checkbox', { name: /english/i })
        .click();
      await expect(matrixRows(page)).toHaveCount(initial * 2, { timeout: 20_000 });

      // Quitar un ángulo la reduce (menos ángulos = menos variantes).
      const anglesBefore = await matrixRows(page).count();
      await cp2(page).locator('[data-slot="angle-card"]').first().getByRole('checkbox').click();
      await expect(matrixRows(page)).not.toHaveCount(anglesBefore, { timeout: 20_000 });
      expect(await matrixRows(page).count()).toBeLessThan(anglesBefore);
    },
  );

  test(
    'confirmar crea EXACTAMENTE las variantes de la matriz, con `filename_code` únicos',
    { tag: ['@f2', '@checkpoint'] },
    async ({ page }) => {
      await runToCp2(page);

      // LO QUE EL USUARIO VE ANTES DE PAGAR: el número de variantes de la matriz y los códigos
      // que se van a crear. La Verificación exige que lo creado sea EXACTAMENTE esto.
      const expectedCount = await matrixRows(page).count();
      expect(expectedCount).toBeGreaterThan(0);
      const shownCodes = await matrixRows(page).locator('td:nth-child(6)').allInnerTexts();
      expect(new Set(shownCodes).size).toBe(shownCodes.length); // únicos ya en la UI

      // El botón DICE el número (el mockup: «Confirmar y crear N variantes»).
      await expect(
        page.getByRole('button', { name: new RegExp(`crear ${String(expectedCount)} variantes`) }),
      ).toBeEnabled();
      await page.getByRole('button', { name: /confirmar y crear/i }).click();

      // El step avanza (por SSE) y el panel se retira solo.
      await waitCanvasStatus(page, 'N4', 'succeeded', 30_000);

      // ── LA CLÁUSULA, CONTRA LA BD ──────────────────────────────────────────────────────
      // El lote y sus variantes existen, en `planned`, y son EXACTAMENTE las de la matriz. Se
      // mira la BD y no un endpoint: la Verificación pide ver las filas.
      const batches = await queryStack<{
        id: string;
        status: string;
        cost_estimated_cents: number;
      }>(`SELECT id, status, cost_estimated_cents FROM ad_batch ORDER BY id DESC LIMIT 1`);
      expect(batches).toHaveLength(1);
      const batch = batches[0];
      expect(batch?.status).toBe('planned');
      // El gasto AUTORIZADO se persiste (es el techo de la horquilla que el usuario vio).
      expect(batch?.cost_estimated_cents).toBeGreaterThan(0);

      const variants = await queryStack<{ filename_code: string; status: string }>(
        `SELECT filename_code, status FROM ad_variant WHERE batch_id = $1 ORDER BY filename_code`,
        [batch?.id],
      );
      // NI UNA MÁS, NI UNA MENOS que las que la UI enseñó: cada fila de más es dinero de más.
      expect(variants).toHaveLength(expectedCount);
      expect(variants.every((v) => v.status === 'planned')).toBe(true);

      // `filename_code` ÚNICOS (el UNIQUE GLOBAL de §12) y LEGIBLES (§8.3: trazables en Ads
      // Manager — slug del producto, ángulo, hook, persona, idioma, duración y lote).
      const codes = variants.map((v) => v.filename_code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const code of codes) {
        expect(code).toMatch(/^[a-z0-9-]+$/);
        expect(code).toMatch(/-hook\d\d-/);
      }
    },
  );
});

/** Los céntimos MÁXIMOS de una horquilla renderizada ("$0.48 – $2.73" → 273). Es lo que se compara
 *  entre dos tiers: el techo es lo que el sistema autoriza a gastar. */
function centsOf(text: string | null): number {
  const amounts = [...(text ?? '').matchAll(/\$(\d+(?:\.\d+)?)/g)].map((m) =>
    Math.round(Number(m[1]) * 100),
  );
  return Math.max(0, ...amounts);
}
