import { describe, expect, it } from 'vitest';
import { newUlid, UlidSchema } from './ids';

describe('newUlid', () => {
  it('genera un ULID canónico de 26 chars que su propio schema acepta', () => {
    const id = newUlid();
    expect(id).toHaveLength(26);
    expect(UlidSchema.safeParse(id).success).toBe(true);
  });

  it('es monotónico-por-tiempo: ids generados en orden ordenan lexicográficamente', () => {
    // La propiedad que justifica ULID sobre UUID (db.md §1): ordenable por tiempo.
    // El prefijo de timestamp (10 chars) no decrece entre dos llamadas sucesivas.
    const a = newUlid();
    const b = newUlid();
    expect(a.slice(0, 10) <= b.slice(0, 10)).toBe(true);
  });
});

describe('UlidSchema', () => {
  it('rechaza longitudes distintas de 26', () => {
    expect(UlidSchema.safeParse('01ARZ3NDEKTSV4RRFFQ69G5FA').success).toBe(false); // 25
    expect(UlidSchema.safeParse('01ARZ3NDEKTSV4RRFFQ69G5FAVV').success).toBe(false); // 27
  });

  it('rechaza caracteres fuera del alfabeto Crockford base32 (I, L, O, U)', () => {
    expect(UlidSchema.safeParse('0IARZ3NDEKTSV4RRFFQ69G5FAV').success).toBe(false);
    expect(UlidSchema.safeParse('0LARZ3NDEKTSV4RRFFQ69G5FAV').success).toBe(false);
    expect(UlidSchema.safeParse('0OARZ3NDEKTSV4RRFFQ69G5FAV').success).toBe(false);
    expect(UlidSchema.safeParse('0UARZ3NDEKTSV4RRFFQ69G5FAV').success).toBe(false);
  });

  it('acepta un ULID válido conocido', () => {
    expect(UlidSchema.safeParse('01ARZ3NDEKTSV4RRFFQ69G5FAV').success).toBe(true);
  });
});
