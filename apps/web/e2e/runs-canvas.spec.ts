// Regresión permanente del canvas del run (T0.11, e2e.md §9, regla 10 — DoD
// BLOQUEANTE): ejercita el sistema COMPLETO (web + worker + orquestador + pg-boss +
// SSE + React Flow) con el DAG de demo del canvas (executors sleep_ms/fail_rate, sin
// API externa). Cubre: cambios de estado por SSE SIN reload, visor de output/error,
// approve/edit/reject, retry, skip, cancel de otro run, y autopilot + candado
// alwaysPause. Los asserts miran ESTADOS OBSERVABLES (roles/aria/`data-status`),
// NUNCA colores CSS (el color es E2E/CUA visual, no una aserción estable aquí).
import { test, expect, type Page } from '@playwright/test';
import { launchAnalysisRun, launchDemoCanvasRun } from './support/runs';
import { canvasNode, waitCanvasStatus, openCanvasPanel } from './support/canvas';

// El contrato de testabilidad del canvas (role=article + data-status + panel
// role=complementary) vive UNA vez en `support/canvas.ts`, compartido con el spec del
// pipeline de análisis. Aquí solo se traduce la clave CORTA que usan los tests de este
// fichero (N0…N5) al `node_key` REAL del DAG de demo (`demo.canvas.NX` — el prefijo evita
// colisionar en el singletonKey de la cola).
function nodeKeyOf(shortKey: string): string {
  return `demo.canvas.${shortKey}`;
}

function node(page: Page, shortKey: string) {
  return canvasNode(page, nodeKeyOf(shortKey));
}

async function waitStatus(page: Page, shortKey: string, status: string) {
  await waitCanvasStatus(page, nodeKeyOf(shortKey), status, 30_000);
}

async function openPanel(page: Page, shortKey: string) {
  return openCanvasPanel(page, nodeKeyOf(shortKey));
}

test.describe('canvas del run (T0.11)', () => {
  test(
    'los nodos cambian de estado en vivo por SSE (sin reload)',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      const runId = await launchDemoCanvasRun(request, { sleepMs: 1500 });
      await page.goto(`/runs/${runId}`);

      // El SSE conecta y puebla el grafo: aparecen los 6 nodos del DAG de demo.
      await expect(node(page, 'N0')).toBeVisible({ timeout: 30_000 });
      // N0 (root) arranca solo: pasa por running y llega a succeeded — SIN reload.
      await waitStatus(page, 'N0', 'succeeded');
      // N1 es el checkpoint: al alcanzarlo pausa en waiting_approval.
      await waitStatus(page, 'N1', 'waiting_approval');
      // La conexión SSE está viva (estado observable).
      await expect(page.getByRole('status', { name: /conexión/i })).toHaveText(/open/);
    },
  );

  test(
    'checkpoint: aprobar desde el panel avanza el run',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      const runId = await launchDemoCanvasRun(request, { sleepMs: 1200 });
      await page.goto(`/runs/${runId}`);
      await waitStatus(page, 'N1', 'waiting_approval');

      const panel = await openPanel(page, 'N1');
      await panel.getByRole('button', { name: /^aprobar$/i }).click();

      // Aprobado → succeeded; el run continúa a N2 (por SSE, sin reload).
      await waitStatus(page, 'N1', 'succeeded');
      await waitStatus(page, 'N2', 'succeeded');
    },
  );

  test('checkpoint: rechazar desde el panel', { tag: ['@f0'] }, async ({ page, request }) => {
    const runId = await launchDemoCanvasRun(request, { sleepMs: 1000 });
    await page.goto(`/runs/${runId}`);
    await waitStatus(page, 'N1', 'waiting_approval');

    const panel = await openPanel(page, 'N1');
    await panel.getByRole('button', { name: /rechazar/i }).click();
    await waitStatus(page, 'N1', 'rejected');
  });

  test(
    'checkpoint: editar el output JSON y aprobar',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      const runId = await launchDemoCanvasRun(request, { sleepMs: 1000 });
      await page.goto(`/runs/${runId}`);
      await waitStatus(page, 'N1', 'waiting_approval');

      const panel = await openPanel(page, 'N1');
      await panel.getByRole('button', { name: /editar/i }).click();
      const editor = panel.getByRole('textbox', { name: /editar output/i });
      await editor.fill('{"editado":true}');
      await panel.getByRole('button', { name: /guardar y aprobar/i }).click();

      // edit → approve_edited → succeeded (+ invalidación de sub-grafo).
      await waitStatus(page, 'N1', 'succeeded');
    },
  );

  test(
    'fallo: ver el error en el visor y reintentar con éxito',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      const runId = await launchDemoCanvasRun(request, { sleepMs: 800 });
      await page.goto(`/runs/${runId}`);

      // Avanzar por los checkpoints hasta el nodo que falla (N4, failRate=1).
      await waitStatus(page, 'N1', 'waiting_approval');
      await (await openPanel(page, 'N1')).getByRole('button', { name: /^aprobar$/i }).click();
      await waitStatus(page, 'N3', 'waiting_approval'); // el candado alwaysPause
      await (await openPanel(page, 'N3')).getByRole('button', { name: /^aprobar$/i }).click();

      // N4 falla (retries automáticos agotados) → failed terminal.
      await waitStatus(page, 'N4', 'failed');

      // El visor de logs del panel muestra el error del executor.
      const panel = await openPanel(page, 'N4');
      const errorViewer = panel.locator('[data-slot="error-viewer"]');
      await expect(errorViewer).toBeVisible();
      await expect(errorViewer).toContainText(/fallo inyectado/i);

      // Reintentar (el panel patchea failRate=0) → el reintento completa.
      await panel.locator('[data-slot="retry-action"]').click();
      await waitStatus(page, 'N4', 'succeeded');
    },
  );

  test(
    'skip: saltar un nodo skippable desde el panel',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      const runId = await launchDemoCanvasRun(request, { sleepMs: 800 });
      await page.goto(`/runs/${runId}`);

      await waitStatus(page, 'N1', 'waiting_approval');
      await (await openPanel(page, 'N1')).getByRole('button', { name: /^aprobar$/i }).click();
      await waitStatus(page, 'N3', 'waiting_approval');

      // N4 depende de N3 (aún sin aprobar) → N4 está en awaiting_deps: skippable.
      await waitStatus(page, 'N4', 'awaiting_deps');
      const panel = await openPanel(page, 'N4');
      await panel.locator('[data-slot="skip-action"]').click();
      await waitStatus(page, 'N4', 'skipped');
    },
  );

  test(
    'cancelar OTRO run en curso desde el botón del panel',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      // Un run largo que sigue en curso mientras lo cancelamos.
      //
      // sleepMs GENEROSO (20 s, antes 4 s): el test es intrínsecamente una CARRERA —
      // cancela N0 mientras sigue `running`—, y con 4 s se volvió flaky al crecer la
      // suite (T1.10a añadió los specs del pipeline de análisis: más carga en el worker
      // y en el stack, y el `goto` + el click a veces ya no entraban en la ventana; N0
      // llegaba a `succeeded` y el cancel no tenía nada que cancelar). Ampliar la
      // ventana ataca la CAUSA (la carrera) sin tocar un solo assert: lo que se prueba
      // —que el cancel barre los nodos no-terminales a `cancelled`— es idéntico. No se
      // reintenta el test: se le quita la carrera.
      //
      // T1.19 (auditoría del flaky de este fichero): la ventana de este test es
      // IRREDUCIBLE — probar "cancelar un step EN VUELO" exige un step en vuelo, y un step
      // en vuelo ocupa un slot del worker mientras dura. Un gate perfectamente estable
      // (`hang: true`, que deja el step `running` para siempre) costaría un slot de los 10
      // del worker durante TODA la suite (cancelRun cambia el estado del step, NO aborta el
      // job de pg-boss), o sea: cambiaría un flaky por menos paralelismo para los 55 tests
      // sanos. Se queda en ventana ACOTADA CON MARGEN: tras el gate observable (`running`)
      // quedan ~20 s para el click + POST, y la peor latencia medida bajo carga en T1.19
      // (un PATCH con compilación en frío de la ruta) fue 5,7 s ⇒ ~3,5× de margen. HONESTIDAD
      // sobre lo que se sabe: el flaky que T1.19 CONSIGUIÓ reproducir (con traza) fue el de
      // autopilot, el test de aquí abajo; ÉSTE no falló ni una vez en las pasadas de T1.19 —
      // lo cual NO demuestra que su carrera sea imposible, solo que con 20 s de margen no se
      // manifestó. Si algún día vuelve a caer, la causa está aquí escrita.
      const otherRunId = await launchDemoCanvasRun(request, { sleepMs: 20_000 });
      await page.goto(`/runs/${otherRunId}`);
      await expect(node(page, 'N0')).toBeVisible({ timeout: 30_000 });
      // Y se cancela con N0 DEMOSTRABLEMENTE en curso (no "esperando que lo esté"): si
      // el estado no fuera `running`, el test fallaría aquí diciendo la verdad, en vez
      // de más abajo con un `succeeded` desconcertante.
      await waitStatus(page, 'N0', 'running');

      // Cancela el LOTE desde el panel (sin nodo seleccionado el botón sigue visible).
      await page.locator('[data-slot="cancel-action"]').click();
      // Los nodos no-terminales pasan a cancelled (barrido de cancel del run).
      await waitStatus(page, 'N0', 'cancelled');
    },
  );

  // ── T1.19 — el autopilot, sin carreras contra el reloj ───────────────────────────────
  //
  // El test ORIGINAL («activar el toggle → el run completa sin pausas») era una CARRERA y
  // fue el flaky que ensució los gates de T1.15–T1.18 (la causa raíz está en el journal de
  // T1.19): lanzaba el run con `sleepMs: 3000` y confiaba en que el humano simulado —cargar
  // la página + hidratar + clicar el toggle + PATCH— cupiera dentro de la VENTANA de tiempo
  // que N0 y N1 tardaban en dormir. Bajo `fullyParallel` (10 workers, `next dev` compilando
  // rutas en frío) el PATCH llegó a tardar 5,7 s: N1 terminó ANTES de que el autopilot
  // estuviera PERSISTIDO, `shouldPause` leyó `autopilot=false` de la BD y N1 pausó — que es
  // el comportamiento CORRECTO del producto (§7.1: la decisión de pausa se toma al alcanzar
  // el checkpoint; un PATCH posterior no la deshace). El test mentía dos veces:
  //
  //  1. Esperaba por TIEMPO disfrazado de estado (la ventana del sleep).
  //  2. Su «prueba» de que el autopilot estaba activo —`data-run-autopilot=true`— es un
  //     OPTIMISTIC UPDATE del store (run-shell.tsx lo pinta ANTES de que el PATCH responda):
  //     afirmaba el optimismo del cliente, no el estado del servidor.
  //
  // Se parte en dos tests con GATES DE ESTADO ESTABLES (ningún reloj):
  //  (a) el toggle PERSISTE en el servidor (se comprueba contra `GET /api/runs/:id`, la BD,
  //      no contra el atributo optimista), partiendo de un run PARADO en el checkpoint de N1;
  //  (b) el autopilot SALTA el checkpoint normal y RESPETA el candado, con el run lanzado ya
  //      en autopilot (`POST /api/runs` con `autopilot: true`) — no hay nada que "llegar a
  //      tiempo" a clicar.
  // Entre los dos se conserva TODA la cobertura del original.

  test(
    'autopilot: el toggle de la cabecera PERSISTE en el run (no solo en el cliente)',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      const runId = await launchDemoCanvasRun(request, { sleepMs: 200 });
      await page.goto(`/runs/${runId}`);

      // GATE ESTABLE (no una ventana de tiempo): el run se para en el checkpoint de N1 y
      // ahí se queda indefinidamente. Da igual lo cargada que vaya la máquina.
      await waitStatus(page, 'N1', 'waiting_approval');

      await page.locator('[data-slot="autopilot-toggle"]').click();
      // El atributo de la cabecera es un OPTIMISTIC UPDATE: se afirma (es lo que el usuario
      // ve) pero NO demuestra nada del servidor…
      await expect(page.locator('[data-slot="run-header"]')).toHaveAttribute(
        'data-run-autopilot',
        'true',
      );
      // …la observable REAL es la fila del run en la BD, vía la misma API que la lee.
      //
      // `toPass` y NO `expect.poll`: bajo `fullyParallel`, `next dev` llega a CORTAR una
      // conexión (`read ECONNRESET`) cuando compila rutas bajo carga, y `expect.poll` NO
      // reintenta si el callback LANZA — un reset transitorio tumbaba el test (visto en la
      // 4ª pasada de T1.19). `toPass` reintenta también ante excepción, que es el
      // comportamiento de una web-first assertion: si el estado nunca llega, sigue fallando
      // al agotar el timeout (no tapa nada, solo tolera el corte de una lectura).
      await expect(async () => {
        const res = await request.get(`/api/runs/${runId}`);
        const body = (await res.json()) as { autopilot: boolean };
        expect(body.autopilot).toBe(true);
      }).toPass({ timeout: 30_000 });

      // Y con el autopilot YA PERSISTIDO, el run reanudado no vuelve a pararse hasta el
      // candado: aprobar N1 lleva el run hasta N3 (alwaysPause) sin intervención humana.
      const panel = await openPanel(page, 'N1');
      await panel.getByRole('button', { name: /^aprobar$/i }).click();
      await waitStatus(page, 'N2', 'succeeded');
      await waitStatus(page, 'N3', 'waiting_approval');
    },
  );

  test(
    'autopilot: el checkpoint NORMAL no pausa, pero el candado alwaysPause gana igual',
    { tag: ['@f0'] },
    async ({ page, request }) => {
      // El run ARRANCA en autopilot (persistido por `POST /api/runs`): no hay ninguna
      // carrera entre un click humano y el avance del worker.
      const runId = await launchDemoCanvasRun(request, { sleepMs: 200, autopilot: true });
      await page.goto(`/runs/${runId}`);

      // N1 (checkpoint NORMAL) NO pausa con autopilot: pasa a succeeded sin approve.
      await waitStatus(page, 'N1', 'succeeded');
      // N3 (candado alwaysPause) SÍ pausa AUNQUE autopilot esté on: el candado gana.
      await waitStatus(page, 'N3', 'waiting_approval');
    },
  );
});

// ── T1.16: títulos humanos, visor modal del artefacto y controles del lienzo ──────────
//
// Estos tests corren sobre el DAG de ANÁLISIS (N1/N2/N3), no sobre el de demo, y no es una
// comodidad: el DAG de demo NO produce `output_refs` (su executor no devuelve nada) ni abre
// CP1 (el editor de brief se activa por la FORMA del artefacto, `N3OutputSchema`, no por
// `isCheckpoint`). Las dos observables de esta tarea —una modal con un artefacto que el
// excerpt TRUNCA, y el lienzo comprimido por CP1— solo existen con un brief real. Sigue sin
// costar un céntimo: las APIs externas del stack E2E son falsas.
test.describe('canvas: títulos, visor del artefacto y controles (T1.16)', () => {
  test(
    'los nodos muestran su título humano y la clave sigue siendo el accessible name',
    { tag: ['@f1'] },
    async ({ page, request }) => {
      const runId = await launchAnalysisRun(request);
      await page.goto(`/runs/${runId}`);

      // El nodo se sigue encontrando POR SU CLAVE (la API de test no cambia)…
      const n2 = canvasNode(page, 'N2');
      await expect(n2).toBeVisible({ timeout: 30_000 });
      // …y lo que el humano lee es el título del PRD §7.2, no `N2`.
      await expect(n2.locator('[data-slot="node-title"]')).toHaveText('Análisis visual');
      await expect(canvasNode(page, 'N1').locator('[data-slot="node-title"]')).toHaveText(
        'Ingesta',
      );
      await expect(canvasNode(page, 'N3').locator('[data-slot="node-title"]')).toHaveText(
        'ProductBrief',
      );
    },
  );

  test(
    'con CP1 abierto el lienzo se comprime pero N2 sigue alcanzable (fit/zoom)',
    { tag: ['@f1'] },
    async ({ page, request }) => {
      // La deuda que dejó el verifier de T1.14: con el editor de CP1 abierto el lienzo baja a
      // ~255 px y N2/N3 se salían de la vista, sin controles para recuperarlos.
      const runId = await launchAnalysisRun(request);
      await page.goto(`/runs/${runId}`);

      // Esperar a CP1: N3 pausa en waiting_approval y el editor de brief toma la vista.
      await waitCanvasStatus(page, 'N3', 'waiting_approval', 60_000);
      await expect(page.getByRole('form', { name: /editor de brief/i })).toBeVisible();

      // Los controles del lienzo existen (con su accessible name en español).
      await expect(page.getByRole('button', { name: 'Ajustar a la vista' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Acercar' })).toBeVisible();

      // LA OBSERVABLE: N2 está DENTRO del viewport, no solo en el DOM. `toBeInViewport` y no
      // `toBeVisible`: React Flow mantiene los nodos fuera de encuadre montados y a tamaño
      // completo, así que `toBeVisible` pasaría incluso con N2 paneado fuera de la vista — es
      // decir, no detectaría el bug que esta tarea arregla.
      await expect(canvasNode(page, 'N2')).toBeInViewport({ timeout: 15_000 });
      // Y no solo N2: el re-encuadre mete el DAG ENTERO en el lienzo estrecho (es lo que
      // exige bajar `minZoom` por debajo del 0.5 de fábrica).
      await expect(canvasNode(page, 'N1')).toBeInViewport();
      await expect(canvasNode(page, 'N3')).toBeInViewport();

      // Y el fit manual lo mantiene alcanzable (el control funciona, no es decoración).
      await page.getByRole('button', { name: 'Ajustar a la vista' }).click();
      await expect(canvasNode(page, 'N2')).toBeInViewport();
    },
  );

  test(
    'la caja de output abre la modal con el artefacto COMPLETO (lo que el excerpt trunca)',
    { tag: ['@f1'] },
    async ({ page, context, request }) => {
      // El portapapeles es una API con PERMISO: Chromium headless lo deniega por defecto y
      // `navigator.clipboard.writeText` rechazaría. Concederlo es reproducir al usuario real
      // (que lo tiene), no debilitar el test: el assert de abajo lee el contenido COPIADO.
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);

      const runId = await launchAnalysisRun(request);
      await page.goto(`/runs/${runId}`);

      // CP1 aparece → se aprueba sin editar. Y DESPUÉS **CP2** (T2.3: N4 compone la matriz y pausa
      // en `waiting_approval`), que también se confirma: los paneles de checkpoint RETIRAN el
      // inspector genérico mientras están abiertos (es el patrón de CP1 desde T1.10b), así que la
      // vista cockpit —la que este spec necesita— no vuelve hasta que NINGÚN checkpoint está
      // pausado. Antes de T2.3 el run se quedaba sin checkpoints tras CP1; ahora hay dos.
      await waitCanvasStatus(page, 'N3', 'waiting_approval', 60_000);
      const editor = page.getByRole('form', { name: /editor de brief/i });
      await editor.getByRole('button', { name: /aprobar y continuar/i }).click();
      await waitCanvasStatus(page, 'N3', 'succeeded');

      await waitCanvasStatus(page, 'N4', 'waiting_approval', 60_000);
      await page.getByRole('button', { name: /confirmar y crear/i }).click();
      await waitCanvasStatus(page, 'N4', 'succeeded', 30_000);

      // El inspector de N3: su caja de output enseña el EXCERPT (200 chars del servidor).
      const panel = await openCanvasPanel(page, 'N3');
      await expect(panel.getByText('ProductBrief')).toBeVisible(); // título humano (§7.2 / DS)
      const excerpt = panel.locator('[data-slot="open-output-dialog"]');
      await expect(excerpt).toBeVisible();

      // Prueba de que el recorte del servidor ES REAL: un campo del brief que vive MÁS ALLÁ
      // del carácter 200 (los ángulos son de lo último del artefacto) NO está en la caja…
      await expect(excerpt).not.toContainText('angles');

      // …y SÍ está en la modal, que pide el `output_refs` entero a `GET /api/steps/:id`.
      await excerpt.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: /output de productbrief/i })).toBeVisible();
      await expect(dialog.locator('[data-slot="json-viewer"]')).toContainText('"angles"', {
        timeout: 15_000,
      });
      // El JSON está FORMATEADO (indentado), no en una línea minificada como el excerpt.
      await expect(dialog.locator('[data-slot="json-viewer"]')).toContainText('\n  "');

      // Copiar: y se comprueba lo que HAY EN EL PORTAPAPELES (que el botón diga "Copiado" no
      // demuestra que copiara nada — y menos que copiara el artefacto ENTERO).
      await dialog.getByRole('button', { name: /^copiar$/i }).click();
      await expect(dialog.getByText(/copiado/i)).toBeVisible();
      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboard).toContain('"angles"'); // el campo que el excerpt truncaba

      // Cerrar.
      await dialog.getByRole('button', { name: /^cerrar$/i }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
    },
  );

  test(
    'la caja de error abre la modal con el error COMPLETO (lo que el excerpt trunca)',
    { tag: ['@f1'] },
    async ({ page, context, request }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);

      // El error se INYECTA largo y con la forma de los reales (prefijo del nodo + volcado de
      // issues de Zod, que es lo que produce un `PermanentStepError` de N3). NO vale el
      // "fallo inyectado" de 25 caracteres del default: cabe entero en los 200 del excerpt, así
      // que un visor que truncara pasaría el test igual — el arnés sería más cómodo que la
      // realidad, y el bug que esta tarea arregla no podría ponerlo rojo.
      const sentinel = 'ULTIMO_ISSUE_DEL_VOLCADO';
      const longError = `N3: config inválida: ${Array.from(
        { length: 8 },
        (_, i) =>
          `[{"code":"invalid_type","path":["angles",${String(i)},"hook"],"message":"Required"}]`,
      ).join(' ')} ${sentinel}`;

      const runId = await launchDemoCanvasRun(request, { sleepMs: 400, failMessage: longError });
      await page.goto(`/runs/${runId}`);

      // Avanzar por los checkpoints hasta N4 (failRate=1), que falla con ESE mensaje.
      await waitStatus(page, 'N1', 'waiting_approval');
      await (await openPanel(page, 'N1')).getByRole('button', { name: /^aprobar$/i }).click();
      await waitStatus(page, 'N3', 'waiting_approval');
      await (await openPanel(page, 'N3')).getByRole('button', { name: /^aprobar$/i }).click();
      await waitStatus(page, 'N4', 'failed');

      const panel = await openPanel(page, 'N4');
      const box = panel.locator('[data-slot="open-error-dialog"]');
      await expect(box).toBeVisible();

      // CONTROL NEGATIVO (espejo del test de output): el excerpt del SSE está cortado a 200
      // caracteres y el centinela del FINAL del mensaje NO está en la caja del inspector…
      await expect(box).toContainText('N3: config inválida');
      await expect(box).not.toContainText(sentinel);

      // …y SÍ está en la modal, que pide el error ENTERO a `GET /api/steps/:id`.
      await box.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: /^error de /i })).toBeVisible();
      const errorText = dialog.locator('[data-slot="error-text"]');
      await expect(errorText).toContainText(sentinel, { timeout: 15_000 });

      // Copiar copia el error ENTERO (no el recorte), y cerrar cierra.
      await dialog.getByRole('button', { name: /^copiar$/i }).click();
      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboard).toContain(sentinel);
      await dialog.getByRole('button', { name: /^cerrar$/i }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
    },
  );
});
