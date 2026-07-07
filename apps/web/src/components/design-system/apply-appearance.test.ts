import { describe, expect, it } from 'vitest';
import { applyAccent, applyDensity, applyTheme } from './apply-appearance';

// Minimal attribute-bag fake so the test runs in the default `node` vitest
// environment (jsdom is not wired up until the testing stack setup task). The
// helpers only touch set/remove/getAttribute, so this is a faithful stand-in.
function fakeEl(): HTMLElement {
  const attrs = new Map<string, string>();
  return {
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    hasAttribute: (k: string) => attrs.has(k),
  } as unknown as HTMLElement;
}

describe('apply-appearance', () => {
  it('stamps data-theme=light but leaves the dark default unstamped', () => {
    const el = fakeEl();
    applyTheme(el, 'light');
    expect(el.getAttribute('data-theme')).toBe('light');
    applyTheme(el, 'dark');
    expect(el.hasAttribute('data-theme')).toBe(false);
  });

  it('stamps a non-default accent and clears back to indigo', () => {
    const el = fakeEl();
    applyAccent(el, 'emerald');
    expect(el.getAttribute('data-accent')).toBe('emerald');
    applyAccent(el, 'cyan');
    expect(el.getAttribute('data-accent')).toBe('cyan');
    applyAccent(el, 'indigo');
    expect(el.hasAttribute('data-accent')).toBe(false);
  });

  it('stamps a non-default density and clears back to balanced', () => {
    const el = fakeEl();
    applyDensity(el, 'compact');
    expect(el.getAttribute('data-density')).toBe('compact');
    applyDensity(el, 'comfortable');
    expect(el.getAttribute('data-density')).toBe('comfortable');
    applyDensity(el, 'balanced');
    expect(el.hasAttribute('data-density')).toBe(false);
  });
});
