// COMPOSICIÓN REAL DEL WORKER (T5.12). Este fichero existe por un fallo concreto y caro:
//
// T5.12 añadió a N6 un `logger.warn` para que la DEGRADACIÓN de faceta (una `product.category` libre
// del LLM que ningún template reconoce) fuera OBSERVABLE. El executor lo emitía, dos tests lo veían en
// verde… y en PRODUCCIÓN era un no-op silencioso: el grupo de deps `generation` de `boss.ts` NUNCA
// cableó `logger` (ausente desde T4.4), y `GenerationExecutorDeps.logger` es OPCIONAL — así que
// `deps.logger?.warn(...)` no lanzaba: simplemente no escribía nada. La mitad "observable" de la
// entrega no existía.
//
// POR QUÉ NINGÚN TEST LO CAZÓ (skill testing, principio 9 — «el arnés nunca más cómodo que la
// realidad»): el unit del executor INYECTA un logger falso, y el test del registro pasa
// `generation: {} as never`. Ninguno de los dos ejerce LA COMPOSICIÓN: nadie preguntaba «¿el logger que
// llega al executor en producción es un logger de verdad?». Un doble que el test construye siempre está
// cableado; el composition root real puede no estarlo.
//
// QUÉ HACE ESTE TEST, ENTONCES: arranca el worker DE VERDAD (`bootstrap` → `createBoss` → Postgres real
// + pg-boss real), CAPTURA el registro de executors que la composición real construyó —con las deps
// reales que `boss.ts` compone, no unas de test— y ejecuta ese executor. El único doble es el LOGGER de
// entrada del proceso (`makeTestLogger`), que es exactamente la salida que queremos observar. Si
// cualquiera de los DOS eslabones del cableado se rompe (`boss.ts` deja de pasar `logger` al grupo
// `generation`, o `executors/index.ts` deja de pasárselo a `makeN6Executor`), este test se pone ROJO.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExecutorContext, StepExecutor } from '@ugc/core/orchestrator';
import { DEMO_BEAUTY_BRIEF, DEMO_PERSONA, DEMO_SCRIPT, type N6Sources } from '@ugc/core/gallery';
import { createTestDatabase, makeTestLogger } from '@ugc/test-utils';
import type { TestDatabase, TestLogger } from '@ugc/test-utils';
import { PgBoss } from 'pg-boss';
import { stopBossAndWait } from '../helpers';

// El registro que construye la COMPOSICIÓN REAL. Se captura envolviendo `makeExecutorRegistry` sin
// sustituir su comportamiento: se delega en la implementación ORIGINAL con las deps ORIGINALES que
// `boss.ts` le pasa. El test no fabrica ninguna dep — solo mira lo que la composición produjo.
let capturedRegistry: Record<string, StepExecutor> | undefined;

vi.mock('../../src/executors', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/executors')>();
  return {
    ...real,
    makeExecutorRegistry: (deps: Parameters<typeof real.makeExecutorRegistry>[0]) => {
      const registry = real.makeExecutorRegistry(deps);
      capturedRegistry = registry;
      return registry;
    },
  };
});

// El import va DESPUÉS del `vi.mock` a propósito (el hoisting de vitest lo garantiza igualmente):
// `bootstrap` importa `createBoss`, que importa `makeExecutorRegistry` — el que se captura arriba.
const { bootstrap } = await import('../../src/bootstrap');

let tdb: TestDatabase;
let boss: PgBoss | undefined;

/** Un `N6-sources` cuya `product.category` es la etiqueta LIBRE que el LLM emitió de verdad sobre la
 *  URL de CeraVe el 2026-07-25 — la que dejaba el lote muerto antes de T5.12. */
const FREE_CATEGORY = 'Cuidado bucal';
const n6SourcesFreeCategory: N6Sources = {
  node: 'N6-sources',
  brief: {
    ...DEMO_BEAUTY_BRIEF,
    product: { ...DEMO_BEAUTY_BRIEF.product, category: FREE_CATEGORY },
  },
  persona: DEMO_PERSONA,
  script: DEMO_SCRIPT,
  facets: { hookAngle: 'pain_point', format: 'grwm', platform: 'tiktok', durationSeconds: 22 },
};

beforeAll(async () => {
  tdb = await createTestDatabase({ label: 'worker:boss-wiring' });
});

afterEach(async () => {
  if (boss !== undefined) await stopBossAndWait(boss);
  boss = undefined;
  capturedRegistry = undefined;
});

afterAll(async () => {
  await tdb.close();
});

describe('composición real del worker: el logger LLEGA a los executors (T5.12)', () => {
  it('el N6 que compone boss.ts emite el warning de degradación por el logger REAL del worker', async () => {
    // El ÚNICO doble: el logger de entrada del proceso — que es justo la salida bajo observación.
    // Todo lo demás (deps del registro, pool de Drizzle, storage, thunk de la fal-key) lo compone
    // `createBoss` de verdad contra Postgres real.
    const logger: TestLogger = makeTestLogger();
    const result = await bootstrap({
      logger,
      databaseUrl: tdb.connectionString,
      noopShouldFail: () => false,
    });
    boss = result.boss;
    expect(result.health).toEqual({ ok: true, db: true });

    // El registro capturado es el que la composición REAL construyó.
    const registry = capturedRegistry;
    if (registry === undefined) throw new Error('la composición real no construyó el registro');
    const n6 = registry.N6;
    if (n6 === undefined) throw new Error('el registro real no trae un executor bajo la clave N6');

    // Se ejecuta el executor REAL por la costura stepless (fuentes por dep): no hace falta sembrar la
    // variante en la BD para observar el cableado del logger, y así el test mide UNA cosa.
    const outputs: unknown[] = [];
    const ctx: ExecutorContext = {
      config: { variantId: 'var_wiring_01' },
      collectOutput: (refs) => outputs.push(refs),
      deps: [
        {
          stepId: 's1',
          nodeKey: 'N6-sources',
          status: 'succeeded',
          outputRefs: n6SourcesFreeCategory,
        },
      ],
    };
    await n6(ctx);

    // (a) La degradación ocurrió de verdad (si no, el warning no tendría por qué existir).
    expect(outputs[0]).toMatchObject({
      node: 'N6',
      degradedFacet: { facet: 'vertical', value: FREE_CATEGORY },
    });

    // (b) LO QUE ESTE FICHERO EXISTE PARA PROBAR: el warning salió por el logger que compuso el
    // WORKER, no por uno inyectado por el test. `entries` es del logger que se le pasó a `bootstrap`.
    // `LogEntry.obj` está tipado como `object` (el puerto Logger no fija el shape de los bindings):
    // se estrecha con un guard explícito en vez de un cast, para que el assert siga siendo real.
    const hasVerticalFacet = (obj: object): boolean =>
      'facet' in obj && (obj as { facet?: unknown }).facet === 'vertical';
    const warnings = logger.entries.filter((e) => e.level === 'warn' && hasVerticalFacet(e.obj));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.obj).toMatchObject({
      variantId: 'var_wiring_01',
      facet: 'vertical',
      unmatchedValue: FREE_CATEGORY,
    });
    expect(warnings[0]?.msg).toContain('DEGRADADA');
  });
});
