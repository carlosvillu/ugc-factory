// La lógica de warnings de CP1 (T1.10b), probada como función PURA — sin DOM.
//
// LO QUE FIJA (y por qué importa): que la petición de imágenes BLOQUEA la aprobación hasta que el
// usuario decide — y que «promover una imagen scrapeada» (T1.15) SIN elegir cuál es un estado que
// NO SE PUEDE ESCRIBIR: lo impide el tipo (`ChosenImageDecision`), no un acuerdo en runtime entre
// `canApprove` y `toBriefDecision`. La primera versión de T1.15 sí lo repartía entre las dos
// funciones (una fabricaba `hero_image_url: ''` y la otra evitaba que se enviara) — el patrón de
// los dos canales que este proyecto ya se ha comido varias veces, y que aquí acaba en un 400.
import { describe, expect, it } from 'vitest';
import { CheckpointDecisionSchema, type BriefWarning } from '@ugc/core/contracts';
import {
  canApprove,
  requiresUserDecision,
  toBriefDecision,
  toWarningView,
  type ChosenImageDecision,
} from './brief-warnings';

const needsDecision: BriefWarning = {
  code: 'needs_user_decision',
  reason: 'missing_hero_image',
  message: 'No hay imagen de producto: sube al menos una foto o elige generar un packshot con IA.',
};

const hookTooLong: BriefWarning = {
  code: 'hook_too_long',
  angleIndex: 0,
  angleName: 'POV: tu piel al despertar',
  hookIndex: 0,
  hook: 'Llevo tres semanas usando este sérum cada mañana y mi piel ya no se apaga',
  wordCount: 14,
};

const priceMismatch: BriefWarning = {
  code: 'price_mismatch',
  synthesized: '39,90 €',
  fastPath: '34,90 €',
};

describe('requiresUserDecision', () => {
  it('`needs_user_decision` EXIGE decisión: es la petición bloqueante de imágenes del modo manual', () => {
    expect(requiresUserDecision(needsDecision)).toBe(true);
  });

  it('`hook_too_long` NO exige decisión (y no es un descuido)', () => {
    // Los hooks auténticos de Sonnet 5 se pasan del techo con frecuencia (8 casos en briefs
    // reales de T1.9). Si bloqueara, CP1 estaría bloqueado en casi cualquier análisis real.
    expect(requiresUserDecision(hookTooLong)).toBe(false);
  });

  it('`price_mismatch` NO exige decisión: el validador ya corrigió el precio', () => {
    expect(requiresUserDecision(priceMismatch)).toBe(false);
  });
});

describe('canApprove', () => {
  it('sin warnings, se puede aprobar', () => {
    expect(canApprove([], null)).toBe(true);
  });

  it('con warnings NO bloqueantes, se puede aprobar sin decidir nada', () => {
    expect(canApprove([hookTooLong, priceMismatch], null)).toBe(true);
  });

  it('con la petición de imágenes SIN resolver, NO se puede aprobar', () => {
    // LA CLÁUSULA DE LA VERIFICACIÓN: un análisis manual sin imágenes muestra en CP1 la
    // petición bloqueante — y bloquea de verdad hasta que el usuario elige.
    expect(canApprove([needsDecision], null)).toBe(false);
  });

  it('resuelta con «subir imágenes», se desbloquea', () => {
    expect(canApprove([needsDecision], { images: 'upload_images' })).toBe(true);
  });

  it('resuelta con «packshot IA» (la derivación a N7a), se desbloquea', () => {
    expect(canApprove([needsDecision], { images: 'ai_packshot' })).toBe(true);
  });

  // ── T1.15 · la TERCERA salida: promover una imagen scrapeada ────────────────────────────
  it('«promover una imagen scrapeada» CON imagen elegida desbloquea', () => {
    expect(
      canApprove([needsDecision], {
        images: 'promote_scraped',
        heroUrl: 'https://es.stayforlong.com/img/banner.jpg',
      }),
    ).toBe(true);
  });

  it('«promover» SIN imagen elegida NO COMPILA: el estado inválido no se puede escribir', () => {
    // ESTE ES EL TEST, y su aserción es el `@ts-expect-error` — no hay `expect()` porque el
    // caso ya no existe en tiempo de ejecución: el invariante «promover exige URL» (que el
    // contrato de core impone con un refine, y que el servidor haría cumplir con un 400) NO
    // depende de que `canApprove` y `toBriefDecision` se pongan de acuerdo. Lo impone el TIPO.
    //
    // La barrera se avisa a sí misma: si alguien relaja `ChosenImageDecision` a
    // `{images, heroUrl?: string}`, esta línea deja de dar error y la compilación FALLA (un
    // `@ts-expect-error` que no expecta ningún error es, él mismo, un error).
    // @ts-expect-error -- `promote_scraped` EXIGE `heroUrl`: sin ella no hay decisión que construir.
    const imposible: ChosenImageDecision = { images: 'promote_scraped' };
    void imposible;

    // Y sin decisión imposible que vigilar, `canApprove` tiene UN solo criterio: ¿hay elección?
    expect(
      canApprove([needsDecision], { images: 'promote_scraped', heroUrl: 'https://x.dev/a.jpg' }),
    ).toBe(true);
  });
});

describe('toBriefDecision (el canal genérico de T1.11)', () => {
  it('las salidas sin imagen NO llevan `hero_image_url` (el contrato lo prohíbe)', () => {
    expect(toBriefDecision({ images: 'ai_packshot' })).toEqual({
      kind: 'brief',
      images: 'ai_packshot',
    });
    expect(toBriefDecision({ images: 'upload_images' })).toEqual({
      kind: 'brief',
      images: 'upload_images',
    });
  });

  it('`promote_scraped` lleva la imagen elegida', () => {
    expect(
      toBriefDecision({
        images: 'promote_scraped',
        heroUrl: 'https://es.stayforlong.com/img/banner.jpg',
      }),
    ).toEqual({
      kind: 'brief',
      images: 'promote_scraped',
      hero_image_url: 'https://es.stayforlong.com/img/banner.jpg',
    });
  });

  it('lo que construye es SIEMPRE una decisión válida para el contrato de core', () => {
    // La garantía de punta a punta: `toBriefDecision` no puede fabricar la decisión que el
    // servidor rechaza (era el `hero_image_url: heroUrl ?? ''` de la primera versión de T1.15 —
    // una URL vacía que pasaba el `canApprove` de al lado y moría con un 400 `Invalid URL`).
    // Ahora el tipo no le deja: sin `heroUrl` no hay input que darle. Se comprueba contra el
    // MISMO schema que valida el route handler, no contra una copia.
    for (const chosen of [
      { images: 'upload_images' },
      { images: 'ai_packshot' },
      { images: 'promote_scraped', heroUrl: 'https://es.stayforlong.com/img/banner.jpg' },
    ] as const) {
      expect(CheckpointDecisionSchema.safeParse(toBriefDecision(chosen)).success).toBe(true);
    }
  });
});

describe('toWarningView', () => {
  it('la petición de imágenes muestra el mensaje ACCIONABLE del validador (con las dos salidas)', () => {
    const view = toWarningView(needsDecision);
    expect(view.requiresDecision).toBe(true);
    // El mensaje viene del servidor TAL CUAL (T1.9 lo escribe accionable); no se reescribe aquí.
    expect(view.detail).toBe(needsDecision.message);
    expect(view.detail).toContain('packshot');
  });

  it('el hook largo se muestra con su texto y su recuento (el usuario lo reescribe en el editor)', () => {
    const view = toWarningView(hookTooLong);
    expect(view.detail).toContain(hookTooLong.hook);
    expect(view.detail).toContain('14 palabras');
    expect(view.requiresDecision).toBe(false);
  });

  it('el precio corregido explica QUÉ se descartó y QUÉ ganó (el cross-check N1==N3)', () => {
    const view = toWarningView(priceMismatch);
    expect(view.detail).toContain('39,90 €'); // lo que propuso la IA (descartado)
    expect(view.detail).toContain('34,90 €'); // el de la página (ganó)
  });
});

// ── T2.7 · «se analizó otra página» en CP1 ───────────────────────────────────
describe('url_redirected (T2.7) — el aviso que convierte un fallo tragado en un hecho visible', () => {
  const redirected: BriefWarning = {
    code: 'url_redirected',
    reason: 'path_to_root',
    requested: 'https://www.dr-squatch.com/products/pine-tar-bar-soap',
    final: 'https://www.dr-squatch.com',
  };

  it('el copy muestra LAS DOS URLs (la pedida y la analizada): sin ellas el aviso no sirve', () => {
    const view = toWarningView(redirected);
    expect(view.detail).toContain('https://www.dr-squatch.com/products/pine-tar-bar-soap');
    expect(view.detail).toContain('https://www.dr-squatch.com');
    expect(view.tone).toBe('warning');
  });

  it('AVISA, NO BLOQUEA (precedente T1.15): no exige decisión y deja aprobar', () => {
    expect(toWarningView(redirected).requiresDecision).toBe(false);
    expect(requiresUserDecision(redirected)).toBe(false);
    expect(canApprove([redirected], null)).toBe(true);
  });

  it('la CATEGORÍA no se describe como «portada» (el copy sigue al `reason`, no lo aplana)', () => {
    const view = toWarningView({
      code: 'url_redirected',
      reason: 'path_diverged',
      requested: 'https://www.dr-squatch.com/products/pine-tar-bar-soap',
      final: 'https://www.dr-squatch.com/collections/soaps',
    });
    expect(view.detail).toContain('otra sección');
    expect(view.detail).not.toContain('portada'); // decirle «portada» a quien acabó en la categoría sería mentirle.
  });

  it('el cambio de HOST se explica como tal (es otro dominio, no un producto retirado)', () => {
    const view = toWarningView({
      code: 'url_redirected',
      reason: 'host_changed',
      requested: 'https://glow.example/products/serum',
      final: 'https://otro-sitio.com/landing',
    });
    expect(view.detail).toContain('otro dominio');
  });
});
