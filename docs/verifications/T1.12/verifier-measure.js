(() => {
// T1.12 · VERIFIER's own in-browser contrast measurer (independent of the implementer's
// arithmetic scripts). Injected with `agent-browser eval --stdin`, so every number below comes
// from the CSS the browser ACTUALLY applied, not from a .mjs recomputing hexes on the side.
//
// THE TRAP THIS AVOIDS: a badge's background is `--x-soft` = the hue at 10% ALPHA. Reading it
// with getComputedStyle gives `rgba(21,124,59,0.1)` — feeding that to a WCAG formula naively
// yields garbage (same hue as the text → ~1:1). And compositing it over an ASSUMED `--surface`
// (what check.mjs does) bakes in a guess about what's actually painted underneath. So here we
// WALK THE REAL ANCESTOR CHAIN and composite every semi-transparent layer we find, ending at an
// opaque one. No assumption about which surface the badge happens to sit on.
//
// Returns, per element: the text color, the composited background, the ratio, and the ancestor
// chain we composited through (so the report can show its work).

const parseRGB = (s) => {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
};

const lin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const L = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (f, b) => {
  const l1 = L(f), l2 = L(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};
// src OVER dst (both premultiplied-free, dst assumed opaque at the end of the chain)
const over = (src, dst) => ({
  r: src.r * src.a + dst.r * (1 - src.a),
  g: src.g * src.a + dst.g * (1 - src.a),
  b: src.b * src.a + dst.b * (1 - src.a),
  a: 1,
});

// Walk up from the element, collecting every painted background layer, until we hit an opaque
// one (or the root). Then composite them back down: the badge's own -soft over whatever is
// really behind it. THIS is the pair a human eye sees.
const effectiveBg = (el) => {
  const layers = [];
  let node = el;
  while (node && node !== document.documentElement.parentNode) {
    const bg = parseRGB(getComputedStyle(node).backgroundColor);
    if (bg && bg.a > 0) {
      layers.push({ tag: node.tagName.toLowerCase(), cls: (node.className || '').toString().slice(0, 40), bg });
      if (bg.a >= 0.999) break; // opaque: nothing below it can show through
    }
    node = node.parentElement;
  }
  // Nothing opaque found? fall back to the canvas (white per CSS spec).
  let acc = { r: 255, g: 255, b: 255, a: 1 };
  const chain = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    acc = over(layers[i].bg, acc);
    chain.push(`${layers[i].tag}.${layers[i].cls}=rgba(${[layers[i].bg.r, layers[i].bg.g, layers[i].bg.b, layers[i].bg.a].join(',')})`);
  }
  return { bg: acc, chain };
};

const measure = (el, label) => {
  const cs = getComputedStyle(el);
  const fg = parseRGB(cs.color);
  const { bg, chain } = effectiveBg(el);
  const fs = parseFloat(cs.fontSize);
  const fw = parseInt(cs.fontWeight, 10) || 400;
  // WCAG "large text": >=24px, or >=18.66px when bold(>=700). Everything else: 4.5:1.
  const isLarge = fs >= 24 || (fs >= 18.66 && fw >= 700);
  const r = ratio(fg, bg);
  return {
    label,
    text: el.textContent.trim().slice(0, 40),
    color: cs.color,
    bgComposited: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
    fontPx: fs,
    fontWeight: fw,
    threshold: isLarge ? 3.0 : 4.5,
    ratio: Math.round(r * 100) / 100,
    pass: r >= (isLarge ? 3.0 : 4.5),
    chain: chain.join(' → '),
  };
};

const theme = document.documentElement.getAttribute('data-theme') || 'dark(default)';
const results = [];

// 1) BADGES: every rendered Badge, keyed by its tone class (text-<tone> over bg-<tone>-soft).
for (const tone of ['success', 'warning', 'danger', 'info', 'violet', 'accent', 'neutral']) {
  const els = document.querySelectorAll(`.text-${tone}`);
  els.forEach((el, i) => {
    // Only elements that carry text of their own (skip pure wrappers/dots).
    if (!el.textContent.trim()) return;
    results.push(measure(el, `badge/text-${tone}[${i}]`));
  });
}

// 2) SOLID FILLS: --x-on over a solid --x (the "Aprobar y continuar" button, checkpoint-banner,
// step-panel). This is a DIFFERENT PAIR from the badge and the one most likely to have been
// broken by the fix, since --success-on inverts in light.
document.querySelectorAll('[class*="bg-success"], [class*="bg-danger"], [class*="bg-warning"], [class*="bg-info"], [class*="bg-violet"]').forEach((el, i) => {
  const cls = el.className.toString();
  if (/-soft/.test(cls)) return;          // that's the badge case, already covered
  if (!el.textContent.trim()) return;      // dots/bars carry no text
  results.push(measure(el, `solid-fill[${i}] ${cls.match(/bg-\w+/)?.[0] ?? ''}`));
});

return JSON.stringify({ theme, url: location.pathname, count: results.length, results }, null, 2);
})()
