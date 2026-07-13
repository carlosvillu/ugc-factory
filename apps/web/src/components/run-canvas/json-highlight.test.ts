import { expect, test } from 'vitest';
import { formatJson, tokenizeJson } from './json-highlight';

test('formatJson pretty-printea un artefacto opaco', () => {
  expect(formatJson({ a: 1, b: ['x'] })).toBe('{\n  "a": 1,\n  "b": [\n    "x"\n  ]\n}');
});

test('formatJson re-formatea un string que YA es JSON, y respeta el que no lo es', () => {
  expect(formatJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  expect(formatJson('fallo inyectado')).toBe('fallo inyectado');
});

test('tokeniza claves, strings, números, booleanos y null con su kind', () => {
  const tokens = tokenizeJson(formatJson({ name: 'glow', price: 19.9, ok: true, hero: null }));
  const byKind = (kind: string) => tokens.filter((t) => t.kind === kind).map((t) => t.text);

  expect(byKind('key')).toEqual(['"name"', '"price"', '"ok"', '"hero"']);
  expect(byKind('string')).toEqual(['"glow"']);
  expect(byKind('number')).toEqual(['19.9']);
  expect(byKind('boolean')).toEqual(['true']);
  expect(byKind('null')).toEqual(['null']);
});

test('INVARIANTE: concatenar los tokens reproduce el input carácter a carácter', () => {
  // Es lo que hace seguro pintarlos en un <pre>: nada se pierde ni se duplica. Payload
  // con las trampas reales (string con `:` dentro, escape de comillas, negativos,
  // exponente, array anidado).
  const formatted = formatJson({
    'a:b': 'texto con "comillas" y : dos puntos',
    nums: [-3, 1e-4, 0.5],
    nested: { deep: { flag: false, none: null } },
  });
  expect(tokenizeJson(formatted).reduce((acc, t) => acc + t.text, '')).toBe(formatted);
});

test('una clave y un valor string IDÉNTICOS no se confunden', () => {
  const tokens = tokenizeJson(formatJson({ estado: 'estado' }));
  expect(tokens.filter((t) => t.kind === 'key')).toEqual([{ kind: 'key', text: '"estado"' }]);
  expect(tokens.filter((t) => t.kind === 'string')).toEqual([{ kind: 'string', text: '"estado"' }]);
});
