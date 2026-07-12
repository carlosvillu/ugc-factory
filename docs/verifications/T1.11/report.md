# Verificación T1.11 — Canal de decisiones del checkpoint

- **Tarea**: T1.11 · Canal de decisiones del checkpoint (`planning.md`, F1b)
- **Fecha**: 2026-07-12
- **Ejecutor**: subagente `verifier` · agent-browser (npx, 0.27.x) · sesión `t1.11`
- **Sistema**: commit base `c17c07c` + working tree con el diff de T1.11 (tabla `checkpoint_decision`, contrato `CheckpointDecisionSchema`, `persistCheckpointDecision` en `/approve` y `/edit`, `.strictObject` en `PATCH /api/briefs/:id`). Stack E2E de fakes levantado standalone (`pnpm exec tsx apps/web/scripts/e2e-stack.ts`): web `:3100` + worker + Postgres testcontainer (`localhost:34353/test_35043a83f4ad`) + servidor HTTP local que finge Firecrawl/Jina/Anthropic. `GET /api/health` → `{"ok":true,"db":true}`.
- **Gate previo**: `pnpm gate` VERDE (lint + typecheck + format:check + knip + 939 tests en 95 ficheros).

## Por qué el stack de fakes y no `pnpm dev` en :3001

La Verificación exige el **modo manual SIN imágenes**, que atraviesa N1/N2/N3 (Firecrawl/Jina/Anthropic reales en `pnpm dev` ⇒ gasto). El brief de la tarea autoriza explícitamente reutilizar el camino de los specs. El stack E2E corre **el mismo código de producto** (mismos route handlers, mismo orquestador, mismas migraciones, mismo worker) con las base URLs de los proveedores apuntadas a un fake local ⇒ **coste real $0**. La app se condujo **como un humano** con agent-browser sobre `:3100`; los SELECT van contra la Postgres de ese stack (la que publica `apps/web/e2e/.runtime.json`), no contra la de compose — el error silencioso más fácil de cometer aquí.

Los SELECT se ejecutaron con **mi propio runner** (`q.mjs`, en este directorio), no con el helper del implementer (`e2e/support/stack-db.ts`): la evidencia no depende de su código. Tampoco se ejecutó su spec de Playwright como prueba — la suite verde NO es la verificación.

## Verificación esperada (literal de planning.md)
> En el navegador, un análisis manual SIN imágenes → CP1 → elegir «Generar packshot con IA» → aprobar → la decisión está **en la BD** (`SELECT` que la muestre, asociada al step del checkpoint) y sobrevive a un reload; y si la transición del checkpoint falla, la decisión **no** queda persistida (atomicidad: mismo criterio que la v2 huérfana que cerró T1.10b). Aprobar sin decisión (el caso de la rama URL, que no la necesita) sigue funcionando igual.

## Pasos ejecutados

**Baseline** — `checkpoint_decision` existe con la forma esperada (`id`, `step_run_id`, `kind`, `decision` jsonb, `decided_at`) y está **VACÍA (0 filas)** antes de tocar nada → cualquier fila posterior es atribuible al flujo verificado. Evidencia: `00-system.txt`.

### Observable 1 — decisión en la BD + reload (run MANUAL sin imágenes)

1. Login en `/login` (password del stack) → `/`.
2. `/analyses/new` → pestaña **«Texto libre»** → texto **mío** (una cafetera, NO el fixture del implementer) y **NINGUNA imagen subida**. `01-intake-manual-sin-imagenes.png`.
3. «Analizar» → run `01KXB61FWNBKCFTFDWM0Q68BVG`. El pipeline real corre: **N1 `succeeded`, N2 `skipped`** (`no_analyzable_visuals` — no hay imágenes), **N3 `waiting_approval`** = CP1 abierto. Step de CP1: **`01KXB61FWMKA97QY65Y5FS143M`**.
4. CP1 muestra la petición BLOQUEANTE de imágenes: botones «Subir imágenes del producto» / «Generar packshot con IA», y **«Aprobar y continuar» DESHABILITADO**. `02-cp1-abierto-aprobar-disabled.png`.
5. Click en **«Generar packshot con IA»** → «Aprobar y continuar» se **habilita**. `03-packshot-ia-elegido-aprobar-enabled.png`. Antes de aprobar, re-comprobado: tabla aún con **0 filas** (`04-antes-de-aprobar-tabla-vacia.txt`).
6. Click en **«Aprobar y continuar»** (click humano, no API). `05-tras-aprobar.png`.
7. **SELECT** (`06-decision-en-bd.txt`): 1 fila, `step_run_id = 01KXB61FWMKA97QY65Y5FS143M`, `kind = brief`, `decision = {"kind":"brief","images":"ai_packshot"}`. Un JOIN contra `step_run` confirma que ese id **es N3 del run**, y que N3 pasó a `succeeded` — la decisión está asociada al step del checkpoint, no a una fila suelta.
8. **Reload** completo de `/runs/…` → N3 sigue «completado» (CP1 cerrado) y el **SELECT devuelve la misma fila con el mismo `decided_at`** (`08-decision-sobrevive-reload.txt`, `07-tras-reload.png`). Es persistencia, no memoria del cliente.

### Observable 2 — ATOMICIDAD: transición que falla ⇒ NO queda decisión

Diseñado (como exige el brief) para que la transición falle **sin** que haya habido una aprobación previa exitosa CON decisión. Run manual nuevo `01KXB6JWCDZN7PCMFZ790V7CWY` (N1 `succeeded` = `01KXB6JWCAK5YMDXNS5K9MYKS3`; N3 `waiting_approval` = `01KXB6JWCC69MAB825BYS9VYWR`).

- **Caso A** (`13-atomicidad-casoA-curl.txt`): `POST /api/steps/01KXB6JWCAK5YMDXNS5K9MYKS3/approve` con body `{"decision":{"kind":"brief","images":"ai_packshot"}}` sobre un step que **NO está en `waiting_approval`** (N1, `succeeded`, jamás aprobado) → **409 `invalid_transition`**. **SELECT para ese step: 0 filas.** Tabla global sin cambios.
- **Caso B** (`14-atomicidad-casoB-curl.txt`): sobre N3 (`waiting_approval`), 1.er `POST /approve` **SIN decisión** → **200** (transición OK, y **no escribe fila** — correcto); 2.º `POST /approve` **CON decisión válida** → **409** (ya no está en `waiting_approval`). **SELECT para ese step: 0 filas.** El step transicionó pero la decisión del POST fallido no se coló.
- **Tabla completa al final de todos los casos: UNA sola fila**, la legítima del run manual (`ai_packshot`).

**Qué prueba qué (sin sobrevender):**
- *Dinámico* (lo que la Verificación pide, y en la dirección que nombra): transición fallida llevando una decisión válida → **cero filas**. Mismo criterio que la v2 huérfana de T1.10b (`docs/verifications/T1.10b/22-idempotencia-n3.txt`: SELECT que demuestra que no queda fila huérfana).
- *Estático* (lo que garantiza la atomicidad): en **ambos** routes (`approve/route.ts`, `edit/route.ts`) `persistCheckpointDecision(tx, …)` es la **última** operación **dentro** del mismo `withDomainTransaction` que la transición, y el repo inserta con **ese mismo executor `tx`**. No se filmó un rollback de una fila ya insertada porque, siendo el insert la última operación, ese caso **no es alcanzable por la API** sin inyección de fallos ni tocar código de producto (ambas cosas prohibidas al verifier). Se documenta así en vez de fingir una observación que no se hizo.

### Observable 3 — aprobar SIN decisión (rama URL) sigue igual

Run `01KXB6GGWKMNCS0G3DP3WSNS5C` desde `/analyses/new` → «Desde URL». N1 y **N2 `succeeded`** (hay imágenes) → N3 `waiting_approval` (`01KXB6GGWJKAW715BWRVC61WTW`). CP1 **no muestra los botones de decisión** y «Aprobar y continuar» está **habilitado de entrada** (`10-cp1-rama-url-sin-decision.png`). Aprobado desde la UI → N3 `succeeded` (`11-rama-url-aprobada.png`) y **`SELECT … WHERE step_run_id = '01KXB6GGWJKAW715BWRVC61WTW'` → 0 filas** (`12-rama-url-sin-fila.txt`): **ninguna fila vacía «por si acaso»**.

### Extras (deuda menor de la tarea + robustez del canal) — `15-extra-strict-body.txt`

- `PATCH /api/briefs/:id` con clave desconocida (`tyop_desconocido`) → **400** con `Unrecognized key: "tyop_desconocido"`. Ya no se pierde en silencio (era la deuda declarada en la tarea).
- `POST /approve` con `decision.kind` inventado → **400** `Invalid discriminator value. Expected 'brief'`. La unión discriminada no deja colar basura en el jsonb.
- El brief del run manual quedó `approved` (v1): el efecto de dominio de T1.10b sigue intacto conviviendo con el canal nuevo.
- **`INVARIANTE ROTO`** (el `onConflictDoNothing` + log ERROR): NO se disparó en ningún momento (`stack.log` sin la línea). Correcto — sería la señal de dos aprobaciones commiteadas del mismo step, y no ocurrió. No es provocable por UI sin romper la guardia del orquestador; no se forzó.

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Manual sin imágenes → CP1 → «Generar packshot con IA» → aprobar → decisión EN LA BD asociada al step del checkpoint | 1 fila: `step_run_id=01KXB61FWMKA97QY65Y5FS143M` (=N3 del run, `waiting_approval`→`succeeded`), `kind=brief`, `decision={"kind":"brief","images":"ai_packshot"}` | `06-decision-en-bd.txt`, `02`/`03`/`05-*.png` | ✅ |
| 2 | …y sobrevive a un reload | Tras reload: misma fila, mismo `decided_at`; N3 «completado» | `08-decision-sobrevive-reload.txt`, `07-tras-reload.png` | ✅ |
| 3 | Atomicidad: si la transición FALLA, la decisión NO queda persistida | Caso A: 409 sobre step no-`waiting_approval` con decisión válida → **0 filas**. Caso B: 409 tras aprobación sin decisión → **0 filas** | `13-atomicidad-casoA-curl.txt`, `14-atomicidad-casoB-curl.txt` | ✅ |
| 4 | Aprobar SIN decisión (rama URL) sigue funcionando igual | Rama URL aprobada desde la UI: N3 `succeeded`, **0 filas** de decisión (ni vacía) | `12-rama-url-sin-fila.txt`, `10`/`11-*.png` | ✅ |

**Consola del navegador**: **0 errores** (`09-browser-errors.txt` vacío). Sin `console.error` de código propio.

## Coste real

**$0.00** (estimado: $0). Ninguna llamada a proveedor de pago: el stack apunta `FIRECRAWL_BASE_URL`/`JINA_BASE_URL`/`ANTHROPIC_BASE_URL` a un servidor HTTP local de fakes. Las filas de `cost_entry` que aparecen son las cifras **ficticias** que devuelve el fake, no dinero real (`16-coste.txt`).

## Veredicto

**PASS** — los tres observables de la Verificación se cumplen contra el sistema real levantado: la decisión de CP1 sale del cliente, se persiste en `checkpoint_decision` asociada al step del checkpoint, sobrevive a un reload; una transición fallida no deja decisión huérfana; y la rama URL aprueba sin decisión y sin fila.

**Rarezas / deuda (no bloquean, fuera del alcance de T1.11):**
1. **`[React Flow]: The parent container needs a width and a height`** — warning repetido en la consola del navegador en `/runs/*`. Es de una **dependencia de terceros** (React Flow), transitorio durante la hidratación del canvas, y **preexistente** (no lo introduce el diff de T1.11: la tarea no toca el canvas). Encaja en la excepción estrecha de `cua.md` §Paso 3 (dep de terceros, ruido dev). Anotado como deuda upstream; conviene confirmarlo contra un build de prod en alguna tarea que sí toque el canvas.
2. **El detalle del 400 de `PATCH /api/briefs/:id`** mezcla el `Unrecognized key` con una cascada de ~11 `fieldErrors` del `brief` vacío que envié. Es correcto (mi body era inválido en dos ejes), solo señalo que el mensaje es ruidoso; no es un fallo.
3. **No es de T1.11**: el bug conocido de `api-client.ts` con `localhost:3000` hardcodeado (T1.13) no afectó a esta verificación — el stack E2E fija `INTERNAL_API_URL` al puerto correcto.

**Artefactos**: `q.mjs` (mi runner de SQL, independiente del helper del implementer), `stack.log` (log del stack levantado), capturas `01`–`11`, outputs `00`, `04`, `06`, `08`, `09`, `12`–`16`.
