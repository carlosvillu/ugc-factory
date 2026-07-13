# T1.19 · El flaky de `runs-canvas.spec.ts` — VERIFICACIÓN

**Veredicto: PASS** · Coste: **$0** · Fecha: 2026-07-13 · Ciclos: 1

## Verificación literal (del planning)

> `pnpm test:e2e` **10 ejecuciones consecutivas en verde** (o el spec eliminado con su causa raíz escrita). Sin `retries` en la config: reintentar es tapar.

## Resultado — ejecutado por el bucle (no por el implementer)

10 pasadas consecutivas de `pnpm test:e2e`, matando `next-server` entre cada una:

```
pasada  1: VERDE — 56 passed      pasada  6: VERDE — 56 passed
pasada  2: VERDE — 56 passed      pasada  7: VERDE — 56 passed
pasada  3: VERDE — 56 passed      pasada  8: VERDE — 56 passed
pasada  4: VERDE — 56 passed      pasada  9: VERDE — 56 passed
pasada  5: VERDE — 56 passed      pasada 10: VERDE — 56 passed
```

**10/10.** Antes de esta tarea el fallo aparecía ≈1 de cada 3 pasadas completas.
`pnpm gate` verde: 1249 tests / 117 ficheros.

## La causa raíz — y era OTRO test

El planning (y cuatro tareas de journal) culpaban a `cancelar OTRO run en curso`.
**Falso: el flaky era el test VECINO del mismo fichero, el de `autopilot`.** Nadie lo había
diagnosticado; solo se había reintentado.

**Veredicto: TEST MAL ESCRITO, no bug de producto.** Traza del rojo capturado:

```
POST /api/runs        t=88.396
SSE conectado         t=91.879
click en el toggle    t=92.947
PATCH /api/runs/:id   t=93.302  → tarda 5.689 ms (compilación en frío bajo carga)
N1 termina            t≈95      → la BD todavía dice autopilot=false  ⇒ el run PAUSA (correcto)
```

El test asertaba `data-run-autopilot` en el DOM, que solo prueba **el optimismo del cliente**
(`setAutopilot(next)` corre ANTES de que el PATCH resuelva) — no la verdad del servidor. El
orquestador es correcto: `shouldPause` lee `autopilot` de la BD **en el instante del checkpoint**,
y en ese instante aún era `false`. **El producto hizo exactamente lo que debía; el test apostaba
a que le daba tiempo.**

Reescrito **sin reloj**, en dos tests deterministas: (a) el toggle **persiste** (assert contra
`GET /api/runs/:id` — la verdad del servidor — con `toPass`), gateado en `waiting_approval`;
(b) con `autopilot:true` desde el lanzamiento, el checkpoint normal no pausa pero el candado
`alwaysPause` gana igual.

## Las otras tres carreras (sin ellas, 10 verdes es inalcanzable)

1. **`spend.spec.ts` — estado global compartido**, no una ventana temporal: `/spend` agrega la
   tabla `cost_entry` ENTERA, y specs de análisis concurrentes insertaban filas después de su
   `DELETE` ($0.99 esperado vs $1.17). Fix **estructural**: proyecto Playwright `spend` con
   `dependencies: ['chromium']` ⇒ corre después de todo lo que escribe coste. **No se serializó
   la suite.**
2. **`brief-editor.spec.ts`** — el locator se re-resolvía contra un conjunto `[data-usable="true"]`
   que **crece de forma asíncrona** (`useThumbnailProbe`): elegía una candidata y clicaba en otra.
   Fix: fijar el elemento por `data-url` tras elegirlo.
3. **`personas.spec.ts`** — el `expect` de 15 s estaba infrapresupuestado para un upload de 2048px
   + `sharp` bajo carga (el DOM seguía en «Subiendo imagen…» a los 47 s). Fix: 3 timeouts
   **localizados** de 60 s en esos asserts, no una subida global.

## Lo que NO se hizo (verificado por el bucle)

- `retries` sigue en **0** en local (`process.env.CI ? 2 : 0`, intacto).
- Ningún `skip`, `fixme` ni `.only`. Ningún test borrado ni debilitado. **No** se puso `workers: 1`.
- `support/http.ts` (nuevo) reintenta **solo cortes de transporte** (`ECONNRESET|socket hang up|
  EPIPE|ECONNREFUSED`, máx. 3): una petición que murió **antes de llegar a la app**. **Cualquier
  respuesta HTTP —incluido un 500— se devuelve intacta y sin reintentar**, así que es incapaz de
  tapar un bug de producto. Leído y confirmado por el bucle.

## Honestidad del alcance

La tarea nombra un spec; se tocaron 5 + la config. Es **en alcance**: la Verificación literal
(«10 pasadas verdes») es inalcanzable con cualquier flaky vivo en la suite compartida.

El test de `cancelar OTRO run` **se dejó con sus asserts intactos**: no se reprodujo su fallo. Que
no cayera en 10 pasadas no demuestra que su carrera sea imposible — solo que con ~3,5× de margen
(20 s frente a los 5,7 s de peor latencia medida) no se manifiesta. La causa queda escrita en el
fichero por si vuelve.
