// T1.12 · VERIFIER — CP1 contrast measurement (NOT a product test; lives under
// docs/verifications/ and is run explicitly with --config, never part of `pnpm test:e2e`).
//
// The Verificación names CP1 (`/runs/:id` with N3 paused) explicitly. This drives the REAL
// system to CP1 through the UI (the same helper the permanent spec uses → the real N1/N2/N3
// nodes against the FAKE paid APIs, so it costs $0), then measures, in BOTH themes:
//   1. the provenance badges  «✓ extraído» (success) and «inferido» (violet)
//   2. THE BUTTON: «Aprobar y continuar» — --success-on over a SOLID --success fill, the pair
//      that INVERTS in light and that a badge-only check would never have caught.
// Every number comes from the pixels the browser actually rasterized, not from side arithmetic:
// the -soft background is composited on a <canvas> so the integer channel rounding the display
// performs is included (float math reads ~0.02-0.03 HIGH, which is exactly the margin at stake).
import { test, expect, type Page } from '@playwright/test';
import { briefEditor, runUrlAnalysisToCp1 } from '../../../apps/web/e2e/support/brief';

const MEASURE = (sel: string) =>
  `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return { error: 'not found: ' + ${JSON.stringify(sel)} };
    const cs = getComputedStyle(el);
    const parse = (s) => { const m = s.match(/[\\d.]+/g).map(Number); return { r:m[0], g:m[1], b:m[2], a:m.length>3?m[3]:1 }; };
    // Nearest OPAQUE painted ancestor = what is really behind this element.
    let node = el, layers = [];
    while (node) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg.a > 0) { layers.push(bg); if (bg.a >= 0.999) break; }
      node = node.parentElement;
    }
    // Rasterize the stack on a canvas: integer channels, exactly as the screen shows it.
    const cv = document.createElement('canvas'); cv.width = cv.height = 4;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,4,4);
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      ctx.fillStyle = 'rgba(' + l.r + ',' + l.g + ',' + l.b + ',' + l.a + ')';
      ctx.fillRect(0,0,4,4);
    }
    const px = ctx.getImageData(1,1,1,1).data;
    const lin = (c) => { c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
    const L = (r,g,b) => 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
    const fg = parse(cs.color);
    const l1 = L(fg.r,fg.g,fg.b), l2 = L(px[0],px[1],px[2]);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    const ratio = (hi + 0.05) / (lo + 0.05);
    return {
      text: el.textContent.trim().slice(0, 30),
      color: cs.color,
      bgRasterized: 'rgb(' + px[0] + ',' + px[1] + ',' + px[2] + ')',
      fontPx: parseFloat(cs.fontSize),
      fontWeight: cs.fontWeight,
      ratio: Math.floor(ratio * 100) / 100,   // truncate: 4.4999 is NOT 4.5
    };
  })()`;

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
}

const rows: string[] = [];

test('T1.12 · CP1: badges de procedencia y BOTÓN de aprobar, en light y dark', async ({ page }) => {
  await runUrlAnalysisToCp1(page); // → CP1 real, N3 pausado, con los fakes: $0
  const editor = briefEditor(page);
  await expect(editor).toBeVisible();

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await page.waitForTimeout(150); // el repaint del cambio de tema

    const badgeExtracted = await page.evaluate(MEASURE('[data-slot="badge-extracted"]'));
    const badgeInferred = await page.evaluate(MEASURE('[data-slot="badge-inferred"]'));
    // El botón sólido: --success-on sobre relleno --success.
    const button = await page.evaluate(
      MEASURE('button.bg-success, button[class*="bg-success"]'),
    );

    for (const [name, m] of [
      ['badge ✓extraído (success)', badgeExtracted],
      ['badge inferido (violet)', badgeInferred],
      ['BOTÓN Aprobar y continuar (success-on/success)', button],
    ] as const) {
      const r = m as Record<string, unknown>;
      const ratio = r.ratio as number;
      const ok = ratio >= 4.5;
      rows.push(
        `${theme.toUpperCase().padEnd(5)} | ${ok ? 'OK  ' : 'FAIL'} ${String(ratio).padStart(5)}:1 | ${name.padEnd(46)} | ${String(r.color)} on ${String(r.bgRasterized)} | ${JSON.stringify(r.text)}`,
      );
    }
    await page.screenshot({
      path: `docs/verifications/T1.12/cp1-${theme}.png`,
      fullPage: true,
    });
  }

  console.log('\n===== T1.12 · CP1 MEDIDO (rasterizado real) =====');
  for (const r of rows) console.log(r);
  console.log('=================================================\n');

  // El gate: cualquier par de TEXTO por debajo de 4.5:1 es FAIL.
  const failing = rows.filter((r) => r.includes('FAIL'));
  expect(failing, `pares por debajo de AA:\n${failing.join('\n')}`).toHaveLength(0);
});
