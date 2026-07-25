// E2E PERMANENTE de T5.13 — CUALQUIER persona de la librería es alcanzable en CP2, aunque el
// `avatar_hint` del análisis no la sugiera.
//
// EL BUG (destapado por el run real de T5.9): el selector de persona de CP2 se poblaba SOLO con
// `matchPersonas(avatarHint)`. Una persona de la librería del usuario —con `voice_map` real, la
// única con voz utilizable— que no casara con el hint NO APARECÍA en la lista: no había forma de
// fijarla desde el producto. El verifier de T5.9 tuvo que hacer un `INSERT` a mano en la BD para
// avanzar; eso es la definición de un callejón sin salida.
//
// Y había un SEGUNDO tramo del mismo bug, más silencioso, en core: aunque se fijara
// (`personaMode: 'fixed'`), `composeMatrix` volvía a pasar el pool por `matchPersonas` y la
// descartaba → `personaSelection: 'no_match'` y variantes SIN CARA. O sea: elegirla no bastaba,
// había que hacer que la elección MANDARA. Por eso este spec no se conforma con ver la card
// marcada: comprueba la persona en la MATRIZ y, tras confirmar, en las filas de `ad_variant`.
//
// $0: no se genera nada. El spec llega hasta CREAR el lote (`planned`), que es donde la decisión
// de persona queda persistida — la generación es de otra fase.
import { test, expect, type Page } from '@playwright/test';
import { createDb, upsertPersonaByName } from '@ugc/db';
import { waitCanvasStatus } from './support/canvas';
import { briefEditor, runUrlAnalysisToCp1 } from './support/brief';
import { queryStack, stackDatabaseUrl } from './support/stack-db';

const stackDb = createDb(stackDatabaseUrl);

/**
 * LA PERSONA QUE EL `avatar_hint` NO SUGIERE — y el test depende de que DE VERDAD no case.
 *
 * El brief del fake de síntesis emite el hint «Creadora 30 años, estilo natural, baño luminoso».
 * Esta persona es su negativo punto por punto (hombre, 45-54, urbano, gimnasio, sin tokens
 * compartidos en el descriptor), que es exactamente por lo que `matchPersonas` la descarta — el
 * mismo perfil por el que el seed `Marcus` no aparece en `batch-matrix.spec.ts`. El test lo
 * ASEVERA antes de nada (ver el primer `expect`): si un día la regla cambiara y esta persona
 * pasara a ser candidata, el spec fallaría ahí en vez de pasar por el camino fácil de «salía en la
 * lista de siempre», que no probaría nada de T5.13.
 *
 * CON `voice_map` REAL porque ese es el caso del bug: la persona útil (la que tiene voz) era la
 * inalcanzable. `voiceId` es un literal de test evidente (el fake de fal acepta cualquiera).
 */
const UNMATCHED_PERSONA = {
  name: 'Bruno E2E Fuera-de-hint',
  ageRange: '45-54',
  gender: 'male' as const,
  ethnicity: 'caucasian',
  style: 'urban',
  descriptor: 'hombre de 50 años, estilo urbano, gimnasio industrial',
  setting: 'gimnasio industrial',
  personality: 'seco y competitivo',
  voiceMap: {
    es: {
      provider: 'elevenlabs' as const,
      voiceId: 'voice-es-bruno-t513-not-a-secret',
      label: 'ElevenLabs ES',
    },
  },
};

/**
 * LA PERSONA SIN VOZ CONFIGURADA — para que la rama «sin voz configurada» sea ALCANZABLE contra
 * datos reales y no solo en jsdom.
 *
 * Hace falta sembrarla explícitamente porque las 10 personas del seed tienen `voice_map` POBLADO
 * (con `voiceId` `placeholder-*`): sin esta, ninguna card del stack real pintaría nunca el aviso,
 * y la rama viviría verde-por-no-existir — justo el patrón que el arnés persigue.
 */
const VOICELESS_PERSONA = {
  ...UNMATCHED_PERSONA,
  name: 'Silvia E2E Sin-voz',
  descriptor: 'mujer de 50 años, estilo urbano, gimnasio industrial',
  gender: 'female' as const,
  voiceMap: {},
};

test.beforeAll(async () => {
  await upsertPersonaByName(stackDb, UNMATCHED_PERSONA);
  await upsertPersonaByName(stackDb, VOICELESS_PERSONA);
});

function cp2(page: Page) {
  return page.locator('[data-slot="matrix-panel"]');
}

function personas(page: Page) {
  return page.getByRole('radiogroup', { name: /persona del lote/i });
}

function matrixRows(page: Page) {
  return page.locator('[data-slot="planned-matrix"] tbody tr');
}

/** Lleva el run hasta CP2 por el camino REAL del usuario (CP1 es el único que abre CP2). */
async function runToCp2(page: Page): Promise<void> {
  await runUrlAnalysisToCp1(page);
  await briefEditor(page)
    .getByRole('button', { name: /aprobar y continuar/i })
    .click();
  await waitCanvasStatus(page, 'N4', 'waiting_approval', 60_000);
  await expect(cp2(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('status', { name: /coste estimado/i })).not.toHaveText('—', {
    timeout: 30_000,
  });
}

async function personaIdByName(name: string): Promise<string> {
  const rows = await queryStack<{ id: string }>(`SELECT id FROM persona WHERE name = $1`, [name]);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`no se sembró la persona ${name}`);
  return id;
}

test.describe('CP2 · toda la librería de personas es alcanzable (T5.13)', () => {
  test(
    'una persona que el `avatar_hint` NO sugiere se encuentra, se fija y el lote se crea con ella',
    { tag: ['@f5', '@checkpoint'] },
    async ({ page }) => {
      await runToCp2(page);
      const personaId = await personaIdByName(UNMATCHED_PERSONA.name);

      // ── 1. DE ENTRADA NO ESTÁ (y por eso el resto del test significa algo) ────────────────
      // La recomendación del `avatar_hint` sigue siendo el default destacado: esta persona NO es
      // candidata y no se ofrece. Sin este assert, el test podría estar pasando por un hint que
      // casa por accidente — probaría el camino fácil, no el bug.
      //
      // Se espera al `radiogroup` (que existe desde el primer render) y a que el toggle «ver toda
      // la librería» esté pintado: ese botón solo aparece CUANDO la librería ya llegó del
      // servidor, así que es la señal de que las listas están pobladas. Sin ese punto de
      // sincronización, el `toHaveCount(0)` podría estar leyendo un panel que aún no ha
      // respondido — un verde vacío.
      await expect(personas(page)).toBeVisible({ timeout: 30_000 });
      const seeAll = cp2(page).getByRole('button', { name: /ver toda la librería/i });
      await expect(seeAll).toBeVisible({ timeout: 30_000 });
      await expect(
        personas(page).getByRole('radio', { name: new RegExp(UNMATCHED_PERSONA.name, 'i') }),
      ).toHaveCount(0);

      // ── 2. LA SALIDA: «ver toda la librería» ──────────────────────────────────────────────
      // Esto es lo que T5.13 añade. Antes, aquí se acababa el producto.
      await seeAll.click();

      const bruno = personas(page).getByRole('radio', {
        name: new RegExp(UNMATCHED_PERSONA.name, 'i'),
      });
      await expect(bruno).toBeVisible();

      // LA VOZ, DICHA HONESTAMENTE. La card NO afirma «tiene voz» —el cliente no puede saber si un
      // `voiceId` funciona, y las 10 personas del seed traen placeholders que fal rechaza con 422:
      // un badge verde las marcaría a todas como cubiertas justo cuando su voz va a reventar—.
      // Quien lo comprueba es el ▶ (T4.6): reproducir suena o falla. Bruno tiene voz configurada
      // para `es`, así que su ▶ está.
      await expect(bruno).not.toContainText(/voz es/i);
      await expect(
        cp2(page).locator(`[data-slot="persona-voice-previews-${personaId}"] button`),
      ).toBeVisible();

      // Y LA AUSENCIA sí se afirma (es inequívoca: no hay clave en `voice_map`). Silvia no tiene
      // ninguna voz configurada y su card lo DICE — la rama del aviso, alcanzable contra la BD
      // real y no solo en jsdom.
      const silvia = personas(page).getByRole('radio', {
        name: new RegExp(VOICELESS_PERSONA.name, 'i'),
      });
      await expect(silvia).toBeVisible();
      await expect(silvia).toContainText(/sin voz configurada/i);

      // ── 3. FIJARLA MANDA SOBRE LA RECOMENDACIÓN ───────────────────────────────────────────
      await bruno.click();
      await expect(bruno).toBeChecked();

      // Y la matriz —que la compone el SERVIDOR— la lleva en TODAS las variantes. Este es el
      // assert que caza el segundo tramo del bug: con el `composeMatrix` de antes de T5.13, aquí
      // se leerían celdas «—» (persona descartada por no casar con el hint).
      await expect(async () => {
        const cells = await matrixRows(page).locator('td:nth-child(3)').allInnerTexts();
        expect(cells.length).toBeGreaterThan(0);
        expect(cells.every((c) => c.includes(UNMATCHED_PERSONA.name))).toBe(true);
      }).toPass({ timeout: 20_000 });

      // ── 4. Y EL LOTE SE CREA CON ELLA (en la BD, no en un endpoint que podría mentir) ──────
      const expectedCount = await matrixRows(page).count();
      const analysisPath = new URL(page.url()).pathname;
      await cp2(page)
        .getByRole('button', { name: /confirmar y crear/i })
        .click();
      await page.waitForURL((u) => u.pathname.startsWith('/runs/') && u.pathname !== analysisPath, {
        timeout: 30_000,
      });

      const batches = await queryStack<{ id: string }>(
        `SELECT id FROM ad_batch ORDER BY id DESC LIMIT 1`,
      );
      const batchId = batches[0]?.id;
      expect(batchId).toBeDefined();

      const variants = await queryStack<{ persona_id: string | null }>(
        `SELECT persona_id FROM ad_variant WHERE batch_id = $1`,
        [batchId],
      );
      expect(variants).toHaveLength(expectedCount);
      // NI UNA variante sin cara: la elección del usuario llegó hasta la fila que se va a generar.
      expect(variants.every((v) => v.persona_id === personaId)).toBe(true);
    },
  );
});
