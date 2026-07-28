# Verificación T5.22 — La suite e2e corre contra `next build && next start` (producción) en vez de `next dev` (HMR)

- **Tarea**: T5.22 · suite e2e contra `next start` (mejora de fidelidad del gate) (`planning.md` ~L812)
- **Fecha**: 2026-07-29
- **Ejecutor**: verifier (contexto fresco, escéptico) · Playwright 1.61.1 (`@playwright/test`) · sesión de arnés de test (no navegador humano)
- **Sistema**: `HEAD 5989a6f` (branch `docs/f5-cost-reprojection`) con el diff de T5.22 **STAGED pero SIN commitear**; `git diff` (unstaged, fuera de `docs/verifications/T5.22/`) VACÍO ⇒ el código que corre es exactamente el diff bajo verificación. Docker = Colima.
- **Ficheros del diff**: `apps/web/e2e/global-setup.ts` (nuevo, guard de frescura), `apps/web/scripts/e2e-stack.ts` (`next build`→`next start`, sella `.runtime.json` con `mode:'built'`+`builtAt`, limpia solo `.next/dev`), `apps/web/playwright.config.ts` (`globalSetup` + `timeout:480_000`), `.gitignore` (+`apps/web/next-env.d.ts`), borrado de `next-env.d.ts`, docs de skill (`e2e.md`, `stack-setup.md`), `journal.md`.

## Verificación esperada (literal de planning.md)
> La suite e2e verde contra `next start`; el `Hydration failed` de `/projects` bajo `fullyParallel` ya no aparece en los traces; `.next/dev/` desaparece de los frames de los traces.

## Naturaleza de la verificación
Argumento de MECANISMO, no de repetición: con `next start` NO hay dev server ⇒ el mismatch de router-refresh inducido por HMR es estructuralmente imposible. El discriminador barato/determinista es el CONTROL POSITIVO (una traza `next dev` SÍ contiene el canal HMR) que hace que su AUSENCIA en prod PRUEBE algo. Se verifica además el guard que cierra el footgun del build congelado (principio 9), su extensión a worker+fake (hallazgo REVIEW) y la ausencia de falsos positivos.

## Pasos ejecutados
1. `check-orphan-workers --strict` → sin workers vivos; :3100 libre.
2. `pnpm gate` completo → VERDE exit 0: unit+integración 2503/2503, `test:e2e:phases` 4/4. Typecheck verde confirma el claim del `.gitignore` (pasa sin `next-env.d.ts`). Evidencia: `gate.log`.
3. **Clause (a)** `pnpm test:e2e` COMPLETO (89 tests, prod) → **89 passed, 0 failed, 0 flaky, exit 0** (2.5m). Leídos COUNTS, no solo exit: los 4 proyectos que dependen de `chromium` (spend/partial-regeneration/normal-generation-composes/f5-export) VERDES (no skipped); `dashboard.spec.ts` (5 tests, 3 navegan `/projects`) verde. Evidencia: `full-suite.log`. Suite verde ⇒ 0 trazas retenidas → obliga a la corrida trazada del paso 5.
4. Stack MANUAL a mano → `mode:built`, `builtAt 2026-07-29 01:26:47`, `/api/health {ok:true,db:true}`. Evidencia: `stack-manual.log`, `manual-stack-runtime.txt`.
5. **Clauses (b)+(c)** `playwright test dashboard.spec.ts --trace on` REUSANDO el stack (no reconstruyó) → 6/6 verde, 6 trazas PROD retenidas. `unzip` + grep de FRAMES. Evidencia: `dashboard-traced.log`, `prod-trace-grep.txt`.
6. **Control POSITIVO** (clause c): `next dev` (:3000) trazado en `/login` → HMR PRESENTE; mismo script contra PROD `/login` (:3100) → HMR AUSENTE. Evidencia: `trace-grep-dev.txt`, `trace-grep-prod.txt`, `dev-trace.zip`, `prod-trace.zip`.
7. **Control NEGATIVO del guard EXTENDIDO** contra stack manual reusado: touch worker/main.ts, touch fake-apis.ts, fichero NUEVO untracked → guard LANZA en los 3, nombrando el fichero. Evidencia: `guard-experiments-run.txt`, `guard-*.log`.
8. **Falso positivo del guard**: stack matado, `.runtime.json` STALE (builtAt 01:26 < fuentes a 01:29), :3100 libre, Playwright gestiona stack FRESCO → 1 spec CORRE (4 passed, no bloquea). Evidencia: `false-positive-check.log`.
9. Limpieza: pkill stack+worker, compose down, probe borrado; `check-orphan-workers --strict` verde, puertos libres.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| a | Suite e2e verde contra `next start` | 89 passed / 0 failed / 0 flaky, exit 0; 4 proyectos doom verdes; dashboard `/projects` verde | full-suite.log | OK |
| b | `Hydration failed` de `/projects` ya NO en traces | 0 hits `hydrat|Minified React error|#418|#423|#425` en 6 frames PROD; 25 ficheros mencionan `/projects` (traza no vacía) | prod-trace-grep.txt | OK |
| c | `.next/dev/` desaparece de los frames | 0 hits `webpack-hmr|turbopack-hmr|hot-reloader|__nextjs|.next/dev` en PROD (dashboard+`/login`); DEV `/login` SÍ (webpack-hmr:1, __nextjs:1, chunks turbopack hmr-client) | prod-trace-grep.txt, trace-grep-prod.txt, trace-grep-dev.txt | OK |
| guard-worker | El guard cubre el worker spawneado (REVIEW) | LANZA nombrando `apps/worker/src/main.ts` | guard-worker-main.log | OK |
| guard-fake | El guard cubre el fake in-process (REVIEW) | LANZA nombrando `packages/test-utils/src/fake-apis.ts` | guard-fake-apis.log | OK |
| guard-untracked | `--others` cubre código NUEVO sin `git add` | LANZA nombrando el fichero untracked | guard-untracked-new.log | OK |
| guard-no-FP | El guard NO bloquea run legítimo (stack fresco Playwright, runtime.json stale) | 4 passed, exit 0 — webServer resella builtAt antes de globalSetup | false-positive-check.log | OK |

**Nota clave clause (b)**: en build de PRODUCCIÓN React strippea el mensaje verboso; un mismatch afloraría como `Minified React error #418/#423/#425`, NO como `Hydration failed because…`. Grepear solo el literal daría un vacío que no prueba nada; por eso el grep PROD es el conjunto ampliado, 0 hits, con la traza conteniendo `/projects`.

**Nota clause (c)** (rareza no bloqueante): `e2e-stack.ts:196-197` hace `rmSync('.next/dev')` antes del build ⇒ la ausencia está SOBRE-determinada. La cláusula se cumple; el mecanismo lo prueba el control positivo (DEV emite HMR, PROD no), no solo el grep.

## Control negativo
El guard de frescura EXTENDIDO (fix load-bearing del REVIEW) MUERDE en los tres casos, sobre el stack manual reusado (builtAt 01:26:47) con la fuente tocada a 01:29 (más nueva). Salida ROJA verbatim (Error / exit 1):

```
=== A: touch apps/worker/src/main.ts ===
Error: [e2e frescura del build] El stack reusado sirve un build CONGELADO más viejo que el código.
  fuente más nueva: apps/worker/src/main.ts (2026-07-28T23:29:56.893Z)
(exit: 1)

=== B: touch packages/test-utils/src/fake-apis.ts ===
Error: [e2e frescura del build] El stack reusado sirve un build CONGELADO más viejo que el código.
  fuente más nueva: packages/test-utils/src/fake-apis.ts (2026-07-28T23:29:57.634Z)
(exit: 1)

=== C: NEW untracked file en apps/worker/src (--others) ===
Error: [e2e frescura del build] El stack reusado sirve un build CONGELADO más viejo que el código.
  fuente más nueva: apps/worker/src/__t522_probe_untracked.ts (2026-07-28T23:29:58.324Z)
(exit: 1)
```

Los tres FALLAN (ROJO) donde deben: A prueba que el WORKER (proceso spawneado, congelado bajo reuse) está cubierto — el corazón del hallazgo del REVIEW; B el FAKE in-process; C el flag `--others` (código nuevo sin commitear). Complemento (misma familia, dirección opuesta): el FALSO POSITIVO NO se dispara — con `.runtime.json` stale (builtAt 01:26 < fuentes a 01:29) y Playwright gestionando un stack fresco, la corrida CORRIÓ (4 passed) porque el `webServer` arranca ANTES que `globalSetup` y resella `builtAt`. Un guard naive habría bloqueado cada run tras editar; este no.

### Prueba positiva del discriminador de clause (c)
- DEV `next dev` `/login` (control positivo): `TRACE-ZIP hits {"webpack-hmr":1,"__nextjs":1,...}`; URLs con `[turbopack]_browser_dev_hmr-client_hmr-client_ts...` y `next-devtools`. HMR PRESENTE.
- PROD `next start` `/login` (mismo script): `{"webpack-hmr":0,...,".next/dev":0}`. AUSENTE.
- PROD dashboard `/projects` (6 frames): 0 hits. AUSENTE.

## Coste real
**$0.** Sin APIs de pago. El stack fija `*_BASE_URL` al fake local INCONDICIONALMENTE y, con `NODE_ENV=production` (T5.22), `next.config.ts` ya NO carga el `.env` raíz ⇒ keys reales tampoco se filtran. Verificado: 0 hits de `api.anthropic.com|queue.fal.run|fal.run|api.firecrawl` en los logs; todas las URLs de proveedor apuntan a 127.0.0.1/localhost (fal-cdn del fake). El único host no-local del log es el banner de arranque de Next (LAN del server local). Estimado del planning: $0. Coincide.

## Veredicto
**PASS** — Las tres cláusulas se cumplen contra el sistema real en modo producción: (a) 89/89 verde contra `next start`; (b) 0 errores de hidratación/React-minificado en trazas PROD de `/projects`; (c) el canal HMR/`.next/dev` desaparece de los frames PROD, con control positivo DEV que lo demuestra presente. El guard de frescura EXTENDIDO (worker + fake + untracked, fix del REVIEW) muerde correctamente y NO produce falsos positivos en el path legítimo de Playwright.

**Rarezas (aunque PASS)**:
- Clause (c) sobre-determinada por el `rmSync('.next/dev')` previo al build (no bloqueante).
- Deuda conocida del guard (fuera de alcance T5.22): el BORRADO de un fichero trackeado NO dispara el guard; el caso peligroso (código NUEVO/EDITADO congelado) sí queda cubierto.
- El flake residual clase T5.21 (shared-table + fullyParallel: gallery/library/voice-preview) NO apareció (89/89 limpio a la primera). No es regresión ni bloqueo de T5.22.
- 29+ contenedores pg16 huérfanos (Colima) preexistentes — fuga de testcontainers documentada, ajena a T5.22 (workers de app: 0 al cerrar).
- `touch` solo cambió mtimes (git sin diff de contenido); probe untracked borrado; árbol restaurado.
