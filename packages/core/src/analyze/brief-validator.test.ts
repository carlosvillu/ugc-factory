// Tests del BriefValidator (T1.9, PRD §9.2; testing/unit-core.md §5). Cada código de warning
// tiene un caso que lo dispara y, para cada perfil, se fija que las reglas AJENAS no se
// disparan — la diferencia entre perfiles es exactamente lo que un refactor descuidado rompe.
// Las cláusulas deterministas de la Verificación de T1.9 quedan aquí como test permanente
// (regla de trabajo 8): precio discrepante → warning tipado + gana el fast path; manual sin
// hero → `needs_user_decision: missing_hero_image`, brief VÁLIDO y el paso NO falla.
import { describe, expect, it } from 'vitest';
import { makeBrief, makeRawContent } from '@ugc/test-utils';
import { ProductBriefSchema } from '../contracts/product-brief';
import { isBlockingWarning } from '../contracts/brief-warning';
import { validateBrief, parsePriceValue, MAX_HOOK_WORDS } from './brief-validator';

/** Brief sin hero image: `hero_image_url` a null Y sin imágenes (el override de `makeBrief` es
 *  SHALLOW — hay que dar el objeto `assets` entero o el hero canónico sobreviviría). */
const briefWithoutHero = () =>
  makeBrief({ assets: { hero_image_url: null, images: [], video_urls: [] } });

describe('parsePriceValue (normalización de los DOS idiomas del precio)', () => {
  it('lee el formato CRUDO del fast path real (String(amount) / string de la tienda)', () => {
    // Lo que emiten de verdad `mapProduct` de firecrawl y `priceToString` de los parsers.
    expect(parsePriceValue('34.9')).toBe(34.9);
    expect(parsePriceValue('34.90')).toBe(34.9);
    expect(parsePriceValue('110.00')).toBe(110);
    expect(parsePriceValue('29')).toBe(29);
  });

  it('lee el formato FORMATEADO del LLM (símbolo, coma decimal, millares)', () => {
    expect(parsePriceValue('34,90 €')).toBe(34.9);
    expect(parsePriceValue('€34.90')).toBe(34.9);
    expect(parsePriceValue('$29.99')).toBe(29.99);
    expect(parsePriceValue('1.234,56 €')).toBe(1234.56); // es-ES
    expect(parsePriceValue('1,234.56 USD')).toBe(1234.56); // en-US
    expect(parsePriceValue('1,299')).toBe(1299); // 3 decimales tras la coma ⇒ millares
  });

  it('null cuando no hay número que leer (no se puede afirmar que discrepen)', () => {
    expect(parsePriceValue(null)).toBeNull();
    expect(parsePriceValue(undefined)).toBeNull();
    expect(parsePriceValue('')).toBeNull();
    expect(parsePriceValue('consultar precio')).toBeNull();
  });
});

describe('BriefValidator · cross-check de precio N1==N3 (§9.2)', () => {
  it('REGRESIÓN: mismo precio en los dos FORMATOS reales ("34.90" vs "34,90 €") → SIN warning', () => {
    // El bug que este test caza: N1 emite el número crudo y N3 el formateado. Comparados como
    // strings, `"34,90 €" !== "34.90"` SIEMPRE ⇒ cada análisis por URL habría emitido un
    // price_mismatch espurio y sobrescrito el brief con el número desnudo de Firecrawl.
    const raw = makeRawContent(); // product.price = '34.90' (formato REAL del fast path)
    const brief = makeBrief(); // pricing.price = '34,90 €' (formato REAL del LLM)

    const res = validateBrief(brief, { profile: 'url', rawContent: raw });

    expect(res.warnings).toEqual([]); // MISMO valor: no hay discrepancia
    expect(res.brief.pricing.price).toBe('34,90 €'); // se conserva el del LLM (más legible)
  });

  it('url: precio N1≠N3 de VERDAD → warning tipado price_mismatch y GANA el precio del fast path', () => {
    const raw = makeRawContent({
      product: { title: 'Sérum', price: '29.90', currency: 'EUR' }, // formato real de N1
    });
    const brief = makeBrief(); // pricing.price = '34,90 €' (el del LLM)

    const res = validateBrief(brief, { profile: 'url', rawContent: raw });

    expect(res.ok).toBe(true); // discrepancia de precio: se CORRIGE, no invalida el brief
    expect(res.warnings).toContainEqual({
      code: 'price_mismatch',
      synthesized: '34,90 €',
      fastPath: '29.90 EUR', // el VALOR del fast path, sin perder la moneda extraída
    });
    // Corrección determinista, no solo aviso: el dato extraído gana al inferido.
    expect(parsePriceValue(res.brief.pricing.price)).toBe(29.9);
    // El resto del pricing sobrevive intacto (solo se tocan `price`/`currency`).
    expect(res.brief.pricing.compare_at_price).toBe(brief.pricing.compare_at_price);
    expect(res.brief.pricing.positioning).toBe(brief.pricing.positioning);
    // PURA: la entrada no se muta.
    expect(brief.pricing.price).toBe('34,90 €');
  });

  it('url: el fast path SIN precio no dispara el check (una página sin JSON-LD es normal)', () => {
    const raw = makeRawContent({ product: { title: 'Sérum', price: null, currency: null } });
    const res = validateBrief(makeBrief(), { profile: 'url', rawContent: raw });

    expect(res.warnings.map((w) => w.code)).not.toContain('price_mismatch');
    expect(res.brief.pricing.price).toBe('34,90 €'); // se conserva el del LLM: no hay con qué cruzar
  });

  it('url: dato duro en N1 + N3 sin precio → el precio EXTRAÍDO entra (no se queda en null)', () => {
    const raw = makeRawContent({ product: { title: 'Sérum', price: '29.90', currency: 'EUR' } });
    const brief = makeBrief({
      pricing: {
        price: null, // el LLM no encontró el precio
        currency: null,
        compare_at_price: null,
        active_offer: null,
        guarantee: null,
        shipping: null,
        positioning: 'premium',
      },
    });

    const res = validateBrief(brief, { profile: 'url', rawContent: raw });

    // "Gana el fast path" también en el caso degenerado: con un JSON-LD válido delante, dejar
    // el brief en null sería tirar el único dato fiable.
    expect(parsePriceValue(res.brief.pricing.price)).toBe(29.9);
    expect(res.brief.pricing.currency).toBe('EUR');
    // No hay DOS valores que discrepen ⇒ no es un mismatch.
    expect(res.warnings.map((w) => w.code)).not.toContain('price_mismatch');
  });

  it('url: N3 con un precio ILEGIBLE ("consultar precio") → ni warning ni corrección a ciegas', () => {
    const raw = makeRawContent({ product: { title: 'Sérum', price: '29.90', currency: 'EUR' } });
    const brief = makeBrief({
      pricing: {
        price: 'consultar precio',
        currency: null,
        compare_at_price: null,
        active_offer: null,
        guarantee: null,
        shipping: null,
        positioning: 'premium',
      },
    });

    const res = validateBrief(brief, { profile: 'url', rawContent: raw });

    // No se puede AFIRMAR que discrepen: no se toca el brief y no se inventa un hallazgo.
    expect(res.warnings.map((w) => w.code)).not.toContain('price_mismatch');
    expect(res.brief.pricing.price).toBe('consultar precio');
  });

  it('manual: NUNCA emite price_mismatch (el cross-check de precio se OMITE, §9.2)', () => {
    // Aunque llegara un RawContent con precio DISTINTO, el perfil manual lo ignora por contrato.
    const raw = makeRawContent({
      source: 'manual',
      url: null,
      platform: 'manual',
      product: { price: '29.90', currency: 'EUR' },
    });
    const res = validateBrief(makeBrief(), { profile: 'manual', rawContent: raw });

    expect(res.warnings.map((w) => w.code)).not.toContain('price_mismatch');
    expect(res.brief.pricing.price).toBe('34,90 €'); // el del LLM se conserva
  });
});

describe('BriefValidator · hero image por perfil (§9.2)', () => {
  it('manual sin hero → needs_user_decision:missing_hero_image, brief VÁLIDO y el paso NO falla', () => {
    const brief = briefWithoutHero();
    expect(brief.assets.hero_image_url).toBeNull(); // el fixture dispara de verdad el check

    const res = validateBrief(brief, { profile: 'manual' });

    expect(res.ok).toBe(true); // decisión de CP1, NO error (§9.2)
    expect(res.warnings).toContainEqual(
      expect.objectContaining({ code: 'needs_user_decision', reason: 'missing_hero_image' }),
    );
    // El brief de salida sigue siendo un ProductBrief VÁLIDO (el paso no falla).
    expect(ProductBriefSchema.safeParse(res.brief).success).toBe(true);
  });

  it('url sin hero → missing_hero_image con ok=false (aquí SÍ es un problema real)', () => {
    const res = validateBrief(briefWithoutHero(), {
      profile: 'url',
      rawContent: makeRawContent(),
    });

    expect(res.ok).toBe(false);
    expect(res.warnings.map((w) => w.code)).toContain('missing_hero_image');
    // Y NO se disfraza de decisión de CP1: eso es exclusivo del perfil manual.
    expect(res.warnings.map((w) => w.code)).not.toContain('needs_user_decision');
  });

  it('url: hero ALUCINADO (URL fuera de assets.images) se trata como hero ausente', () => {
    // El LLM inventa una hero_image_url que no está en el set de imágenes reales. Sin este
    // check, N7a la usaría como frame inicial de image-to-video y gastaría dinero contra una
    // imagen inexistente. Mismo criterio de pertenencia que `suggested_assets`.
    const base = makeBrief();
    const brief = makeBrief({
      assets: {
        hero_image_url: 'https://cdn.example.com/inventada-por-el-llm.jpg',
        images: base.assets.images, // el set REAL no la contiene
        video_urls: [],
      },
    });

    const res = validateBrief(brief, { profile: 'url', rawContent: makeRawContent() });

    expect(res.ok).toBe(false);
    expect(res.warnings.map((w) => w.code)).toContain('missing_hero_image');
    // Y el puntero roto se PODA: no viaja aguas abajo.
    expect(res.brief.assets.hero_image_url).toBeNull();
    expect(brief.assets.hero_image_url).toBe('https://cdn.example.com/inventada-por-el-llm.jpg'); // PURA
  });

  it('manual: hero ALUCINADO → needs_user_decision (decisión de CP1, el paso NO falla)', () => {
    const base = makeBrief();
    const brief = makeBrief({
      assets: {
        hero_image_url: 'https://cdn.example.com/fantasma.jpg',
        images: base.assets.images,
        video_urls: [],
      },
    });

    const res = validateBrief(brief, { profile: 'manual' });

    expect(res.ok).toBe(true);
    expect(res.warnings).toContainEqual(
      expect.objectContaining({ code: 'needs_user_decision', reason: 'missing_hero_image' }),
    );
    expect(res.brief.assets.hero_image_url).toBeNull();
    expect(ProductBriefSchema.safeParse(res.brief).success).toBe(true);
  });

  it('con hero image: ninguno de los dos warnings, en ambos perfiles', () => {
    for (const profile of ['url', 'manual'] as const) {
      const res = validateBrief(makeBrief(), { profile, rawContent: makeRawContent() });
      const codes = res.warnings.map((w) => w.code);
      expect(codes).not.toContain('missing_hero_image');
      expect(codes).not.toContain('needs_user_decision');
      expect(res.ok).toBe(true);
    }
  });
});

describe('BriefValidator · suggested_assets ⊆ assets.images (§9.2)', () => {
  it('poda las URLs que no están en assets.images y emite pruned_suggested_asset', () => {
    const brief = makeBrief();
    const heroUrl = brief.assets.images[0]?.url ?? '';
    const dirty = {
      ...brief,
      angles: [
        {
          ...brief.angles[0]!,
          name: 'Ángulo sucio',
          suggested_assets: [heroUrl, 'https://cdn.example.com/no-existe.jpg'],
        },
        ...brief.angles.slice(1),
      ],
    };

    const res = validateBrief(dirty, { profile: 'url', rawContent: makeRawContent() });

    expect(res.brief.angles[0]?.suggested_assets).toEqual([heroUrl]); // la válida sobrevive
    expect(res.warnings).toContainEqual({
      code: 'pruned_suggested_asset',
      angleIndex: 0,
      angleName: 'Ángulo sucio',
      url: 'https://cdn.example.com/no-existe.jpg',
    });
    expect(res.ok).toBe(true); // se corrige, no invalida
    // PURA: el ángulo de entrada conserva su asset inválido.
    expect(dirty.angles[0]?.suggested_assets).toHaveLength(2);
  });

  it('la poda se aplica en el perfil manual igual que en url (no depende del origen)', () => {
    const brief = briefWithoutHero();
    const dirty = {
      ...brief,
      angles: [
        { ...brief.angles[0]!, suggested_assets: ['https://cdn.example.com/fantasma.jpg'] },
        ...brief.angles.slice(1),
      ],
    };

    const res = validateBrief(dirty, { profile: 'manual' });

    expect(res.brief.angles[0]?.suggested_assets).toEqual([]);
    expect(res.warnings.map((w) => w.code)).toContain('pruned_suggested_asset');
  });

  it('sin suggested_assets no hay poda ni warning', () => {
    const res = validateBrief(makeBrief(), { profile: 'url', rawContent: makeRawContent() });
    expect(res.warnings.map((w) => w.code)).not.toContain('pruned_suggested_asset');
  });
});

describe('BriefValidator · longitud de hooks (≤12 palabras)', () => {
  it('un hook de 13 palabras emite hook_too_long con el conteo y el techo', () => {
    const brief = makeBrief();
    const longHook = Array.from(
      { length: MAX_HOOK_WORDS + 1 },
      (_u, i) => `palabra${String(i)}`,
    ).join(' ');
    const dirty = {
      ...brief,
      angles: [
        { ...brief.angles[0]!, name: 'Ángulo largo', hook_examples: [longHook, 'Hook corto'] },
        ...brief.angles.slice(1),
      ],
    };

    const res = validateBrief(dirty, { profile: 'url', rawContent: makeRawContent() });

    expect(res.warnings).toContainEqual({
      code: 'hook_too_long',
      angleIndex: 0,
      angleName: 'Ángulo largo',
      hookIndex: 0,
      hook: longHook,
      wordCount: MAX_HOOK_WORDS + 1,
      // El techo NO viaja en el warning: es la constante `MAX_HOOK_WORDS`, no un dato del caso.
    });
    // AVISA, no reescribe: el copy lo arregla el usuario en CP1.
    expect(res.brief.angles[0]?.hook_examples[0]).toBe(longHook);
    expect(res.ok).toBe(true);
  });

  it('un hook de exactamente 12 palabras NO dispara el warning (el techo es inclusivo)', () => {
    const brief = makeBrief();
    const edgeHook = Array.from({ length: MAX_HOOK_WORDS }, (_u, i) => `p${String(i)}`).join(' ');
    const dirty = {
      ...brief,
      angles: [
        { ...brief.angles[0]!, hook_examples: [edgeHook, 'Otro hook'] },
        ...brief.angles.slice(1),
      ],
    };

    const res = validateBrief(dirty, { profile: 'url', rawContent: makeRawContent() });
    expect(res.warnings.map((w) => w.code)).not.toContain('hook_too_long');
  });
});

describe('BriefValidator · cardinalidades (§13.2)', () => {
  // Las cardinalidades (5–10 ángulos, 2–3 hooks…) las garantiza la capa Zod de T1.1, que es su
  // ÚNICA fuente de verdad (la API de Anthropic ignora los constraints de array). El validador
  // NO las re-implementa: recibe un ProductBrief ya parseado. Este test fija la frontera —
  // si alguien mueve las cardinalidades fuera de Zod, aquí se entera.
  it('el contrato Zod rechaza 4 ángulos (la red de seguridad NO está en el validador)', () => {
    const brief = makeBrief();
    const tooFew = { ...brief, angles: brief.angles.slice(0, 4) };
    expect(ProductBriefSchema.safeParse(tooFew).success).toBe(false);
  });

  it('el brief corregido sigue cumpliendo las cardinalidades (la corrección no las rompe)', () => {
    const brief = makeBrief();
    const dirty = {
      ...brief,
      angles: brief.angles.map((a) => ({
        ...a,
        suggested_assets: ['https://cdn.example.com/x.jpg'],
      })),
    };
    const res = validateBrief(dirty, { profile: 'url', rawContent: makeRawContent() });

    expect(res.warnings.filter((w) => w.code === 'pruned_suggested_asset')).toHaveLength(5);
    // Podar assets no elimina ángulos ni hooks: el brief de salida sigue siendo válido.
    expect(ProductBriefSchema.safeParse(res.brief).success).toBe(true);
    expect(res.brief.angles).toHaveLength(5);
  });
});

describe('BriefValidator · pureza del retorno (copia, no referencia)', () => {
  it('los ángulos SIN poda también se copian: mutar la salida NO toca la entrada', () => {
    // El brief limpio no dispara ninguna corrección: es justo el camino donde un `return angle`
    // por referencia habría dejado la salida compartiendo objetos con la entrada. El editor de
    // CP1 (T1.10b) manipula estos briefs — mutar la salida no puede alcanzar al caller.
    const brief = makeBrief();
    const res = validateBrief(brief, { profile: 'url', rawContent: makeRawContent() });

    expect(res.warnings).toEqual([]); // camino limpio, sin correcciones

    for (const [i, angle] of res.brief.angles.entries()) {
      expect(angle).not.toBe(brief.angles[i]); // objeto distinto
      expect(angle).toEqual(brief.angles[i]); // mismo contenido
    }

    // Mutación de la salida: hooks (array interno) y campos escalares.
    res.brief.angles[0]!.hook_examples.push('hook añadido por el consumidor');
    res.brief.angles[0]!.name = 'renombrado por el consumidor';

    expect(brief.angles[0]?.hook_examples).toHaveLength(2); // la entrada, INTACTA
    expect(brief.angles[0]?.name).toBe('Ángulo 1');
  });

  it('el array de suggested_assets de la salida no es el mismo objeto que el de la entrada', () => {
    const base = makeBrief();
    const heroUrl = base.assets.images[0]!.url;
    const brief = makeBrief({
      angles: base.angles.map((a) => ({ ...a, suggested_assets: [heroUrl] })),
    });

    const res = validateBrief(brief, { profile: 'url', rawContent: makeRawContent() });

    expect(res.warnings).toEqual([]); // nada que podar: todas las URLs son válidas
    expect(res.brief.angles[0]?.suggested_assets).not.toBe(brief.angles[0]?.suggested_assets);
    res.brief.angles[0]?.suggested_assets?.push('https://cdn.example.com/otra.jpg');
    expect(brief.angles[0]?.suggested_assets).toEqual([heroUrl]); // entrada intacta
  });
});

describe('BriefValidator · `ok` es DERIVADO de los warnings, no un canal paralelo', () => {
  // El invariante: la severidad viaja CON el warning (`isBlockingWarning`) y `ok` se deriva.
  // Cuando `ok` era un `let` acumulado aparte, había DOS canales para "el brief no sirve" que
  // podían divergir en silencio: bastaba olvidar un `ok = false` al añadir un código bloqueante
  // para que el paso aceptara un brief que revienta aguas abajo. Estos tests fijan la derivación.
  it.each([
    {
      nombre: 'url sin hero (bloqueante)',
      sinHero: true,
      profile: 'url' as const,
      esperado: false,
    },
    {
      nombre: 'manual sin hero (NO bloqueante: decisión de CP1)',
      sinHero: true,
      profile: 'manual' as const,
      esperado: true,
    },
    { nombre: 'brief limpio', sinHero: false, profile: 'url' as const, esperado: true },
  ])(
    'ok === false SI Y SOLO SI hay warning bloqueante — $nombre',
    ({ sinHero, profile, esperado }) => {
      const brief = sinHero ? briefWithoutHero() : makeBrief();

      const res = validateBrief(brief, { profile, rawContent: makeRawContent() });

      expect(res.ok).toBe(esperado);
      // Y la derivación se cumple: `ok` NO es un canal independiente de los warnings.
      expect(res.ok).toBe(!res.warnings.some(isBlockingWarning));
    },
  );

  it('los warnings NO bloqueantes (corrección, aviso, decisión de CP1) dejan ok=true', () => {
    // Un brief con las TRES clases de warning no bloqueante a la vez: precio discrepante
    // (corrige), asset fantasma (poda), hook largo (avisa). El brief sigue siendo válido.
    const brief = makeBrief();
    const dirty = {
      ...brief,
      angles: [
        {
          ...brief.angles[0]!,
          hook_examples: [
            Array.from({ length: MAX_HOOK_WORDS + 1 }, (_u, i) => `p${String(i)}`).join(' '),
            'Hook corto',
          ],
          suggested_assets: ['https://cdn.example.com/fantasma.jpg'],
        },
        ...brief.angles.slice(1),
      ],
    };
    const raw = makeRawContent({ product: { price: '19.90', currency: 'EUR' } });

    const res = validateBrief(dirty, { profile: 'url', rawContent: raw });

    expect(res.warnings.map((w) => w.code).sort()).toEqual([
      'hook_too_long',
      'price_mismatch',
      'pruned_suggested_asset',
    ]);
    expect(res.warnings.some(isBlockingWarning)).toBe(false);
    expect(res.ok).toBe(true); // ninguno invalida el brief (§9.2)
  });
});
