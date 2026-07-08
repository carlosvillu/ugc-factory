# Verificación TD.5 — Componentes de producto (presentacionales puros)

- **Tarea**: TD.5 · Componentes de producto (presentacionales puros) (`planning.md`)
- **Fecha**: 2026-07-08
- **Ejecutor**: verifier (contexto fresco) · chrome-devtools-mcp (inspección + a11y tree) + Playwright 1.60.0 (emulación reduced-motion, instalado en scratchpad, proyecto intacto)
- **Sistema**: working tree sobre commit `f8aaeab` (TD.4) · `pnpm --filter @ugc/web dev` (Next 16.2.10, Turbopack) · sin compose/seeds (página estática de server components). Los 5 componentes TD.5 están en el working tree sin commitear (estado `A`), es el código que corre.
- **Gate previo**: `pnpm gate` VERDE (eslint + typecheck + format:check + knip + 35 tests en 8 files).

## Verificación esperada (literal de planning.md)
> CUA vs `pipeline-node.card.html` y `variant-spend-safezone.card.html` (dark y light); el pulso se apaga con `prefers-reduced-motion` sin perder el estado visible.

Nota (planning §143): las `.card.html` son inejecutables localmente (cargan `_ds_bundle.js` ausente) → la comparación se hace contra las specs `.jsx` que importan + medición runtime, como en TD.1–TD.4.

## Pasos ejecutados
1. Leídas las 5 specs del espejo (`product/{PipelineNode,CheckpointBanner,VariantCard,SpendLedger,SafeZoneOverlay}.jsx`) y contrastadas 1:1 con los 5 componentes en `apps/web/src/components/ui/`.
2. Levantado `pnpm --filter @ugc/web dev`; `/design-system` responde 200; sección de producto (`ProductSpecimens`) renderiza los 5 componentes en todos sus estados.
3. **pipeline-node** (dark, sin RM): medido `offsetWidth`, `animationName`, `boxShadow`, `borderColor` de los 4 estados en runtime.
4. **variant-card a11y**: `take_snapshot` (árbol de accesibilidad autoritativo del navegador) → `a11y-tree-full.txt`.
5. **reduced-motion**: Playwright `emulateMedia({ reducedMotion })` en `no-preference` y `reduce`, en dark Y light, con aserción `matchMedia(...).matches` load-bearing (False→True). Medido checkpoint y running (los dos con anillo).
6. Screenshots dark+light de toda la sección de producto y crops del pipeline en los 4 combos tema×RM.
7. Consola capturada en ambos temas.

## Resultado observado vs esperado

### pipeline-node — estados, glifo/color/dot, width, pulseRing
| Estado | Esperado (spec) | Observado runtime | OK |
|---|---|---|---|
| done | barra/dot `--success`, shadow-sm, sin pulso, w=168 | verde, `animationName: none`, shadow-sm, offsetWidth 168 | ✅ |
| checkpoint | barra/dot/borde `--warning`, pulso, w=180 (prop) | amber `rgb(245,158,11)`, `ugc-pulse-ring`, offsetWidth 180 | ✅ |
| running | dot `--info`+spinner, borde `--border-2`, pulso, w=180 | spinner azul, borde gris, `ugc-pulse-ring`, offsetWidth 180 | ✅ |
| pending | barra/dot `--text-3`, opacity 72, sin pulso, w=168 | gris, `animationName: none`, offsetWidth 168 | ✅ |

Width-por-prop confirmado: 168 default, 180 cuando `width={180}`. done/pending NO tienen halo 3px (solo shadow-sm) → el halo es state-specific.

### checkpoint-banner
Fiel a `CheckpointBanner.jsx`: fill `warning-soft`, borde `warning-border`, chip ◆ (aria-hidden), compone Button ×3 con roles/labels correctos: **Editar** (secondary), **Rechazar** (danger-ghost), **Aprobar y continuar** (success-tinted). ✅

### variant-card — estados, badges, spinner, y a11y (requisito explícito)
| # | Esperado | Observado (árbol a11y `take_snapshot`) | OK |
|---|---|---|---|
| approved | badge lee "aprobada", NO "✓ aprobada"; ✓ aria-hidden | `StaticText "aprobada"` (líneas 182,227 de a11y-tree); ✓ ausente del árbol | ✅ |
| composing | spinner 3px, badge "componiendo" info | `StaticText "componiendo"`; spinner presente | ✅ |
| failed | ⚠ (aria-hidden), badge "fallo" danger, borde danger | `StaticText "fallo"`; ⚠ ausente del árbol; borde `danger-border` | ✅ |
| acciones | linaje/ver/reintentar sin glifo →/↺ | links `"linaje"` / `"ver"` / `"reintentar"`, sin →/↺ en el árbol | ✅ |

**El fix de a11y está confirmado en el árbol autoritativo**: los glifos decorativos ✓/→/↺ NO se leen; el badge lee "aprobada".

### spend-ledger
Barra `--accent` proporcional sobre track `--surface-3`, dos ticks (warning/danger) en sus umbrales, labels 0/70%/90%/100%, figura `text-h1` (30px), nota inline `warning-soft`+⚠. Estructura 1:1 con `SpendLedger.jsx`. Fill 100% cuando spent>budget (spendPct clamp, unit-tested). ✅

### safe-zone-overlay
Hatch diagonal 9:16 (`hatch-9x16-wide`, 12px band), scrim `--overlay` (rgba 0,0,0,0.34), recuadro 1.5px dashed `--accent` + fill `--accent-soft`, borde discontinuo. Insets por preset **exactos vs spec**: universal {14.06/12.96/35/6.02}, tiktok {6.77/12.96/25.2/4.07}, meta {14/6/35/6}. Preset `off` → solo hatch+scrim, sin recuadro, label vacía. ✅

### REQUISITO EXPLÍCITO — reduced-motion (pulso off, estado preservado)
Aserción `matchMedia('(prefers-reduced-motion: reduce)').matches`: False en no-preference, True en reduce (load-bearing, verificada en ambos temas).

| Tema | RM | Estado | animationName | box-shadow (halo) | borderColor | OK |
|---|---|---|---|---|---|---|
| dark | no-preference | checkpoint | `ugc-pulse-ring` | `0 0 0 4.76px` (fluctuante, mid-keyframe) | amber | ✅ pulso ON |
| dark | no-preference | running | `ugc-pulse-ring` | `0 0 0 4.76px` (fluctuante) | gris | ✅ pulso ON |
| dark | **reduce** | checkpoint | **`none`** | **`rgba(245,158,11,0.133) 0 0 0 3px`** (estable) | amber | ✅ pulso OFF, halo+borde |
| dark | **reduce** | running | **`none`** | **`rgba(59,130,246,0.133) 0 0 0 3px`** (estable) | gris (dot/halo azul) | ✅ pulso OFF, halo |
| light | no-preference | checkpoint | `ugc-pulse-ring` | fluctuante | amber | ✅ pulso ON |
| light | no-preference | running | `ugc-pulse-ring` | fluctuante | gris claro | ✅ pulso ON |
| light | **reduce** | checkpoint | **`none`** | **`rgba(245,158,11,0.133) 0 0 0 3px`** | amber | ✅ |
| light | **reduce** | running | **`none`** | **`rgba(59,130,246,0.133) 0 0 0 3px`** | gris claro (dot/halo azul) | ✅ |

Bajo reduced-motion el pulso animado se apaga (`animationName: none`) pero permanece un anillo **estático** de 3px (`pulse-ring-static`) + borde/dot de color → checkpoint y running siguen claramente distinguibles. done/pending no ganan halo bajo reduce (siguen shadow-sm). Confirmado visualmente en `pipeline-{dark,light}-rm-reduce.png`.

## Evidencias
- `a11y-tree-full.txt` — árbol de accesibilidad (variant-card lee "aprobada"/"componiendo"/"fallo", links sin glifo).
- `product-dark-full.png`, `product-light-full.png` — secciones de producto completas en ambos temas.
- `pipeline-dark-rm-no-preference.png`, `pipeline-dark-rm-reduce.png`, `pipeline-light-rm-no-preference.png`, `pipeline-light-rm-reduce.png` — evidencia del pulso con/sin reduced-motion.

## Coste real
$0 — verificación 100% local, sin APIs de pago (vs estimado $0). ✅

## Veredicto
**PASS** — los 5 componentes de producto son fieles a las specs del espejo en dark y light, y el requisito explícito de reduced-motion se cumple exactamente: el pulso se apaga y el estado permanece visible (halo estático 3px + borde/dot de color) en ambos temas y ambos estados activos. El fix de a11y (glifos decorativos aria-hidden) está confirmado en el árbol autoritativo.

### Rarezas / hallazgos (no bloquean TD.5)
- **`console.error` de hidratación en `/design-system`, ajeno a TD.5**: Base UI `ProgressRoot` emite `aria-valuetext="66%"` (cliente) vs `"66 %"` (servidor) → hydration mismatch. El componente `Progress` es de **TD.4** (`OverlaySpecimens`), NO es un componente TD.5, no está referenciado por `product-specimens.tsx`, y `progress.tsx` no está modificado en este working tree. Un `aria-valuetext` (string) no puede verse afectado por CSS ni por el wiring de TD.5 → definitivamente independiente de TD.5. No se aplica la excepción dev-only/muere-en-prod de cua.md §Paso 3 (los mismatches de hidratación disparan el `console.error` también en prod; solo el diff verboso es dev-only). **Recomendación al bucle/usuario**: reabrir TD.4 o crear tarea de fix — el `OverlaySpecimens` (con Progress) ya estaba en `/design-system` desde TD.4 y su nota afirmaba consola limpia; este error no se detectó entonces. Fuera del alcance del implementer de TD.5.
```

_(Report persistido por el bucle principal: el harness bloquea la Write en subagentes para este path; el contenido es el emitido literalmente por el verifier.)_
