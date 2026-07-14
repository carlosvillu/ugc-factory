# `@ugc/services`

**El cableado entre `core` y `db`.** Es el paquete más pequeño del monorepo, y existe por una razón muy concreta.

## Por qué existe

[`@ugc/core`](../core) es puro: sabe llamar a Anthropic, pero no sabe guardar el resultado. [`@ugc/db`](../db) sabe guardar, pero no sabe llamar a nadie. Alguien tiene que enchufar las dos mitades: descifrar la clave del proveedor, llamar al modelo, persistir el artefacto, apuntar el coste en el ledger.

Ese "alguien" no puede vivir en `apps/web` ni en `apps/worker`, porque **son _composition roots_ hermanos**: ninguno importa del otro, y ambos necesitan exactamente los mismos servicios (el worker los ejecuta en el pipeline; la web los invoca desde sus scripts de smoke). Duplicarlos era la alternativa. Este paquete es la otra.

De hecho nacieron dentro de `apps/web/src/server/` y se movieron aquí en cuanto el worker los necesitó. **Mover, no duplicar.**

```
core  →  db  →  services  →  web, worker
```

## Comandos

```bash
pnpm --filter @ugc/services test
pnpm --filter @ugc/services typecheck
```

## Qué expone

Tres funciones. Una por cada nodo del pipeline de análisis:

```ts
import { runFirecrawlIngest, runVisualAnalyze, runSynthesizeBrief } from '@ugc/services';
```

| Función              | Nodo   | Qué hace de punta a punta                                                                                                                              |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `runFirecrawlIngest` | **N1** | Scrapea (Firecrawl, con fallback a Jina) → persiste `url_analysis`, guarda el screenshot como `asset` y apunta los créditos consumidos en `cost_entry` |
| `runVisualAnalyze`   | **N2** | Descifra la clave de Anthropic, lee el screenshot del storage, llama a Haiku 4.5 (visión) y registra el coste                                          |
| `runSynthesizeBrief` | **N3** | Llama a Sonnet 5 con _structured output_ (el resultado **es** un `ProductBrief` válido) y registra el coste                                            |

El patrón es siempre el mismo: **la lógica está en `core`, la persistencia en `db`, y aquí solo el pegamento** — más el registro del gasto, que nunca es opcional.

Internamente hay una pieza que no sale del barrel pero importa: `anthropic-pricing.ts` calcula el coste real de una llamada distinguiendo los tokens de escritura de caché, los de lectura y los normales. Sin eso, el ledger mentiría.

## Convención

Si una función necesita **a la vez** un cliente de red de `core` y un repo de `db`, su sitio es este. Si solo necesita uno de los dos, no lo es.
