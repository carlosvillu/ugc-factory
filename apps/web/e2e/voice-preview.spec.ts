// E2E PERMANENTE del PREVIEW DE VOZ en CP2/CP3 (T4.6, §8.3, DoD bloqueante). Prueba, de punta a punta
// contra el stack real (Postgres + web + worker) y con fal FINGIDO (startFakeExternalApis, FAL_BASE_URL
// → CERO gasto real), que:
//   · el botón ▶ junto a cada Persona/idioma genera y reproduce una muestra de voz ANTES de gastar
//     render, desde CP2 (por persona × idioma del lote) y desde CP3 (por variante);
//   · cambiar de idioma/Persona reproduce OTRA muestra (otro botón);
//   · REUTILIZACIÓN: reproducir la MISMA muestra 5 veces NO añade coste — se cuenta `generation`
//     (voice_preview) y `cost_entry` de fal antes/después y NO incrementan tras la 1ª (la caché scoped
//     del servidor hace hit sin tocar fal ni el ledger). Es el corazón de la Verificación.
//
// CONTROL NEGATIVO (demostrado en el implementer, NO commiteado roto): forzar un cache-miss (hash
// distinto por click) pone ROJO el assert de no-doble-generación — está documentado en el informe y en
// el test de servicio `generate-tts.test.ts` (donde el forced-miss se ejecuta y revierte).
//
// La Persona candidata se siembra con un `voice_map` es+en (provider elevenlabs): las personas seed
// puntúan 0 contra el avatar_hint del fake (mismo hallazgo que batch-matrix.spec), así que se siembra
// una que la regla REAL sí acepta y CON voz asignada (sin voz, el ▶ no se pinta).
import { test, expect, type Page } from '@playwright/test';
import { createDb, upsertPersonaByName } from '@ugc/db';
import { waitCanvasStatus } from './support/canvas';
import { briefEditor, runUrlAnalysisToCp1 } from './support/brief';
import { queryStack, stackDatabaseUrl } from './support/stack-db';

const stackDb = createDb(stackDatabaseUrl);

// Persona que la regla REAL (`matchPersonas`) acepta para el brief del fake, CON voz es+en. El
// `voiceId` es un placeholder (el fake de fal acepta cualquiera); el `provider` elevenlabs decide el
// endpoint TTS (turbo-v2.5), que es lo que el fake atiende.
function voicePersona(name: string, voiceSuffix: string) {
  return {
    name,
    ageRange: '25-35',
    gender: 'female' as const,
    ethnicity: 'mediterránea',
    style: 'natural',
    descriptor: 'creadora de 30 años, estilo natural, baño luminoso',
    setting: 'baño luminoso',
    personality: 'cercana y directa',
    voiceMap: {
      // `voiceId` distinto por persona → `content_hash` distinto → las muestras de CP2 y CP3 NO
      // colisionan en la caché (si compartieran voiceId, la 1ª reproducción de CP3 sería un cache-hit
      // de CP2 y su assert de "1 generación nueva" fallaría por acoplamiento entre tests).
      es: {
        provider: 'elevenlabs' as const,
        voiceId: `voice-es-${voiceSuffix}-not-a-secret`,
        label: 'ElevenLabs ES',
      },
      en: {
        provider: 'elevenlabs' as const,
        voiceId: `voice-en-${voiceSuffix}-not-a-secret`,
        label: 'ElevenLabs EN',
      },
    },
  };
}

// Una persona por test (voiceId distinto): las personas seed puntúan 0 contra el avatar_hint del fake,
// así que se siembran las que la regla REAL acepta y CON voz asignada (sin voz, el ▶ no se pinta).
const CP2_PERSONA = voicePersona('Vera E2E Voz CP2', 'cp2');
const CP3_PERSONA = voicePersona('Vera E2E Voz CP3', 'cp3');

test.beforeAll(async () => {
  await upsertPersonaByName(stackDb, CP2_PERSONA);
  await upsertPersonaByName(stackDb, CP3_PERSONA);
});

function cp2(page: Page) {
  return page.locator('[data-slot="matrix-panel"]');
}
function cp3(page: Page) {
  return page.locator('[data-slot="scripts-panel"]');
}

/** Cuenta las generaciones de PREVIEW de voz (`voice_preview=true`) y las `cost_entry` de fal — las
 *  dos métricas que la caché debe dejar CONSTANTES entre reproducciones de la misma muestra. */
async function counts(): Promise<{ previews: number; falEntries: number }> {
  const [gen] = await queryStack<{ n: string }>(
    `SELECT count(*)::text AS n FROM generation WHERE voice_preview = true`,
  );
  const [cost] = await queryStack<{ n: string }>(
    `SELECT count(*)::text AS n FROM cost_entry WHERE provider = 'fal'`,
  );
  return { previews: Number(gen?.n ?? '0'), falEntries: Number(cost?.n ?? '0') };
}

/** El id (ULID) de una persona por su nombre — garantizado `string` (lanza si no existe). */
async function personaIdByName(name: string): Promise<string> {
  const rows = await queryStack<{ id: string }>(`SELECT id FROM persona WHERE name = $1`, [name]);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`persona '${name}' no sembrada`);
  return id;
}

/** Conduce el sistema REAL hasta CP2 (matriz de N4 en `waiting_approval`). */
async function driveToCp2(page: Page): Promise<void> {
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

/**
 * Clica un ▶ y espera la respuesta 200 de `POST /api/personas/:id/voice-preview`.
 *
 * El componente MEMOIZA el assetId en cliente: el 2º click del MISMO botón NO vuelve a llamar a la API.
 * Por eso, para EJERCITAR LA CACHÉ DEL SERVIDOR (que es lo que "5 reproducciones no añaden coste" mide
 * de verdad — la caché del cliente es trivial), las reproducciones repetidas se hacen tras RECARGAR la
 * página: el estado del cliente se resetea, el ▶ vuelve a llamar al servidor, y el servidor hace
 * cache-HIT sin tocar fal ni el ledger. Así el conteo del ledger prueba la caché REAL, no el memo del
 * componente.
 *
 * NO se asserta que el `<audio>` SUENE: la reproducción en headless depende de la política de autoplay
 * y NO es lo que la Verificación mide; el componente traga un rechazo de `play()` en su `catch`. El
 * efecto observable robusto es la respuesta HTTP del preview y el conteo del ledger.
 */
async function playAndAwait(page: Page, button: ReturnType<Page['locator']>): Promise<void> {
  const waitResponse = page.waitForResponse(
    (r) => r.url().includes('/voice-preview') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await button.click();
  const res = await waitResponse;
  expect(res.status()).toBe(200);
}

// SERIAL: los dos tests cuentan `generation`/`cost_entry` GLOBALES antes/después. En paralelo sus
// conteos se interleavarían y romperían las igualdades exactas. Son dos tests cortos; el serial es el
// aislamiento correcto (mismo criterio que spend.spec.ts, que se aísla con su propio proyecto).
test.describe.configure({ mode: 'serial' });

test.describe('Preview de voz en CP2/CP3 (T4.6)', () => {
  test(
    'CP2: ▶ por persona/idioma reproduce la voz; 5 reproducciones no añaden coste; cambiar idioma es otra muestra',
    { tag: ['@f4', '@checkpoint'] },
    async ({ page }) => {
      await driveToCp2(page);

      const personaId = await personaIdByName(CP2_PERSONA.name);
      const previewsFor = () =>
        cp2(page).locator(`[data-slot="persona-voice-previews-${personaId}"]`);
      const esButtonFor = () =>
        previewsFor().locator('[data-slot="voice-preview"][data-language="es"]');
      const enButtonFor = () =>
        previewsFor().locator('[data-slot="voice-preview"][data-language="en"]');

      // El brief del fake trae solo `es` → habilitar `en` con el checkbox de idiomas para que la
      // persona muestre DOS ▶ (uno por idioma del lote) y poder probar el cambio de idioma.
      await expect(previewsFor()).toBeVisible({ timeout: 30_000 });
      await expect(esButtonFor()).toBeVisible();
      await cp2(page)
        .locator('[data-slot="languages"]')
        .getByRole('checkbox', { name: 'English' })
        .check();
      await expect(enButtonFor()).toBeVisible({ timeout: 30_000 });

      // ── Reproducir la muestra ES: genera 1 preview + 1 cost_entry de fal ──
      const before = await counts();
      await playAndAwait(page, esButtonFor());
      const afterFirstEs = await counts();
      expect(afterFirstEs.previews).toBe(before.previews + 1);
      expect(afterFirstEs.falEntries).toBe(before.falEntries + 1);

      // ── CAMBIAR DE IDIOMA: la muestra EN es OTRA (otro botón) → una generación + un coste nuevos ──
      await playAndAwait(page, enButtonFor());
      const afterEn = await counts();
      expect(afterEn.previews).toBe(afterFirstEs.previews + 1);
      expect(afterEn.falEntries).toBe(afterFirstEs.falEntries + 1);

      // ── REUTILIZACIÓN: 4 reproducciones más de la muestra ES → 0 coste, 0 generación nueva ──
      // Se RECARGA entre reproducciones para resetear el memo del cliente y forzar que el ▶ vuelva a
      // llamar al servidor: así se prueba la CACHÉ DEL SERVIDOR (cache-hit sin gastar), no el memo
      // trivial del componente. Tras la recarga, CP2 re-abre (N4 sigue en waiting_approval) con su
      // config por defecto (es), y el ▶ de `es` sigue presente.
      for (let i = 0; i < 4; i += 1) {
        await page.reload();
        await expect(cp2(page)).toBeVisible({ timeout: 30_000 });
        await expect(esButtonFor()).toBeVisible({ timeout: 30_000 });
        await playAndAwait(page, esButtonFor());
      }
      const afterReplays = await counts();
      expect(afterReplays.previews).toBe(afterEn.previews); // ni una generación más (es ya cacheada)
      expect(afterReplays.falEntries).toBe(afterEn.falEntries); // ni un cost_entry más
    },
  );

  test(
    'CP3: ▶ en la tarjeta de variante reproduce la voz de su persona en su idioma; reutiliza sin coste',
    { tag: ['@f4', '@checkpoint'] },
    async ({ page }) => {
      await driveToCp2(page);

      // FIJAR la persona con voz para que TODAS las variantes lleven su personaId a CP3.
      const personaId = await personaIdByName(CP3_PERSONA.name);
      await cp2(page).locator(`[data-slot="persona-${personaId}"]`).click();

      // Confirmar CP2 → arranca el run de N5; navegar a él (CP3 vive ahí).
      const analysisPath = new URL(page.url()).pathname;
      await cp2(page)
        .getByRole('button', { name: /confirmar y crear/i })
        .click();
      await page.waitForURL((u) => u.pathname.startsWith('/runs/') && u.pathname !== analysisPath, {
        timeout: 30_000,
      });
      await waitCanvasStatus(page, 'N5', 'waiting_approval', 90_000);
      await expect(cp3(page)).toBeVisible({ timeout: 30_000 });

      // La PRIMERA tarjeta de variante (filename_code determinista); se fija su código para re-localizarla
      // exacta tras recargar (la muestra reutilizada debe ser la MISMA variante → mismo idioma → mismo
      // content_hash).
      const card = cp3(page).locator('[data-slot="variant-card"]').first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      const filenameCode = await card.getAttribute('data-filename-code');
      if (filenameCode === null || filenameCode === '') {
        throw new Error('la tarjeta de variante no expone data-filename-code');
      }

      // La tarjeta de variante tiene un ▶ (persona fijada). Su idioma es el de la variante.
      const preview = card.locator('[data-slot="voice-preview"]');
      await expect(preview).toBeVisible();
      await expect(preview).toHaveAttribute('data-persona-id', personaId);

      // ── Reproducir desde CP3: genera 1 preview + 1 cost_entry ──
      const before = await counts();
      await playAndAwait(page, preview);
      const afterFirst = await counts();
      expect(afterFirst.previews).toBe(before.previews + 1);
      expect(afterFirst.falEntries).toBe(before.falEntries + 1);

      // ── REUTILIZACIÓN: 4 reproducciones más (recargando para forzar el round-trip al servidor) de la
      //    MISMA variante → cache-hit del servidor, 0 coste, 0 generación nueva ──
      for (let i = 0; i < 4; i += 1) {
        await page.reload();
        await expect(cp3(page)).toBeVisible({ timeout: 30_000 });
        const sameCard = cp3(page).locator(
          `[data-slot="variant-card"][data-filename-code="${filenameCode}"]`,
        );
        await expect(sameCard).toBeVisible({ timeout: 30_000 });
        await playAndAwait(page, sameCard.locator('[data-slot="voice-preview"]'));
      }
      const afterReplays = await counts();
      expect(afterReplays.previews).toBe(afterFirst.previews);
      expect(afterReplays.falEntries).toBe(afterFirst.falEntries);
    },
  );
});
