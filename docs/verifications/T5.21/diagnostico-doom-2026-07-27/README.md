# T5.21 · Diagnóstico del rojo-en-gate de `f4-generation:190` (2026-07-27)

Diagnóstico previo al fix (coordinador del bucle, $0). Fija el TRIGGER del rojo
intermitente de `f4-generation.spec.ts:190` dentro de `pnpm gate`, y deja la
línea-base del **control negativo B1** de T5.21.

## Hipótesis

`test:e2e:phases` (el que corre el gate) selecciona SOLO por ruta f1-brief +
f2-scripts + f4-generation → dentro del gate NO hay competidor por el `doom`
global del fake de fal (f1 no genera; f2 para en `scripted`, sin submit seeded;
f5-export NO está en el gate). Entonces el rojo no es contención cross-spec sino
**reuse de un stack huérfano** cuyo `doomedRequestId` one-shot ya se gastó
(`reuseExistingServer: !CI`, `playwright.config.ts:100`).

## Método y resultado (medido)

1. **Stack fresco gestionado por Playwright** (`gate1-stack-fresco-VERDE.log`):
   `pnpm gate` completo → `f4-generation:94` ✓, 4 passed. El doom se reclama
   (log: `N7a PermanentStepError … no trae images[]: {}`). Al terminar,
   Playwright MATA el stack que él arrancó (`:3100` queda vacío) → por eso las
   corridas gestionadas por él salen frescas y verdes.

2. **Stack arrancado A MANO** (`apps/web/scripts/e2e-stack.ts`) → Playwright lo
   REUSA (no lo gestiona, no lo mata). Dos corridas de `test:e2e:phases` contra
   ESE mismo stack vivo:
   - Corrida 1 (`run1-stack-reusado-VERDE.log`): `f4-generation:94` ✓, 4 passed.
     El doom se reclama en esta corrida.
   - Corrida 2 (`run2-stack-reusado-ROJO.log`): **ROJA en `f4-generation:190`**
     — `Error: un sub-step de generación debe fallar de forma determinista`;
     `waitForFailedStep` (línea 189) devuelve `''` tras 120 s porque el doom
     one-shot YA se gastó en la corrida 1 y no se re-arma. 1 failed / 3 passed.

## Conclusión

- **Lo que la medición prueba (sólido)**: sobre un stack REUSADO (arrancado a
  mano, Playwright lo reusa), corrida 1 = VERDE, corrida 2 = ROJA en
  `f4-generation:190` (`waitForFailedStep` vacío). El patrón corrida-1-verde /
  corrida-2-roja es real y reproducible. El trigger es un **stack huérfano** en
  `:3100` (Playwright reusa un stack vivo previo en vez de arrancar uno fresco).
- **CORRECCIÓN del mecanismo (2026-07-27, medido por el implementer de T5.21)**:
  la causa NO es «el doom one-shot ya se gastó». Es **dedup de generación
  cross-run sobre la BD persistente del stack**. En corrida 1 el doom malforma el
  output de N7a → el step queda `failed` → el retry granular lo REGENERA con
  ÉXITO → queda un **packshot N7a `completed`** en la BD. En corrida 2, ese
  packshot completado gana el dedup (`generation_dedup_hit`, «generación
  reutilizada de una completed idéntica, 0 coste») → N7a **NUNCA submitea a fal**
  → no hay request que doomar → ningún N7a `failed` → `waitForFailedStep` vacío →
  rojo. **Discriminador empírico**: el implementer implementó el arming opt-in
  (re-arma el doom en corrida 2) y la corrida 2 SIGUIÓ ROJA — si la causa fuese
  el doom gastado, re-armar lo habría arreglado. No lo arregló ⇒ la causa es la
  ausencia de submit (dedup), no el doom.
- Los 3 gates verdes de la sesión de T5.10 fueron sobre stacks frescos: f4 es el
  primer (y único, en el gate) generador de imagen seeded → su caché de dedup
  está vacía en un stack fresco → siempre reclama y falla su doom. El `=1`
  intermitente heredó un huérfano con packshots completados.
- `LoserRaceError` (level 40) que aparece en `gate1` es RED HERRING: la
  carrera-perdedora de dedup de T4.11, por diseño (`N7_MAX_RETRIES=80` la
  contempla), en una corrida que acabó verde.

## Uso para el fix (movido a tarea propia — el arming NO lo arregla)

- **El arming opt-in NO resuelve esto** (medido). El defecto real es que
  `f4-generation` presupone una caché de dedup vacía — premisa que se rompe sobre
  un stack reusado/warm. El fix vive en el spec (input run-único que falle la
  caché legítimamente) o en el stack (negarse/reiniciarse ante estado rancio), no
  en re-armar el doom.
- Estos logs son la línea-base del **control negativo** de la tarea que herede
  B1: cualquier fix debe hacer que la corrida 2 sobre el MISMO stack vivo pase a
  VERDE. El escenario que MUERDE es el stack REUSADO/warm — un stack fresco por
  corrida oculta el bug (f4 pasa con o sin fix).
- **Nota sobre estos logs concretos**: `phases-r1/r2solo` fueron capturados con
  `pnpm test:e2e:phases` y NO volcaron las líneas `[WebServer]`/worker (donde vive
  el `generation_dedup_hit`); sí lo hizo `gate1` (vía `pnpm gate`). La evidencia
  directa del `dedup_hit` está en la corrida instrumentada del implementer de
  T5.21 (ver el report de esa tarea).

## Nota de entorno (ajena a T5.21, para el journal)

Durante el diagnóstico se acumularon **29 contenedores `postgres:16` huérfanos**
(hasta 4 h) porque `TESTCONTAINERS_RYUK_DISABLED=true` (Colima) no los barre. Se
limpiaron a mano (`docker rm -f`). Misma familia que el stack huérfano: el
entorno filtra infraestructura de test que luego corrompe corridas. No expande
T5.21.
