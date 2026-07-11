# Verificación T0.14 — Credenciales cifradas y /settings

- **Tarea**: T0.14 · Credenciales cifradas y /settings (`planning.md`)
- **Fecha**: 2026-07-11
- **Ejecutor**: verifier (escéptico, contexto fresco) · agent-browser 0.27.0 · sesiones `t0.14` / `t0.14b`
- **Sistema**: commit `e66f9a8` + diff T0.14 staged (working tree == index; 30 ficheros, ~1937 inserciones) · docker compose dev (`ugc-postgres-dev`, PG16 en :55432) + `pnpm dev` (web+worker) · sin seeds extra (la BD ya tenía `secret.fal`/`auth.password_hash` de arranques previos)
- **Gate previo**: `pnpm gate` VERDE (71 test files, 695 tests). Nota: una primera pasada del gate falló por un `next dev` HUÉRFANO en :3000 (PID stale) que colisionó con el subserver de `sse-contract.test.ts` ("Another next dev server is already running"); tras matar el proceso suelto, el gate pasa limpio. No es defecto de T0.14 (ver `gate.txt`).

## Verificación esperada (literal de planning.md)
> guardar la key de fal desde `/settings` → reiniciar el contenedor de Postgres y los procesos web/worker → la key sigue funcionando; en `psql`, el valor almacenado es un blob cifrado (no aparece la key en claro en ningún `SELECT`); borrar la env var tras el bootstrap no rompe nada; cambiar tema/acento/densidad desde `/settings` se aplica en vivo y persiste tras un reload.

## Metodología de discriminación (inputs elegidos por el verifier)
- La key **real** de fal (`FAL_KEY`) sembrada en BD termina en `65e3`. Para que cada cláusula sea auto-probatoria NO se reusó esa key: se guardaron por la UI keys distintivas con last4 único (`fal-UI-4242` -> `4242`, `fal-HUMAN-7788` -> `7788`, `fal-CLICK-5566` -> `5566`), de modo que el last4 servido y el needle en psql atribuyen inequívocamente el cambio a la escritura desde /settings, no al seed.
- **curl PATCH** (`fal-DIAG-CURL-0000`) y **`form.requestSubmit()`** se usaron SOLO como diagnósticos para aislar backend vs. interacción del navegador; NO cuentan como la "escritura humana" de la cláusula (son atajos por API prohibidos para el paso verificado, cua.md regla 1). La cláusula se cerró con acciones humanas reales: **tecla Enter en el campo** (submit nativo) y **click de ratón con el botón dentro del viewport**.

## Pasos ejecutados
1. Login en `/login` (cookie de sesión) -> `/settings` renderiza apariencia + credenciales + preferencias. Placeholder fal `********65e3` (seed real), input vacío (write-only). -> `01-settings-inicial.png`.
2. **Guardar desde /settings (humano)**: tecleo `fal-HUMAN-7788` en el campo fal.ai + Enter -> `PATCH /api/settings 200`, aparece `role="status"` "Ajustes guardados.", campo vuelve a vacío, blob en BD cambia, `GET /api/settings` last4 = `7788`. -> `05-guardado-ok.png`.
   - (Antes, `fal-UI-4242` por el mismo camino Enter había dado last4 `4242`, y un click con el botón scrolleado a viewport `fal-CLICK-5566` -> `5566`. Todos por la UI.)
3. **Reiniciar Postgres + web + worker**: capturo blob (`blob-before-restart.txt`), paro web/worker, `docker restart ugc-postgres-dev`, relanzo `pnpm dev` (PIDs nuevos 67264/67265). Blob sobrevive; `GET /api/settings` last4 = `7788` -> el blob cifrado DESCIFRA de vuelta al valor original tras el reinicio completo. (`dev-after-restart.log`)
4. **psql — cifrado at-rest**: `SELECT value FROM app_setting WHERE key LIKE 'secret.%'` -> `{"v":1,"ct":"...hex...","iv":"...hex...","tag":"...hex..."}`. Búsqueda del needle (`CLICK-5566`, `fal-CLICK`, `fal-`) sobre `value::text` de TODA la tabla -> 0 filas. No hay key en claro. (`psql-cipher-check.txt`)
5. **Borrar la env var**: backup de `.env` (sha256 capturado), strip de la línea `FAL_KEY=` vía redirección (sin exponer secretos), relanzo `pnpm dev`. Discriminador de validez: el log de arranque NO contiene NINGUNA línea `secret.fal` (el `if(!env) return` disparó -> FAL_KEY genuinamente ausente; APP_MASTER_KEY intacta). Health ok; `/settings` sigue mostrando la key configurada (`********5566`, servida desde BD). `.env` **restaurado byte-idéntico** (sha256 coincide con el original). -> `06-env-removed-key-configurada.png`, `dev-env-removed.log`.
6. **Apariencia en vivo**: baseline `<html>` sin data-* (defaults dark/indigo/balanced elididos). Click Light+Emerald+Comfortable -> SIN reload, `<html>` pasa a `data-theme=light data-accent=emerald data-density=comfortable`, cookie `ugc_appearance=light.emerald.comfortable`. -> `07-apariencia-live.png`.
7. **Persistencia tras reload**: recargo `/settings` -> `<html>` conserva `light/emerald/comfortable`, botones `aria-pressed` reflejan el estado (leído server-side de la cookie, sin flash). -> `08-apariencia-persistida-reload.png`.
8. **Contraste WCAG (aserción obligatoria de UI, cua.md Paso 3)**: medido color+fondo reales del botón segmentado activo y del primario "Guardar ajustes" en dark Y light x indigo/emerald/amber/cyan. (`contrast-wcag.txt`)
9. **Consola del navegador** (sesión limpia `t0.14b`): 0 errores/rejects. (`browser-console.txt`)

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Guardar la key de fal desde /settings | Enter en campo + click (viewport) -> PATCH 200, "Ajustes guardados", last4 = key tecleada (7788/5566) | 05-guardado-ok.png, dev-server.log | OK |
| 2 | Reiniciar PG + web/worker -> la key sigue funcionando | Tras `docker restart` + relanzar web/worker, GET last4 = 7788 (blob descifra al original) | dev-after-restart.log, blob-before-restart.txt | OK |
| 3 | psql: blob cifrado, key nunca en claro en ningún SELECT | value = `{v,iv,tag,ct}` hex; needle `CLICK-5566`/`fal-` -> 0 filas en toda la tabla | psql-cipher-check.txt | OK |
| 4 | Borrar la env var tras el bootstrap no rompe nada | FAL_KEY ausente (sin línea `secret.fal` en log); health ok; /settings muestra `********5566` desde BD | dev-env-removed.log, 06-env-removed-key-configurada.png | OK |
| 5 | Cambiar tema/acento/densidad se aplica en vivo | `<html>` data-* cambian sin reload a light/emerald/comfortable; cookie escrita | 07-apariencia-live.png | OK |
| 6 | Apariencia persiste tras un reload | Tras reload, `<html>` conserva light/emerald/comfortable (cookie leída server-side, sin flash) | 08-apariencia-persistida-reload.png | OK |
| 7 | (Obligatorio) Contraste texto/acento AA en botones de acento | Todos >=4.5:1: indigo 5.42 (blanco), emerald 7.80, amber 9.21, cyan 8.15 (near-black), en dark y light | contrast-wcag.txt | OK |

## Coste real
$0 — sin APIs de pago. T0.14 solo cifra/descifra la key localmente (AES-256-GCM, node:crypto); NUNCA llama a fal.ai. Coincide con el estimado ($0).

## Veredicto
**PASS** — las 5 cláusulas de la Verificación se cumplen contra el sistema real levantado, más la aserción obligatoria de contraste WCAG (todos los acentos pasan AA). Round-trip de descifrado tras reinicio completo confirmado por last4; cifrado at-rest confirmado por psql (needle ausente, forma `{v,iv,tag,ct}`); independencia de la env confirmada con FAL_KEY genuinamente ausente; apariencia en vivo + persistencia tras reload confirmadas por los `data-*` de `<html>`.

### Rarezas (no bloquean el PASS)
1. **`agent-browser click @e18` sobre "Guardar ajustes" no disparaba submit** hasta scrollear el botón a viewport. Causa raíz diagnosticada: el botón estaba en y~1001 (fuera del viewport headless ~800px) -> `document.elementFromPoint(cx,cy)` devolvía `null` (el click caía en nada). Tras `scrollintoview` el click funciona (elementFromPoint = el propio BUTTON, PATCH dispara). Es artefacto del navegador headless, NO defecto del producto: un humano scrollea y clica, y el submit por teclado (Enter, camino a11y-correcto) funciona sin scroll. Documentado, no ruteado.
2. **`next build && next start` (prod) NO arranca**: crash de boot `TypeError: An error occurred while loading instrumentation hook: The "path" argument must be of type string. Received type number` (Next 16.2.10 + Turbopack, hook de instrumentation). Impidió el clean-room prod como decisor del punto 1; se resolvió con el diagnóstico de viewport en dev. Es un problema de infra prod (candidato a tarea propia, relacionado con el canal `UGC_DB_MIGRATIONS_DIR`/`scripts/dev.mjs` de next.config), ajeno a la lógica de T0.14. Anotado como deuda; `prod-web.log` guardado.
3. La extensión **MetaMask** se inyectó en el Chrome de agent-browser en la primera sesión (`t0.14` reusaba un perfil con la extensión) y emitía `unhandledRejection: Failed to connect to MetaMask`. En la sesión limpia `t0.14b` no aparece y la consola queda a 0 errores. Artefacto de entorno, no del producto.

### Notas
- El servicio `GET /api/settings` descifra cada blob solo para derivar `last4` (round-trip real en producción); nunca expone la key (solo 4 chars). El `PATCH` es write-only (una key ausente no toca la guardada).
- La apariencia vive en cookie `ugc_appearance` (no en BD), por eso la cláusula pide "reload" y no "reinicio"; incidentalmente también sobrevive a reinicios de PG (el estado no está en BD).
- `next.config.ts` recarga el `.env` raíz vía `process.loadEnvFile` en dev — invalidó un primer intento de `env -u FAL_KEY`; el test válido requirió quitar la línea del fichero. Restauración verificada por sha256.
