// Unit del COMPOSITOR DE MATRIZ (T2.2, N4). Determinista y puro: se llama y se mira la salida.
//
// La aritmética combinatoria (ángulos × hooks × idiomas) y la economía Hook×Body×CTA (qué
// segmentos se comparten) son la Entrega de la tarea; el coste lo cubre `cost.test.ts`.
import { describe, expect, it } from 'vitest';
import { makeAngle, makeBrief } from '@ugc/test-utils';
import { BatchPlanSchema } from '../contracts/batch-plan';
import { HOOK_LINE_SEEDS } from '../library/seed-data';
import type { MatchablePersona } from '../persona/contracts';
import { composeMatrix } from './matrix';
import { DURATION_PRESETS, MAX_EXPORT_SECONDS } from './presets';

// El brief de la Verificación: 5 ángulos (el mínimo del contrato), con `framework` de
// vocabulario de la librería para que los hooks de librería puedan casar por ángulo.
const BRIEF = makeBrief({
  angles: [
    makeAngle({ name: 'El dolor de la piel tirante', framework: 'pain_point' }),
    makeAngle({ name: 'Lo que nadie te cuenta', framework: 'curiosity' }),
    makeAngle({ name: 'Miles ya lo usan', framework: 'social_proof' }),
    makeAngle({ name: 'La fundadora lo cuenta', framework: 'founder_story' }),
    makeAngle({ name: 'Antes y después', framework: 'transformation' }),
  ],
});

// Personas: la del `avatar_hint` del brief («Creadora 30 años, estilo natural, baño luminoso»)
// y una incompatible. Filas planas (`MatchablePersona`), como las que da `@ugc/db`.
const LUCIA: MatchablePersona = {
  name: 'Lucía',
  ageRange: '25-34',
  gender: 'female',
  ethnicity: 'latina',
  style: 'natural',
  descriptor: 'creadora de 30 años, estilo natural',
};
const MARCUS: MatchablePersona = {
  name: 'Marcus',
  ageRange: '55-64',
  gender: 'male',
  ethnicity: 'black',
  style: 'elegante',
  descriptor: 'hombre de 60 años, elegante',
};
// (La SEGUNDA persona compatible —la que hace observable la rotación, y con ella el bug de dinero
// del review— vive en `cost.test.ts`, que es donde se mide su consecuencia: la dedup del body.)

const BASE = {
  brief: BRIEF,
  libraryHooks: HOOK_LINE_SEEDS,
  personas: [LUCIA, MARCUS],
  tier: 'standard' as const,
};

describe('composeMatrix — la aritmética de la matriz (§7.2 N4)', () => {
  // LA VERIFICACIÓN LITERAL DEL PLANNING: «2 ángulos × 3 hooks × 1 persona × es+en → 12 variantes».
  it('2 ángulos × 3 hooks × es+en = 12 variantes con filename_code únicos', () => {
    const plan = composeMatrix({
      ...BASE,
      angleCount: 2,
      hooksPerAngle: 3,
      languages: ['es', 'en'],
      objective: 'conversion',
    });

    expect(plan.variants).toHaveLength(12);
    expect(new Set(plan.variants.map((v) => v.filenameCode)).size).toBe(12);
    // El plan es un contrato: tiene que validar contra su schema Zod (§7.4).
    expect(BatchPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('es DETERMINISTA: la misma entrada da exactamente el mismo plan (§7.2 N4: $0, sin LLM)', () => {
    const input = {
      ...BASE,
      angleCount: 2,
      hooksPerAngle: 3,
      languages: ['es', 'en'],
      objective: 'conversion' as const,
    };
    expect(composeMatrix(input)).toEqual(composeMatrix(input));
  });

  it('los hooks salen del BRIEF primero y se completan con la LIBRERÍA (§7.2 N4)', () => {
    // `makeAngle` trae 2 `hook_examples`; pedir 3 obliga a tirar de librería para el tercero.
    const plan = composeMatrix({
      ...BASE,
      angleCount: 1,
      hooksPerAngle: 3,
      languages: ['es'],
      objective: 'conversion',
    });

    expect(plan.variants).toHaveLength(3);
    expect(plan.variants.map((v) => v.hook.source)).toEqual(['brief', 'brief', 'library']);

    // El hook de librería tiene que ser uno REAL de la librería sembrada, del ángulo y el
    // idioma correctos. Se resuelve por la CLAVE NATURAL (language, text) — el mismo lookup
    // que hará T2.3 contra el UNIQUE de `hook_line` — y no por una posición de array.
    const fromLibrary = plan.variants[2]?.hook;
    expect(fromLibrary?.source).toBe('library');
    const seed = HOOK_LINE_SEEDS.find((h) => h.language === 'es' && h.text === fromLibrary?.text);
    expect(seed, 'el hook servido debe ser una línea REAL de la librería sembrada').toBeDefined();
    expect(seed?.angle).toBe('pain_point'); // el framework del ángulo 0
  });

  it('el hook de librería de la variante en INGLÉS es un hook en inglés (§17: no se traduce)', () => {
    const plan = composeMatrix({
      ...BASE,
      angleCount: 1,
      hooksPerAngle: 3,
      languages: ['es', 'en'],
      objective: 'conversion',
    });
    const en = plan.variants.filter((v) => v.language === 'en' && v.hook.source === 'library');
    expect(en).toHaveLength(1);
    // La línea servida existe en la librería CON el idioma pedido (clave natural, no índice).
    expect(
      HOOK_LINE_SEEDS.find((h) => h.language === 'en' && h.text === en[0]?.hook.text),
    ).toBeDefined();
  });

  it('la persona sale de matchPersonas sobre el avatar_hint (§11) — la incompatible NO entra', () => {
    const plan = composeMatrix({
      ...BASE,
      angleCount: 2,
      hooksPerAngle: 3,
      languages: ['es', 'en'],
      objective: 'conversion',
    });
    // El `avatar_hint` del brief describe a Lucía. Marcus (hombre, 60, elegante) queda fuera:
    // la regla de T2.0 lo descarta y el compositor NO cae en «pues el primero de la lista».
    expect(new Set(plan.variants.map((v) => v.personaName))).toEqual(new Set(['Lucía']));
  });

  it('sin personas compatibles la variante queda SIN persona fijada (§11: el usuario la fija)', () => {
    const plan = composeMatrix({
      ...BASE,
      personas: [MARCUS], // ninguna candidata para el hint del brief
      angleCount: 1,
      hooksPerAngle: 2,
      languages: ['es'],
      objective: 'conversion',
    });
    expect(plan.variants.every((v) => v.personaName === null)).toBe(true);
  });
});

describe('composeMatrix — la economía Hook×Body×CTA (§7.2 N5, §16.1)', () => {
  it('hook_test: las 3 variantes de un ángulo COMPARTEN body y CTA; el hook es propio', () => {
    const plan = composeMatrix({
      ...BASE,
      angleCount: 1,
      hooksPerAngle: 3,
      languages: ['es'],
      objective: 'hook_test',
    });

    expect(plan.sharedBodyAndCta).toBe(true);
    expect(plan.variants).toHaveLength(3);

    const bodyKeys = new Set(plan.variants.map((v) => v.segmentKeys.body));
    const ctaKeys = new Set(plan.variants.map((v) => v.segmentKeys.cta));
    const hookKeys = new Set(plan.variants.map((v) => v.segmentKeys.hook));
    expect(bodyKeys.size).toBe(1); // UNA generación de body para las 3
    expect(ctaKeys.size).toBe(1); // UNA generación de CTA para las 3
    expect(hookKeys.size).toBe(3); // el hook es lo que se está testeando: uno por variante
  });

  it('hook_test: el body NO se comparte entre IDIOMAS (un body en es no sirve para el en)', () => {
    // Compartir «por ángulo a secas» sería más barato… y falso: el body se HABLA. La clave
    // lleva el idioma, así que es+en son dos generaciones distintas.
    const plan = composeMatrix({
      ...BASE,
      angleCount: 1,
      hooksPerAngle: 3,
      languages: ['es', 'en'],
      objective: 'hook_test',
    });
    expect(new Set(plan.variants.map((v) => v.segmentKeys.body)).size).toBe(2);
  });

  it('conversion/story: NADA se comparte — 1 guion por variante (§7.2 N5, «lotes normales»)', () => {
    const plan = composeMatrix({
      ...BASE,
      angleCount: 2,
      hooksPerAngle: 3,
      languages: ['es', 'en'],
      objective: 'conversion',
    });
    expect(plan.sharedBodyAndCta).toBe(false);
    expect(new Set(plan.variants.map((v) => v.segmentKeys.body)).size).toBe(12);
    expect(new Set(plan.variants.map((v) => v.segmentKeys.cta)).size).toBe(12);
  });
});

// `ad_variant.filename_code` es UNIQUE **GLOBAL** (§12), no único por lote: dos lotes del mismo
// brief con la misma config colisionarían al INSERT — un 500 justo al confirmar el gasto en CP2.
// La defensa vive en el CÓDIGO (`batchDiscriminator`), no en un comentario que T2.3 puede no leer.
describe('filename_code: el UNIQUE GLOBAL de §12 y el desambiguador de lote', () => {
  const config = {
    ...BASE,
    angleCount: 2,
    hooksPerAngle: 3,
    languages: ['es', 'en'],
    objective: 'conversion' as const,
  };

  it('SIN desambiguador, dos lotes del mismo brief producen los MISMOS códigos (la colisión existe)', () => {
    // Este test NO documenta un bug: fija el hecho de que la unicidad por defecto es solo DENTRO
    // del plan (lo correcto para previsualizar CP2 antes de que el lote exista). Es la razón de
    // ser del parámetro, y si un día el default cambiara, este assert obliga a decidirlo.
    const a = composeMatrix(config);
    const b = composeMatrix(config);
    expect(a.variants.map((v) => v.filenameCode)).toEqual(b.variants.map((v) => v.filenameCode));
  });

  it('CON desambiguador, dos lotes del mismo brief NO colisionan: 24 códigos globalmente únicos', () => {
    const a = composeMatrix({ ...config, batchDiscriminator: '01JBATCHAAA' });
    const b = composeMatrix({ ...config, batchDiscriminator: '01JBATCHBBB' });

    const all = [...a.variants, ...b.variants].map((v) => v.filenameCode);
    expect(all).toHaveLength(24);
    // LO QUE EL UNIQUE GLOBAL DE LA BD EXIGE: 24 filas, 24 códigos distintos. Sin el
    // desambiguador este assert daría 12 y el segundo INSERT reventaría en producción.
    expect(new Set(all).size).toBe(24);

    // Y sigue siendo LEGIBLE (§8.3: trazabilidad en Ads Manager), no un hash opaco.
    expect(a.variants[0]?.filenameCode).toContain('01jbatchaaa');
    expect(a.variants[0]?.filenameCode).toMatch(/^serum-hidratante-/);
    // Dentro del lote, el código sigue siendo único (el desambiguador no rompe nada).
    expect(new Set(a.variants.map((v) => v.filenameCode)).size).toBe(12);
  });
});

// EL BUG DEL CODE-REVIEW: `composeMatrix` devolvía planes que NO validan contra su propio schema
// (`BatchPlanSchema` exige `variants.min(1)`). El llamante o revienta al parsear en un sitio
// lejano, o —si no parsea— persiste un `ad_batch.matrix` VACÍO y le enseña al usuario un lote de
// 0 variantes con coste $0. **Un olvido de parámetro degradaba a SILENCIO, no a error.**
describe('composeMatrix NUNCA devuelve un plan inválido (lanza nombrando la causa)', () => {
  it('EL DEFAULT SENSATO: sin angleIndices NI angleCount, entran TODOS los ángulos del brief', () => {
    // Antes, el default de `angleCount` era **0** → `variants: []`. Cero es el único valor que no
    // puede ser lo que nadie quiere: el default correcto es «todos».
    const plan = composeMatrix({
      ...BASE,
      hooksPerAngle: 2,
      languages: ['es'],
      objective: 'conversion',
    });
    expect(plan.variants).toHaveLength(BRIEF.angles.length * 2); // 5 ángulos × 2 hooks
    expect(BatchPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('sin idiomas, LANZA (no devuelve una matriz vacía)', () => {
    expect(() =>
      composeMatrix({
        ...BASE,
        angleCount: 2,
        hooksPerAngle: 3,
        languages: [],
        objective: 'conversion',
      }),
    ).toThrow(/idiomas/);
  });

  it('con angleIndices vacío, LANZA', () => {
    expect(() =>
      composeMatrix({
        ...BASE,
        angleIndices: [],
        hooksPerAngle: 3,
        languages: ['es'],
        objective: 'conversion',
      }),
    ).toThrow(/ángulos/);
  });

  it('si el ángulo no tiene hooks (ni brief ni librería), LANZA nombrando la causa', () => {
    // Un ángulo sin `hook_examples` y sin librería que lo cubra no produce variantes. Antes salía
    // un plan vacío tan tranquilo.
    const sinHooks = makeBrief({
      angles: [
        makeAngle({ name: 'Ángulo mudo', framework: 'pain_point', hook_examples: [] }),
        ...makeBrief().angles.slice(1),
      ],
    });
    expect(() =>
      composeMatrix({
        brief: sinHooks,
        libraryHooks: [], // sin librería: no hay de dónde sacar hooks
        angleIndices: [0],
        hooksPerAngle: 3,
        languages: ['es'],
        objective: 'conversion',
        tier: 'standard',
      }),
    ).toThrow(/hooks/);
  });
});

describe('la persona: clave ESTABLE y señal de por qué no hay ninguna', () => {
  // Las mismas dos personas, ahora CON id (como las filas de `@ugc/db` que pasará T2.3).
  const LUCIA_ID = { ...LUCIA, id: '01JPERSONALUCIA' };

  it('la clave de dedup/filename usa el ID, no el nombre: RENOMBRAR no rompe la trazabilidad', () => {
    // §8.3: el `filename_code` es lo que el usuario busca en Ads Manager. Si la clave fuera el
    // NOMBRE, renombrar la persona reescribiría el código de todas sus variantes futuras — y
    // rompería justo la trazabilidad que el código existe para dar.
    const config = {
      ...BASE,
      personas: [LUCIA_ID],
      angleCount: 1,
      hooksPerAngle: 2,
      languages: ['es'],
      objective: 'hook_test' as const,
    };
    const antes = composeMatrix(config);
    const despues = composeMatrix({
      ...config,
      personas: [{ ...LUCIA_ID, name: 'Lucía Renombrada' }],
    });

    // El código de fichero y la clave de dedup NO cambian…
    expect(despues.variants.map((v) => v.filenameCode)).toEqual(
      antes.variants.map((v) => v.filenameCode),
    );
    expect(despues.variants.map((v) => v.segmentKeys.body)).toEqual(
      antes.variants.map((v) => v.segmentKeys.body),
    );
    // …pero el nombre LEGIBLE (lo que CP2 pinta) sí refleja el renombrado.
    expect(despues.variants[0]?.personaName).toBe('Lucía Renombrada');
  });

  it('personaSelection distingue «no había personas» de «ninguna casó» (CP2 puede decir la verdad)', () => {
    const base = {
      ...BASE,
      angleCount: 1,
      hooksPerAngle: 2,
      languages: ['es'],
      objective: 'conversion' as const,
    };

    // Con candidata compatible.
    expect(composeMatrix({ ...base, personas: [LUCIA_ID] }).personaSelection).toBe('matched');
    // Librería VACÍA.
    expect(composeMatrix({ ...base, personas: [] }).personaSelection).toBe('no_personas');
    // Había personas, pero NINGUNA casa con el `avatar_hint` del segmento. Antes, este caso era
    // indistinguible del anterior en la salida: CP2 solo podía enseñar un lote mudo.
    const soloIncompatible = composeMatrix({ ...base, personas: [MARCUS] });
    expect(soloIncompatible.personaSelection).toBe('no_match');
    expect(soloIncompatible.variants.every((v) => v.personaName === null)).toBe(true);
  });
});

describe('presets de duración (§8.4 × §7.5)', () => {
  it('el plan lleva la duración del preset de su objetivo, y el cap de export se respeta', () => {
    for (const objective of ['hook_test', 'conversion', 'story'] as const) {
      const plan = composeMatrix({
        ...BASE,
        angleCount: 1,
        hooksPerAngle: 2,
        languages: ['es'],
        objective,
      });
      const preset = DURATION_PRESETS[objective];
      expect(plan.durationTargetSeconds).toBe(preset.targetSeconds);
      expect(plan.variants.every((v) => v.durationTargetSeconds === preset.targetSeconds)).toBe(
        true,
      );
      // §8.4: cap duro de export 60 s.
      expect(preset.targetSeconds).toBeLessThanOrEqual(MAX_EXPORT_SECONDS);
      // §7.5: los segundos de los segmentos SON la duración del anuncio (no un reparto aparte).
      const { hook, body, cta } = preset.segmentSeconds;
      expect(hook + body + cta).toBe(preset.targetSeconds);
    }
  });

  it('las duraciones caen dentro de la horquilla de su objetivo (§8.4)', () => {
    // §8.4 literal: hook testing 8–15 s · conversión 21–34 s · storytelling 35–60 s.
    const RANGES = {
      hook_test: [8, 15],
      conversion: [21, 34],
      story: [35, 60],
    } as const;
    for (const [objective, [lo, hi]] of Object.entries(RANGES)) {
      const seconds = DURATION_PRESETS[objective as keyof typeof RANGES].targetSeconds;
      expect(seconds).toBeGreaterThanOrEqual(lo);
      expect(seconds).toBeLessThanOrEqual(hi);
    }
  });
});
