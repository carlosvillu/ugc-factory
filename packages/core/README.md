# `@ugc/core`

**El núcleo puro del pipeline.** Aquí viven los contratos, la lógica determinista, los clientes de las APIs de IA y la máquina de estados del orquestador.

La regla que lo define: **`core` no toca la base de datos ni el disco.** No importa Drizzle, no abre conexiones, no escribe ficheros. Cuando necesita persistir algo, declara un **puerto** (una interfaz) y deja que otro lo implemente — eso es [`@ugc/db`](../db). Lo que sí hace es red (Anthropic, Firecrawl) y CPU (parsear, componer la matriz, redimensionar imágenes con sharp).

Esa frontera es lo que hace que la lógica del pipeline se pueda testear sin levantar un Postgres.

## Cómo encaja

```
core  ←  db  ←  services  ←  web, worker
  └──────────────────────────┘
```

No depende de ningún otro paquete del monorepo. **Todos dependen de él.**

## Comandos

```bash
pnpm --filter @ugc/core test        # vitest
pnpm --filter @ugc/core typecheck   # tsc --noEmit
```

No tiene `build`: los `exports` apuntan directamente al fuente TypeScript (`web` lo transpila vía `transpilePackages`, `worker` con tsup/tsx).

## Qué expone

Doce _subpath exports_, uno por dominio. Se importan así:

```ts
import { ProductBriefSchema, newUlid } from '@ugc/core/contracts';
import { transition, createRun } from '@ugc/core/orchestrator';
import { composeMatrix, estimateBatchCost } from '@ugc/core/strategy';
```

### `./contracts` — el lenguaje del sistema

Todo cruce de frontera está tipado con Zod. El contrato central es **`ProductBriefSchema`**: producto, beneficios, audiencia con niveles de consciencia, objeciones _con su contraargumento_, prueba social, marca, precio, assets clasificados y los ángulos publicitarios. Es lo que produce el análisis y lo que consume todo lo demás.

Junto a él: `RawContentSchema` (lo que devuelve el scraping), `VisualAnalysisSchema` (lo que ve el modelo de visión), `BatchPlanSchema` (la matriz de variantes), `IntakeConfigSchema`, `RunEventSchema` (el contrato del SSE), `ErrorEnvelopeSchema` (lo que serializa la API), más `AppError`, `UlidSchema`/`newUlid` y los enums compartidos.

Hay un detalle que merece nombre propio: `product-brief.json-schema.ts` proyecta el schema Zod a JSON Schema para alimentar el _structured output_ de Anthropic. **Un solo contrato, dos representaciones** — el modelo no puede devolver algo que el sistema no sepa parsear.

### `./orchestrator` — el dueño del DAG

El componente central del producto. Una máquina de estados **transaccional**:

- `transition()` — el embudo **único** por el que pasa todo cambio de estado de un step. Todo lo demás (aprobar, editar, rechazar, reintentar, cancelar, expirar) desemboca aquí. Cada transición valida su legalidad, escribe la auditoría, consolida el coste y notifica por `LISTEN/NOTIFY` — o no hace nada de eso, atómicamente.
- `createRun()` + `validateDag()` — instancia un run a partir de una definición de DAG.
- `checkpoint-ops.ts` — `approveStep`, `editStep`, `rejectStep`, `skipStep`, `cancelRun`. **Editar invalida el sub-grafo aguas abajo** creando steps nuevos con `supersedes_id`, nunca reseteando filas: el histórico y el linaje de costes se conservan.
- `retry.ts`, `timeout.ts`, `sweep.ts` — reintentos, expiración de steps colgados.
- `run-events.ts` — el contrato del stream SSE (snapshot, deltas, heartbeat).
- `ports.ts` — las interfaces que `db` implementa: `StepStore`, `RunStore`, `JobQueue`, `CostStore`, `AuditStore`, `WithTransaction`.

### `./ingest` — N1

Clasifica la URL y aplica el _fast path_ determinista (Shopify `.json`, JSON-LD, Open Graph) antes de gastar en Firecrawl. Si hace falta, scrapea (con Jina Reader como fallback barato) y funde ambas fuentes. También construye el contenido base cuando la entrada es texto libre, y deriva el `BrandKit` del dominio.

### `./analyze` — N2 y N3

`makeVisualAnalyzer` (Haiku 4.5: clasifica las imágenes en hero/b-roll/inservible, extrae la paleta) y `makeBriefSynthesizer` (Sonnet 5: la síntesis del brief en una sola llamada con _structured output_). Incluye `ANTI_INJECTION_BLOCK` — la landing analizada es **contenido no confiable** — y `validateBrief`, los checks deterministas que corren _después_ del modelo: que el precio coincida con el scraping, que los hooks no pasen de 12 palabras, que los assets sugeridos existan de verdad.

### `./strategy` — N4

`composeMatrix` (brief + librería + personas → `BatchPlan`) y `estimateBatchCost`: **el coste se ve antes de gastarlo**, no después.

### Los demás

`./persona` (avatares; partido en dos entradas: `index` es _browser-safe_, `./persona/server` usa sharp y solo corre en Node) · `./jobs` (definiciones de cola tipadas) · `./library` (los seeds de hooks, CTAs y recetas) · `./secrets` (AES-256-GCM: las claves de proveedor se guardan cifradas) · `./observability` (el logger pino, con redacción de secretos).

## Convenciones

- **Zod en toda frontera.** Si un dato entra o sale del paquete, tiene schema.
- **Puertos, no imports.** Si necesitas persistir, declara la interfaz aquí e impleméntala en `db`.
- **Sin efectos ocultos.** Los clientes de red se crean con factories (`makeX`) que reciben sus dependencias: en los tests se inyecta un doble.
