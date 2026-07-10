// Suite del espejo JSON Schema del ProductBrief (unit-core.md §3). El espejo diverge
// del Zod A PROPÓSITO (Apéndice A, divergencia 3): sin `minItems`/`maxItems` y con
// `additionalProperties:false` en todo objeto. El test FIJA ese reparto para que
// nadie lo "arregle" moviendo cardinalidades al JSON Schema (donde Anthropic las
// ignoraría en silencio). `Ajv2020.compile` YA falla si el espejo no es draft
// 2020-12 válido — eso satisface la Verificación de T1.1.
import Ajv2020 from 'ajv/dist/2020';
import { makeBrief } from '@ugc/test-utils';
import { describe, expect, it } from 'vitest';

import { ProductBriefSchema } from './product-brief';
import { productBriefJsonSchema, toAnthropicJsonSchema } from './product-brief.json-schema';

const ajv = new Ajv2020({ strict: true });
// compile YA valida el espejo contra el meta-schema draft 2020-12 (Verificación T1.1).
const validateMirror = ajv.compile(productBriefJsonSchema);

describe('productBriefJsonSchema (espejo Anthropic)', () => {
  it('es un JSON Schema draft 2020-12 VÁLIDO (compila sin lanzar)', () => {
    expect(typeof validateMirror).toBe('function');
    expect(productBriefJsonSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  // Recolecta todos los nodos-objeto del espejo (sin `expect` dentro de la recursión:
  // vitest/no-conditional-expect). Los tests asertan sobre el array resultante.
  const collectNodes = (root: unknown): Record<string, unknown>[] => {
    const nodes: Record<string, unknown>[] = [];
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const n = node as Record<string, unknown>;
      nodes.push(n);
      Object.values(n).forEach(walk);
    };
    walk(root);
    return nodes;
  };

  it('todo objeto lleva additionalProperties:false (requisito Anthropic)', () => {
    const objectNodes = collectNodes(productBriefJsonSchema).filter((n) => n.type === 'object');
    expect(objectNodes.length).toBeGreaterThan(0);
    expect(objectNodes.every((n) => n.additionalProperties === false)).toBe(true);
  });

  // Constraints que Anthropic IGNORA (research/07 §4.2): NINGÚN nodo del espejo, a
  // cualquier profundidad, puede llevarlos — si no, el espejo mentiría sobre lo que
  // la API respeta. Incluye `minimum`/`maximum` (que `z.number().int()` emite con los
  // bounds de safe-integer) además de los de array y string.
  const IGNORED_BY_ANTHROPIC = [
    'minItems',
    'maxItems',
    'minContains',
    'maxContains',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minLength',
    'maxLength',
  ] as const;

  it.each(IGNORED_BY_ANTHROPIC)(
    'NINGÚN nodo lleva "%s" (podado: la regla vive solo en Zod)',
    (keyword) => {
      const nodes = collectNodes(productBriefJsonSchema);
      expect(nodes.some((n) => keyword in n)).toBe(false);
    },
  );

  it('divergencia documentada: 11 ángulos pasan el espejo pero Zod los rechaza', () => {
    const brief = makeBrief();
    const inflated = { ...brief, angles: Array(11).fill(brief.angles[0]) };
    expect(validateMirror(inflated)).toBe(true); // Anthropic no lo frenaría
    expect(ProductBriefSchema.safeParse(inflated).success).toBe(false); // Zod sí
  });

  it('divergencia documentada: source_url no-null en modo manual pasa el espejo pero Zod lo rechaza', () => {
    // El bicondicional del `.superRefine` NO viaja al JSON Schema (los refines no se
    // representan) — es coherente: es una regla, no una forma. Vive solo en Zod.
    const brief = makeBrief();
    const badManual = {
      ...brief,
      meta: { ...brief.meta, platform: 'manual', source_url: 'https://x.com' },
    };
    expect(validateMirror(badManual)).toBe(true);
    expect(ProductBriefSchema.safeParse(badManual).success).toBe(false);
  });

  it('el espejo acepta todo lo que Zod acepta (espejo ⊇ Zod)', () => {
    expect(validateMirror(makeBrief())).toBe(true);
  });

  it('el espejo NO tiene format:uri con checks estrictos que rompan (draft 2020-12 puro)', () => {
    // Sanity: valida también el fixture manual (source_url null).
    const manual = makeBrief({
      meta: {
        source_url: null,
        platform: 'manual',
        language: 'es',
        extracted_at: '2026-07-10T12:00:00.000Z',
        extraction_confidence: 'low',
        warnings: [],
      },
    });
    expect(validateMirror(manual)).toBe(true);
  });
});

describe('toAnthropicJsonSchema (helper puro)', () => {
  it('fija additionalProperties:false en objetos anidados', () => {
    const out = toAnthropicJsonSchema({
      type: 'object',
      properties: { inner: { type: 'object', properties: {} } },
    }) as Record<string, unknown>;
    expect(out.additionalProperties).toBe(false);
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect(props.inner?.additionalProperties).toBe(false);
  });

  it('poda minItems/maxItems a cualquier profundidad', () => {
    const out = toAnthropicJsonSchema({
      type: 'object',
      properties: { arr: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 } },
    }) as Record<string, unknown>;
    const arr = (out.properties as Record<string, Record<string, unknown>>).arr!;
    expect(arr.minItems).toBeUndefined();
    expect(arr.maxItems).toBeUndefined();
    expect(arr.type).toBe('array'); // el resto del nodo intacto
  });

  it('no muta la entrada', () => {
    const input = { type: 'array', minItems: 5 };
    const copy = { ...input };
    toAnthropicJsonSchema(input);
    expect(input).toEqual(copy);
  });
});
