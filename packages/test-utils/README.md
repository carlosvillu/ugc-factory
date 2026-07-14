# `@ugc/test-utils`

**El arnés de test compartido.** Paquete interno: es `devDependency` de todos los demás y no forma parte del producto. Nada de aquí llega a producción.

Su trabajo es sostener una promesa: **`pnpm test` es hermético.** No toca la red, no gasta dinero, no depende de una base de datos compartida. Si un test necesita alguna de esas tres cosas, o usa un doble de aquí, o vive en un tier aparte.

## Comandos

```bash
pnpm --filter @ugc/test-utils test
pnpm --filter @ugc/test-utils typecheck
```

## Qué expone

```ts
import { createTestDatabase, makeProject, expectGolden } from '@ugc/test-utils';
import { server, useHttpMocks } from '@ugc/test-utils';
import { spendBudget } from '@ugc/test-utils/live-budget';
import { FIRECRAWL_SCRAPE_RICH } from '@ugc/test-utils/fixtures/firecrawl';
```

### Postgres real, con Testcontainers

`global-setup` levanta **un solo contenedor** de Postgres 16 para toda la corrida (singleton con refcount entre proyectos de vitest), aplica las migraciones sobre una base de datos _template_, y luego `createTestDatabase()` da a cada suite un clon instantáneo (`CREATE DATABASE ... TEMPLATE`). Aislamiento real sin pagar el arranque N veces.

La _connection string_ viaja por `provide`/`inject` de vitest, **nunca por variable de entorno**. Es deliberado: así es imposible que una suite apunte por accidente a una base de datos de verdad.

### Red: msw, y falla por defecto

`server` nace **vacío** y con `onUnhandledRequest: 'error'`. Cualquier petición HTTP que un test no haya mockeado explícitamente **hace fallar el test**. No hay forma de que una llamada real se cuele sin que nadie se entere.

`useHttpMocks(...)` registra los handlers de cada suite. Los fixtures de respuestas reales están en `./fixtures/firecrawl` y `./fixtures/anthropic`.

### `fake-apis` — para los E2E

En los tests E2E quien llama a la red no es el proceso de test, sino el servidor de Next.js: msw no puede interceptarlo. Así que `startFakeExternalApis()` levanta un servidor HTTP local de verdad que finge ser Firecrawl, Jina y Anthropic. Es lo que permite que **`pnpm test:e2e` recorra el pipeline de análisis completo, determinista y a coste cero.**

### `live-budget` — el techo de gasto

Los tests que sí llaman a las APIs reales (`pnpm test:live`) declaran cuánto van a gastar **antes** de la llamada:

```ts
spendBudget(0.27, 'síntesis del brief sobre una landing real');
```

Si la suma supera `LIVE_BUDGET_USD`, la corrida aborta. Un test que gasta de más no falla al final: no llega a gastar.

### Lo demás

`factories.ts` (constructores de filas y de objetos de contrato: `makeProject`, `makeStepRun`, `makeBrief`…) · `image-fixtures.ts` (PNGs **reales** generados con sharp, porque el validador de imágenes de referencia comprueba dimensiones de verdad) · `golden.ts` (`expectGolden`, con `UPDATE_GOLDEN=1` para regenerar) · `fake-event-source.ts` (jsdom no implementa `EventSource`, y el cliente SSE hay que testearlo) · `test-logger.ts` (para afirmar que un fallo tragado dejó traza).

## La regla

**Ningún test se pone en verde debilitando un test.** Si un test es _flaky_, se arregla con causa raíz o se borra con justificación explícita — nunca se reintenta hasta que pase.
