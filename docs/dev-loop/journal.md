# Journal del dev-loop — UGC Factory

> Memoria del bucle entre sesiones. Append cronológico; una entrada por evento (tarea cerrada, bloqueo, parada, decisión de arnés). Escribe para el agente que retomará el trabajo sin tu contexto. Formato en `.claude/skills/dev-loop/SKILL.md`.

## 2026-07-07 · Arnés de desarrollo creado
- Sesión de diseño: investigación del estado del arte (deep-research, 13 hallazgos verificados) + inventario de capacidades de Claude Code.
- Piezas: CLAUDE.md · skill `dev-loop` · agentes `implementer`/`verifier` · hook `guard-planning` (bloquea `[x]` sin evidencia, testeado con 5 casos) · settings con allowlist y `defaultMode: acceptEdits` · este journal.
- Decisiones del usuario: bucle continuo con paradas · git local SIN CI remota por ahora (gate = `pnpm gate` local espejo de `ci-ok`; `ci.yml` se crea igualmente en T0.1, inerte hasta que exista remote) · cap de gasto por tarea = estimado ×3 (mín. $1).
- Deuda del arnés: cuando exista remote de GitHub → activar CI + branch protection (tarea explícita); reevaluar si `pnpm gate` sigue siendo el gate de merge.
- Próximo paso: piloto T0.1 con el bucle completo.

## 2026-07-07 · ⏳ T0.1 iniciada (piloto del arnés)
- Primera ejecución real del ciclo dev-loop completo. Sin dependencias previas; coste esperado $0.

## 2026-07-07 · T0.1 cerrada — PASS
- Coste: $0 · Ciclos verifier: 1 (PASS a la primera tras review) · Tests: 27 en 6 suites · Evidencia: docs/verifications/T0.1/
- Ciclo completo del arnés ejercitado: implement → gate (cazó binding nativo x64/arm64: Rosetta+nvm mixto; fix = supportedArchitectures en pnpm-workspace.yaml) → review 6 ángulos (4 bugs correctness confirmados: LOG_PRETTY crasheaba worker prod, LOG_LEVEL inválido tumbaba /api/health, golden.ts percent-encoding+catch tragón, exit(0) racea flush de pino; + test:live sin budget guard y test:e2e falso verde, desarmados con guards ruidosos hasta T1.8/T0.4) → verify → close.
- Máquina: shells bajo Rosetta (uname x86_64) con nvm mixto (22-arm64 default, 24-x64 en .nvmrc). El gate ya es verde en ambos mundos.
- Arnés: agentes implementer/verifier aún no registrados en la sesión que los creó (requieren reinicio) — fallback general-purpose con definición inlineada funcionó; desde la próxima sesión se usan directos.
- Skills actualizadas deliberadamente: tooling.md §2 (eslint-config-next ≥16 flat nativo, sin FlatCompat; react-hooks ≥7) y stack-setup.md §4.5 (expectGolden con fileURLToPath, nunca .pathname). La skill externa pnpm no documenta supportedArchitectures (hueco conocido).
- Deuda anotada: tsup no typechequea (la rotura del worker la caza pnpm typecheck del gate — comportamiento estándar); pnpm -r --parallel typecheck aborta al primer fallo (evidencia de fallos múltiples exige --filter aislado).

## 2026-07-07 · arnés: review con effort proporcional al riesgo
- Feedback del usuario tras el piloto (duración). El paso REVIEW del dev-loop ahora escala: low para diffs pequeños/mecánicos, medium por defecto, high solo en orquestador/dinero/seguridad. T0.1 fue el caso máximo (bootstrap de 60+ ficheros + primera vez del arnés); el régimen normal por tarea será sensiblemente más corto.

## 2026-07-07 · arnés: skill dev-help creada
- Punto de entrada humano al arnés a petición del usuario: `/dev-help [pregunta]` explica piezas, comandos, flujos, paradas, presupuesto y cómo intervenir, fundándose en los ficheros reales. Manual completo en `.claude/skills/dev-help/references/tour.md`. Referenciada desde CLAUDE.md.

## 2026-07-07 · Fase FD (design system) creada en el planning
- Origen: el usuario pobló el proyecto «UGC Factory Design System» en Claude Design (tokens completos, 17 componentes en 6 grupos, guidelines, ui_kit) y pidió convertirlo en la piedra angular de toda UI ANTES de seguir con F0.
- Decisiones del usuario (4, vía AskUserQuestion): FD se ejecuta YA — tras T0.1, antes de T0.2 (T0.2 ganó una dependencia de ORDEN sobre TD.7, no técnica) · los 5 componentes de producto (PipelineNode, CheckpointBanner, VariantCard, SpendLedger, SafeZoneOverlay) se crean ahora como presentacionales PUROS · las primitivas que el DS no define (dialog, sheet, toast, tooltip…) se crean con sus foundations y se SUBEN a Claude Design (TD.4) · obligatoriedad de uso = skill frontend endurecida + lint ESLint de adherencia (TD.6).
- Piezas tocadas: planning.md (fase FD con TD.1–TD.7 + fila en Estado global + nota en T0.14: /settings ganará tema/acento/densidad — cambio menor anotado también en PRD §8) · hook guard-planning ahora protege también `TD.\d+` (re-testeado: bloquea sin evidencia, permite legítimos) · skill frontend actualizada deliberadamente (references/design-system.md REESCRITO contra el DS real: hex verbatim —no OKLCH—, naming 1:1 --bg/--surface/--text-2/--r-*, dark default + data-theme/data-accent, Geist self-hosted, glifos Unicode SIN lucide, inventario §4, obligatoriedad; SKILL.md: principio 1, convenciones, iconografía) · dev-help/tour.md y CLAUDE.md al día · eslint.config.ts ignora docs/design-system/**.
- Espejo del DS en docs/design-system/ (solo lectura, regenerable con la tool DesignSync): en curso al escribir esto; queda verificado antes del commit. HALLAZGO del arnés: DesignSync NO está disponible de forma fiable en subagentes («exists but is not enabled in this context», comportamiento flaky — algunos hijos frescos sí la cargan vía ToolSearch, otros no); las tareas que suban al DS (TD.4) deben prever que la subida la haga el bucle principal en el CLOSE si el implementer no tiene la tool.
- Estado: arnés preparado; el usuario lanzará /dev-loop él mismo (decisión explícita — quiere probar el flujo). Próxima tarea elegible: TD.1. Coste de la fase estimado: $0.

## 2026-07-07 · ⏳ TD.1 iniciada
- Primera tarea de la fase FD. Tokens del DS → globals.css, Geist self-hosted, showcase /design-system con switchers. Coste esperado $0.

## 2026-07-07 · TD.1 cerrada — PASS
- Coste: $0 (vs estimado $0) · Ciclos verifier: 1 (PASS a la primera) · Tests: 30 en 7 suites · Review: low (diff mecánico de volcado, sin hallazgos) · Evidencia: docs/verifications/TD.1/ (5 screenshots + console + report).
- Nota de reanudación: la sesión anterior dejó `⏳ TD.1 iniciada` en el journal SIN commitear pero NUNCA implementó nada (ni código ni docs/verifications/TD.1). Esta sesión retomó TD.1 desde cero; el árbol estaba limpio salvo esa línea, que quedó absorbida en este cierre.
- Decisiones no obvias que la siguiente tarea de la fase debe heredar:
  - **Densidad**: mecanismo `[data-density="compact|balanced|comfortable"]` en `<html>` → `--ui-fs` 13/14/15px; balanced=14 es el default de `:root` (NO se estampa atributo). Igual para tema (dark default sin atributo) y acento (indigo default sin atributo): SSR limpio, sin hydration mismatch. Sienta precedente para /settings (T0.14). Helpers puros testeados en `components/design-system/apply-appearance.ts` — reutilizables.
  - **Escala tipográfica mapeada a `@theme inline`** (`text-h1`/`text-display`/`text-mono`… con line-height y letter-spacing horneados via `--text-*--line-height`/`--letter-spacing`) para que los specimens usen SOLO clases de token y sobrevivan al lint de adherencia de TD.6. Igual con `tracking-*`, `leading-*`, `font-weight-*`, `--spacing-space-*`.
  - **Keyframes**: nombres verbatim del espejo `ugc-spin`/`ugc-pulse-ring`, fuera de `@theme` (siempre emitidos); `@theme inline` mapea `--animate-spin`/`--animate-pulse-ring`. `prefers-reduced-motion` apaga `.animate-pulse-ring`.
  - **Fuentes**: paquete npm `geist` (self-hosta los .woff2, servidos desde `/_next/static/media`; 0 requests a googleapis/gstatic — verificado en network). Cierra la nota ⚠ de fuentes del readme del DS. NO se copió el `@import`/`@font-face` de Google Fonts del espejo (era placeholder).
  - Naming: elevación es la ÚNICA desviación (`--shadow-*` del DS → `--elevation-*` en :root para evitar var() circular; las clases resultantes conservan `shadow-sm/md/lg`).
- Deuda anotada: en la card «Acento de marca», el swatch etiquetado "indigo" lee `--accent` vivo (con emerald activo se ve verde). Cosmético, no bloqueante (verifier lo marcó); considerar en TD.7 renombrar el label a "activo" o marcar el default. · `next-env.d.ts` flipa `.next/types`↔`.next/dev/types` según último comando dev/build; se restauró antes del commit para no meter ruido (el gate corre build y lo deja en `.next/types`).

## 2026-07-07 · ⏳ TD.2 iniciada
- Primitivas core+forms (button, input, textarea, select, checkbox, switch, slider) con shadcn sobre Base UI, 1:1 al espejo, glifos Unicode. Es la PRIMERA tarea de componentes: incluye el setup inicial de shadcn/Base UI (no existe components.json ni components/ui/). Coste esperado $0.

## 2026-07-07 · TD.2 cerrada — PASS
- Coste: $0 (vs estimado $0) · Ciclos verifier: 2 (1 FAIL → fix → PASS) · Tests: 30 en 7 suites · Review: medium (fija el patrón de todos los componentes) · Evidencia: docs/verifications/TD.2/ (17 screenshots + a11y dumps dark/light + console).
- Entregado: setup inicial shadcn/Base UI (components.json, lib/utils.ts cn, deps @base-ui-components/react 1.0.0-rc.0 + cva + tailwind-merge + clsx) + 7 primitivas en components/ui/ (button, input, textarea, select, checkbox, switch, slider) 1:1 al espejo, glifos Unicode, sin lucide/radix · 2 secciones nuevas en /design-system.
- Decisiones no obvias que heredan TD.3–TD.5:
  - **Spacing FRACCIONARIO es el mecanismo de fidelidad al px, NO arbitrario**: `size-4.5`=18px, `w-9.5`=38px, `size-8.5`=34px (sin corchetes, usa token `--spacing`=4px default de Tailwind v4; lint-limpio, ya en TD.1). El implementer redondeó a la escala entera (`w-11`/`size-5`) en la 1ª pasada → la review lo cazó como desviación del espejo. Corolario para TD.6: el lint de adherencia debe acotarse a corchetes arbitrarios + paleta cruda + libs de iconos; NO prohibir spacing fraccionario.
  - **Checkbox etiquetado = un ÚNICO `<button role="checkbox">`** (nativeButton render, caja+texto dentro del mismo control). NO envolver la Root de Base UI en `<label>` ni usar `<label htmlFor>` hermano: ambos crean doble camino de activación (el control togglea + el label reenvía → net no-op al click de ratón; solo funcionaba teclado). Base UI apunta el `for`/`id` al `<input>` oculto, no al elemento con role. Este fue el FAIL del verifier — lo cazó la interacción real en navegador, invisible a los tests. Patrón a reutilizar en cualquier control etiquetado de Base UI.
  - **Select nativo** (no Base UI): desviación documentada en select.tsx, 1:1 con la card, role=combobox accesible gratis. Contradice el inventario de la skill (design-system.md §4 lista select sobre Base UI) → resuelto a favor del espejo (jerarquía); anotar en TD.7 al cerrar la skill contra la realidad.
  - **Slider aria-label**: el role=slider vive en el `<input>` del Thumb (descendiente), NO en Root. Un aria-label del caller vía props cae en Root (el grupo) y NO nombra el control → hay que reenviarlo al Thumb vía getAriaLabel. Asimetría con Switch/Checkbox (role en Root). Trampa a recordar para F0.
- Deuda anotada: doble-labeling residual del checkbox resuelto por el rediseño (name-from-contents). Specimen duplicado entre foundation-specimens.tsx y component-specimens.tsx + strings de error/base triplicados en input/textarea/select — extracción trivial pendiente, NO bloqueante (candidata a limpieza en TD.3 o TD.7). Switch/Select sin guardrail de accessible name propio (fiel al espejo; el showcase los nombra) — trampa para los wrappers de F0, no defecto de TD.2.
- Arnés/cambio menor (regla 6): las `*.card.html` del espejo son INEJECUTABLES (cargan _ds_bundle.js ausente del dump read-only → renderizan en blanco). La Verificación CUA de TD.2–TD.5 se hace contra las specs `.jsx` que las cards importan + medición runtime, no A/B pixel. Anotado en la Verificación de TD.2 en planning.md. TD.1 topó con lo mismo.
- Nota de tooling para futuras verificaciones: el `.click()` sintético de agent-browser NO dispara el toggle de componentes `nativeButton` de Base UI; usar secuencia de puntero real vía CDP (move→down→up) midiendo aria-checked antes/después.
