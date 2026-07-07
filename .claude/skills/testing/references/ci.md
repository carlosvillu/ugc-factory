# CI — GitHub Actions desde F0

Capa de integración continua de UGC Factory. Este reference decide **dónde y cuándo corre cada suite** y da el workflow completo. El *cómo* de cada suite vive en su propio reference (p. ej. Testcontainers y el globalSetup en db-integration.md); aquí no se duplica.

## Contenido

1. [Principios](#1-principios)
2. [Bootstrap: el workflow nace en T0.1](#2-bootstrap-el-workflow-nace-en-t01)
3. [Qué corre en CI — y qué queda fuera deliberadamente](#3-qué-corre-en-ci--y-qué-queda-fuera-deliberadamente)
4. [El workflow completo](#4-el-workflow-completo)
5. [Decisiones que el workflow codifica (el porqué)](#5-decisiones-que-el-workflow-codifica-el-porqué)
6. [Caching](#6-caching)
7. [Gate de merge: branch protection + job agregador](#7-gate-de-merge-branch-protection--job-agregador)
8. [Tabla resumen: dónde corre cada suite](#8-tabla-resumen-dónde-corre-cada-suite)
9. [Evolución del workflow por fases](#9-evolución-del-workflow-por-fases)

---

## 1. Principios

- **CI existe desde el primer commit (T0.1), no "cuando haya algo que testear".** La regla de trabajo 2 del planning exige "sin regresión del E2E de la fase anterior" en cada tarea: eso solo es barato si la red de regresión automatizada corre sola en cada push. Retrofit de CI sobre un repo con suites a medias no ocurre nunca en la práctica.
- **Todos los jobs son gate de merge a `main`.** Un solo desarrollador también se beneficia: la disciplina "solo se mergea en verde" es lo que mantiene el E2E de fases anteriores como suelo firme mientras construyes la siguiente.
- **CI no usa ningún secret.** El workflow no declara `secrets.*`: las APIs de pago van con msw + fixtures grabados (y en E2E con el fake server HTTP que sirve esos mismos fixtures, ver e2e.md §4), la app E2E arranca con executors de demo. Si un test "necesita" una API key real en CI, está mal clasificado — es un `*.live.test.ts` y corre fuera de CI. Beneficio doble: cero gasto accidental y cero superficie de exfiltración.
- **CI verifica; no genera.** `UPDATE_GOLDEN=1` jamás se setea en CI: ante drift de golden files, CI debe fallar, no regenerar en silencio.
- **CI es red de regresión, no verificación de tarea.** El gate CUA y los E2E de fase contra APIs reales cierran tareas concretas con evidencia en `docs/verifications/<TASK-ID>/`; CI protege que lo ya cerrado siga funcionando. Son capas distintas y ninguna sustituye a la otra.

## 2. Bootstrap: el workflow nace en T0.1

El repo aún no es git. La secuencia en T0.1 es:

1. `git init` y esqueleto del monorepo.
2. Crear `.nvmrc` (versión de Node del proyecto), fijar `packageManager` (pnpm) en el `package.json` raíz, y crear `.github/workflows/ci.yml` + `.github/actions/setup/action.yml` (§4). **El primer commit ya incluye el workflow.**
3. Crear el repo en GitHub, push, y activar branch protection sobre `main` con `CI OK (gate de merge)` como required status check — antes de escribir la segunda tarea.

El YAML de §4 muestra el **estado final** del workflow; los jobs `seed-validators` y `media` se añaden en las tareas que crean sus scripts (§9). No dejes jobs que invocan scripts inexistentes: un job rojo permanente entrena a ignorar el rojo.

## 3. Qué corre en CI — y qué queda fuera deliberadamente

**Corre en CI** (en cada PR y en cada push a `main`):

| Job | Qué ejecuta | Necesita Docker |
|---|---|---|
| `lint` | `pnpm lint` + `pnpm typecheck` + `pnpm format:check` + `pnpm knip` (estos dos los define la skill backend, `references/tooling.md`) | No |
| `unit` | `pnpm test:unit` (Vitest, `--project '*:unit'`) | No |
| `seed-validators` | `pnpm seed --validate` (T2.1/T3.2) | No — valida los JSON del seed (slugs únicos, slots resolubles, guard packs existentes) como lógica pura sobre ficheros |
| `integration` | `pnpm test:integration` (Vitest + Testcontainers) | Sí — el globalSetup arranca su propio `postgres:16` |
| `e2e` | `pnpm test:e2e` (Playwright contra la app real con Postgres real y APIs externas servidas por el fake server HTTP, ver e2e.md §4) | Sí — el stack de E2E arranca su propio `postgres:16` vía Testcontainers |
| `media` | `pnpm test:media` dentro de la imagen del worker (desde F5) | Sí — build + run de la imagen |

**NO corre en CI**, y el porqué importa más que la regla:

- **Gate CUA (`agent-browser`)**: es agéntico e interactivo — reproduce el flujo humano con juicio de un LLM y produce evidencia para `docs/verifications/<TASK-ID>/`. Su valor es cerrar UNA tarea una vez, no vigilar regresiones; en CI sería no-determinista, lento y caro sin proteger nada que Playwright no proteja ya.
- **`pnpm test:live`**: gasta dinero real (fal, Anthropic, Firecrawl) y depende de la disponibilidad y del catálogo cambiante de terceros. Corre opt-in en local, acotado por `LIVE_BUDGET_USD`, cuando toca cerrar deudas `[verificar]` o validar un cliente crítico. Un cron o un PR ajeno no deben poder facturar.
- **E2E de fase contra APIs reales** (T1.10b, T2.6, T4.11, T5.9): son verificaciones de tarea manuales y "sagradas" (regla de trabajo 4) — exigen URLs reales, coste anotado y juicio humano ("el guion suena nativo", "el producto es reconocible"). No son automatizables sin degradarlas a lo que ya cubren las suites con mocks.
- **Deploy**: fuera de este workflow (deploy = `git pull && docker compose up -d --build` en el VPS, PRD §18.2). Si algún día se automatiza, será un workflow separado con trigger propio — CI decide si el código es mergeable, no cuándo se despliega.

## 4. El workflow completo

Los cinco jobs comparten setup; extráelo a una action composite local para no mantener cinco copias:

```yaml
# .github/actions/setup/action.yml
name: setup
description: pnpm + Node del proyecto + deps con caché de store
runs:
  using: composite
  steps:
    - uses: pnpm/action-setup@v4          # lee la versión del campo packageManager
    - uses: actions/setup-node@v4
      with:
        node-version-file: .nvmrc          # UNA versión: la del proyecto (§5)
        cache: pnpm                        # caché del pnpm store, keyed por lockfile
    - run: pnpm install --frozen-lockfile
      shell: bash
```

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

# Un push nuevo en la misma branch cancela el run anterior: el feedback debe ser
# sobre el último commit, no sobre uno obsoleto. En main nunca se cancela: cada
# commit de main queda con veredicto completo.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}

jobs:
  lint:
    name: Lint + typecheck
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm format:check
      - run: pnpm knip

  unit:
    name: Unit
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: pnpm test:unit

  seed-validators:
    # Se añade en T2.1 (hooks/CTAs/recipes); T3.2 lo amplía a la galería.
    name: Seed validators
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: pnpm seed --validate

  integration:
    # Docker ya está disponible en los runners ubuntu-latest: NO se usan service
    # containers. El globalSetup de Vitest arranca su propio postgres:16 con
    # startPostgresContainer() — mismo code path que en local (ver db-integration.md).
    name: Integration (Testcontainers)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: [lint]
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: pnpm test:integration

  e2e:
    name: E2E (Playwright)
    runs-on: ubuntu-latest
    timeout-minutes: 25
    needs: [lint]
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup

      # Caché de browsers: la clave es la versión exacta de @playwright/test,
      # así se invalida exactamente cuando haces bump de la dependencia.
      - name: Resolver versión de Playwright
        run: echo "PLAYWRIGHT_VERSION=$(node -p "require('./apps/web/package.json').devDependencies['@playwright/test']")" >> "$GITHUB_ENV"
      - uses: actions/cache@v4
        id: pw-cache
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ env.PLAYWRIGHT_VERSION }}
      - if: steps.pw-cache.outputs.cache-hit != 'true'
        run: pnpm exec playwright install --with-deps chromium
      - if: steps.pw-cache.outputs.cache-hit == 'true'
        run: pnpm exec playwright install-deps chromium

      # pnpm test:e2e es autosuficiente: NO se levanta compose ni se migra a
      # nivel de job. El webServer de playwright.config.ts ejecuta
      # scripts/e2e-stack.ts (tsx), que arranca su propio testcontainer
      # Postgres (startPostgresContainer()), migra + siembra (seedFixtures) y
      # levanta next + worker con los executors de demo (flags de T0.7b) y el
      # fake server HTTP de APIs externas (startFakeExternalApis, ver e2e.md
      # §4): cero llamadas reales, cero secrets. Traces con
      # trace: 'retain-on-failure' → test-results/.
      - run: pnpm test:e2e

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: |
            apps/web/playwright-report/
            apps/web/test-results/
          retention-days: 7

  media:
    # Se añade en T5.1. Construye la imagen REAL del worker y corre la suite
    # dentro: valida los binarios de producción (ffmpeg+libass+fuentes OFL+
    # c2patool), no un ffmpeg de apt-get del runner cuyo libass/fuentes pueden
    # diferir y desincronizar los golden files.
    name: Media (worker image)
    runs-on: ubuntu-latest
    timeout-minutes: 30
    needs: [lint]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build de la imagen del worker con caché de capas
        uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/worker/Dockerfile
          load: true
          tags: ugc-worker:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: pnpm test:media dentro de la imagen
        run: |
          docker run --rm -v "$PWD":/repo -w /repo ugc-worker:ci \
            sh -c "corepack enable && pnpm install --frozen-lockfile && pnpm test:media"

  # Job agregador: el ÚNICO required status check en branch protection (§7).
  ci-ok:
    name: CI OK (gate de merge)
    runs-on: ubuntu-latest
    timeout-minutes: 2
    needs: [lint, unit, seed-validators, integration, e2e, media]
    if: always()
    steps:
      - if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')
        run: exit 1
      - run: echo "all green"
```

## 5. Decisiones que el workflow codifica (el porqué)

- **`timeout-minutes` explícito en TODOS los jobs.** El default de GitHub es 360 minutos: un `--wait` sobre un healthcheck que nunca sana, un webServer que no abre el puerto o un testcontainer colgado te roban horas de runner y, peor, bloquean el veredicto del PR. El colgado silencioso es el mayor ladrón de CI. Regla: 2–3× la duración esperada del job; si un job empieza a rozar su timeout, investiga (suele ser un test nuevo lento o un deadlock), no lo subas por reflejo.
- **`needs: [lint]` en los jobs caros** (integration, e2e, media): lint+typecheck tarda ~1–2 min; no quemes 20 min de Docker y browsers en código que ni compila. No encadenes más que eso — cada eslabón extra alarga el camino crítico del feedback.
- **Sin matrix de Node ni de OS.** `node-version-file: .nvmrc` es la única fuente de verdad. El runtime real de este producto es exactamente uno: la versión que fijan la imagen del worker y el VPS. Una matrix 3 versiones × 2 OS multiplica por seis los minutos y añade flakes de plataformas donde el código jamás correrá. Eres mono-desarrollador: no pagues matrices que no necesitas. Cuando subas de versión de Node, cambias `.nvmrc` y el Dockerfile en el mismo PR y CI valida la nueva — eso es todo el "soporte multi-versión" que hace falta.
- **Integración sin service containers.** Podrías declarar `services: postgres:` en el job, pero entonces CI y local divergen: los service containers se fijan a nivel de job, no permiten preparar la template database antes de que Vitest calcule el provide/inject, y crean un segundo code path que solo se ejecuta en CI (los bugs de "solo falla en CI" nacen ahí). Con `startPostgresContainer()` en el globalSetup, CI ejecuta *exactamente* el mismo arranque que tu máquina: contenedor pg16 + migraciones + template database una vez por run (detalle en db-integration.md).
- **Solo Chromium en E2E.** Es una herramienta personal que operas tú desde Chrome; Firefox/WebKit añadirían minutos y flakes sin proteger a ningún usuario real. Si algún día importa, es una línea en `playwright.config.ts`.
- **Artifacts solo en fallo.** `playwright-report/` + traces suben únicamente con `if: failure()`: en verde no aportan nada y consumen cuota de storage. En rojo son la diferencia entre reproducir en 2 minutos y adivinar.
- **La suite media debe seguir siendo rápida.** Corre en cada PR (es gate, no se filtra por paths — ver §7), así que sus fixtures son clips sintéticos de 1–2 s generados con ffmpeg, nunca renders reales de 30 s. Si tarda >10 min, el problema es la suite, no el job.

## 6. Caching

Tres cachés, cada una keyed por lo que realmente la invalida:

| Qué | Mecanismo | Clave | Por qué |
|---|---|---|---|
| pnpm store | `actions/setup-node` con `cache: pnpm` | `pnpm-lock.yaml` | `pnpm install` pasa de minutos a segundos; se invalida solo cuando cambian deps |
| Browsers Playwright | `actions/cache` sobre `~/.cache/ms-playwright` | versión exacta de `@playwright/test` | Descargar Chromium (~150 MB) en cada run es el coste dominante del job e2e; la clave por versión invalida exactamente en el bump. En cache-hit sigue haciendo falta `install-deps` (librerías del sistema no cacheables) |
| Capas Docker (worker) | buildx con `cache-from/to: type=gha` | contenido del Dockerfile/contexto | La imagen del worker (ffmpeg, libass, fuentes, c2patool) cambia poco: con caché el build es segundos salvo cuando tocas el Dockerfile |

## 7. Gate de merge: branch protection + job agregador

Configura branch protection en `main` con **un único required check: `CI OK (gate de merge)`**. El porqué del agregador: los required checks se configuran *por nombre* en settings de GitHub, fuera del repo. Si en F5 añades el job `media` y se te olvida tocar settings, `media` en rojo NO bloquearía el merge — y nadie lo notaría. Con `ci-ok`, la lista `needs` del propio YAML es la única fuente de verdad del gate y se revisa en el PR como cualquier código. Regla operativa: **todo job nuevo se añade a `needs` de `ci-ok` en el mismo PR que lo crea.**

El `if: always()` + check de resultados es necesario porque, sin él, un job fallido haría que `ci-ok` quedara `skipped` — y GitHub trata `skipped` como pasable. Por lo mismo, no filtres jobs por `paths`: un required check que a veces no corre es un gate con agujeros.

## 8. Tabla resumen: dónde corre cada suite

| Suite | Local dev | Pre-commit | CI | Verificación de tarea |
|---|---|---|---|---|
| lint + typecheck | al guardar (IDE) | ✅ lint --fix + prettier sobre staged; typecheck en pre-push (lefthook — skill backend, tooling.md §7) | ✅ `lint` | — |
| unit — `pnpm test:unit` | ✅ en watch mientras desarrollas | opcional* | ✅ `unit` | — |
| integration — `pnpm test:integration` | ✅ antes de push si tocaste BD/orquestador | ✗ | ✅ `integration` | — |
| e2e — `pnpm test:e2e` | al tocar flujos de UI | ✗ | ✅ `e2e` (fake APIs + executors demo) | — |
| media — `pnpm test:media` | al tocar composición (requiere imagen worker) | ✗ | ✅ `media` (desde F5) | — |
| seed validators — `pnpm seed --validate` | al tocar seeds | ✗ | ✅ `seed-validators` (desde F2) | — |
| live — `pnpm test:live` | opt-in deliberado (`LIVE_BUDGET_USD`) | ✗ | ✗ **nunca** (gasta dinero) | ✅ cierres de deuda `[verificar]`, clientes críticos |
| Gate CUA (`agent-browser`) | — | ✗ | ✗ **nunca** (agéntico e interactivo) | ✅ toda tarea con superficie UI → evidencia en `docs/verifications/<TASK-ID>/` |
| E2E de fase (APIs reales) | — | ✗ | ✗ **nunca** (coste + juicio humano) | ✅ T1.10b, T2.6, T4.11, T5.9 |

\* Pre-commit solo admite lo que corre en <10 s (lint-staged; unit del paquete tocado si sigue siendo instantáneo). Un pre-commit lento entrena el hábito de `--no-verify`, y entonces no tienes gate ninguno — CI es el gate real; pre-commit es solo cortesía de feedback temprano.

## 9. Evolución del workflow por fases

El workflow crece con el proyecto; cada job aparece cuando existe lo que ejecuta:

- **T0.1**: `ci.yml` con `lint`, `unit` y `ci-ok` + composite action + `.nvmrc` + `packageManager`. Branch protection activada.
- **T0.3–T0.7a**: primeras suites con Testcontainers (migraciones, `transition()`) → job `integration`.
- **T0.11**: primer flujo de UI real (canvas demo) → job `e2e` con su primer spec.
- **T2.1**: job `seed-validators` (`pnpm seed --validate`); **T3.2** lo amplía al seed de la galería.
- **T5.1**: job `media` sobre la imagen del worker recién creada.

En cada adición: job nuevo → `needs` de `ci-ok` → mismo PR. La verificación de la tarea que añade un job incluye ver ese job en verde (y, donde el planning lo pide — T2.1, T3.2 —, verlo **fallar** con un fixture roto a propósito: un gate que nunca has visto en rojo no está demostrado).
