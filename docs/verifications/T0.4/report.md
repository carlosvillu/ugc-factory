# Verificación T0.4 — Auth single-user

- **Tarea**: T0.4 · Auth single-user (`planning.md`)
- **Fecha**: 2026-07-10
- **Ejecutor**: verifier (subagente) · agent-browser 0.27.0 · sesión `t0.4`
- **Sistema**: código T0.4 **staged sin commitear** (se commitea DESPUÉS de este PASS; verificado sobre el diff en working tree, no sobre `HEAD` c3ee934) · docker compose dev (`ugc-postgres-dev` healthy, host 55432) + `pnpm --filter @ugc/web dev` (fresh boot) · seed `auth.password_hash` sembrado en first boot con `AUTH_BOOTSTRAP_PASSWORD=ugc-factory-dev`
- **Gate previo**: `pnpm gate` verde (typecheck + format:check + knip + 329 tests en 26 files, todos pasan).
- **Arranque**: `/api/health` → `{ok:true, db:true}`; log de boot `auth.password_hash sembrado (first boot)`. `app_setting` estaba vacía antes del arranque → seed limpio con el password conocido, sin necesidad de borrar hash previo.

## Regresión Playwright permanente (regla 10, entregable del planning)

Además del CUA one-shot de arriba, T0.4 activa el harness E2E y deja regresión automatizada (`pnpm test:e2e`), verificada aparte del gate:

- **Harness**: `apps/web/playwright.config.ts` + `apps/web/scripts/e2e-stack.ts` (testcontainer pg16 + `next dev` en :3100, arrancado por Playwright vía tsx). El guard `test:e2e` (`exit 1` "DESHABILITADO hasta T0.4") se reemplazó por el runner real.
- **Specs** (`@f0`): `apps/web/e2e/auth.spec.ts` (las 3 cláusulas: redirect sin sesión, rate-limit al 3.er intento, login+persistencia tras reload) + `apps/web/e2e/design-system.spec.ts` (backfill FD: `/design-system` abre, switchers tema/acento/densidad operables). `auth.setup.ts` loguea una vez → storageState (e2e.md §5).
- **Resultado**: `pnpm test:e2e` → **8 passed** (1 setup + 3 auth + 4 design-system), estable en 2 corridas (~11 s, 0 flaky). El log muestra el flujo real: seeding first-boot, login 200, 401×2 → 429 (fencepost del rate-limit), sesión persistente tras reload.
- **Invariante CUA==commit preservado**: el trabajo E2E es puramente aditivo-de-test — CERO cambios bajo `apps/web/src/` (confirmado). El árbol que este CUA bendijo es byte-idéntico al que se commitea.

## Verificación esperada (literal de planning.md)
> en navegador, acceder a `/` sin sesión redirige a login; password incorrecto 3 veces → rate limit visible; con password correcto se entra y la cookie sobrevive a un refresh.

Nota de diseño: `LOGIN_MAX_ATTEMPTS=2` → el 3.er intento fallido es el primer 429.

## Pasos ejecutados (orden A: cláusula 1 → 3 → 2, para no envenenar el rate-limit in-memory por IP `local` antes del login correcto)

1. **Cláusula 1** — `open http://localhost:3000/` sin sesión → redirige a `http://localhost:3000/login`. Form de login renderizado (campo Contraseña, toggle ver/ocultar, botón Entrar). `01-root-redirect-login.png`.
2. **Cláusula 3a** — `fill @e3 "ugc-factory-dev"` + `click @e5` (botón Entrar, como humano, sin atajos API) → login OK, `window.location.assign('/')` → URL `http://localhost:3000/` renderiza "UGC Factory" (contenido autenticado, sin form de login). Cookie `ugc_session` presente (httpOnly). `02-authenticated-after-login.png`. Log servidor: `POST /api/login 200`.
3. **Cláusula 3b (refresh)** — navegación dura `open http://localhost:3000/` de nuevo → URL sigue `/`, renderiza "UGC Factory", **NO** vuelve a `/login`. La cookie `ugc_session` sobrevive al reload. `03-authenticated-after-reload.png`. Consola limpia (`console-authenticated.txt`, `errors-authenticated.txt`): solo info de React DevTools + HMR/Fast Refresh (dev-only, third-party, mueren en prod).
4. **Preparación cláusula 2** — `cookies clear` para volver a estado no autenticado. `open /` → redirige a `/login` de nuevo (confirma cláusula 1 desde estado limpio).
5. **Cláusula 2** — password INCORRECTO 3 veces desde la UI:
   - Intento 1 (`wrong-pass-aaa`) → Alert "Contraseña incorrecta." (`04-attempt1-wrong.png`). Log: `POST /api/login 401`.
   - Intento 2 (`wrong-pass-bbb`) → Alert "Contraseña incorrecta." (`05-attempt2-wrong.png`). Log: `POST /api/login 401`.
   - Intento 3 (`wrong-pass-ccc`) → Alert (role=alert) **"Demasiados intentos. Espera unos minutos antes de volver a intentarlo."** (`06-attempt3-ratelimit.png`). Log: `POST /api/login 429`. Mensaje de rate-limit VISIBLE en la UI, distinto de los dos errores previos de password incorrecto.

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | `/` sin sesión redirige a login | URL final `http://localhost:3000/login`, form renderizado (2 veces: inicial y tras `cookies clear`) | 01-root-redirect-login.png · `get url` | OK |
| 2 | Password incorrecto 3 veces → rate limit visible | Intentos 1–2: "Contraseña incorrecta." (401). Intento 3: Alert "Demasiados intentos. Espera unos minutos…" (429), visible en UI | 04, 05, 06 · secuencia log 401/401/429 | OK |
| 3 | Password correcto → entra Y cookie sobrevive refresh | Login OK → `/` autenticado ("UGC Factory"); tras navegación dura a `/`, sigue autenticado, no redirige a login; cookie `ugc_session` httpOnly presente | 02, 03 · `POST /api/login 200` | OK |

## Aserción de contraste WCAG (obligatoria, cua.md línea 111) — dark

La página `/login` es **dark-only** (sin `data-theme`, sin toggle `prefers-color-scheme`; bodyBg `rgb(10,10,11)`), por lo que la medición relevante es dark. Medido con `getComputedStyle` (color de texto + fondo compositado por la cadena de ancestros) y ratio WCAG:

| Elemento | Texto | Fondo (resting) | Ratio | Tamaño | Umbral | OK |
|---|---|---|---|---|---|---|
| Botón "Entrar" (primary, `bg-accent`/`text-on-accent`) | `rgb(255,255,255)` | `rgb(84,87,229)` = `#5457e5` | **5.42:1** | 14px / 600 | 4.5:1 | OK |
| Alert rate-limit (`tone=danger`, role=alert) | `rgb(244,244,245)` | compositado `rgb(33,16,17)` (red 10% sobre panel) | **16.68:1** | 13px / 400 | 4.5:1 | OK |

Ambos AA. El botón coincide exactamente con el valor bloqueado en TD.7 (indigo `#5457e5` = 5.42:1).

**Rareza chequeada y descartada (no es hallazgo)**: una primera medición dio el botón a 4.04:1 sobre `rgb(109,113,234)` = `#6d71ea`. Diagnóstico: ese es el token `--accent-hover`, y el botón estaba en estado `:hover` porque el puntero de agent-browser quedó encima tras el `click`. En estado de reposo (puntero fuera) el botón es `#5457e5` → 5.42:1. WCAG no exige 4.5:1 al color de hover transitorio del texto de un botón; el estado en reposo cumple. No hay defecto de contraste ni deuda de DS que rutear.

## Consola / errores del navegador
Limpia. Solo `[info]` React DevTools + `[log]` HMR/Fast Refresh (Next dev-only, third-party, mueren en prod build — carve-out de cua.md línea 110). Cero `errors`. Ver `console-authenticated.txt` / `errors-authenticated.txt`.

## Coste real
$0 — sin APIs de pago (solo login local + Postgres dev). vs estimado $0. Sin recalibración.

## Veredicto
**PASS** — las tres cláusulas se cumplen con evidencia observable: redirect a `/login` sin sesión (confirmado 2 veces), secuencia 401/401/429 con el Alert de rate-limit "Demasiados intentos…" visible en UI al 3.er intento (distinto del error de password incorrecto), y login correcto que entra a `/` autenticado y sobrevive a una recarga completa (cookie `ugc_session` httpOnly persiste). Contraste AA en botón (5.42:1) y alert (16.68:1) en dark. Consola limpia. `pnpm gate` verde.

Notas:
- Orden de cláusulas A (1→3→2) elegido deliberadamente para no envenenar el rate-limit in-memory (por IP `local`) antes del login correcto — sin necesidad de reiniciar web entre cláusulas.
- El `--session` por variable de entorno no persiste entre llamadas de shell del harness (cada bash resetea el entorno); resuelto pasando `--session t0.4` explícito en cada comando. Se detectó y corrigió que las primeras lecturas caían en la sesión `default` (about:blank).
- Falso positivo de contraste (hover 4.04:1) investigado hasta la causa raíz y descartado — el estado en reposo cumple AA.
