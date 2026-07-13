// La DERIVACIÓN del estado agregado del run (T1.17). Es la decisión central de la tarea:
// `pipeline_run.status` no lo mantiene nadie (deuda de T0.8), así que el listado deriva el
// estado de los STEPS. Esta suite fija la REGLA (precedencia + tratamiento de `superseded`)
// como test permanente del gate: cualquiera que la cambie tiene que cambiar estos asserts a
// conciencia.
import { describe, expect, it } from 'vitest';
import {
  deriveCurrentStep,
  deriveRunStatus,
  RunListItemSchema,
  RunListQuerySchema,
  RUN_LIST_DEFAULT_LIMIT,
  RUN_LIST_MAX_LIMIT,
  type RunStepStatus,
} from './run-list';

describe('deriveRunStatus (estado agregado del run)', () => {
  it('los 3 steps del pipeline de análisis completados ⇒ succeeded', () => {
    // Los dos runs REALES de la BD local que completaron (N1/N2/N3 succeeded) y que
    // `pipeline_run.status` sigue llamando `pending`.
    expect(deriveRunStatus(['succeeded', 'succeeded', 'succeeded'])).toBe('succeeded');
  });

  it('un step failed manda sobre cualquier éxito previo ⇒ failed', () => {
    // Los dos runs REALES muertos en N3: N1 y N2 completaron, N3 falló. `pending` en BD.
    expect(deriveRunStatus(['succeeded', 'succeeded', 'failed'])).toBe('failed');
  });

  it('un step expirado (timeout del sweeper) cuenta como fallo del run', () => {
    expect(deriveRunStatus(['succeeded', 'expired', 'pending'])).toBe('failed');
  });

  it('failed gana a TODO lo demás (checkpoint esperando, otro step corriendo)', () => {
    expect(deriveRunStatus(['failed', 'waiting_approval', 'running'])).toBe('failed');
  });

  it('cancelled/rejected (decisión humana) ⇒ cancelled, no failed', () => {
    expect(deriveRunStatus(['succeeded', 'cancelled'])).toBe('cancelled');
    expect(deriveRunStatus(['succeeded', 'rejected', 'skipped'])).toBe('cancelled');
  });

  it('waiting_approval gana a running: el run está bloqueado EN TI', () => {
    expect(deriveRunStatus(['succeeded', 'waiting_approval', 'running'])).toBe('waiting_approval');
  });

  it('running: cualquier trabajo en vuelo (running/submitting/queued)', () => {
    expect(deriveRunStatus(['succeeded', 'running'])).toBe('running');
    expect(deriveRunStatus(['succeeded', 'submitting'])).toBe('running');
    // `queued` = ya encolado en pg-boss: el run ARRANCÓ. Pintarlo `pending` mentiría.
    expect(deriveRunStatus(['succeeded', 'queued', 'awaiting_deps'])).toBe('running');
  });

  it('un nodo SKIPPED satisface su dependencia: no impide el succeeded del run', () => {
    // N2 sin imágenes se autodescarta (§7.1) y N3 avanza igual (T0.8).
    expect(deriveRunStatus(['succeeded', 'skipped', 'succeeded'])).toBe('succeeded');
  });

  it('recién creado (nada encolado) ⇒ pending', () => {
    expect(deriveRunStatus(['pending', 'awaiting_deps', 'awaiting_deps'])).toBe('pending');
  });

  it('un run SIN steps es pending, no succeeded (`every` sobre vacío es true)', () => {
    // La trampa clásica: `[].every(ok)` === true ⇒ un run vacío se declararía completado.
    expect(deriveRunStatus([])).toBe('pending');
  });

  it('los steps SUPERSEDED no puntúan: un retry con éxito no arrastra el fallo viejo', () => {
    // T0.8: la invalidación crea una fila NUEVA con el mismo node_key y marca la vieja
    // `superseded`. Si contara, este run sería `failed` para siempre.
    expect(deriveRunStatus(['succeeded', 'superseded', 'succeeded'])).toBe('succeeded');
    // …y un run cuyos steps sean TODOS superseded no revienta: cae a pending.
    expect(deriveRunStatus(['superseded', 'superseded'])).toBe('pending');
  });

  it('es TOTAL: ningún estado de step la deja sin respuesta', () => {
    const all: RunStepStatus[] = [
      'awaiting_deps',
      'pending',
      'queued',
      'submitting',
      'running',
      'waiting_approval',
      'succeeded',
      'failed',
      'rejected',
      'skipped',
      'cancelled',
      'expired',
      'superseded',
    ];
    for (const s of all) {
      expect(() => deriveRunStatus([s])).not.toThrow();
    }
  });
});

describe('deriveCurrentStep (el step que EXPLICA el estado)', () => {
  const step = (nodeKey: string, status: RunStepStatus) => ({ nodeKey, status });

  it('en un run fallido señala el step que falló', () => {
    const steps = [step('N1', 'succeeded'), step('N2', 'succeeded'), step('N3', 'failed')];
    expect(deriveCurrentStep(steps)?.nodeKey).toBe('N3');
  });

  it('en un run en checkpoint señala el step que espera', () => {
    const steps = [step('N1', 'succeeded'), step('N3', 'waiting_approval')];
    expect(deriveCurrentStep(steps)?.nodeKey).toBe('N3');
  });

  it('en un run vivo señala el step en vuelo', () => {
    const steps = [step('N1', 'succeeded'), step('N2', 'running')];
    expect(deriveCurrentStep(steps)?.nodeKey).toBe('N2');
  });

  it('NUNCA contradice al estado derivado: con un fallo, no señala al que corre', () => {
    const steps = [step('N2', 'running'), step('N3', 'failed')];
    expect(deriveRunStatus(steps.map((s) => s.status))).toBe('failed');
    expect(deriveCurrentStep(steps)?.nodeKey).toBe('N3'); // el failed, no el running
  });

  it('un run completado o recién creado no tiene «paso actual»', () => {
    expect(deriveCurrentStep([step('N1', 'succeeded'), step('N2', 'succeeded')])).toBeNull();
    expect(deriveCurrentStep([step('N1', 'pending')])).toBeNull();
  });

  it('ignora los steps superseded también aquí', () => {
    const steps = [step('N3', 'superseded'), step('N3', 'running')];
    expect(deriveCurrentStep(steps)?.status).toBe('running');
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// EL EMPAREJAMIENTO status ↔ currentStep — el test que hace que unificar la tabla NO sea cosmético
//
// `deriveRunStatus` y `deriveCurrentStep` llevaban una copia PRIVADA de la precedencia cada una,
// y ningún test cubría que dijeran lo mismo. El fallo era SILENCIOSO: bastaba añadir un estado al
// rango `running` de una y olvidar la otra para que un run VIVO se listara «en curso» con el paso
// en «—». Ahora las dos consumen `PRECEDENCE`; esto es lo que impide que vuelvan a separarse.
//
// CONTROL NEGATIVO (comprobado a mano al escribirlo): desincronizar las tablas —p. ej. quitar
// 'queued' del rango `running` de UNA de las dos— pone ESTOS asserts en rojo.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('deriveRunStatus ↔ deriveCurrentStep (coherencia de la tabla ÚNICA)', () => {
  // Un step de cada estado que EXPLICA un run, con el estado de run que debe producir y el
  // `node_key` que debe señalarse. Se recorre entero: si alguien añade un estado a un rango sin
  // añadirlo al otro, el par deja de casar aquí.
  const TIERS: { stepStatus: RunStepStatus; runStatus: string }[] = [
    { stepStatus: 'failed', runStatus: 'failed' },
    { stepStatus: 'expired', runStatus: 'failed' },
    { stepStatus: 'cancelled', runStatus: 'cancelled' },
    { stepStatus: 'rejected', runStatus: 'cancelled' },
    { stepStatus: 'waiting_approval', runStatus: 'waiting_approval' },
    { stepStatus: 'running', runStatus: 'running' },
    { stepStatus: 'submitting', runStatus: 'running' },
    { stepStatus: 'queued', runStatus: 'running' },
  ];

  it.each(TIERS)(
    'un step $stepStatus ⇒ run $runStatus, y el paso señalado ES ese step',
    ({ stepStatus, runStatus }) => {
      // Se acompaña de un step ya completado: el run tiene historia, y aun así el paso que
      // EXPLICA el estado debe ser el del rango, nunca el que terminó.
      const steps = [
        { nodeKey: 'N1', status: 'succeeded' as RunStepStatus },
        { nodeKey: 'NX', status: stepStatus },
      ];
      expect(deriveRunStatus(steps.map((s) => s.status))).toBe(runStatus);
      // EL EMPAREJAMIENTO: hay paso actual, y es el step del rango que decidió el estado.
      const current = deriveCurrentStep(steps);
      expect(current).not.toBeNull();
      expect(current?.nodeKey).toBe('NX');
      expect(current?.status).toBe(stepStatus);
    },
  );

  it('un estado que NO explica (succeeded/pending) ⇒ status sin paso actual', () => {
    // La otra mitad del invariante: los rangos que NO están en la tabla devuelven `null`, y eso
    // es correcto (en un run completado o recién creado, el run entero es la respuesta).
    for (const status of ['succeeded', 'skipped'] as RunStepStatus[]) {
      const steps = [{ nodeKey: 'N1', status }];
      expect(deriveRunStatus([status])).toBe('succeeded');
      expect(deriveCurrentStep(steps)).toBeNull();
    }
    for (const status of ['pending', 'awaiting_deps'] as RunStepStatus[]) {
      const steps = [{ nodeKey: 'N1', status }];
      expect(deriveRunStatus([status])).toBe('pending');
      expect(deriveCurrentStep(steps)).toBeNull();
    }
  });

  it('NUNCA hay un status que explique un paso y devuelva null (ni al revés)', () => {
    // El invariante GENERAL, sobre los 13 estados de step: si el status derivado es uno de los
    // que la tabla explica, TIENE que haber paso actual; si no lo es, NO puede haberlo. Es
    // exactamente la contradicción que las dos tablas separadas permitían.
    const ALL: RunStepStatus[] = [
      'awaiting_deps',
      'pending',
      'queued',
      'submitting',
      'running',
      'waiting_approval',
      'succeeded',
      'failed',
      'rejected',
      'skipped',
      'cancelled',
      'expired',
      'superseded',
    ];
    const EXPLAINED = ['failed', 'cancelled', 'waiting_approval', 'running'];

    // Sin `if` alrededor del `expect` (lo veta `vitest/no-conditional-expect`, y con razón: un
    // assert dentro de una rama que nunca se toma no assert nada). Se construye la tabla de lo
    // OBSERVADO y se compara contra la de lo ESPERADO en UN solo assert: si algún estado
    // desempareja, el diff dice exactamente cuál.
    const observed = ALL.map((status) => {
      const runStatus = deriveRunStatus([status]);
      return {
        status,
        runStatus,
        hasCurrentStep: deriveCurrentStep([{ nodeKey: 'N1', status }]) !== null,
      };
    });
    const expected = observed.map(({ status, runStatus }) => ({
      status,
      runStatus,
      // EL INVARIANTE: hay «paso actual» SI Y SOLO SI el status derivado es uno de los que la
      // tabla explica. Es exactamente la contradicción que las dos tablas separadas permitían.
      hasCurrentStep: EXPLAINED.includes(runStatus),
    }));
    expect(observed).toEqual(expected);
  });
});

describe('RunListQuerySchema (paginación simple)', () => {
  it('sin params aplica los defaults', () => {
    const q = RunListQuerySchema.parse({});
    expect(q).toEqual({ limit: RUN_LIST_DEFAULT_LIMIT, offset: 0 });
  });

  it('coerce los strings del querystring a enteros', () => {
    expect(RunListQuerySchema.parse({ limit: '10', offset: '20' })).toEqual({
      limit: 10,
      offset: 20,
    });
  });

  it('acota el limit: un ?limit=1000000 no puede tumbar la BD desde fuera', () => {
    expect(RunListQuerySchema.safeParse({ limit: String(RUN_LIST_MAX_LIMIT + 1) }).success).toBe(
      false,
    );
    expect(RunListQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
  });
});

describe('RunListItemSchema (contrato de la fila)', () => {
  it('acepta una fila de análisis por URL con su origen y su coste', () => {
    const item = RunListItemSchema.parse({
      id: '01KXD1MM3ENG6QNZ43YY7M1P6V',
      kind: 'full',
      createdAt: '2026-07-13T06:11:41.823Z',
      status: 'failed',
      origin: { source: 'url', url: 'https://relatio.chat/' },
      costActualCents: 3,
      currentStep: 'N3',
      error: 'PermanentStepError: brief inválido',
    });
    expect(item.origin).toEqual({ source: 'url', url: 'https://relatio.chat/' });
  });

  it('el origen manual/other NO lleva url: no hay URL que enseñar', () => {
    const base = {
      id: '01KXD1MM3ENG6QNZ43YY7M1P6V',
      kind: 'full',
      createdAt: '2026-07-13T06:11:41.823Z',
      status: 'succeeded',
      costActualCents: 0,
      currentStep: null,
      error: null,
    };
    expect(RunListItemSchema.parse({ ...base, origin: { source: 'manual' } }).origin).toEqual({
      source: 'manual',
    });
    expect(RunListItemSchema.parse({ ...base, origin: { source: 'other' } }).origin).toEqual({
      source: 'other',
    });
    // Y la rama `url` SÍ exige la url: un origen `url` sin url es drift, no una fila válida.
    expect(RunListItemSchema.safeParse({ ...base, origin: { source: 'url' } }).success).toBe(false);
  });
});
