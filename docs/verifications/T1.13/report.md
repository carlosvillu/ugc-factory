# Verificación T1.13 — Base URL del fetch de servidor + navegación global

- **Tarea**: T1.13 · Base URL del fetch de servidor + navegación global (`planning.md`, F1b)
- **Fecha**: 2026-07-12
- **Ejecutor**: subagente `verifier` · agent-browser 0.27.0 · sesión `t1.13`
- **Sistema**: working tree sobre commit `ef1f35b` (diff de T1.13 sin commitear, verificado tal
  cual) · docker compose dev (`ugc-postgres-dev`) + `PORT=3001 pnpm dev` · BD con datos reales
  preexistentes (runs de F1, ledger de gasto). `.next` purgado antes del ciclo.
- **Coste**: **$0** (ninguna API de pago tocada).

## Verificación esperada (literal de planning.md)

> Con el dev server en **3001** y **sin exportar `INTERNAL_API_URL` a mano**, `/spend` y
> `/settings` cargan correctamente en el navegador; y desde la home se llega a las páginas
> existentes **sin escribir ninguna URL**.

## Gate previo

`pnpm gate` (lint + typecheck + format:check + knip + test) en **verde**: 98 ficheros, **958 tests
pasados**, formato y knip limpios. Output en `gate.txt`.

## Condiciones de arranque (lo que impide un PASS falso)

El fix depende de que `process.env.PORT` llegue al runtime de Next. Se comprobó ANTES de mirar nada:

1. **Lanzado como lo haría el usuario, sin muleta**:
   `env -u INTERNAL_API_URL PORT=3001 pnpm dev`.
   `apps/web/package.json` → `dev: node scripts/dev.mjs` → `spawn(next, ['dev'])` **sin flag `-p`**:
   Next elige puerto leyendo `PORT` del entorno, que es exactamente el canal que el fix usa. No hay
   `-p` que pudiera fijar el puerto de escucha sin poblar `process.env.PORT`.
2. **`INTERNAL_API_URL` NO existe**: ausente del shell (`env | grep` vacío), ausente de `.env`
   (grep vacío) y ausente del entorno del proceso servidor. El stack E2E ya no la fija (la muleta
   se retiró en el diff).
3. **Nada de esta app escucha en el 3000**: `curl localhost:3000/api/health` → conexión rechazada
   (`http_code=000`). Esto **cierra las dos puertas del falso PASS**: si el código siguiera clavado
   al 3000, el fetch de servidor moriría con ECONNREFUSED → 500; y no hay ningún servidor viejo
   sirviendo respuestas por detrás.
4. **Salud en 3001**: `{"ok":true,"db":true}`.

Prueba de que el bug era real (`git show HEAD:apps/web/src/lib/api-server.ts`):
`baseUrl: process.env.INTERNAL_API_URL ?? 'http://localhost:3000'` — sin override y con el 3000
vacío, ese fetch NO podía resolver. Que las páginas rendericen hoy solo se explica por la base
derivada del PORT.

## Pasos ejecutados (todo conducido en navegador, como un humano)

1. `/login` → renderiza el form. **Sin nav**: 0 `[data-slot=app-nav]`, 0 `header`, 0 `nav` en el
   DOM (`01-login-sin-nav.png`). El route group `(app)` no le cuelga chrome encima.
2. Login con la contraseña real (fill + click "Entrar") → aterriza en `/`.
3. **Home** (`02-home-con-nav.png`, `03-arbol-a11y-home.txt`): topbar con los 6 destinos + las 2
   utilidades a la derecha, y tarjetas "Ir a" derivadas de `lib/routes.ts`.
4. **Destinos deshabilitados** — árbol de accesibilidad (`13-a11y-deshabilitados.json`) y pruebas
   de comportamiento (`04-deshabilitados-click-y-teclado.txt`):
   - `<span role="link" aria-disabled="true">`, **sin `href`**.
   - **El motivo va en el NOMBRE ACCESIBLE** (`aria-label`), no solo en `title`: p. ej.
     `"Biblioteca · llega en la fase F2 (guiones y variantes)"`. El snapshot del árbol a11y del CLI
     los lista literalmente como `link "Biblioteca · llega en la fase F2 (guiones y variantes)" [disabled]`.
   - **Click → NO navegan**: URL idéntica antes y después en los 3.
   - **Teclado → NO son tabulables**: se recorrió un ciclo COMPLETO de Tab (12 pulsaciones, hasta
     dar la vuelta). Orden de foco observado: marca → Inicio → Canvas → **[los 3 saltados]** →
     Gasto → Design system → Ajustes → tarjetas de la home. Nunca reciben foco.
5. **Navegación a golpe de click, sin escribir NINGUNA URL** (`07-navegacion-por-click.txt`):
   - Home → click "Gasto" → `/spend`.
   - `/spend` → click "Ajustes" → `/settings`.
   - `/settings` → click en la marca "UGC Factory" → `/` (**la forma de volver**).
   - Home → click "Canvas" → `/analyses/new` (`<h1>Nuevo análisis</h1>`, form presente).
   - Home → click "Design system" → `/design-system` (`<h1>Design system</h1>`).
6. **Canvas** `/runs/01KXAR7Z14ZJYA11XSPTMK3YFG` (run REAL preexistente de la BD; escenario
   preparado por BD, observación en navegador): medición del layout tras el cambio
   `h-dvh`→`h-full` (`08-canvas-run-sin-doble-scroll.png`).
7. **Consola y errores del navegador**: capturados en el canvas y al final de toda la sesión.
8. **Contraste texto/fondo de la topbar** en dark Y light (`14-contraste-nav.md`).

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Dev server en 3001 **sin `INTERNAL_API_URL`** | Lanzado con `env -u INTERNAL_API_URL PORT=3001`; var ausente en shell, `.env` y proceso; nada escuchando en 3000; health `{ok:true,db:true}` | §Condiciones | ✅ |
| 2 | **`/spend` carga** (antes: 500) | `<h1>Gasto</h1>` + **datos reales del fetch de servidor**: presupuesto $2.34/$30, Anthropic 484 706 tokens $2.32, Firecrawl 49 credits $0.02, gasto por día | `05-spend-cargado.png` | ✅ |
| 3 | **`/settings` carga** (antes: 500) | `<h1>Ajustes</h1>`, sección "Apariencia", 6 inputs, credenciales de proveedores | `06-settings-cargado.png` | ✅ |
| 4 | Desde la home se llega a las páginas existentes **sin escribir URLs** | Alcanzadas a golpe de click: `/spend`, `/settings`, `/analyses/new`, `/design-system`, y vuelta a `/` por la marca | `07-navegacion-por-click.txt` | ✅ |
| 5 | `/` y `/analyses/new` renderizan | `<h1>UGC Factory</h1>` + tarjetas "Ir a"; `<h1>Nuevo análisis</h1>` + form | `02`, `07` | ✅ |
| 6 | Los 3 destinos deshabilitados **no navegan (click ni teclado)** y el motivo está en el **nombre accesible** | `role=link` + `aria-disabled=true` + sin `href`; `aria-label` con el motivo; click no cambia la URL; ciclo completo de Tab nunca los enfoca | `13-a11y-deshabilitados.json`, `04-...txt` | ✅ |
| 7 | **Ninguna URL cambió** por el route group `(app)` | `/spend`, `/settings`, `/analyses/new`, `/design-system`, `/runs/:id` sirven en sus rutas de siempre | `07`, §Canvas | ✅ |
| 8 | El canvas **no se rompe** (ni doble scroll ni altura 0) | nav 47px, `innerHeight` 577. Página **no scrollea** (`docScrollHeight` 577 == 577). Contenedor del layout **no desborda** (`scrollHeight` 530 == `clientHeight` 530). `run-shell` `clientHeight` = **530 = 577−47** exacto → `h-full` aplicó y la topbar se resta UNA vez. 3 nodos React Flow pintados | `08-canvas-...png` | ✅ |
| 9 | `/login` **sin nav** | 0 `app-nav`, 0 `header`, 0 `nav` en el DOM | `01-login-sin-nav.png` | ✅ |
| 10 | Sin errores de consola | **0 errores** en el canvas y en toda la sesión. Consola solo con ruido dev de Next (Fast Refresh, HMR, aviso de React DevTools) — infraestructura, nada de código propio | `09`, `10`, `12` | ✅ |

### Discriminador del punto 8 (para que la medición sea creíble)

Una medición que dijera "no hay scroll" en TODAS las páginas estaría midiendo el nodo equivocado.
Contraste sobre el **mismo** contenedor del layout:

- **`/runs/:id`** (full-bleed): `scrollHeight` 530 == `clientHeight` 530 → **no scrollea**.
- **`/spend`** (documento): `scrollHeight` 532 > `clientHeight` 530 → **sí scrollea**, y la página
  (`document`) sigue sin scrollear.

Es decir: el scroll ocurre DENTRO de la región del layout en las páginas de documento y no ocurre
en el canvas — exactamente el diseño que el layout `(app)` describe. No hay doble scroll en ningún
caso.

## Coste real

**$0** — vs estimado $0. La verificación no invoca ninguna API de pago: solo el stack local
(Postgres + web). El run usado para el canvas ya existía en la BD (su coste, $0.12, es de F1 y no
se imputa aquí). Nada nuevo entró en el ledger.

## Veredicto

**PASS** — los 2 observables de la Verificación se cumplen literalmente: con el server en 3001 y
sin `INTERNAL_API_URL` (verificado ausente en shell, `.env` y proceso, y con el 3000 vacío para que
un hardcode no pudiera colarse), `/spend` y `/settings` **renderizan con datos reales** donde antes
daban 500; y desde la home se llega a todas las páginas existentes **a golpe de click**, con forma
de volver. Los 3 destinos pendientes son inertes (ni click ni teclado) y anuncian su motivo en el
nombre accesible. El route group no movió ninguna URL, el canvas no sufrió por `h-dvh`→`h-full`
(medido, no estimado), `/login` no hereda la nav y la consola está limpia.

### Hallazgo a rutear (NO bloquea T1.13) — contraste del token `--text-3` en dark

Los items IDLE de la topbar dan **3.81:1** en dark (< 4.5:1 de AA para texto normal de 13px). El
estado **activo**, que es la señal nueva que T1.13 introduce, pasa con holgura (14.58 dark / 15.30
light), y en light los idle dan 4.83 (pasan).

La causa NO está en esta tarea: el color viene del token compartido del DS **`--text-3: #71717a`**
(`apps/web/src/app/globals.css`, mismo valor en el bloque dark y en el light), ya usado por ≥10
ficheros anteriores (`login/page.tsx`, `settings/page.tsx`, `login-form.tsx`, `brief-editor.tsx`,
los specimens del design-system…). La nav simplemente usa el mismo token de "texto secundario" que
el resto de la app. Y no es que esos usos previos escapen al umbral por ser texto grande: **15 de
ellos combinan `text-text-3` con `text-small`** (cuerpo de `settings/page.tsx`, `login-form.tsx`…),
es decir texto normal y pequeño en dark, exactamente el mismo caso que la nav. El defecto es del
valor del token y ya estaba en la app antes de T1.13. Conforme a cua.md ("hallazgo a rutear si el color viene del DS: el defecto está
en los valores del DS, decisión del usuario, pero se REPORTA con la tabla de ratios"), queda
reportado con la tabla completa en `14-contraste-nav.md`. **Afecta a toda la app, no a T1.13**, y
arreglarlo es tocar el DS — fuera del alcance de esta tarea.

Los 3 destinos deshabilitados dan 2.38 (dark) / 2.56 (light), pero WCAG 1.4.3 **exime** el texto de
componentes inactivos, así que no es defecto.

### Rarezas

- `npx agent-browser find role link --name "Ajustes"` falló una vez con "Element not found" justo
  tras una navegación, mientras el árbol a11y sí listaba el link. Artefacto del CLI con refs
  caducados, no de la app: re-snapshot + click por ref (`@e16`) funcionó a la primera. La app es
  clicable con normalidad.
- `knip` emite un hint de configuración preexistente (`src/golden.ts` en `packages/test-utils`),
  ajeno a esta tarea y sin romper el gate.

## Evidencia

| Fichero | Qué es |
|---|---|
| `gate.txt` | `pnpm gate` en verde (958 tests) |
| `01-login-sin-nav.png` | `/login` renderiza sin topbar |
| `02-home-con-nav.png` | Home con la nav global y las tarjetas |
| `03-arbol-a11y-home.txt` | Árbol de accesibilidad completo de la home |
| `04-deshabilitados-click-y-teclado.txt` | Click no navega + ciclo completo de Tab |
| `05-spend-cargado.png` | **`/spend` con datos reales** (el 500 de antes) |
| `06-settings-cargado.png` | **`/settings` cargado** (el otro 500) |
| `07-navegacion-por-click.txt` | Recorrido de navegación sin teclear URLs |
| `08-canvas-run-sin-doble-scroll.png` | Canvas de un run real bajo la topbar |
| `09-consola-canvas.txt` / `10-errores-canvas.txt` | Consola y errores en el canvas |
| `12-errores-sesion-completa.txt` | Errores de toda la sesión (vacío) |
| `13-a11y-deshabilitados.json` | Árbol a11y de los 3 destinos deshabilitados |
| `14-contraste-nav.md` | Tabla de ratios WCAG de la topbar (dark + light) |
