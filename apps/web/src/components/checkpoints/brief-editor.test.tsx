// Tests del editor de brief de CP1 (T1.10b, frontend.md §6): los badges de procedencia con su
// cita, la petición BLOQUEANTE de imágenes del modo manual y el payload que se envía al
// checkpoint. Interacción como el usuario (roles/texto + userEvent); asserts sobre lo renderizado
// o sobre el payload emitido.
//
// El brief de prueba sale de `makeBrief()` (la ÚNICA factory de un ProductBrief válido): un
// objeto inventado aquí podría no cumplir el contrato (5–10 ángulos, 2–3 hooks…) y el test
// pasaría por casualidad — la lección de T1.8/T1.9.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, test } from 'vitest';
import { makeBrief, server, useHttpMocks } from '@ugc/test-utils';
import type { BriefWarning, ProductBrief } from '@ugc/core/contracts';

import { BriefEditor } from './brief-editor';

// eslint-disable-next-line react-hooks/rules-of-hooks
useHttpMocks(thumbnailOk());

afterEach(() => {
  cleanup();
});

const STEP_ID = '01J000000000000000000STEP0';
/** La fila `product_brief` que el editor tiene delante. Desde T1.18 NO es decorativa: es la
 *  ALLOWLIST del proxy de miniaturas (`/api/thumbnails?url=…&briefId=…` solo sirve URLs que
 *  estén en ESE brief persistido), así que sin ella el editor no puede comprobar si una
 *  candidata se puede descargar — y por tanto no la ofrece. */
const BRIEF_ID = '01J000000000000000000BRIEF';

/** Bytes de una miniatura: da igual QUÉ imagen sea (el DOM de jsdom no la decodifica); lo que
 *  importa es que el proxy respondió 200 con un blob. */
const THUMBNAIL_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/** El proxy de miniaturas de T1.18, contento por defecto: TODAS las candidatas se pueden
 *  descargar. Los tests que necesitan lo contrario (T1.18) lo sobrescriben con `server.use`. */
function thumbnailOk() {
  return http.get('*/api/thumbnails', () =>
    HttpResponse.arrayBuffer(THUMBNAIL_BYTES.slice().buffer, {
      headers: { 'content-type': 'image/png' },
    }),
  );
}

/** Un brief con un pain point EXTRAÍDO (con cita) y otro INFERIDO (sin ella): el par que hace
 *  observables los dos badges y la evidencia. */
const brief: ProductBrief = makeBrief({
  pain_points: [
    {
      pain: 'La piel se ve apagada al despertar',
      severity: 'high',
      current_alternative: 'Cremas hidratantes genéricas',
      evidence: 'Nuestras clientas notan la piel más luminosa desde la primera semana',
    },
    {
      pain: 'Miedo a irritar la piel sensible',
      severity: 'medium',
      current_alternative: null,
      evidence: null,
    },
  ],
});

const needsImages: BriefWarning = {
  code: 'needs_user_decision',
  reason: 'missing_hero_image',
  message: 'No hay imagen de producto: sube al menos una foto o elige generar un packshot con IA.',
};

/** T1.15 — EL BRIEF DE STAYFORLONG: rama URL, sin hero usable, pero CON las imágenes que el scrape
 *  sí trajo (award `unusable`, banner `broll`). Es el fixture del caso real, no uno cómodo: con
 *  `images: []` no habría nada que promover y el test no ejercitaría la salida nueva. */
const BANNER = 'https://es.stayforlong.com/img/hero-banner-hotel.jpg';
/** La OTRA candidata real: la que el CDN sirve solo a su propia web (403 a cualquier fetch de
 *  fuera). Es la protagonista de T1.18 — la que el sistema NO puede descargar. */
const AWARD = 'https://es.stayforlong.com/img/award-2024.png';
const briefSinHeroConImagenes: ProductBrief = makeBrief({
  assets: {
    hero_image_url: null,
    images: [
      {
        url: AWARD,
        kind: 'chart_or_text',
        has_overlay_text: true,
        background: 'clean',
        video_suitability: 'unusable',
      },
      {
        url: BANNER,
        kind: 'lifestyle',
        has_overlay_text: true,
        background: 'busy',
        video_suitability: 'broll',
      },
    ],
    video_urls: [],
  },
});

/** El mensaje que emite el validador cuando SÍ hay imágenes que promover (T1.15). */
const needsImagesConCandidatas: BriefWarning = {
  code: 'needs_user_decision',
  reason: 'missing_hero_image',
  message:
    'No hay una imagen de producto clara: elige una de las imágenes de la página como principal, ' +
    'sube tus propias fotos, o genera un packshot con IA.',
};

describe('BriefEditor (CP1)', () => {
  test('los campos extraídos muestran su badge y SU CITA; los inferidos, solo el badge', async () => {
    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[]} />);

    // El badge de procedencia (Apéndice A: extractivo ⇒ `evidence`; inferencial ⇒ sin cita).
    expect(screen.getAllByText(/✓ extraído/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^inferido$/).length).toBeGreaterThan(0);

    // LA CITA, VISIBLE (no un tooltip): la Verificación pide que el badge extraído «muestre su
    // evidence» en el editor, y un tooltip no es evidencia para quien no tiene ratón.
    expect(
      await screen.findByText(/Nuestras clientas notan la piel más luminosa/),
    ).toBeInTheDocument();
  });

  test('el rail de trazabilidad cuenta extraídos e inferidos', () => {
    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[]} />);
    const rail = screen.getByLabelText('Trazabilidad');
    // 1 pain point con cita + los features del brief canónico que la tengan.
    expect(within(rail).getByText('Extraído')).toBeInTheDocument();
    expect(within(rail).getByText('Inferido')).toBeInTheDocument();
    expect(within(rail).getByText('Editado por ti')).toBeInTheDocument();
  });

  test('editar un beneficio y guardar manda el brief EDITADO al checkpoint (no el de la IA)', async () => {
    const user = userEvent.setup();
    let payload: unknown;
    server.use(
      http.post(`*/api/steps/${STEP_ID}/edit`, async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );

    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[]} />);

    const primerBeneficio = screen.getByLabelText('Beneficio 1');
    await user.clear(primerBeneficio);
    await user.type(primerBeneficio, 'Piel luminosa en 7 días');

    await user.click(screen.getByRole('button', { name: /guardar cambios y continuar/i }));

    await waitFor(() => {
      expect(payload).toBeDefined();
    });
    // El servidor recibe el brief COMPLETO editado (de ahí sale la versión v2, con
    // `edited_by_user:true`): el linaje IA→humano vive en la fila, no en un diff.
    const body = payload as { brief: ProductBrief };
    expect(body.brief.benefits[0]?.benefit).toBe('Piel luminosa en 7 días');
    // Y el resto del brief viaja intacto (no se manda un patch parcial).
    expect(body.brief.product.name).toBe(brief.product.name);
  });

  test('editar un HOOK y guardar lo manda editado (la Verificación edita un hook en CP1)', async () => {
    const user = userEvent.setup();
    let payload: unknown;
    server.use(
      http.post(`*/api/steps/${STEP_ID}/edit`, async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );

    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[]} />);

    // El accessible name lleva el ÁNGULO: hay 5–10 ángulos y todos tienen un «Hook 1»; sin el
    // nombre del ángulo, ni un lector de pantalla ni este test podrían decir cuál es cuál.
    const hook = screen.getByLabelText(`Hook 1 de ${brief.angles[0]?.name ?? ''}`);
    await user.clear(hook);
    await user.type(hook, 'Tu piel al despertar');

    await user.click(screen.getByRole('button', { name: /guardar cambios y continuar/i }));

    await waitFor(() => {
      expect(payload).toBeDefined();
    });
    const body = payload as { brief: ProductBrief };
    expect(body.brief.angles[0]?.hook_examples[0]).toBe('Tu piel al despertar');
  });

  test('aprobar SIN editar llama a /approve (no crea versión: no hubo edición humana)', async () => {
    const user = userEvent.setup();
    let approved = false;
    server.use(
      http.post(`*/api/steps/${STEP_ID}/approve`, () => {
        approved = true;
        return HttpResponse.json({ ok: true });
      }),
    );

    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[]} />);
    await user.click(screen.getByRole('button', { name: /aprobar y continuar/i }));

    await waitFor(() => {
      expect(approved).toBe(true);
    });
  });

  test('modo manual sin imágenes: la petición BLOQUEANTE aparece y deshabilita Aprobar', async () => {
    const user = userEvent.setup();
    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[needsImages]} />);

    // LA CLÁUSULA DE LA VERIFICACIÓN: se ve la petición de imágenes CON su derivación a
    // packshot-IA (el mensaje accionable que escribe el validador de T1.9).
    expect(
      screen.getByText(/sube al menos una foto o elige generar un packshot con IA/i),
    ).toBeInTheDocument();

    // Y BLOQUEA de verdad: no se puede aprobar sin decidir.
    expect(screen.getByRole('button', { name: /aprobar y continuar/i })).toBeDisabled();

    // La derivación a packshot-IA es una de las dos salidas (la otra: subir fotos).
    await user.click(screen.getByRole('button', { name: /generar packshot con ia/i }));

    // Resuelta la decisión, se desbloquea.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /aprobar y continuar/i })).toBeEnabled();
    });
  });

  // ── T1.11 · LA DECISIÓN SALE DEL CLIENTE ────────────────────────────────────────────────
  // Hasta T1.11 la `ImageDecision` era `useState` local: habilitaba el botón y SE EVAPORABA (no
  // viajaba a ningún endpoint). Su consumidor real —N7a (T4.4), que decide si genera un
  // packshot-IA o usa fotos reales— no habría tenido NADA que leer. Estos dos tests son la
  // regresión de que la decisión viaja, por los DOS caminos que el usuario puede tomar.

  test('T1.11 · aprobar con la decisión de packshot-IA la MANDA en el body de /approve', async () => {
    const user = userEvent.setup();
    let payload: unknown;
    server.use(
      http.post(`*/api/steps/${STEP_ID}/approve`, async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );

    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[needsImages]} />);
    await user.click(screen.getByRole('button', { name: /generar packshot con ia/i }));
    await user.click(screen.getByRole('button', { name: /aprobar y continuar/i }));

    await waitFor(() => {
      expect(payload).toBeDefined();
    });
    // El canal GENÉRICO: `kind` discrimina el checkpoint (CP2/CP3/CP4 mandarán el suyo), y la
    // decisión concreta va dentro. NO es un campo del brief: viaja aparte del artefacto.
    expect(payload).toEqual({ decision: { kind: 'brief', images: 'ai_packshot' } });
  });

  test('T1.11 · guardar (editar) con decisión: el body lleva el brief EDITADO **y** la decisión', async () => {
    // El camino que se pierde si la decisión solo montara en `/approve`: el usuario del modo
    // manual elige packshot-IA Y ADEMÁS corrige un hook antes de guardar.
    const user = userEvent.setup();
    let payload: unknown;
    server.use(
      http.post(`*/api/steps/${STEP_ID}/edit`, async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );

    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[needsImages]} />);
    await user.click(screen.getByRole('button', { name: /subir imágenes del producto/i }));

    const primerBeneficio = screen.getByLabelText('Beneficio 1');
    await user.clear(primerBeneficio);
    await user.type(primerBeneficio, 'Piel luminosa en 7 días');
    await user.click(screen.getByRole('button', { name: /guardar cambios y continuar/i }));

    await waitFor(() => {
      expect(payload).toBeDefined();
    });
    const body = payload as { brief: ProductBrief; decision: unknown };
    expect(body.decision).toEqual({ kind: 'brief', images: 'upload_images' });
    expect(body.brief.benefits[0]?.benefit).toBe('Piel luminosa en 7 días');
  });

  test('T1.11 · sin decisión pendiente (rama URL), el approve NO manda decisión', async () => {
    // La otra mitad de la Verificación: aprobar sin decisión sigue funcionando igual. Un `{}` y
    // no un `{decision: null}`: el servidor distingue "no decidió" de "decidió nada".
    const user = userEvent.setup();
    let payload: unknown;
    server.use(
      http.post(`*/api/steps/${STEP_ID}/approve`, async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );

    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[]} />);
    await user.click(screen.getByRole('button', { name: /aprobar y continuar/i }));

    await waitFor(() => {
      expect(payload).toBeDefined();
    });
    expect(payload).toEqual({});
  });

  // ── T1.15 · LA TERCERA SALIDA: PROMOVER UNA IMAGEN SCRAPEADA A HERO ──────────────────────
  // El caso stayforlong: una web de servicio, sin packshot, cuyas 3 imágenes Haiku clasificó
  // honestamente como `broll`/`unusable`. Hasta T1.15 el run MORÍA en N3 (warning bloqueante) con
  // la síntesis de Sonnet ya pagada. Ahora llega a CP1 — y el usuario, que sí sabe cuál de esas
  // imágenes sirve, puede decirlo.

  test('T1.15 · rama URL sin hero: CP1 pide la decisión y ofrece las imágenes de la página', async () => {
    const user = userEvent.setup();
    render(
      <BriefEditor
        stepId={STEP_ID}
        briefId={BRIEF_ID}
        brief={briefSinHeroConImagenes}
        warnings={[needsImagesConCandidatas]}
      />,
    );

    // La petición de decisión (la misma que el modo manual: es el mismo warning tipado).
    expect(screen.getByText(/elige una de las imágenes de la página/i)).toBeInTheDocument();
    // Y BLOQUEA hasta que se decida.
    const aprobar = screen.getByRole('button', { name: /aprobar y continuar/i });
    expect(aprobar).toBeDisabled();

    // LAS TRES SALIDAS, con la nueva: una candidata por cada imagen que el scrape trajo,
    // incluidas las que N2 descartó (son las únicas que hay).
    expect(
      screen.getByRole('button', { name: /subir imágenes del producto/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generar packshot con ia/i })).toBeInTheDocument();
    // Se OFRECEN las dos que el scrape trajo. Desde T1.18 el botón de cada una solo se llama
    // «Usar como imagen principal» CUANDO el proxy ha confirmado que se puede descargar, así que
    // las candidatas se cuentan por su slot (que es lo que la galería pinta) y su promovibilidad
    // se espera aparte.
    expect(document.querySelectorAll('[data-slot="hero-candidate"]')).toHaveLength(2);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /usar como imagen principal/i })).toHaveLength(
        2,
      );
    });

    // Elegir una desbloquea la aprobación.
    // `findBy`: el botón solo lleva ese nombre CUANDO el proxy ya ha confirmado que la imagen se
    // puede descargar (T1.18). Mientras comprueba, se llama «Comprobando si se puede descargar» y
    // está deshabilitado — no se puede promover lo que aún no se sabe si el sistema puede usar.
    await user.click(
      await screen.findByRole('button', { name: `Usar como imagen principal: ${BANNER}` }),
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /aprobar y continuar/i })).toBeEnabled();
    });
  });

  test('T1.15 · promover una imagen: la DECISIÓN viaja Y el brief aprobado tiene ESA imagen de hero', async () => {
    // LA CLÁUSULA que la Verificación observa. Son DOS efectos por DOS canales, y ninguno vale sin
    // el otro: la decisión (`checkpoint_decision`, para N7a en T4.4) y el ARTEFACTO (el brief
    // versionado, cuyo `hero_image_url` es lo que lee el resto del pipeline). Por eso la promoción
    // sale por `/edit` (versión v2) y no por `/approve` —que, por definición, no toca el brief—:
    // aprobar por el otro camino habría persistido la decisión y dejado el brief SIN hero.
    const user = userEvent.setup();
    let payload: unknown;
    server.use(
      http.post(`*/api/steps/${STEP_ID}/edit`, async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );

    render(
      <BriefEditor
        stepId={STEP_ID}
        briefId={BRIEF_ID}
        brief={briefSinHeroConImagenes}
        warnings={[needsImagesConCandidatas]}
      />,
    );

    // `findBy`: el botón solo lleva ese nombre CUANDO el proxy ya ha confirmado que la imagen se
    // puede descargar (T1.18). Mientras comprueba, se llama «Comprobando si se puede descargar» y
    // está deshabilitado — no se puede promover lo que aún no se sabe si el sistema puede usar.
    await user.click(
      await screen.findByRole('button', { name: `Usar como imagen principal: ${BANNER}` }),
    );
    await user.click(screen.getByRole('button', { name: /aprobar y continuar/i }));

    await waitFor(() => {
      expect(payload).toBeDefined();
    });
    const body = payload as { brief: ProductBrief; decision: unknown };
    // 1) LA DECISIÓN, en el canal genérico de T1.11 (con la imagen elegida: el contrato la exige).
    expect(body.decision).toEqual({
      kind: 'brief',
      images: 'promote_scraped',
      hero_image_url: BANNER,
    });
    // 2) EL ARTEFACTO: el brief que se versiona YA lleva esa imagen como hero.
    expect(body.brief.assets.hero_image_url).toBe(BANNER);
    // El resto del brief viaja intacto (promover no reescribe nada más).
    expect(body.brief.assets.images).toHaveLength(2);
    expect(body.brief.product.name).toBe(briefSinHeroConImagenes.product.name);
  });

  test('T1.15 · promover Y ADEMÁS editar un hook: se guardan las dos cosas', async () => {
    // El camino mixto: el usuario elige la imagen del banner y de paso corrige el copy. La
    // promoción no puede pisar la edición ni al revés (van al mismo `/edit`).
    const user = userEvent.setup();
    let payload: unknown;
    server.use(
      http.post(`*/api/steps/${STEP_ID}/edit`, async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );

    render(
      <BriefEditor
        stepId={STEP_ID}
        briefId={BRIEF_ID}
        brief={briefSinHeroConImagenes}
        warnings={[needsImagesConCandidatas]}
      />,
    );

    // `findBy`: el botón solo lleva ese nombre CUANDO el proxy ya ha confirmado que la imagen se
    // puede descargar (T1.18). Mientras comprueba, se llama «Comprobando si se puede descargar» y
    // está deshabilitado — no se puede promover lo que aún no se sabe si el sistema puede usar.
    await user.click(
      await screen.findByRole('button', { name: `Usar como imagen principal: ${BANNER}` }),
    );
    const hook = screen.getByLabelText(
      `Hook 1 de ${briefSinHeroConImagenes.angles[0]?.name ?? ''}`,
    );
    await user.clear(hook);
    await user.type(hook, 'Hoteles a mitad de precio');
    await user.click(screen.getByRole('button', { name: /guardar cambios y continuar/i }));

    await waitFor(() => {
      expect(payload).toBeDefined();
    });
    const body = payload as { brief: ProductBrief; decision: unknown };
    expect(body.brief.assets.hero_image_url).toBe(BANNER);
    expect(body.brief.angles[0]?.hook_examples[0]).toBe('Hoteles a mitad de precio');
    expect(body.decision).toEqual({
      kind: 'brief',
      images: 'promote_scraped',
      hero_image_url: BANNER,
    });
  });

  test('T1.15 · cambiar de idea tras promover: la promoción se DESHACE (ni hero ni campo dirty)', async () => {
    // El usuario promueve el banner y luego se arrepiente: elige packshot-IA. Si la promoción no
    // se deshiciera, el `assets.hero_image_url` del form seguiría apuntando al banner y el rail
    // contaría un campo «editado por ti» por una elección que ya no edita nada — un estado de UI
    // que no se corresponde con lo que se va a guardar (`/approve` ignora el form). Y si el
    // usuario acabara GUARDANDO, el brief v2 llevaría un hero que él ya había descartado.
    const user = userEvent.setup();
    let payload: unknown;
    server.use(
      http.post(`*/api/steps/${STEP_ID}/edit`, async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );

    render(
      <BriefEditor
        stepId={STEP_ID}
        briefId={BRIEF_ID}
        brief={briefSinHeroConImagenes}
        warnings={[needsImagesConCandidatas]}
      />,
    );

    const rail = screen.getByLabelText('Trazabilidad');
    // `findBy`: el botón solo lleva ese nombre CUANDO el proxy ya ha confirmado que la imagen se
    // puede descargar (T1.18). Mientras comprueba, se llama «Comprobando si se puede descargar» y
    // está deshabilitado — no se puede promover lo que aún no se sabe si el sistema puede usar.
    await user.click(
      await screen.findByRole('button', { name: `Usar como imagen principal: ${BANNER}` }),
    );
    // Promover ES una edición del brief: el rail lo cuenta.
    await waitFor(() => {
      expect(within(rail).getByText('Editado por ti').parentElement).toHaveTextContent('1');
    });

    await user.click(screen.getByRole('button', { name: /generar packshot con ia/i }));
    // Y al cambiar de idea, deja de contarlo: el campo vuelve a su valor original.
    await waitFor(() => {
      expect(within(rail).getByText('Editado por ti').parentElement).toHaveTextContent('0');
    });

    await user.click(screen.getByRole('button', { name: /guardar cambios y continuar/i }));
    await waitFor(() => {
      expect(payload).toBeDefined();
    });
    const body = payload as { brief: ProductBrief; decision: unknown };
    // La decisión es la ÚLTIMA (packshot-IA), y sin imagen (el contrato lo exige).
    expect(body.decision).toEqual({ kind: 'brief', images: 'ai_packshot' });
    // Y el brief NO lleva el hero que se descartó: vuelve al de la IA (null).
    expect(body.brief.assets.hero_image_url).toBeNull();
  });

  // ── T1.18 · UNA CANDIDATA QUE NO SE PUEDE DESCARGAR NO SE OFRECE ─────────────────────────
  // El caso REAL: de las 2 candidatas de es.stayforlong.com, la de `/_next/image?url=…` devuelve
  // 403 a cualquier fetch de fuera de su web. Hasta T1.18 su miniatura se veía ROTA y —lo grave—
  // SEGUÍA SIENDO PROMOVIBLE: elegirla persistía decisión + brief v2 con un hero que nadie podría
  // descargar, y quien lo descubría era N7a (F4) PAGANDO fal.ai.

  test('T1.18 · la candidata que el servidor NO puede descargar no es promovible (y dice por qué)', async () => {
    const user = userEvent.setup();
    // El proxy: sirve el banner y NIEGA el award (403, como el CDN real). El fixture tiene una
    // URL que de verdad no se puede bajar y otra que sí — principio 9.
    server.use(
      http.get('*/api/thumbnails', ({ request }) => {
        const target = new URL(request.url).searchParams.get('url');
        if (target === AWARD) return new HttpResponse(null, { status: 403 });
        return HttpResponse.arrayBuffer(THUMBNAIL_BYTES.slice().buffer, {
          headers: { 'content-type': 'image/png' },
        });
      }),
    );

    render(
      <BriefEditor
        stepId={STEP_ID}
        briefId={BRIEF_ID}
        brief={briefSinHeroConImagenes}
        warnings={[needsImagesConCandidatas]}
      />,
    );

    // LA CLÁUSULA: la que no se puede bajar NO se ofrece como promovible, y el MOTIVO viaja en el
    // nombre accesible (no solo en un `title`, que no llega ni a teclado ni a lector de pantalla).
    const award = await screen.findByRole('button', {
      name: `No se puede usar (el servidor no puede descargarla): ${AWARD}`,
    });
    expect(award).toBeDisabled();
    // Y la candidata sigue VISIBLE (con su ficha), marcada como inservible: la galería no miente
    // ni por omisión — el usuario ve que esa imagen existe y por qué no puede usarla.
    const ficha = document.querySelector(`[data-url="${AWARD}"]`);
    expect(ficha).toHaveAttribute('data-usable', 'false');

    // LA OTRA MITAD: la que sí se puede bajar sigue funcionando y completa la decisión.
    await user.click(
      await screen.findByRole('button', { name: `Usar como imagen principal: ${BANNER}` }),
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /aprobar y continuar/i })).toBeEnabled();
    });
  });

  test('T1.15 · modo manual (sin imágenes): NO se ofrece promover lo que no existe', () => {
    // `brief` es el canónico CON hero; el que importa aquí es el de manual, sin imágenes.
    const manual = makeBrief({
      assets: { hero_image_url: null, images: [], video_urls: [] },
    });
    render(<BriefEditor stepId={STEP_ID} brief={manual} warnings={[needsImages]} />);

    expect(screen.queryByRole('button', { name: /usar como imagen principal/i })).toBeNull();
    // Las otras dos salidas siguen ahí (y siguen bloqueando hasta que se elija una).
    expect(screen.getByRole('button', { name: /generar packshot con ia/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /aprobar y continuar/i })).toBeDisabled();
  });

  test('un hook demasiado largo se AVISA pero NO bloquea (los hooks reales de Sonnet se pasan)', () => {
    const hookTooLong: BriefWarning = {
      code: 'hook_too_long',
      angleIndex: 0,
      angleName: brief.angles[0]?.name ?? 'Ángulo',
      hookIndex: 0,
      hook: 'Llevo tres semanas usando este sérum cada mañana y mi piel ya no se apaga',
      wordCount: 14,
    };
    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[hookTooLong]} />);

    expect(screen.getByText(/hook demasiado largo/i)).toBeInTheDocument();
    // NO bloquea: si lo hiciera, CP1 estaría bloqueado en casi cualquier análisis real.
    expect(screen.getByRole('button', { name: /aprobar y continuar/i })).toBeEnabled();
  });

  // T2.7 — CP1 es el suelo honesto: si la web sirvió OTRA página, el usuario lo VE aquí (y no
  // enterándose tres pasos después de que su anuncio habla de otro producto).
  test('una redirección significativa se MUESTRA con las dos URLs y NO bloquea la aprobación', () => {
    const redirected: BriefWarning = {
      code: 'url_redirected',
      reason: 'path_to_root',
      requested: 'https://www.dr-squatch.com/products/pine-tar-bar-soap',
      final: 'https://www.dr-squatch.com',
    };
    render(<BriefEditor stepId={STEP_ID} brief={brief} warnings={[redirected]} />);

    expect(screen.getByText(/se analizó otra página/i)).toBeInTheDocument();
    // Las DOS URLs, visibles (el aviso sin ellas no le sirve a nadie).
    expect(screen.getByText(/dr-squatch\.com\/products\/pine-tar-bar-soap/)).toBeInTheDocument();
    // AVISA, no bloquea (precedente T1.15): el humano decide.
    expect(screen.getByRole('button', { name: /aprobar y continuar/i })).toBeEnabled();
  });
});
