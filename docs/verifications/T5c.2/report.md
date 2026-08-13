# Verificación T5c.2 — El stop silencioso al aprobar CP3 debe ser VISIBLE (hoy 200 mudo)

- **Tarea**: T5c.2 · El stop silencioso al aprobar CP3 debe ser VISIBLE (`planning.md`)
- **Fecha**: 2026-08-13
- **Ejecutor**: verifier (contexto fresco) · agent-browser 0.27.x · sesión `t5c.2`
- **Sistema**: HEAD `1194fd0` (T5c.1) + **T5c.2 SIN COMMITEAR en el árbol de trabajo** (13 ficheros, `git diff --stat` = 265 insertions / 39 deletions). El código verificado es el del working tree, no el de HEAD. `docker compose dev` (postgres:16 `ugc-postgres-dev`) + `pnpm dev` (web+worker, health `{ok:true,db:true}`) + migraciones aplicadas.

## Verificación esperada (literal de planning.md)
> aprobar CP3 en un tier SIN endpoint de generación → la variante queda `scripted` **y** la UI (cabecera del run) muestra el aviso nombrando el tier y el motivo (no un 200 mudo). Control: en un tier que SÍ genera, no aparece el aviso y navega (T5c.1). **La verificación se hace en un navegador REAL en un tier no-generador** (`f2-scripts.spec.ts` ya aprueba CP3 en ese tier, $0) — NO basta el test unit del panel: mockea el SSE, que es justo el mecanismo (desmontaje) que hace fallar el diseño ingenuo.

## Pasos ejecutados
1. **Higiene**: `check-orphan-workers --strict` → «sin workers vivos ✓»; 4 contenedores postgres huérfanos flagueados y eliminados (`docker rm -f`) antes de empezar.
2. **Gate previo** (`pnpm gate`, exit 0): lint 0 errores (31 warnings de dependencias upstream `sharp`/`prettier`, no del cambio), typecheck, format, knip, readme:status ✓, **248 test files / 2639 tests passed**, + `test:e2e` con las 3 specs de fase.
3. **Verificación PRINCIPAL — navegador REAL (Playwright chromium, dentro del gate)**: `f2-scripts.spec.ts:52` aprueba CP3 en el tier por defecto `test` (no-generador) → observa el aviso `[data-slot="generation-skipped"]` VISIBLE por SSE (sin reload), tras el desmontaje del panel CP3. PASSED (4.6s). El spec asserta el aviso + motivo + tier Y las variantes `scripted` contra la BD del stack.
4. **Integración del servicio** (`scripts-checkpoint.test.ts`, config integration, DOCKER_HOST): el early-return tier-no-ready devuelve `generationSkipped: { reason: 'tier_not_ready', tier: 'test' }`. Verde dentro del gate.
5. **Contraste WCAG del nuevo `Alert tone="info"`** (obligatorio, cua.md Paso 3): renderizado del markup EXACTO de `RunHeader` en el navegador real, `getComputedStyle` en dark Y light → ratios medidos (tabla abajo). Screenshots `01-alert-dark.png` / `02-alert-light.png`.
6. **Consola del navegador**: limpia (`browser-console.txt`) — solo notas dev de Next/React (DevTools, HMR/Fast Refresh), ninguna de código propio.
7. **Control negativo**: revert de la línea discriminante + test en ROJO + restauración probada (ver sección).

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | (a) La variante queda `scripted` tras aprobar CP3 en tier no-generador | `f2-scripts.spec.ts:136-141`: TODAS las variantes del lote (`toHaveLength(variantCount)` + `.every(v.status==='scripted')`) contra la BD del stack → PASS | gate.txt:354 | ✅ |
| 2 | (b) La UI (cabecera del run) muestra el aviso nombrando tier + motivo (no un 200 mudo) | `[data-slot="generation-skipped"]` VISIBLE vía SSE (sin reload); contiene `/no puede generar vídeo todavía/` + `test` | gate.txt:354, 01/02-alert-*.png | ✅ |
| 3 | El aviso sobrevive al desmontaje del panel CP3 (mecanismo SSE) | La cabecera `RunHeader` (siempre montada) lee del run store; el spec navegador-real lo confirma end-to-end (el unit mockea SSE, este no) | gate.txt:354 | ✅ |
| 4 | Servicio: early-return tier-no-ready es explícito | `result.generationSkipped` = `{reason:'tier_not_ready', tier:'test'}` + 0 runs creados (money-gate intacto) | negctrl-integration.txt | ✅ |
| 5 | Contraste AA del aviso en dark Y light | Body+tier 16.48:1 (dark) / 14.77:1 (light), muy por encima de 4.5:1 | contrast-dark.json, contrast-light.json | ✅ |
| 6 | Control (T5c.1): en un tier que SÍ genera, NO aparece el aviso y navega | Cubierto por `f4-generation.spec.ts:95` (PASS, run de generación navegado) + unit `scripts-panel.test.tsx` (rama con `nextRunId`: `push('/runs/...')` llamado Y `[data-slot=generation-skipped]` === null) | gate.txt:474 | ✅ |

### Tabla de contraste (getComputedStyle, navegador real)
| Tema | Elemento | Color texto | Fondo efectivo | Ratio | Umbral | OK |
|---|---|---|---|---|---|---|
| dark (default) | body + tier `test` | `rgb(244,244,245)` (`--text`) | `rgb(15,22,35)` (info-soft s/ page) | **16.48:1** | 4.5:1 | ✅ |
| dark | glyph `i` (aria-hidden, decorativo) | `rgb(59,130,246)` (`--info`) | id. | 4.93:1 | — | ✅ |
| light | body + tier `test` | `rgb(24,24,27)` (`--text`) | `rgb(227,235,248)` | **14.77:1** | 4.5:1 | ✅ |
| light | glyph `i` (decorativo) | `rgb(10,88,216)` | id. | 5.15:1 | — | ✅ |

Nota: el aviso pinta texto de cuerpo estándar (`--text`) sobre `bg-info-soft`, NO un texto de acento semántico. Es una combinación pre-existente del DS (alerts info) que no incurre en el patrón accent-soft de la deuda de /gallery. El `tier` es `font-mono font-semibold` sin override de color → hereda `--text` (mismo ratio, altísimo).

## Control negativo
ROJO reproducido: revertida la línea discriminante `script-checkpoint.ts:268` (`return { generationSkipped: {...} }` → `return {}`), el test de integración FALLA: `AssertionError: expected undefined to deeply equal { reason: 'tier_not_ready', tier: 'test' }` (`scripts-checkpoint.test.ts:612` — `Test Files 1 failed`, `Tests 1 failed`). Salida completa en `negctrl-integration.txt`.

Restauración probada: `cp` desde el backup → `shasum` idéntico (`13295b5c...`), línea 268 de vuelta, y `git diff --stat` recupera exactamente **13 ficheros / 265 insertions / 39 deletions**. El código del implementer quedó intacto (nunca se usó `git checkout HEAD`, porque T5c.2 vive solo en el working tree).

### Detalle
- Línea revertida: la única que fabrica el campo `generationSkipped` en el early-return tier-no-ready (`applyDecidedVerdicts`).
- El assert que muerde: `expect(result.generationSkipped).toEqual({ reason: 'tier_not_ready', tier: 'test' })`.
- El e2e `f2-scripts.spec.ts` también moriría con este revert (el aviso nunca se pintaría), pero no se usó para el control negativo por coste/tiempo — el assert de integración es el discriminante barato y directo.

## Coste real
n/a — sin APIs de pago. El tier de prueba es `test` (precisamente el que NO genera), los e2e usan fakes de Firecrawl/Jina/Anthropic/fal ($0). Ningún lote premium contra fal real. **$0** (estimado $0 ✓).

## Veredicto
**PASS** — aprobar CP3 en tier `test` (no-generador) deja las variantes `scripted` Y la cabecera del run pinta un `Alert tone="info"` nombrando el tier y el motivo, verificado end-to-end en navegador real (Playwright chromium, mecanismo SSE de desmontaje incluido); el control T5c.1 (tier que SÍ genera → sin aviso, navega) sigue verde; contraste AA holgado en ambos temas; control negativo reproduce el ROJO y se restaura limpio.

Notas / rarezas (PASS):
- Logs del gate muestran `LoserRaceError`/`PermanentStepError` en N7 del stack e2e f4: son races de dedup del fake bajo concurrencia que el executor reintenta — el spec f4 acaba en verde, no son fallos del sistema bajo prueba (ni tocan T5c.2).
- Deudas ya declaradas en el planning (no bloquean): el aviso es TRANSITORIO (no sobrevive a reload → durabilidad = T5c.2b) y NO afirma qué endpoint concreto falta (`isTierGenerationReady` es booleano puro). Ambas explícitas en la Entrega re-scopeada.
- Las 31 warnings de lint del gate son upstream (`sharp`/`prettier` named-export), preexistentes, ajenas al diff.
