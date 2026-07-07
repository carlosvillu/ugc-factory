# Verificación T0.1 — Monorepo y esqueleto de proyectos

- **Tarea**: T0.1 · Monorepo y esqueleto de proyectos (`planning.md`)
- **Fecha**: 2026-07-07
- **Ejecutor**: verifier (Claude Code) · sin navegador — verificación solo backend (cua.md paso 0: el gate es script/curl observable) · sesión `t0.1`
- **Sistema**: commit base `800a36e` ("Ignore machine-local claude artifacts") + **cambios T0.1 staged, aún sin commit** · sin docker ni BD (llegan en T0.2/T0.3) · `pnpm build` + `pnpm dev` (web :3000 + worker) · sin seeds
  - `git status --short | head`: `A .github/actions/setup/action.yml`, `A .github/workflows/ci.yml`, `M .gitignore`, `A .nvmrc`, `A .prettierignore`, `A .prettierrc`, `AM apps/web/next-env.d.ts`, `A apps/web/next.config.ts`, `A apps/web/package.json`, `A apps/web/postcss.config.mjs` … (63 entradas en total)
  - **OJO (ver Notas 1)**: el trabajo T0.1 NO está íntegramente staged — 16 ficheros `AM` (975 líneas de diff unstaged) + 5 ficheros relevantes untracked. Lo verificado es el **árbol de trabajo**.

## Verificación esperada (literal de planning.md)
> `pnpm build && pnpm dev` → `curl localhost:3000/api/health` devuelve `{ok:true}` y el log del worker muestra "worker ready" en JSON estructurado. Un cambio en un tipo de `packages/core` rompe la compilación de ambas apps (se comprueba a propósito).

## Pasos ejecutados
1. `pnpm build` (salida completa en `build.txt`) → exit 0; 5 de 6 proyectos del workspace con build; worker tsup `dist/main.js 3.16 KB` "Build success in 11ms"; web Next.js 16.2.10 compila, typecheckea y genera rutas — `/api/health` como `ƒ (Dynamic)`. 0 warnings, 0 errors en la salida.
2. `pnpm dev` en background con stdout+stderr a `dev.log` → poll por condición (timeout 60 s): `curl -sf localhost:3000/api/health` responde tras **1 s** y `dev.log` contiene "worker ready" tras **1 s**. Next "✓ Ready in 295ms".
3. `curl -s localhost:3000/api/health | tee health.json` → HTTP 200 `content-type: application/json`, body exacto `{"ok":true}`; comparado **parseado** en Python: `body == {"ok": True}`, claves = `['ok']` (ninguna extra).
4. Línea "worker ready" extraída de `dev.log` (quitando el prefijo `apps/worker dev: ` de pnpm --parallel) → `worker-ready.json`; `json.loads` OK. Campos presentes: `level=30`, `time=1783432376006`, `pid=934`, `hostname`, `name="worker"`, `health={"ok":true}`, `msg="worker ready"` — JSON estructurado pino con name/level/msg.
5. **Fallo provocado (autorizado)**: en `packages/core/src/contracts/health.ts` renombrada la clave del schema `ok` → `ok_BROKEN_T01_VERIFICATION`. Evidencia en `broken-compile.txt`:
   - `pnpm typecheck` → exit 2. El agregado `pnpm -r --parallel typecheck` aborta al primer fallo (solo mostró worker), así que se capturó cada app aislada:
   - `pnpm --filter @ugc/web typecheck` → exit 2: `src/app/api/health/route.ts(17,20): error TS2353: … 'ok' does not exist in type '{ ok_BROKEN_T01_VERIFICATION: boolean; }'`.
   - `pnpm --filter @ugc/worker typecheck` → exit 2: `src/bootstrap.ts(18,20): error TS2353` + `src/bootstrap.ts(20,3): error TS2741`.
   - `pnpm build` (mismo estado roto) → exit 1: `next build` de web falla en "Running TypeScript" con el mismo error de `route.ts:17`; el tsup del worker en cambio bundlea "Build success" (esbuild no typechequea — ver Notas 2).
6. **Restauración exacta**: `git restore --worktree -- packages/core/src/contracts/health.ts` (contra el índice staged) → status vuelve a `A ` limpio, `git diff` del fichero = 0 líneas; `pnpm typecheck` → exit 0 con los 5 proyectos "Done" (`restored-compile.txt`). El diff unstaged global tras la restauración coincide 1:1 con los 16 ficheros `AM` preexistentes al inicio — **cero residuo** de la rotura provocada.
7. Parada limpia: `kill -TERM` al `pnpm dev` propio (PID 809) → worker loggea graceful shutdown en JSON (`"signal":"SIGTERM","msg":"worker shutting down"`), árbol muerto en 2 s, puerto 3000 LIBRE.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | `pnpm build` compila | exit 0; worker `dist/main.js` 3.16 KB; web genera `/api/health` dynamic; 0 warnings | build.txt | ✅ |
| 2 | `pnpm dev` levanta web y worker | Ambos arriba en ~1 s (Next Ready 295 ms; worker ready al arrancar) | dev.log | ✅ |
| 3 | `curl localhost:3000/api/health` devuelve `{ok:true}` | HTTP 200 application/json, body exacto `{"ok":true}`, parseado `== {"ok": True}`, única clave `ok` | health.json | ✅ |
| 4 | Log del worker con "worker ready" en JSON estructurado | Línea pino JSON parseable: `name:"worker"`, `level:30`, `msg:"worker ready"` + `health/pid/hostname/time` | worker-ready.json | ✅ |
| 5 | Cambio de tipo en core rompe la compilación de AMBAS apps | typecheck exit 2 en las dos: web `route.ts(17,20) TS2353` Y worker `bootstrap.ts(18,20) TS2353 + (20,3) TS2741`; `pnpm build` roto exit 1 (falla web) | broken-compile.txt | ✅ |
| 6 | Restauración sin residuo y compilación en verde | `git diff` de health.ts = 0 líneas; `pnpm typecheck` exit 0 (5/5 Done) | restored-compile.txt | ✅ |

## Coste real
n/a — sin APIs de pago ($0; T0.1 no toca Anthropic/fal/Firecrawl).

## Veredicto
**PASS** — Los cuatro observables literales de la Verificación se cumplen contra el sistema real levantado, incluido el fallo provocado que rompe web Y worker y su restauración exacta sin residuo.

Notas (rarezas — ninguna contradice la Verificación, pero las dos primeras piden acción):
1. **El árbol verificado ≠ el índice staged.** 16 ficheros con estado `AM` (975 líneas de diff unstaged, incluidos `apps/web/src/app/api/health/route.ts`, `apps/worker/src/bootstrap.ts`, `apps/worker/src/main.ts`, `packages/core/src/observability/logger.ts`) y 5 ficheros untracked que el sistema en ejecución SÍ usa: `tsconfig.json` (raíz — lo consume el paso `tsc --noEmit` de `pnpm typecheck`), `eslint-plugins.d.ts`, `apps/worker/src/main.test.ts`, `packages/test-utils/src/golden.test.ts`, `packages/test-utils/vitest.config.ts`. **Este PASS aplica al árbol de trabajo**: commitear solo el índice produciría un árbol distinto (más viejo) del verificado. Antes del commit de T0.1: `git add -A` (o re-stagear todo) para que el árbol commiteado sea el verificado.
2. **El build del worker (tsup/esbuild) no typechequea**: con el tipo roto, `pnpm build` falla por web (`next build` sí typechequea) pero tsup emite "Build success". La rotura del worker la captura su `tsc --noEmit` (`pnpm typecheck`, incluido en `pnpm gate`). Decisión estándar de tooling, pero conviene saber que "compilación del worker" = typecheck, no bundling.
3. `pnpm -r --parallel typecheck` aborta al primer fallo (`ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`): en rojo global solo se ve UNA app fallar; para diagnóstico por app hace falta `--filter`.
4. **Procesos huérfanos preexistentes** (anteriores a esta verificación, NO tocados): 3 `pnpm dev` de sesiones previas de hoy (PIDs 51845/55320/96506, arrancados 15:10/15:13/15:49) con sus workers tsx vivos bajo node v24.15.0, y 2 `node --import tsx src/main.ts` colgando de PID 1 (89709, 90072). No ocupan el puerto 3000. Recomendada limpieza manual.
5. `dev.log` impecable durante toda la sesión: 0 errores/warnings; cada request a `/api/health` loggea JSON con `request_id` de correlación y `route`. El shutdown del worker es graceful y observable en JSON.
