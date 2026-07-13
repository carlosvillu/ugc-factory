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
        // «Runs» (T1.17): otra tarjeta que aparece SOLA por tener `href` — la misma promesa,
        // cobrada por segunda vez. Es el listado de pipelines lanzados: sin él, tras arrancar un
        // run no había forma de volver a él.
        { link: /^runs/i, heading: 'Runs' },
        // «Personas» (T2.0): la tarjeta NO se escribió a mano en la home — aparece sola porque el
        // destino tiene `href`. Es la promesa de T1.13 cobrada, y por eso se comprueba de verdad
        // que se llega a la página a golpe de click.
        { link: /^personas/i, heading: 'Personas' },
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
    'la nav global muestra los 8 destinos; los de fases futuras, deshabilitados',
    {
      tag: ['@f1'],
    },
    async ({ page }) => {
      await page.goto('/');
      const nav = page.getByRole('navigation', { name: 'Navegación principal' });

      // ⚠ SON 8 Y NO 6, y las dos desviaciones del mockup 2a son deliberadas:
      //   · «Personas» (T2.0, aprobada por el usuario): su página existe hoy y está completa;
      //     dejarla accesible solo tecleando la URL es la queja que originó T1.13. NO se fusiona
      //     con «Biblioteca» (área de F2, guiones y variantes, aún deshabilitada): son dos cosas
      //     distintas.
      //   · «Runs» (T1.17): el listado de pipelines lanzados. Sin él, tras arrancar un run no
      //     había forma de volver a él ni de ver los anteriores — solo existía `/runs/[id]`, al
      //     que se llegaba TECLEANDO el ULID. El dashboard del mockup es T5.10 (F5), demasiado
      //     lejos para algo que bloquea el uso diario.
      // La lista se sigue enumerando ENTERA: su trabajo es cazar el próximo destino que alguien
      // añada sin pensarlo.
      await expect(nav.getByRole('link')).toHaveText([
        'Inicio',
        'Canvas',
        'Runs',
        'Personas',
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
    'dentro de un run se RESALTA «Runs» (su área) y NO se anuncia como página actual',
    { tag: ['@f1'] },
    async ({ page, request }) => {
      // Regresión de a11y: «resaltado» y «página actual» son dos preguntas distintas. Estando
      // DENTRO del área de un destino (no en su href exacto), anunciar `aria-current="page"`
      // haría que un lector de pantalla dijera «X, página actual» y, al activar el enlace, el
      // usuario aterrizaría en OTRO sitio.
      //
      // ⚠ EL ÁREA DE `/runs/:id` CAMBIÓ DE DUEÑO EN T1.17, a propósito. Antes la reclamaba
      // «Canvas» porque era el único destino que podía (no había listado). Ahora «Runs» existe,
      // y el canvas de un run ES un run: le pertenece. Dejar el prefijo también en «Canvas»
      // resaltaría DOS entradas a la vez estando en `/runs`, y «estás por aquí» dejaría de
      // señalar UN sitio. El caso de «Runs» lo cubre `runs-list.spec.ts`; aquí se prueba el
      // MISMO invariante sobre el área que le queda a «Canvas»: el intake.
      const runId = await launchDemoCanvasRun(request, { sleepMs: 200 });
      await page.goto(`/runs/${runId}`);

      const nav = page.getByRole('navigation', { name: 'Navegación principal' });
      const canvas = nav.getByRole('link', { name: 'Canvas' });
      const runs = nav.getByRole('link', { name: 'Runs' });

      // El área de `/runs/:id` es de «Runs», y de NADIE MÁS: resaltado exactamente UNO.
      await expect(runs).toHaveAttribute('data-highlighted', 'true'); // señal VISUAL: sí
      await expect(runs).not.toHaveAttribute('aria-current', 'page'); // señal a11y: NO (su href
      // es el LISTADO: activarlo te sacaría del run en el que estás)
      await expect(canvas).not.toHaveAttribute('data-highlighted', 'true'); // ya no es su área

      // Y «Canvas» en su href literal sí es, a la vez, resaltado Y página actual.
      await page.goto('/analyses/new');
      await expect(canvas).toHaveAttribute('data-highlighted', 'true');
      await expect(canvas).toHaveAttribute('aria-current', 'page');
      await expect(runs).not.toHaveAttribute('data-highlighted', 'true');
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
