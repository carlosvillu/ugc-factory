// Tests del panel de CP2 (T2.3, frontend.md §5): la selección de ángulos/persona/idiomas, el
// RECÁLCULO DEL COSTE al cambiar el tier, y el payload que se envía al confirmar.
//
// ⚠ EL HANDLER msw NO INVENTA NÚMEROS: llama a `planBatch` con las RECETAS REALES (`RECIPE_SEEDS`,
// el Apéndice B verbatim), que es exactamente lo que hace el endpoint de verdad. Un fake que
// devolviera un coste a ojo probaría que el panel pinta lo que le dan — y no probaría lo único que
// importa: que el número que ve el usuario SALE del estimador real sobre la receta real. Es el
// principio 9 de la skill testing (el arnés nunca puede ser más cómodo que la realidad), y este es
// justo el sitio donde el mockup invitaba a violarlo (traía su propio modelo de coste inventado).
//
// LOS ESPERADOS SE CALCULAN A MANO desde el Apéndice B, aquí, en el test (no se leen del código
// que se está probando): tier test = 30–170 ¢/30 s; preset hook_test = 12 s ⇒ una variante aislada
// cuesta 30×12/30 = 12 ¢ … 170×12/30 = 68 ¢.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeBrief, server, useHttpMocks } from '@ugc/test-utils';
import { HOOK_LINE_SEEDS, RECIPE_SEEDS } from '@ugc/core/library';
import { planBatch } from '@ugc/core/strategy';
import { BatchConfigSchema, type BatchConfig, type ProductBrief } from '@ugc/core/contracts';

import { MatrixPanel } from './matrix-panel';

const STEP_ID = '01J000000000000000000STEP0';

/** El brief: 5 ángulos, 2 hooks cada uno, y un `avatar_hint` con el que Lucía casa. */
const BRIEF: ProductBrief = makeBrief();

/** La persona candidata que el endpoint de T2.0 devuelve. Es la MISMA que el estimador usa (el
 *  handler la pasa a `planBatch`): si el panel enseñara una y el coste se compusiera con otra, el
 *  test no lo vería — por eso hay una sola definición. */
const LUCIA = {
  id: '01J0000000000000000LUCIA0',
  name: 'Lucía',
  ageRange: '25-34',
  gender: 'female' as const,
  ethnicity: 'latina',
  style: 'natural',
  descriptor: 'creadora de 30 años, estilo natural',
  setting: 'baño luminoso',
  personality: 'cercana',
  wardrobeNotes: null,
  voiceMap: {},
  referenceImageIds: [],
  createdAt: '2026-07-14T10:00:00.000Z',
  updatedAt: '2026-07-14T10:00:00.000Z',
};

/** La config que N4 propone (`defaultBatchConfig` sobre este brief): 3 ángulos × 2 hooks,
 *  hook_test, tier test, 1 idioma, persona en rotación. */
const INITIAL_CONFIG: BatchConfig = {
  angleIndices: [0, 1, 2],
  hooksPerAngle: 2,
  objective: 'hook_test',
  tier: 'test',
  languages: ['es'],
  personaMode: 'rotate',
};

/** El endpoint de estimación, ejecutando el ESTIMADOR REAL sobre las RECETAS REALES. */
function estimateHandler() {
  return http.post('*/api/batches/estimate', async ({ request }) => {
    const body = (await request.json()) as { stepId: string; config: unknown };
    // El panel manda el `stepId` del checkpoint, NUNCA un `briefId`: el servidor saca el brief del
    // artefacto del step. Si el cliente volviera a mandar el brief, el endpoint real daría 400
    // (`strictObject`) — aquí se caza igual, en vez de dejar que el mock se lo trague.
    expect(body).toMatchObject({ stepId: STEP_ID });
    expect(body).not.toHaveProperty('briefId');
    const config = BatchConfigSchema.parse(body.config);
    const recipe = RECIPE_SEEDS.find((r) => r.tier === config.tier);
    if (!recipe) throw new Error(`sin receta de ${config.tier}`);
    return HttpResponse.json(
      planBatch({
        brief: BRIEF,
        config,
        libraryHooks: HOOK_LINE_SEEDS,
        personas: [LUCIA],
        recipe,
      }),
    );
  });
}

function candidatesHandler() {
  return http.get('*/api/personas/candidates', () =>
    HttpResponse.json({ candidates: [{ persona: LUCIA, score: 3, matched: ['creadora'] }] }),
  );
}

// eslint-disable-next-line react-hooks/rules-of-hooks
useHttpMocks(estimateHandler(), candidatesHandler());

afterEach(() => {
  cleanup();
});

function renderPanel() {
  return render(<MatrixPanel stepId={STEP_ID} brief={BRIEF} config={INITIAL_CONFIG} />);
}

/** El total que el rail pinta (la horquilla "$X.XX – $Y.YY"), una vez estimado. */
async function totalCost(): Promise<string> {
  const status = await screen.findByRole('status', { name: /coste estimado/i });
  await waitFor(() => {
    expect(status).not.toHaveTextContent('—');
  });
  return status.textContent;
}

describe('CP2 · matriz y confirmación de gasto', () => {
  test('pinta la matriz propuesta con sus `filename_code` y su coste', async () => {
    renderPanel();

    // 3 ángulos × 2 hooks × 1 idioma = 6 variantes. El número SALE DEL PLAN del servidor.
    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(7); // 6 variantes + la cabecera

    // Los `filename_code` son únicos y legibles (§8.3): es la cláusula de la Verificación.
    const codes = screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent);
    const filenames = codes.map((c) => /[a-z0-9-]+-hook\d\d-[a-z0-9-]+-es-12s/.exec(c)?.[0]);
    expect(filenames.every((f) => f !== undefined)).toBe(true);
    expect(new Set(filenames).size).toBe(filenames.length);
  });

  test('cambiar el tier de Test a Standard actualiza el coste AL VUELO', async () => {
    const user = userEvent.setup();
    renderPanel();

    // TIER TEST. La matriz es hook_test (body y CTA compartidos por ángulo): 3 ángulos × 2 hooks
    // × 1 idioma = 6 variantes ⇒ 6 hooks + 3 bodies + 3 CTAs = 12 generaciones.
    // Apéndice B, tier test: 30–170 ¢ por 30 s. Preset hook_test = 12 s (hook 4 + body 6 + cta 2).
    //   variante aislada = 30×12/30 … 170×12/30 = 12 … 68 ¢
    //   sus 3 segmentos (mayor resto sobre 4/6/2 s):  hook 4…23 ¢ · body 6…34 ¢ · cta 2…11 ¢
    //   total = 6×hook + 3×body + 3×cta = 6×4 + 3×6 + 3×2 = 48 ¢ … 6×23 + 3×34 + 3×11 = 273 ¢
    expect(await totalCost()).toContain('$0.48');
    expect(await totalCost()).toContain('$2.73');

    await user.selectOptions(screen.getByRole('combobox', { name: /tier/i }), 'standard');

    // TIER STANDARD: 180–500 ¢ por 30 s ⇒ variante aislada 72 … 200 ¢.
    //   segmentos: hook 24…67 ¢ · body 36…100 ¢ · cta 12…33 ¢
    //   total = 6×24 + 3×36 + 3×12 = 288 ¢ … 6×67 + 3×100 + 3×33 = 801 ¢
    await waitFor(async () => {
      expect(await totalCost()).toContain('$2.88');
    });
    expect(await totalCost()).toContain('$8.01');
  });

  test('quitar un ángulo reduce el número de variantes de la matriz', async () => {
    const user = userEvent.setup();
    renderPanel();
    await totalCost();
    expect(await screen.findAllByRole('row')).toHaveLength(7); // 6 + cabecera

    await user.click(screen.getByRole('checkbox', { name: BRIEF.angles[0]?.name ?? '' }));

    // 2 ángulos × 2 hooks = 4 variantes.
    await waitFor(async () => {
      expect(await screen.findAllByRole('row')).toHaveLength(5);
    });
  });

  test('añadir un idioma MULTIPLICA las variantes (cada uno se genera nativo)', async () => {
    const user = userEvent.setup();
    renderPanel();
    await totalCost();

    await user.click(screen.getByRole('checkbox', { name: /english/i }));

    // 3 ángulos × 2 hooks × 2 idiomas = 12 variantes.
    await waitFor(async () => {
      expect(await screen.findAllByRole('row')).toHaveLength(13);
    });
  });

  test('el selector de personas muestra LAS COMPATIBLES con el `avatar_hint` del segmento', async () => {
    renderPanel();

    // La candidata viene del endpoint de T2.0 (que aplica `matchPersonas` en el servidor): el panel
    // no filtra la librería por su cuenta.
    const personas = await screen.findByRole('radiogroup', { name: /persona del lote/i });
    expect(within(personas).getByRole('radio', { name: /lucía/i })).toBeInTheDocument();
    // Y la rotación (§11) es la opción por defecto: `personaMode: 'rotate'`.
    expect(within(personas).getByRole('radio', { name: /rote/i })).toBeChecked();
  });

  test('fijar una persona la pone en TODAS las variantes de la matriz', async () => {
    const user = userEvent.setup();
    renderPanel();
    await totalCost();

    const personas = await screen.findByRole('radiogroup', { name: /persona del lote/i });
    await user.click(within(personas).getByRole('radio', { name: /lucía/i }));

    await waitFor(() => {
      const rows = screen.getAllByRole('row').slice(1);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.textContent.includes('Lucía'))).toBe(true);
    });
  });

  test('confirmar manda la DECISIÓN (kind: matrix + config) al checkpoint', async () => {
    const user = userEvent.setup();
    const approved = vi.fn();
    server.use(
      http.post(`*/api/steps/${STEP_ID}/approve`, async ({ request }) => {
        approved(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    renderPanel();
    await totalCost();

    await user.click(screen.getByRole('button', { name: /confirmar y crear 6 variantes/i }));

    // LA MATRIZ NO VIAJA: solo la config. El servidor recompone el plan con el id del lote nuevo
    // (el `batchDiscriminator` del UNIQUE GLOBAL) — mandarlo desde aquí sería dejar al cliente
    // escribir las filas de `ad_variant` que se van a facturar.
    await waitFor(() => {
      expect(approved).toHaveBeenCalledWith({
        decision: { kind: 'matrix', config: INITIAL_CONFIG },
      });
    });
  });

  test('un 400 del estimador se PINTA y no deja confirmar un lote fantasma', async () => {
    server.use(
      http.post('*/api/batches/estimate', () =>
        HttpResponse.json(
          {
            code: 'validation_error',
            message: 'ningún ángulo seleccionado produjo hooks: la matriz quedaría vacía',
          },
          { status: 400 },
        ),
      ),
    );
    renderPanel();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/la matriz quedaría vacía/i);
    // Y el botón de confirmar NO está disponible: sin estimación no hay gasto que autorizar.
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled();
  });

  test('una variante SIN coste se pinta «—», nunca «$0.00» (no se inventa una cifra de dinero)', async () => {
    // El estimador REAL siempre devuelve el coste de todas las variantes (`perVariant` se inicializa
    // con el plan entero), así que esto no es alcanzable HOY. Pero eso es una invariante DEL
    // ESTIMADOR, y este test fija la del PANEL: si el coste de una variante no llega, se enseña como
    // AUSENTE. El `?? {minCents: 0, maxCents: 0}` que había aquí lo pintaba como **$0.00** — o sea,
    // «gratis» — en la pantalla donde el usuario autoriza el gasto. Un dato que falta no puede
    // disfrazarse de dato que vale cero.
    server.use(
      http.post('*/api/batches/estimate', async ({ request }) => {
        const body = (await request.json()) as { config: unknown };
        const config = BatchConfigSchema.parse(body.config);
        const recipe = RECIPE_SEEDS.find((r) => r.tier === config.tier);
        if (!recipe) throw new Error(`sin receta de ${config.tier}`);
        const real = planBatch({
          brief: BRIEF,
          config,
          libraryHooks: HOOK_LINE_SEEDS,
          personas: [LUCIA],
          recipe,
        });
        // Se rompe la invariante A PROPÓSITO: el plan trae sus variantes, pero el desglose por
        // variante viene VACÍO.
        return HttpResponse.json({ ...real, estimate: { ...real.estimate, perVariant: {} } });
      }),
    );
    renderPanel();
    await totalCost(); // el total SÍ llega (sale del estimador, no de sumar las celdas)

    const rows = await screen.findAllByRole('row');
    // Las filas de datos (sin la cabecera) enseñan «—» en la columna de coste, y NINGUNA enseña
    // un importe de cero.
    const body = rows.slice(1);
    expect(body.length).toBeGreaterThan(0);
    for (const row of body) {
      expect(row).toHaveTextContent('—');
      expect(row).not.toHaveTextContent('$0.00');
    }
  });
});
