
# UGC Factory — Design System

**UGC Factory** is a personal (single-user, self-hosted) platform for generating AI-driven UGC-style video ads for TikTok and Instagram Reels: from a product URL (or free-text description) to a full 9:16 ad matrix — script, avatar, voice, native captions, and compliance — orchestrated as a visual pipeline with checkpoints, then published and measured from the tool itself.

This is a dense, technical, data-heavy operator tool — not a consumer or marketing surface. Every screen in the product is either a **pipeline graph** (nodes with live state/cost), a **library grid** (video variants), a **ledger/table** (spend, metrics), or an **editor panel** (brief, script). The design system reflects that: neutral dark-first UI, one switchable brand accent, a fixed semantic palette, and mono type wherever data/identifiers/cost appear.

## Sources

- `UGC Factory Design System.dc.html` — a Claude-authored HTML spec that already fully defines this system's tokens, type, and component patterns (buttons, fields, badges, pipeline nodes, checkpoint banners, variant cards, metrics table, spend ledger, safe-zone overlay, alerts/tabs/empty state) with a working dark/light + 4-accent theme switcher. This project is a direct, faithful port of that spec into the design-system file structure the compiler expects — no new visual direction was invented.
- `PRD.md` — full product requirements (23 sections): problem, users, architecture, the pipeline's 12 nodes (N0–N11), UX requirements, data model, compliance, costs.
- `planning.md` — phased execution plan (F0–F8) with granular tasks; useful for terminology (screen names, entity names) referenced across the UI kit.

No Figma file, live codebase, or logo was attached — only the HTML spec and the two docs above. If a repo or Figma exists later, re-run this process against it to true-up spacing/component details.

## Index

- `styles.css` — root stylesheet, `@import`s everything below. Link this one file.
- `tokens/` — `colors.css` (surfaces, accents, semantic), `typography.css` (Geist/Geist Mono + type scale), `spacing.css` (4px scale), `radii-shadows.css` (corner radii; shadows live in `colors.css` since they differ per theme).
- `components/` — reusable primitives, grouped by concern:
  - `core/` — Button
  - `forms/` — Input, Textarea, Select, Switch, Checkbox, Slider
  - `feedback/` — Badge, Alert
  - `navigation/` — Tabs
  - `data/` — MetricsTable
  - `product/` — PipelineNode, CheckpointBanner, VariantCard, SpendLedger, SafeZoneOverlay, EmptyState (see "Intentional additions" below)
- `ui_kits/ugc-factory/` — click-through recreation of the app: pipeline canvas, video library, spend panel, brief editor.
- `guidelines/` — this readme is the guide; foundation specimen cards live throughout `components/` and are also grouped under the Design System tab (`group="Colors"`, `"Type"`, `"Spacing"`, `"Brand"`, `"Components"`).
- `assets/` — no logo was provided (see "Iconography" below); no other brand imagery was provided either.
- `SKILL.md` — Claude Code / Agent Skills-compatible entry point.

### Intentional additions

The HTML spec is the ground truth for every component's visuals, but it presents them as flat specimen sections, not a formal inventory. The following are the primitive names/boundaries I chose when splitting that markup into components — not new designs:

- **PipelineNode**, **CheckpointBanner**, **VariantCard**, **SpendLedger**, **SafeZoneOverlay**: product-specific composites lifted directly from the spec's "Pipeline nodes", "Checkpoint banner", "Video variant cards", "Spend ledger", and "Safe zone overlay" sections respectively — named for clarity, not invented.
- **EmptyState**: the spec shows one inline empty-state card (in the Patterns section); promoted to its own component since it recurs across `/library`, `/gallery`, `/personas` per the PRD.
- **MetricsTable**: generalized from the one worked example ("kill/scale" metrics grid) into a reusable table primitive, since the PRD calls for equivalent tables in `/metrics` and `/spend`.

## Content fundamentals

- **Language**: the spec and product copy are written in **Spanish** (the sole operator is Spanish-speaking); the product itself is multi-lingual for *generated ad content* (es/en day one, per PRD §17), but the **tool's own UI copy is Spanish**. Keep new UI copy in Spanish unless told otherwise.
- **Voice**: terse, technical, operator-to-operator. No marketing tone, no exclamation points, no persuasion — this is a cockpit, not a landing page. Copy states facts and next actions: *"El pipeline está en pausa. Revisa el brief antes de continuar."* / *"Vas al 66%. Alerta configurada al 70% — próxima."*
- **Casing**: sentence case throughout (labels, buttons, headings) — never Title Case, never ALL CAPS except for tiny uppercase eyebrow labels (section numbers, mono metadata headers) which use `letter-spacing` + small size, not for emphasis on real content.
- **Person**: second person imperative for calls to action framed at the operator ("Revisa el brief", "Aprobar y continuar"); first person plural is avoided — it's a tool, not a companion.
- **Numbers & data**: always precise and in `--font-mono`: costs as `$0.09`, `$1.82`; percentages as `31.4%`; confidence as `inferido · 0.78`; ids as `req_a9f2c1`, `N7d`. Never round display numbers for aesthetics.
- **Traceability language**: a recurring, load-bearing pattern — every AI-derived field is labeled **"extraído"** (extracted, with a literal quote as evidence) or **"inferido · <confidence>"** (inferred, with a confidence score). This distinction is a product principle, not just copy — carry it into any new AI-output surface.
- **Emoji**: never used. Status is communicated with color + a small set of glyphs (✓ ✕ ⚠ i ◆), not emoji.
- **Errors/warnings**: specific and actionable, never generic. *"El precio no coincide con el fast path (N1)."* / *"Claim médico bloqueado por el linter. Sugerencia: 'ayuda a lucir la piel más luminosa'."*

## Visual foundations

- **Color**: dark-first, low-saturation neutral surfaces (near-black `#0a0a0b` base) with **one switchable brand accent** — indigo `#6366f1` by default, with emerald/amber/cyan as alternates (a literal control exists in the spec's header to swap it live). A **light theme** is fully defined as an alternate, not an afterthought. **Semantic colors are fixed** across both themes and all accents: success `#22c55e`, warning `#f59e0b`, danger `#ef4444`, info `#3b82f6`, plus a violet `#a78bfa` used narrowly for "premium tier" / "inferred" badges. Never repurpose the accent for status meaning — accent means "brand/primary action," never "success" or "danger."
- **Type**: **Geist** for UI, **Geist Mono** for anything that is data — cost, timestamps, ids, prompts, code, confidence scores. This split is systematic: if a value could be copy-pasted into a terminal or a spreadsheet, it's mono. Display/H1/H2/H3 all carry slightly negative letter-spacing (-0.025em → -0.015em) for a tight, technical feel; body text does not.
- **Spacing**: 4px base scale (4/8/12/16/24/32). Cards use 22–26px internal padding; page sections stack with generous 48px vertical rhythm and a 1px `--border` rule between them — the page reads as a sequence of dense, self-contained modules, not a continuous scroll.
- **Backgrounds**: flat surfaces only — **no gradients, no photography, no illustration, no texture/grain**. The one deliberate exception is a diagonal hatch pattern (`repeating-linear-gradient`, 45°, `--surface-3` + `--stripe`) used exclusively as a placeholder fill for 9:16 video previews that haven't rendered yet.
- **Animation**: minimal and functional only — a `spin` keyframe for loading spinners, and a soft `pulseRing` box-shadow pulse (2s, ease-out) on nodes that are actively running or awaiting approval, to draw the eye without being decorative. No entrance animations, no bounces, no parallax. Transitions are short (`.15s`–`.25s`) on color/background/border/shadow only.
- **Hover states**: surfaces step up one level (`--surface-3` → `--surface-2`/hover-specific token) or the accent shifts to `--accent-hover` (a fixed lighter tint per accent, not computed) — never opacity-based dimming for buttons. Borders often strengthen from `--border-2` to `--border-strong` on hover.
- **Press/active states**: not separately themed in the spec; rely on the browser default plus the existing hover/focus treatment. Add a subtle scale or brightness dip only if a specific interaction calls for it — don't invent a system-wide press style.
- **Focus states**: a soft ring — `box-shadow: 0 0 0 3px var(--ring)` (a low-opacity tint of the accent) plus a solid `--accent` border. Applied to all inputs and interactive controls; this is the *only* place a glow/ring effect appears.
- **Borders & dividers**: 1px hairlines everywhere (`--border` for structure, `--border-2` for control outlines, `--border-strong` for hover/emphasis) — no double borders, no colored borders except for semantic/status callouts (success/warning/danger/info cards use a matching soft-tinted border).
- **Shadows**: three-step elevation (`--shadow-sm/md/lg`), all pure black at varying opacity (dark theme) or very low-opacity black (light theme) — no colored shadows, no glow-as-shadow except the accent focus ring above.
- **Corner radii**: a small, consistent scale — `--r-sm` 5px (chips, checkboxes), `--r-md` 7px (buttons, inputs, most controls), `--r-lg` 10px (cards, panels), `--r-xl` 14px (large containers like the pipeline canvas frame), `--r-full` (pills, badges, avatars, progress bars). Nothing in this system uses a large "friendly" radius (16px+) on a card — cards stay at `--r-lg`/10px.
- **Cards**: 1px `--border`, `--r-lg` radius, `--surface` background, `--shadow-sm` at rest — flat and quiet. Status-colored cards (checkpoint banners, alerts) swap the border for a semantic-tinted one and add a soft semantic-tinted background wash (`color+1a` alpha), never a solid fill.
- **Left accent bars**: the one recurring structural motif — pipeline nodes and some list rows carry a 4px solid color bar on their left edge indicating state (green=done, amber=checkpoint, blue=running, grey=pending). This is the system's signature "status at a glance" device — reach for it on any new stateful row/card, but nowhere else (it is not a generic card decoration).
- **Transparency & blur**: transparency (alpha-tinted fills) is used constantly for soft semantic/accent backgrounds (`--accent-soft`, `--success-soft`, etc.) and for the video-preview dark overlay (`rgba(0,0,0,0.34)`). Backdrop blur is **not** used anywhere in the spec — don't introduce glassmorphism.
- **Imagery color vibe**: no real imagery is defined; the only imagery placeholders are the diagonal-hatch 9:16 video slots. When real product photography/video appears (via generated content, not brand assets), treat it as user content sitting inside a neutral dark frame — don't stylize it.
- **Density**: the spec ships a "compact/balanced/comfortable" density toggle (13/14/15px base) — build new screens to respect `--ui-fs` rather than hardcoding a body size.

## Iconography

- **No icon font, icon library, or SVG icon set is used anywhere in the source spec.** Status and action glyphs are plain Unicode characters set in the UI font: ✓ (success/approved), ✕ (danger/kill/rejected), ⚠ (warning), i (info), ◆ (checkpoint marker), ↺ (retry), ▼ (select caret), + (add/empty-state). This is a deliberate minimalism, not a placeholder — **do not introduce Lucide/Heroicons/an icon font**; keep using plain glyph characters set at 11–20px to match this system.
- Small colored dots (`width/height 6–7px, border-radius 50%`) are used as compact status indicators inline with text (e.g. "Orgánico publicado" next to a green dot).
- Emoji are never used (see Content fundamentals).
- No logo, wordmark, or brand mark was supplied. The header renders the product name **"UGC Factory"** in plain Geist Semibold next to a small solid-color rounded-square mark (just an accent-colored square with a smaller white square inset — a placeholder, not a logo). Do not design or infer a "real" logo from this; if/when a logo exists, drop it into `assets/logo/` and swap the header mark.

## Fonts — substitution note ⚠

Geist and Geist Mono are loaded from Google Fonts (`fonts.googleapis.com/css2?family=Geist…`) rather than from bundled font files, because no font files were attached to this project. `tokens/typography.css` also declares one explicit `@font-face` (Geist Regular, from the same Google-hosted file) so the design-system compiler can register the family; the `@import` above it is what actually loads every weight in the browser. **If you have the official Geist/Geist Mono `.woff2` files, please share them** — I'll swap this for real self-hosted `@font-face` rules with no visual change, just fewer external requests and no CDN dependency.
