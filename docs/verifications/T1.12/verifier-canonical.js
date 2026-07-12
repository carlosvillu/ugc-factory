(() => {
// T1.12 · CANONICAL PAIR measurement — the definitive 5x2 table.
//
// The DOM sweep (verifier-measure.js) walks whatever surface a badge HAPPENS to land on in the
// showcase, which on a demo page includes badges deliberately dropped onto already-tinted panels
// (a danger badge on an amber alert, etc.). Those doubly-composited placements are not the pair
// T1.12 is about, and they exist in dark too (untouched values) so they cannot be regressions.
//
// THE PAIR T1.12 DEFINES, and the one a Badge actually renders:
//     text  = --<family>                                   (opaque)
//     bg    = --<family>-soft  (the same hue at 10% alpha) composited over --surface
// One composite, no guessing. Every value below is read with getComputedStyle from the CSS the
// browser applied, so this is a browser measurement, not side arithmetic.
//
// Plus the SOLID FILL pair, which is a different pair and the one --success-on inverts for:
//     text  = --success-on   over   bg = --success (solid, opaque)

const parseRGB = (s) => {
  const m = s.trim().match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  // hex (#rgb / #rrggbb / #rrggbbaa) — the tokens are declared as hex
  let h = s.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
};

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (f, b) => { const l1 = L(f), l2 = L(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };
const over = (src, dst) => ({
  r: src.r * src.a + dst.r * (1 - src.a),
  g: src.g * src.a + dst.g * (1 - src.a),
  b: src.b * src.a + dst.b * (1 - src.a),
  a: 1,
});
// Truncate, never round up: 4.4999 must read as 4.49, not 4.50. A pass must be a real pass.
const trunc2 = (n) => Math.floor(n * 100) / 100;

const cs = getComputedStyle(document.documentElement);
const tok = (name) => cs.getPropertyValue(name).trim();

const surface = parseRGB(tok('--surface'));
const bg = parseRGB(tok('--bg'));
const out = { theme: document.documentElement.getAttribute('data-theme') || 'dark (default, no data-theme)', surface: tok('--surface'), bg: tok('--bg'), badges: [], solidFills: [] };

for (const fam of ['success', 'warning', 'danger', 'info', 'violet']) {
  const fg = parseRGB(tok(`--${fam}`));
  const soft = parseRGB(tok(`--${fam}-soft`));
  // The badge's own -soft over --surface (cards/panels) and over --bg (page canvas): both are
  // real placements in this app, so report both and gate on the WORSE of the two.
  const onSurface = ratio(fg, over(soft, surface));
  const onBg = ratio(fg, over(soft, bg));
  const worst = Math.min(onSurface, onBg);
  out.badges.push({
    family: fam,
    token: tok(`--${fam}`),
    soft: tok(`--${fam}-soft`),
    ratio_over_surface: trunc2(onSurface),
    ratio_over_bg: trunc2(onBg),
    worst: trunc2(worst),
    threshold: 4.5,
    pass: trunc2(worst) >= 4.5,
  });
}

// The solid fills. --success-on over solid --success is the one that INVERTS in light and the
// one a badge-only check would have missed (button "Aprobar y continuar", checkpoint-banner,
// step-panel — 3 sites, same pair).
for (const [fam, onTok] of [['success', '--success-on']]) {
  const fill = parseRGB(tok(`--${fam}`));
  const onC = parseRGB(tok(onTok));
  const r = ratio(onC, fill);
  out.solidFills.push({
    pair: `${onTok} on solid --${fam}`,
    text: tok(onTok),
    fill: tok(`--${fam}`),
    ratio: trunc2(r),
    threshold: 4.5,
    pass: trunc2(r) >= 4.5,
  });
}

return JSON.stringify(out, null, 2);
})()
