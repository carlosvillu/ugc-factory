---
name: ugc-factory-design
description: Use this skill to generate well-branded interfaces and assets for UGC Factory, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

Quick orientation:
- `readme.md` — company/product context, content voice, visual foundations, iconography, font substitution note.
- `styles.css` — link this one file for all tokens (colors, type, spacing, radii, motion). Dark theme is default; add `data-theme="light"` on a wrapper for light, `data-accent="emerald|amber|cyan"` for an alternate brand accent (indigo is default).
- `components/` — Button (core), Input/Textarea/Select/Switch/Checkbox/Slider (forms), Badge/Alert/EmptyState (feedback), Tabs (navigation), MetricsTable (data), PipelineNode/CheckpointBanner/VariantCard/SpendLedger/SafeZoneOverlay (product-specific — the pipeline canvas, video library, and spend surfaces).
- `ui_kits/ugc-factory/` — a full click-through recreation (canvas / library / spend) showing every component composed together.
- No logo was supplied — never invent one; use plain "UGC Factory" wordmark + the small accent-square placeholder mark until a real logo is provided.
