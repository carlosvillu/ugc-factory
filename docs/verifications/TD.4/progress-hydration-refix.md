# TD.4 — Refix del console.error de hidratación en Progress

> **ALCANCE ACOTADO.** Este documento NO re-verifica toda la cláusula 1 de TD.4
> (eso ya es PASS en `report.md`). Cubre SOLO el fix puntual del bug de hidratación
> del componente `Progress` detectado DESPUÉS, durante el verify de TD.5.

- **Tarea**: TD.4 · Primitiva `Progress` (`apps/web/src/components/ui/progress.tsx`)
- **Fecha**: 2026-07-08
- **Ejecutor**: subagente verifier · chrome-devtools-mcp (conexión CDP persistente)
- **Sistema**: working tree con `apps/web/src/components/ui/progress.tsx` modificado
  (único fichero del diff, confirmado por `git status`) · **build de producción**
  (`pnpm --filter @ugc/web build && PORT=3100 pnpm start`) · superficie 100% frontend,
  ruta `/design-system` (prerenderizada estática → el HTML servido es exactamente lo que Node emitió)

## Cómo apareció el defecto (honestidad de proceso)

- La **1ª pasada de TD.4** (report.md, PASS de la cláusula 1) probó los overlays,
  toasts y tooltips en dark/light y confirmó los 3 estados del Progress a nivel
  visual/a11y — pero **NO cazó el `console.error` de hidratación**: la captura de
  consola de aquella pasada se centró en el warning `flushSync` del Toast, y el
  mismatch del Progress no se hizo evidente en aquel flujo.
- El defecto lo **halló el verify de TD.5**: al abrir `/design-system` se observó un
  `console.error` de hidratación causado por el `aria-valuetext` del Progress.

## Causa raíz (confirmada empíricamente)

Base UI `ProgressRoot` construye `aria-valuetext` con
`Intl.NumberFormat(locale, { style: 'percent' })`. Sin `locale`, cae al default del
runtime, que difiere entre servidor y cliente:

```
$ node -e "..."   # en esta máquina
default locale: "66 %"  [54, 54, 160, 37]   hasNBSP=true    (node default locale: es-ES)
en-US          : "66%"  [54, 54, 37]        hasNBSP=false
```

- **Servidor (Node, locale del SO `es-ES`)** → `"66 %"` con **NBSP (char 160 / `c2a0`)**.
- **Cliente (navegador, `en-US`)** → `"66%"`.
- Server ≠ client en un atributo → **hydration mismatch → `console.error` que salta
  TAMBIÉN en el build de producción** (no es un warning dev-only tipo `flushSync`).

## Fix aplicado (aislado)

`progress.tsx` fija `locale='en-US'` en `BaseProgress.Root`
(`locale={locale ?? PROGRESS_LOCALE}`, `PROGRESS_LOCALE = 'en-US'`), determinista y
sin NBSP para porcentajes, de modo que servidor y cliente producen el string idéntico.
El caller puede seguir sobrescribiendo `locale` por props. Diff de un solo fichero.

## Resultado observado vs esperado (reverificación en PROD)

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Consola limpia tras carga+hidratación en build de PROD (sin error de hidratación de Progress ni de ningún componente) | `next build` limpio; `pnpm start` en :3100; navegación + hidratación (`readyState=complete`) → `list_console_messages` = **sin mensajes** (0 errores / 0 warnings), tras carga, reload y tras conducir el Progress por sus 3 estados | list_console_messages (vacío en cada punto) | ✅ |
| 2 | `aria-valuetext="66%"` sin NBSP (`c2a0`) | HTML servido por el server: `aria-valuetext="66%"` (grep + xxd → **sin byte `a0`**). DOM cliente tras hidratar: char codes `[54,54,37]` = `6`,`6`,`%` → server = client | design-system-prod.html; evaluate_script | ✅ |
| 3a | Determinado 66% → barra ~66% | valuenow=66, valuetext="66%", `data-progressing`, indicador 252px/384px ≈ 65.6% | evaluate_script | ✅ |
| 3b | Indeterminado (`value=null`) → segmento móvil, no lleno estático | valuenow=null, `data-indeterminate`, sin width inline de Base UI → CSS `w-1/3` = 127px/384px = 33% (segmento parcial animado, no barra completa) | evaluate_script | ✅ |
| 3c | Completo 100% → lleno | Conducido por UI real (4 clicks en «+10%» desde 66): valuenow=100, valuetext="100%" char codes `[49,48,48,37]` (sin NBSP), `data-complete`, indicador 382px/384px = lleno | pr-refix-01-progress-100-prod.png; evaluate_script | ✅ |

Los 3 estados se ejercieron en el build de producción; el paso a 100% se hizo
**como un humano** (clicks reales en el botón «+10%» del showcase, vía CDP hit-test),
no por API ni eval simulado.

## Control positivo del capturador de consola (evita el falso-limpio)

La cláusula 1 es la decisiva y descansa en que `list_console_messages` devuelva vacío.
Para que "vacío" signifique algo, se confirmó que el capturador realmente registra en
ESTA página y sesión: se emitió `console.error('probe-xyz-hydration-control')` +
`console.warn('probe-warn-control')` vía `evaluate_script`, y `list_console_messages`
los devolvió AMBOS (`[error] probe-xyz…`, `[warn] probe-warn…`). El capturador funciona
→ los resultados vacíos previos (tras carga, hidratación y los 3 estados) son evidencia
real de consola limpia, no un capturador mudo.

Nota: la prueba independiente y más fuerte del fix no es la consola sino la igualdad
**server === client**: el HTML servido trae `aria-valuetext="66%"` (sin `c2a0`) y el DOM
hidratado trae los mismos char codes `[54,54,37]`. Un mismatch de hidratación EXIGE
server ≠ client; como ambos son `"66%"`, queda probado que no hay mismatch en ese atributo,
con independencia del capturador de consola.

## Gate

`pnpm gate` **verde**: lint + typecheck + format:check + knip OK; 35 tests (8 files) passed.

## Coste real

$0 — reverificación 100% local (chrome-devtools-mcp contra `next start`), sin APIs de pago (vs estimado $0).

## Veredicto (fix puntual)

**PASS** — El fix (locale fijo `en-US`) elimina el mismatch: server y cliente sirven
`aria-valuetext="66%"` idéntico y sin NBSP, la consola del build de PRODUCCIÓN queda
completamente limpia tras la hidratación (y tras conducir los 3 estados), y los 3
estados del Progress (66% / indeterminado / 100%) siguen correctos. El defecto que la
1ª pasada de TD.4 no cazó queda cerrado y su causa raíz documentada.
