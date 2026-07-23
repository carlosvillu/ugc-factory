// playwright.config.ts (e2e.md §3). Solo Chromium (herramienta mono-usuario). El
// webServer arranca el stack completo (Postgres testcontainer + web en :3100) vía
// tsx; Playwright espera al puerto 3100 antes de correr specs. Auth una sola vez
// en un setup project → storageState reutilizado (e2e.md §5).
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000, // arranque en frío del stack + navegación; el default de 30 s se queda corto
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI, // un .only olvidado no desactiva la suite en CI
  retries: process.env.CI ? 2 : 0, // en local, un test que necesita retry es un bug a arreglar
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    testIdAttribute: 'data-testid',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'], // todos los specs (salvo los que sobreescriben storageState) arrancan logueados
      // `spend.spec.ts`, `partial-regeneration.spec.ts` y `normal-generation-composes.spec.ts` NO corren
      // aquí: tienen proyecto propio (ver abajo).
      testIgnore:
        /spend\.spec\.ts|partial-regeneration\.spec\.ts|normal-generation-composes\.spec\.ts/,
    },
    // ── T1.19: el ledger de gasto es GLOBAL, así que su spec necesita EXCLUSIVIDAD ────────
    //
    // `/spend` suma `cost_entry` ENTERA (sin filtro de mes ni de project: ver
    // `getSpendSummary`), y `spend.spec.ts` asserta sumas EXACTAS. Desde T1.10a hay OTROS
    // specs que escriben coste de verdad mientras corren (los del pipeline de análisis:
    // N1/N2/N3 registran créditos de Firecrawl y tokens de Anthropic contra las APIs
    // falsas). Su `beforeAll` intentaba resolverlo con un `DELETE FROM cost_entry`, pero eso
    // NO es exclusividad: bajo `fullyParallel` los otros ficheros corren en OTROS workers y
    // siguen insertando DESPUÉS del DELETE. Medido en T1.19: 2 de 5 pasadas rojas con
    // «Anthropic … $1.17» donde el spec sembró $0.99 — los 18 céntimos de un run de análisis
    // concurrente. Segundo flaky del gate, mismo pecado que el de autopilot: una premisa
    // ("poseo el ledger") sostenida por suerte de ordenación.
    //
    // FIX sin rebajar un solo assert ni serializar la suite: proyecto PROPIO que DEPENDE de
    // `chromium` ⇒ arranca cuando los 53 tests que escriben coste YA han terminado, y su
    // DELETE+seed pasa a ser cierto por CONSTRUCCIÓN. Los demás specs conservan su
    // paralelismo completo; el coste es que 3 tests rápidos corren al final.
    {
      name: 'spend',
      testMatch: /spend\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['chromium'],
    },
    // ── T5.8: el regen parcial COMPITE por el «doom» global del fake de fal ──────────────
    //
    // El fake de fal designa el PRIMER submit de IMAGEN del PROCESO como «doomed» (un solo fallo
    // determinista por corrida, `doomedRequestId` en `fake-apis.ts`) — un recurso GLOBAL, sin
    // conciencia de run. `f4-generation.spec.ts` lo REQUIERE (asserta `waitForFailedStep` + retry
    // granular) y lo ganaba por ordenación: su camino rápido seed→approve→generate submitea la
    // primera imagen. `partial-regeneration.spec.ts` usa EL MISMO camino rápido (el approve de CP3
    // siembra el origen) → bajo `fullyParallel` compite con F4 por ese doom y a veces se lo ROBA,
    // dejando a F4 sin su fallo determinista (rojo en `f4-generation.spec.ts:190`). Mismo pecado
    // que `spend`: una premisa sostenida por suerte de ordenación.
    //
    // FIX sin tocar F4 ni rebajar un assert (ni dooma por-run en el fake, que rompería `gallery`
    // que NO tiene retry): proyecto PROPIO que DEPENDE de `chromium` ⇒ arranca cuando F4 ya
    // reclamó y gastó el doom. Los submits del regen reciben request_ids frescos (no doomed) → su
    // callback de retry no llega a dispararse, y la dedup sigue mordiendo. Los demás specs
    // conservan su paralelismo; el coste es que 1 test corre al final (como `spend`).
    {
      name: 'partial-regeneration',
      testMatch: /partial-regeneration\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['chromium'],
    },
    // ── T5.8b: el flujo normal COMPONE compite por el «doom» global del fake, igual que el regen ──
    //
    // `normal-generation-composes.spec.ts` usa EL MISMO camino rápido seed→approve→generate que
    // `f4-generation.spec.ts` y `partial-regeneration.spec.ts` (el approve de CP3 siembra el origen). Bajo
    // `fullyParallel` competiría con F4 por el `doom` global del fake de fal (el primer submit de imagen del
    // proceso, `doomedRequestId`) y a veces se lo ROBARÍA, dejando a F4 sin su fallo determinista (rojo en
    // `f4-generation.spec.ts:190`). MISMO pecado y MISMO fix que `partial-regeneration`: proyecto PROPIO que
    // DEPENDE de `chromium` ⇒ arranca cuando F4 ya reclamó el doom; sus submits reciben request_ids frescos
    // (no doomed) y su retry granular no llega a dispararse. El coste es que 1 test más corre al final.
    {
      name: 'normal-generation-composes',
      testMatch: /normal-generation-composes\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['chromium'],
    },
  ],
  webServer: {
    command: 'pnpm exec tsx scripts/e2e-stack.ts', // tsx obligatorio: @ugc/test-utils es TS sin build (§2)
    port: 3100,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000, // pull de imagen pg16 + arranque en frío de next dev
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
