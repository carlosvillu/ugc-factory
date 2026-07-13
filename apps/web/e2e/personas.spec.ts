// Regresión permanente de T2.0 (e2e.md §10, DoD BLOQUEANTE): la librería de personas en un
// navegador real contra el stack completo (Next + Postgres del testcontainer + StorageAdapter).
//
// La línea «Playwright permanente» del planning pide EXACTAMENTE esto: «cubre CRUD, voice map
// es/en, upload ≥2K y rechazo visible de una imagen <2K; usa fixtures locales y no generación
// IA». Cada uno de esos cuatro tiene aquí su caso:
//
//   1. CRUD: crear desde el formulario → la persona aparece en la librería con su ficha (mockup
//      6c) → editarla → borrarla (con confirmación) → ya no está.
//   2. VOICE MAP es/en: la ficha pinta las DOS voces con su proveedor; se comprueba también en
//      la BD (el jsonb persistido, no solo lo que la UI cree).
//   3. UPLOAD ≥2K: se sube un PNG REAL de 2048 px de lado largo por el `<input type=file>` y la
//      imagen aparece en la ficha.
//   4. RECHAZO VISIBLE <2K: se sube un PNG REAL de 512 px y el navegador enseña el mensaje de
//      error; la imagen NO se añade.
//
// LOS FIXTURES SON FICHEROS DE VERDAD, generados al vuelo con `writeTestPng` (@ugc/test-utils,
// sharp). No se puede hacer de otra forma sin mentir: el servidor LEE las dimensiones del
// fichero (principio 9 de la skill testing — el arnés no puede ser más cómodo que la realidad).
// CERO generación IA: coste $0.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { writeTestPng } from '@ugc/test-utils';
import { queryStack } from './support/stack-db';

/** Nombre único por ejecución: la BD del stack es COMPARTIDA por toda la suite y `persona.name`
 *  es UNIQUE (la clave natural). Dos reruns con el mismo nombre chocarían. */
function uniqueName(tag: string): string {
  return `E2E ${tag} ${String(Date.now())}-${String(Math.random()).slice(2, 7)}`;
}

/** Los ficheros de imagen del spec, generados UNA vez: uno que pasa el umbral (2048 px de lado
 *  largo) y uno que no lo pasa (512 px). Son PNGs decodificables de verdad. */
let bigImage: string; // ≥2K → se acepta
let smallImage: string; // <2K → se rechaza

test.beforeAll(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ugc-e2e-personas-'));
  bigImage = await writeTestPng(path.join(dir, 'ref-2k.png'), 1638, 2048);
  smallImage = await writeTestPng(path.join(dir, 'ref-small.png'), 512, 640);
});

/** Rellena el formulario de persona (el del diálogo) y lo envía. */
async function fillPersonaForm(
  page: Page,
  values: {
    name: string;
    ageRange?: string;
    ethnicity?: string;
    style?: string;
    esVoiceId?: string;
    enVoiceId?: string;
  },
): Promise<void> {
  await page.getByLabel('Nombre').fill(values.name);
  await page.getByLabel('Rango de edad').fill(values.ageRange ?? '25-34');
  await page.getByLabel('Etnia').fill(values.ethnicity ?? 'latina');
  await page.getByLabel('Estilo').fill(values.style ?? 'casual');
  await page.getByLabel('Descriptor').fill('mujer de 29 años, latina, look casual');
  await page.getByLabel('Escenario').fill('baño con luz natural, encimera con dos productos');
  await page.getByLabel('Personalidad').fill('Cercana y directa, habla como una amiga.');
  // VOICE MAP es/en: las dos filas del mockup 6c.
  await page.getByLabel('Voice ID · Español').fill(values.esVoiceId ?? 'v_es_e2e');
  await page.getByLabel('Voice ID · English').fill(values.enVoiceId ?? 'v_en_e2e');
}

test.describe('/personas — librería de personas (T2.0)', () => {
  test(
    'CRUD completo: crear con voice map es/en, ver la ficha, editar y eliminar',
    { tag: ['@f2'] },
    async ({ page }) => {
      const name = uniqueName('CRUD');
      await page.goto('/personas');

      // ── CREAR ────────────────────────────────────────────────────────────
      await page.getByRole('button', { name: /nueva persona/i }).click();
      await fillPersonaForm(page, { name, esVoiceId: 'v_es_lucia', enVoiceId: 'v_en_lucia' });
      await page.getByRole('button', { name: /crear persona/i }).click();

      // La ficha (mockup 6c) se abre con la persona recién creada.
      const detail = page.getByRole('article');
      await expect(detail.getByRole('heading', { name, level: 2 })).toBeVisible();
      await expect(detail).toContainText('25-34');
      await expect(detail).toContainText('latina');

      // ── VOICE MAP es/en: las DOS voces, en la ficha ──────────────────────
      const esVoice = page.getByTestId('persona-voice-es');
      const enVoice = page.getByTestId('persona-voice-en');
      await expect(esVoice).toContainText('Español');
      await expect(esVoice).toContainText('v_es_lucia');
      await expect(enVoice).toContainText('English');
      await expect(enVoice).toContainText('v_en_lucia');

      // …y en la BD (el jsonb persistido con su PROVEEDOR — no solo lo que la UI cree).
      const rows = await queryStack<{
        voice_map: Record<string, { provider: string; voiceId: string }>;
      }>('SELECT voice_map FROM persona WHERE name = $1', [name]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.voice_map.es).toEqual({ provider: 'elevenlabs', voiceId: 'v_es_lucia' });
      expect(rows[0]!.voice_map.en).toEqual({ provider: 'elevenlabs', voiceId: 'v_en_lucia' });

      // ── EDITAR ───────────────────────────────────────────────────────────
      await page.getByRole('button', { name: /^editar$/i }).click();
      await page.getByLabel('Estilo').fill('elegante');
      await page.getByRole('button', { name: /guardar cambios/i }).click();
      await expect(page.getByRole('article')).toContainText('elegante');

      // Persiste tras un reload (no era estado de cliente: llegó a la BD).
      await page.reload();
      await page.getByTestId(await personaItemTestId(page, name)).click();
      await expect(page.getByRole('article')).toContainText('elegante');

      // ── ELIMINAR ─────────────────────────────────────────────────────────
      const itemTestId = await personaItemTestId(page, name);
      await page.getByRole('button', { name: /^eliminar$/i }).click();
      const confirm = page.getByRole('alertdialog');
      await expect(confirm).toContainText(/no se borran/i); // la política de la FK, explicada
      await confirm.getByRole('button', { name: /^eliminar$/i }).click();

      // La persona desaparece de la LISTA. Se localiza por su TESTID y no por
      // `getByRole('button', {name})`: el nombre accesible del item incluye TAMBIÉN su línea de
      // demografía («… · 25-34 · elegante»), así que un `name` con solo el nombre NO casaba —el
      // assert pasaba VACÍO (0 elementos porque no encontraba ninguno, no porque se hubiera
      // borrado) y el SELECT de abajo corría mientras el DELETE seguía en vuelo. Se veía solo al
      // correr la suite ENTERA, nunca el spec suelto.
      await expect(page.getByTestId(itemTestId)).toHaveCount(0);

      // Y la fila ya NO está en la BD. Con `expect.poll` y no un SELECT suelto: es una aserción
      // sobre el estado de OTRO PROCESO (el servidor), y esas se esperan, no se adivinan.
      await expect
        .poll(async () => {
          const rows = await queryStack('SELECT id FROM persona WHERE name = $1', [name]);
          return rows.length;
        })
        .toBe(0);
    },
  );

  test(
    'las acciones de fases futuras se VEN pero están DESHABILITADAS, y dicen por qué',
    { tag: ['@f2'] },
    async ({ page }) => {
      // Precedente de T1.13 (nav): un afordance de una fase futura NO se omite —se pinta
      // deshabilitado y ANUNCIA su motivo—. Omitirlo esconde a dónde va el producto; pintarlo
      // vivo engaña. El motivo tiene que estar en el NOMBRE ACCESIBLE: el `title` solo aparece
      // con hover del ratón, así que con teclado o lector se oiría «botón, deshabilitado» y nada
      // más. Por eso se busca por su `aria-label`, que es justo lo que oye quien no ve.
      const name = uniqueName('DISABLED');
      await page.goto('/personas');
      await page.getByRole('button', { name: /nueva persona/i }).click();
      await fillPersonaForm(page, { name });
      await page.getByRole('button', { name: /crear persona/i }).click();
      await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();

      const card = page.getByRole('article');
      for (const { action, reason } of [
        { action: 'Usar en lote', reason: /T2\.3/ },
        { action: 'Generar variación', reason: /fase F4/ },
      ]) {
        const button = card.getByRole('button', { name: new RegExp(`^${action} · `) });
        await expect(button).toBeVisible(); // se VE (no está omitido)
        await expect(button).toBeDisabled(); // pero NO se puede pulsar (no engaña)
        await expect(button).toHaveAccessibleName(reason); // y DICE por qué / cuándo llega
      }
    },
  );

  test(
    'upload de una imagen ≥2K: se acepta y aparece en la ficha',
    { tag: ['@f2'] },
    async ({ page }) => {
      const name = uniqueName('UP2K');
      await page.goto('/personas');
      await page.getByRole('button', { name: /nueva persona/i }).click();
      await fillPersonaForm(page, { name });
      await page.getByRole('button', { name: /crear persona/i }).click();
      await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();

      // Arranca sin referencias.
      await expect(page.getByRole('article')).toContainText('0 imágenes de referencia');

      // Sube el PNG REAL de 2048 px de lado largo. El SERVIDOR lee sus dimensiones del fichero.
      await page.getByLabel(/añadir imagen de referencia/i).setInputFiles(bigImage);

      // La imagen entra: la ficha la pinta (identity lock) y el contador sube.
      await expect(page.getByRole('article')).toContainText('1 imagen de referencia');
      await expect(
        page.getByRole('img', { name: new RegExp(`retrato principal de ${name}`, 'i') }),
      ).toBeVisible();
      // Ningún error EN LA FICHA (el `role=alert` global de Next —el route announcer— no cuenta).
      await expect(page.getByRole('article').getByRole('alert')).toHaveCount(0);

      // ── T1.18 · LA IMAGEN SE VE DE VERDAD (no basta con que ESTÉ) ─────────────────────────
      // La regresión que se coló con la primitiva `Image` (verifier de T1.18): su estado salía de
      // `loading` SOLO con el evento `onLoad`, y si la imagen ya está completa cuando React
      // engancha el handler, ese evento no se dispara NUNCA ⇒ la imagen se descargaba bien y el
      // usuario NO LA VEÍA JAMÁS (se quedaba en `opacity-0`, con la trama pintada encima).
      //
      // Y `toBeVisible()` —lo único que este spec afirmaba— NO LO HABRÍA VISTO: Playwright IGNORA
      // la opacidad, así que un `<img>` en `opacity-0` la pasa tan campante. Por eso aquí se mide
      // el DOM REAL: el `data-status` de la primitiva, los píxeles y la opacidad computada.
      //
      // HONESTIDAD SOBRE EL ALCANCE (principio 9, y esto importa): este bloque NO reproduce el
      // estado exacto del bug —la imagen YA CACHEADA al montar—. No puede: el download de assets
      // (T0.5) sirve `Cache-Control: private, no-store`, así que en un reload el navegador SIEMPRE
      // la vuelve a pedir y el evento SIEMPRE llega. Verificado: con la primitiva rota a propósito,
      // este caso seguía en VERDE. Quien SÍ reproduce el estado cacheado —y se pone rojo sin el
      // fix— es el unit de la primitiva (`components/ui/image.test.tsx`), que fuerza el
      // `complete`/`naturalWidth` que el navegador expone. Lo de aquí es la otra mitad: que en un
      // navegador REAL la imagen acabe VISIBLE, que es lo que este spec no comprobaba.
      const retrato = page.getByRole('img', {
        name: new RegExp(`retrato principal de ${name}`, 'i'),
      });
      await expect(retrato).toBeVisible();
      // La primitiva llegó a `loaded` (el `data-status` es su contrato observable).
      await expect(retrato.locator('xpath=..')).toHaveAttribute('data-status', 'loaded');
      // Tiene PÍXELES de verdad.
      expect(await retrato.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      // Y NO es transparente. `poll` porque la primitiva hace un fade (`transition-opacity`): la
      // opacidad está EN CAMINO a 1 (se ha llegado a leer 0.58 aquí). El bug dejaba un 0 CLAVADO
      // para siempre — la diferencia entre «está apareciendo» y «no va a aparecer nunca».
      await expect
        .poll(async () => retrato.evaluate((el) => getComputedStyle(el).opacity))
        .toBe('1');

      // Y la fila `asset` existe de verdad, con kind reference_image.
      const rows = await queryStack<{ n: number }>(
        `SELECT count(*)::int AS n FROM asset a
         JOIN persona p ON a.id = ANY(p.reference_image_ids)
         WHERE p.name = $1 AND a.kind = 'reference_image'`,
        [name],
      );
      expect(rows[0]!.n).toBe(1);

      // Una segunda imagen ≥2K se acumula (§11: 2–3 encuadres del mismo sujeto).
      await page.getByLabel(/añadir imagen de referencia/i).setInputFiles(bigImage);
      await expect(page.getByRole('article')).toContainText('2 imágenes de referencia');
    },
  );

  test(
    'una imagen <2K es RECHAZADA con un mensaje VISIBLE y no se añade',
    { tag: ['@f2'] },
    async ({ page }) => {
      const name = uniqueName('SUB2K');
      await page.goto('/personas');
      await page.getByRole('button', { name: /nueva persona/i }).click();
      await fillPersonaForm(page, { name });
      await page.getByRole('button', { name: /crear persona/i }).click();
      await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();

      // El PNG es REAL y mide 512×640: el servidor lo lee y lo rechaza. Nadie le dice al
      // servidor cuánto mide — es la diferencia entre probar el guard y fingir que se prueba.
      await page.getByLabel(/añadir imagen de referencia/i).setInputFiles(smallImage);

      // EL RECHAZO ES VISIBLE (la cláusula literal de la Verificación) y dice lo que hace falta.
      // Se busca DENTRO de la ficha, no en la página entera: Next inyecta su PROPIO
      // `<div role="alert">` global (`__next-route-announcer__`, que anuncia los cambios de ruta
      // a los lectores de pantalla), así que un `getByRole('alert')` de página resuelve a DOS
      // elementos. Acotar al `article` NO es una rebaja del assert: afirma algo MÁS fuerte —que
      // el error aparece en la ficha de la persona, que es donde el usuario está mirando— en vez
      // de "en algún sitio de la página".
      const alert = page.getByRole('article').getByRole('alert');
      await expect(alert).toBeVisible();
      await expect(alert).toContainText('512');
      await expect(alert).toContainText('2048');

      // Y NO se añadió: ni en la ficha, ni en la BD.
      await expect(page.getByRole('article')).toContainText('0 imágenes de referencia');
      const rows = await queryStack<{ n: number }>(
        `SELECT cardinality(reference_image_ids)::int AS n FROM persona WHERE name = $1`,
        [name],
      );
      expect(rows[0]!.n).toBe(0);
    },
  );
});

/** El testid del item de la lista de una persona (por su nombre): tras un reload hay que volver
 *  a seleccionarla, y el id lo tiene la BD. */
async function personaItemTestId(page: Page, name: string): Promise<string> {
  const rows = await queryStack<{ id: string }>('SELECT id FROM persona WHERE name = $1', [name]);
  const id = rows[0]?.id;
  if (!id) throw new Error(`no existe la persona «${name}» en la BD del stack`);
  await expect(page.getByTestId(`persona-item-${id}`)).toBeVisible();
  return `persona-item-${id}`;
}
