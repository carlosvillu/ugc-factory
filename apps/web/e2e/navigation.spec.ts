// Regresión permanente de T1.13 (e2e.md §10, DoD BLOQUEANTE). Dos cosas, las dos que
// entrega la tarea:
//
//   1. LAS PÁGINAS SERVER-COMPONENT RENDERIZAN EN UN PUERTO QUE NO ES EL 3000. `/spend` y
//      `/settings` son RSC que hacen fetch a la API interna: necesitan una URL ABSOLUTA, y
//      hasta T1.13 esa base estaba HARDCODEADA a `http://localhost:3000`. Servir en
//      cualquier otro puerto ⇒ el RSC llamaba a un servidor ajeno (o a ninguno) ⇒ 404/
//      ECONNREFUSED ⇒ **500 de la página**. El bug vivió desde F0 sin que ningún test lo
//      cazara.
//
//      POR QUÉ ESTE SPEC SÍ LO CAZA (y no es otro test cómodo): el stack E2E sirve en
//      **:3100** (≠ 3000) y —desde T1.13— **YA NO fija `INTERNAL_API_URL`**. Esa env era la
//      MULETA que tapaba justo este fallo: con ella puesta, la base del RSC quedaba correcta
//      por decreto del stack, no por el código. Quitada la muleta, la única forma de que
//      estas páginas rendericen es que el código DERIVE la base del `PORT` real. Si alguien
//      vuelve a clavar el 3000 (o vuelve a meter la muleta y luego rompe la derivación),
//      estos asserts se ponen rojos. La condición del bug queda reproducida de verdad:
//      puerto distinto del asumido + sin override a mano.
//      (`src/lib/e2e-stack-honesty.test.ts` blinda en el GATE que la muleta no vuelva: es
//      lo único que este proceso no puede observar del otro — su entorno.)
//
//   2. LA APP ES NAVEGABLE SIN ESCRIBIR URLs. Antes de T1.13 la home era un `<h1>` suelto:
//      solo se llegaba a una página tecleando su ruta. Aquí se recorre home → cada página
//      existente A GOLPE DE CLICK, y se comprueba la vuelta a casa desde la nav global.
import { test, expect } from '@playwright/test';
import { launchDemoCanvasRun } from './support/runs';

test.describe('base URL del fetch de servidor y navegación global (T1.13)', () => {
  // Las dos páginas RSC que el bug tumbaba. Se afirma el <h1> (no un "no hay 500"): un
  // assert negativo pasaría casi en cualquier estado. Si el fetch de servidor falla, el RSC
  // lanza y Next sirve el error boundary — sin este heading.
  for (const { path, heading } of [
    { path: '/spend', heading: 'Gasto' },
    { path: '/settings', heading: 'Ajustes' },
  ]) {
    test(
      `${path} renderiza sirviendo en un puerto distinto del 3000 y sin INTERNAL_API_URL`,
      { tag: ['@f1'] },
      async ({ page }) => {
        const response = await page.goto(path);
        expect(response?.status()).toBe(200); // el bug daba 500
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      },
    );
  }

  test(
    'desde la home se llega a las páginas existentes sin escribir ninguna URL',
    {
      tag: ['@f1'],
    },
    async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'UGC Factory' })).toBeVisible();

      // Las TARJETAS de la home (dentro de <main>: el <nav> global tiene links homónimos y
      // aquí se prueba la home, no la nav). El accessible name de cada tarjeta arranca por su
      // título, así que se ancla con `^`.
      const entries = [
        { link: /^nuevo análisis/i, heading: 'Nuevo análisis' },
        { link: /^gasto/i, heading: 'Gasto' },
        { link: /^ajustes/i, heading: 'Ajustes' },
        { link: /^design system/i, heading: 'Design system' },
      ];
      for (const entry of entries) {
        await page.goto('/');
        await page.getByRole('main').getByRole('link', { name: entry.link }).click();
        await expect(page.getByRole('heading', { level: 1, name: entry.heading })).toBeVisible();
        // …y la VUELTA a casa: la marca de la nav global, desde cualquier página.
        await page.getByRole('link', { name: 'UGC Factory' }).click();
        await expect(page).toHaveURL('/');
      }
    },
  );

  test(
    'la nav global muestra los 6 destinos del mockup; los de fases futuras, deshabilitados',
    {
      tag: ['@f1'],
    },
    async ({ page }) => {
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: 'Navegación principal' });

      // Los 6 destinos del mockup 2a, en su orden, están TODOS.
      await expect(nav.getByRole('link')).toHaveText([
        'Inicio',
        'Canvas',
        'Biblioteca',
        'Galería',
        'Métricas',
        'Gasto',
      ]);
      await expect(nav.getByRole('link', { name: 'Inicio' })).toHaveAttribute(
        'aria-current',
        'page',
      );

      // Los de fases futuras se VEN (el mockup los tiene) pero están DESHABILITADOS: se
      // anuncian como tales, no tienen destino y no son tabulables. Nunca llevan a una
      // página rota — se activarán solos al cerrar su fase.
      for (const name of ['Biblioteca', 'Galería', 'Métricas']) {
        const item = nav.getByRole('link', { name });
        await expect(item).toBeVisible();
        await expect(item).toHaveAttribute('aria-disabled', 'true');
        // El MOTIVO viaja en el NOMBRE ACCESIBLE, no solo en el `title` (que solo aparece
        // con hover del ratón): quien navega con teclado/lector debe oír POR QUÉ está
        // deshabilitado y CUÁNDO llega, no un «enlace deshabilitado» a secas.
        await expect(item).toHaveAttribute('aria-label', /fase F\d/);
        await expect(item).toHaveAttribute('title', /fase F\d/);
        // Sin `href`: un click no puede llevar a ninguna parte.
        expect(await item.getAttribute('href')).toBeNull();
      }

      // «Canvas» lleva al intake, que es la puerta real a un canvas de run.
      await nav.getByRole('link', { name: 'Canvas' }).click();
      await expect(page).toHaveURL('/analyses/new');
    },
  );

  test(
    'dentro de un run, «Canvas» se RESALTA pero NO se anuncia como página actual',
    { tag: ['@f1'] },
    async ({ page, request }) => {
      // Regresión de a11y: «resaltado» y «página actual» son dos preguntas distintas. El
      // href de «Canvas» es `/analyses/new` (el intake), y dentro de un run NO es donde
      // estás: anunciar `aria-current="page"` ahí haría que un lector de pantalla dijera
      // «Canvas, página actual» y, al activarlo, el usuario aterrizaría en un formulario
      // VACÍO. Se resalta (estás en su área) pero no se declara actual.
      const runId = await launchDemoCanvasRun(request, { sleepMs: 200 });
      await page.goto(`/runs/${runId}`);

      const nav = page.getByRole('navigation', { name: 'Navegación principal' });
      const canvas = nav.getByRole('link', { name: 'Canvas' });
      await expect(canvas).toHaveAttribute('data-highlighted', 'true'); // señal VISUAL: sí
      await expect(canvas).not.toHaveAttribute('aria-current', 'page'); // señal a11y: NO

      // Y en su href literal sí es, a la vez, resaltado Y página actual.
      await page.goto('/analyses/new');
      await expect(canvas).toHaveAttribute('data-highlighted', 'true');
      await expect(canvas).toHaveAttribute('aria-current', 'page');
    },
  );

  test(
    '/login NO lleva la nav global (aún no hay sesión que navegar)',
    { tag: ['@f1'] },
    async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toHaveCount(0);
    },
  );
});
