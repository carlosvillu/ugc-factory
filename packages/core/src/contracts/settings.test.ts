import { describe, expect, it } from 'vitest';
import {
  SECRET_PROVIDERS,
  SettingsPatchSchema,
  SettingsViewSchema,
  DEFAULT_SETTINGS_PREFERENCES,
} from './settings';

describe('settings contracts (T0.14)', () => {
  it('SECRET_PROVIDERS es fal/anthropic/firecrawl (excluye "other")', () => {
    expect([...SECRET_PROVIDERS].sort()).toEqual(['anthropic', 'fal', 'firecrawl']);
  });

  it('rechaza un PATCH vacío (sin secrets ni preferences)', () => {
    expect(SettingsPatchSchema.safeParse({}).success).toBe(false);
  });

  it('acepta un PATCH con solo una key de secret', () => {
    const r = SettingsPatchSchema.safeParse({ secrets: { fal: 'my-fal-key' } });
    expect(r.success).toBe(true);
  });

  it('rechaza una key de secret vacía (write-only: vacío = no tocar, no persistir "")', () => {
    // string vacío no pasa min(1) tras trim → validation_error; el handler además
    // filtra las ausentes, pero enviar "" explícito es un error del cliente.
    const r = SettingsPatchSchema.safeParse({ secrets: { fal: '   ' } });
    expect(r.success).toBe(false);
  });

  it('rechaza un proveedor de secret desconocido', () => {
    const r = SettingsPatchSchema.safeParse({ secrets: { other: 'x' } });
    expect(r.success).toBe(false);
  });

  it('valida preferences: idiomas no vacíos y umbrales en [0,1]', () => {
    expect(
      SettingsPatchSchema.safeParse({
        preferences: {
          defaultLanguages: ['es', 'en'],
          durationPreset: 'short',
          thresholds: { killHookRate: 0.01, scaleHookRate: 0.05 },
        },
      }).success,
    ).toBe(true);
    expect(
      SettingsPatchSchema.safeParse({
        preferences: {
          defaultLanguages: [],
          durationPreset: 'short',
          thresholds: { killHookRate: 0.01, scaleHookRate: 0.05 },
        },
      }).success,
    ).toBe(false);
    expect(
      SettingsPatchSchema.safeParse({
        preferences: {
          defaultLanguages: ['es'],
          durationPreset: 'short',
          thresholds: { killHookRate: 2, scaleHookRate: 0.05 },
        },
      }).success,
    ).toBe(false);
  });

  it('los defaults de fábrica satisfacen el schema de vista', () => {
    const view = {
      secrets: { fal: { set: false, last4: null } },
      preferences: DEFAULT_SETTINGS_PREFERENCES,
    };
    expect(SettingsViewSchema.safeParse(view).success).toBe(true);
  });
});
