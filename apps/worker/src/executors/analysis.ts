// Executors REALES del DAG de análisis (T1.10a, F1): N1 (ingesta) → N2 (visión, con
// auto-skip) → N3 (síntesis + validación). Son la cáscara fina que conecta el
// orquestador (que solo sabe de estados) con los SERVICIOS de @ugc/services (que
// hacen el trabajo: red + persistencia). Aquí NO hay lógica de negocio: parsear la
// config, resolver el output de las dependencias, llamar al servicio, entregar el
// artefacto. La lógica vive en core/services (T1.4–T1.9).
//
// Contrato del executor (T0.7b, executor.ts): un throw = fallo del step; un retorno =
// éxito. El executor NUNCA toca el estado del step — el CONSUMER (step-execute.ts) lo
// hace vía transition(). Por eso N2 no aplica el skip él mismo: llama a
// `markInapplicable()` y retorna; el consumer cierra con `skip_inapplicable`.
//
// El ARTEFACTO de cada nodo viaja al `output_refs` de su step vía `collectOutput()`, y el
// CONSUMER se lo entrega ya resuelto al nodo siguiente en `ctx.deps` (por los ULIDs exactos
// de `dependsOn`, nunca por `node_key` — ver executor.ts). Así la cadena N1→N2→N3 se
// comunica por el ESTADO PERSISTIDO del run, no por memoria del worker: un run sobrevive al
// reinicio del proceso, y ningún executor tiene que saber cómo se llaman sus vecinos ni
// hacer su propio SELECT.
import {
  AnalysisN1ConfigSchema,
  AnalysisN3ConfigSchema,
  PermanentStepError,
  type ExecutorDep,
  type StepExecutor,
} from '@ugc/core/orchestrator';
// Los schemas y `isSkippedOutput` son VALORES en runtime (parsean el jsonb opaco que sale de
// la BD), no solo tipos: van en un import normal. Los tipos, aparte.
import {
  N1OutputSchema,
  N2OutputSchema,
  ProductBriefSchema,
  RawContentSchema,
  isSkippedOutput,
} from '@ugc/core/contracts';
import type {
  RawContent,
  VisualAnalysis,
  N1Output,
  N2Output,
  SkippedOutput,
} from '@ugc/core/contracts';
import { validateBrief } from '@ugc/core/analyze';
import type { StorageAdapter } from '@ugc/core';
import { createBriefVersion, findBriefByOriginStep, getUrlAnalysis, type DbClient } from '@ugc/db';
import { runFirecrawlIngest, runVisualAnalyze, runSynthesizeBrief } from '@ugc/services';

/** Deps de los tres executors de análisis, cableadas por el composition root del
 *  worker (bootstrap/createBoss). Los `*BaseUrl` son overrides de test (el stack E2E
 *  levanta un fake HTTP local y apunta aquí) — en producción van `undefined` y cada
 *  cliente usa su base URL real. */
export interface AnalysisExecutorDeps {
  db: DbClient;
  storage: StorageAdapter;
  /** Clave descifrante de secretos (T0.14), derivada de la master key en el bootstrap. */
  secretsKey: Buffer;
  fetch?: typeof globalThis.fetch;
  firecrawlBaseUrl?: string;
  jinaBaseUrl?: string;
  anthropicBaseUrl?: string;
}

/** Lo que el consumer SIEMPRE inyecta en producción (ids del step, el canal de salida y las
 *  deps ya resueltas). Un executor real sin ellos es un bug de CABLEADO, no un caso a
 *  tolerar: se falla explícito en vez de degradar.
 *
 *  `collectOutput` es TAN obligatorio como los ids, y por una razón de dinero: sin él, N1
 *  completaría su scraping REAL (pagando Firecrawl) y terminaría en `succeeded` con
 *  `output_refs` VACÍO — y N2/N3 fallarían después, con el gasto ya hecho. Degradar en
 *  silencio (`collectOutput?.()`) convertiría un bug de cableado en dinero quemado y un run
 *  roto a mitad. Mejor reventar antes de gastar.
 *
 *  DEUDA (anotada): cuando F2–F4 retiren los executors de demo, estos campos pasan a ser
 *  OBLIGATORIOS en `ExecutorContext` y este helper desaparece — que el compilador haga lo
 *  que hoy hace un throw en runtime. Hoy son opcionales para no romper a los de demo/T0.11. */
function requireExecutorContext(ctx: {
  runId?: string;
  stepId?: string;
  collectOutput?: (outputRefs: unknown) => void;
  deps?: ExecutorDep[];
}): {
  runId: string;
  stepId: string;
  collectOutput: (outputRefs: unknown) => void;
  deps: ExecutorDep[];
} {
  const { runId, stepId, collectOutput, deps } = ctx;
  if (runId === undefined || stepId === undefined || collectOutput === undefined) {
    // Cableado, no entrada: reintentarlo no lo arregla.
    throw new PermanentStepError(
      'executor de análisis: el ExecutorContext no trae runId/stepId/collectOutput (bug de cableado)',
    );
  }
  return { runId, stepId, collectOutput, deps: deps ?? [] };
}

/**
 * El output de la ÚNICA dependencia de este step, validado contra `schema`.
 *
 * Los nodos del análisis tienen exactamente una dependencia cada uno (N2←N1, N3←N2, y N3
 * alcanza a N1 por transitividad… pero N3 declara AMBAS en su `dependsOn`, ver más abajo).
 * El consumer ya las entregó resueltas POR ULID (executor.ts): aquí no se busca por
 * `node_key` —que no identifica una fila tras un supersede— sino que se toma la dep que
 * toca de la lista que el orquestador garantizó correcta.
 */
function depOutput<T>(
  deps: ExecutorDep[],
  nodeKey: string,
  schema: { parse: (value: unknown) => T },
  who: string,
): T {
  const dep = deps.find((d) => d.nodeKey === nodeKey);
  if (dep === undefined) {
    // `deps` viene del `dependsOn` del step, que lo fija la DEFINICIÓN del DAG. Si falta,
    // el DAG está mal construido — no es algo que un reintento arregle.
    throw new PermanentStepError(`${who}: el step no declara dependencia de ${nodeKey}`);
  }
  return schema.parse(dep.outputRefs);
}

/**
 * N1 · INGESTA (§7.2). Dos caminos según el modo de intake, MISMO artefacto de salida:
 *  - `url`: scrapea (Firecrawl → fallback Jina + mini-crawl, T1.4/T1.5) y crea la fila
 *    `url_analysis` DENTRO del run.
 *  - `manual`: la fila YA existe (la creó `POST /api/analyses`, T1.6, con su caché
 *    §7.4). Solo la CARGA. Cero scraping — el verifier lo confirma en los logs.
 */
export function makeN1Executor(deps: AnalysisExecutorDeps): StepExecutor {
  return async (ctx) => {
    const { collectOutput, stepId } = requireExecutorContext(ctx);

    const parsed = AnalysisN1ConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      // Config inválida = bug de la DEFINICIÓN del DAG. Reintentarlo no la arregla.
      throw new PermanentStepError(`N1: config inválida: ${parsed.error.message}`);
    }
    const cfg = parsed.data;

    if (cfg.source === 'manual') {
      // Modo texto libre: el RawContent ya está persistido. N1 solo lo recoge para que
      // N2/N3 lo lean de su output_refs igual que en el modo url (nodos agnósticos).
      const analysis = await getUrlAnalysis(deps.db, cfg.analysisId);
      if (analysis === undefined) {
        // La fila no existe: no va a aparecer en un reintento.
        throw new PermanentStepError(`N1: url_analysis ${cfg.analysisId} no encontrado`);
      }
      // `raw_content` es jsonb opaco: se VALIDA al salir de la BD, no se castea.
      const raw = RawContentSchema.parse(analysis.rawContent);
      collectOutput({
        analysisId: analysis.id,
        projectId: cfg.projectId,
        raw,
      } satisfies N1Output);
      return;
    }

    // Modo URL: el scraping real. El servicio persiste el `url_analysis`, el screenshot
    // como `asset` y el `cost_entry` de los créditos (record-first, T1.4).
    const result = await runFirecrawlIngest(
      {
        db: deps.db,
        storage: deps.storage,
        secretsKey: deps.secretsKey,
        fetch: deps.fetch,
        firecrawlBaseUrl: deps.firecrawlBaseUrl,
        jinaBaseUrl: deps.jinaBaseUrl,
      },
      // `stepRunId` (T1.10b): el `cost_entry` de los créditos de Firecrawl se ATRIBUYE a este
      // step, para que el rollup (`rollupStepCost`, en el consumer) pueda escribir
      // `step_run.cost_actual` y el KPI del canvas deje de mostrar $0,00 con dinero gastado.
      { projectId: cfg.projectId, url: cfg.url, stepRunId: stepId },
    );

    const raw = RawContentSchema.parse(result.analysis.rawContent);
    collectOutput({
      analysisId: result.analysis.id,
      projectId: cfg.projectId,
      raw,
    } satisfies N1Output);
  };
}

/**
 * ¿Hay algo que N2 pueda MIRAR? El screenshot de la página (modo url) o imágenes de
 * producto. Sin ninguna de las dos, el nodo NO APLICA (PRD §7.2: "si no hay ninguna →
 * skipped"). Es la única decisión de negocio de este fichero, y es la que la
 * Verificación observa en el grafo.
 */
function hasAnalyzableVisuals(raw: RawContent): boolean {
  return raw.screenshotRef != null || raw.images.length > 0;
}

/**
 * N2 · ANÁLISIS VISUAL (§7.2). Lee el RawContent de N1. Si no hay NADA que analizar, se
 * autodeclara inaplicable (`markInapplicable()` → el consumer cierra con
 * `skip_inapplicable` → `skipped`) y deja el motivo en `output_refs`. NO lanza: no es un
 * fallo. N3 avanza igual porque `skipped` satisface la dependencia (T0.8).
 */
export function makeN2Executor(deps: AnalysisExecutorDeps): StepExecutor {
  return async (ctx) => {
    const { collectOutput, deps: stepDeps, stepId } = requireExecutorContext(ctx);
    const { markInapplicable } = ctx;

    const n1 = depOutput(stepDeps, 'N1', N1OutputSchema, 'N2');

    if (!hasAnalyzableVisuals(n1.raw)) {
      // El caso canónico de `skipped` del PRD: texto libre sin imágenes.
      collectOutput({
        skipped: true,
        reason: 'no_analyzable_visuals',
      } satisfies SkippedOutput);
      markInapplicable?.();
      return;
    }

    const result = await runVisualAnalyze(
      {
        db: deps.db,
        storage: deps.storage,
        secretsKey: deps.secretsKey,
        fetch: deps.fetch,
        anthropicBaseUrl: deps.anthropicBaseUrl,
      },
      // `stepRunId` (T1.10b): atribuye el `cost_entry` de Haiku a ESTE step (rollup del canvas).
      { projectId: n1.projectId, raw: n1.raw, stepRunId: stepId },
    );

    collectOutput({
      visualAnalysis: result.visualAnalysis,
      status: result.status,
      warnings: result.warnings,
    } satisfies N2Output);
  };
}

/**
 * N3 · PRODUCTBRIEF (§7.2). Sintetiza el brief (T1.8) a partir del RawContent de N1 y
 * del VisualAnalysis de N2 (o `null` si N2 se saltó), y le pasa la validación
 * DETERMINISTA de T1.9 (precio N1==N3, imagen hero, hooks ≤12 palabras,
 * suggested_assets ⊆ assets.images). El perfil de validación lo fija el ORIGEN del
 * contenido: `manual` omite el cross-check de precio (no hay precio scrapeado que
 * cruzar), `url` no.
 */
export function makeN3Executor(deps: AnalysisExecutorDeps): StepExecutor {
  return async (ctx) => {
    const { collectOutput, deps: stepDeps, stepId } = requireExecutorContext(ctx);

    const parsed = AnalysisN3ConfigSchema.safeParse(ctx.config);
    if (!parsed.success) {
      throw new PermanentStepError(`N3: config inválida: ${parsed.error.message}`);
    }

    // Las DOS deps ya vienen resueltas por el consumer (por ULID). N3 las declara ambas en
    // su `dependsOn` (analysis-dag.ts): necesita el texto de N1 y la visión de N2.
    const n1 = depOutput(stepDeps, 'N1', N1OutputSchema, 'N3');

    // N2 pudo SALTARSE (sin imágenes): entonces NO hay VisualAnalysis y el sintetizador
    // trabaja solo con el texto. Es un camino de PRIMERA CLASE (texto libre), no un error.
    // La discriminación es por SCHEMA (`isSkippedOutput`), no por un type-guard a mano: así
    // `{skipped:true}` SIN `reason` no cuela — el motivo que el panel muestra está garantizado.
    const depN2 = stepDeps.find((d) => d.nodeKey === 'N2');
    const visualAnalysis: VisualAnalysis | null =
      depN2 === undefined || isSkippedOutput(depN2.outputRefs)
        ? null
        : // El output de N2 es jsonb OPACO al salir de la BD: se VALIDA contra su contrato,
          // no se castea. Si N2 escribió algo que no es un VisualAnalysis, es mejor fallar
          // aquí (ruidoso) que colar basura al prompt de síntesis.
          N2OutputSchema.parse(depN2.outputRefs).visualAnalysis;

    // El perfil de validación (T1.9) sale del ORIGEN del RawContent, y se usa en los DOS
    // caminos de abajo (síntesis nueva y reuso del brief ya pagado).
    const validationOpts = {
      profile: n1.raw.source === 'url' ? ('url' as const) : ('manual' as const),
      rawContent: n1.raw,
    };

    // ══ IDEMPOTENCIA DE ENTRADA (T1.10b) — ESTO ES UNA SALVAGUARDA DE DINERO ══
    //
    // ¿YA produje yo mi brief? Si sí, se REUSA y NO se vuelve a pasar por caja.
    //
    // El caso que lo motiva: N3 paga ~$0,20 de Sonnet 5 y DESPUÉS persiste la fila. Un fallo
    // TRANSITORIO entre esas dos cosas (deadlock contra el advisory lock del bump, timeout,
    // conexión caída DESPUÉS de que el commit haya prosperado en el servidor) manda el step a
    // `failStep` → gate de retry → N3 se re-ejecuta ENTERO, `runSynthesizeBrief` incluida:
    // otros ~$0,20 por un INSERT que falló, con el brief ya sintetizado y el dinero ya en el
    // ledger. Tres vueltas ≈ $0,60 quemados. Y con el bump `MAX+1`, cada vuelta dejaba ADEMÁS
    // otra fila "de la IA" (v2, v3…) que el usuario no pidió y que `edited_by_user:false` no
    // distingue de la buena.
    //
    // POR QUÉ LA CLAVE ES EL STEP Y NO EL ANÁLISIS: un retry CONSERVA el `step_run.id`
    // (`failStep` reusa la fila: failed→queued + `retry_count++`), mientras que un RE-RUN del
    // pipeline crea steps nuevos — y un re-run SÍ debe sintetizar de nuevo (es lo que el usuario
    // pidió). El id del step separa exactamente esos dos casos; el `url_analysis_id` no (lo
    // comparten). La barrera estructural es el UNIQUE parcial `product_brief_origin_step_key`:
    // aunque dos entregas del mismo job se colasen entre este SELECT y el INSERT, la segunda
    // choca 23505 y el brief duplicado no llega a existir.
    //
    // QUÉ NO SOBREVIVE AL REUSO: los warnings del SINTETIZADOR (viven en su respuesta, que no
    // persistimos). Los del VALIDADOR sí se regeneran —`validateBrief` es determinista y
    // GRATIS— y son los que CP1 necesita para decidir (`needs_user_decision` y compañía). Se
    // acepta a conciencia: el camino de reuso es raro (solo tras un fallo de persistencia), y
    // perder unos warnings informativos es infinitamente más barato que volver a pagar la
    // síntesis.
    const existing = await findBriefByOriginStep(deps.db, stepId);
    if (existing !== undefined) {
      const reused = ProductBriefSchema.parse(existing.data);
      const revalidated = validateBrief(reused, validationOpts);
      collectOutput({
        briefId: existing.id,
        brief: revalidated.brief,
        warnings: revalidated.warnings,
        status: 'reused',
      });
      return;
    }

    const result = await runSynthesizeBrief(
      {
        db: deps.db,
        secretsKey: deps.secretsKey,
        fetch: deps.fetch,
        anthropicBaseUrl: deps.anthropicBaseUrl,
      },
      {
        projectId: n1.projectId,
        raw: n1.raw,
        visualAnalysis,
        targetLanguage: parsed.data.targetLanguage,
        // `stepRunId` (T1.10b): atribuye el `cost_entry` de Sonnet 5 —el cargo más caro del
        // pipeline— a ESTE step. Sin esto, `step_run.cost_actual` quedaba NULL y el canvas
        // mostraba $0,00 mientras `/spend` sí veía el dinero.
        stepRunId: stepId,
      },
    );

    // Refusal / parse_error: el sintetizador NO lanza (estado tipado). Para el PIPELINE
    // sí es un fallo: sin brief no hay nada que aprobar en CP1 ni con qué seguir.
    //
    // PERMANENTE, no reintentable — y esto es una decisión de DINERO, no de estilo. La
    // síntesis es determinista dado el mismo RawContent: un `refused` es la decisión del
    // modelo sobre ESE contenido, y un `parse_error` ya lo reintentó el sintetizador
    // internamente (T1.8 reintenta SOLO el parse_error, y NUNCA el refused, por esta
    // misma razón). Reintentar aquí produciría el MISMO fallo pagando otra llamada de
    // Sonnet 5 (~$0,20) — 3 vueltas = ~$0,60 quemados para acabar igualmente en `failed`.
    // El coste de la llamada que SÍ se hizo queda registrado igualmente (record-first:
    // `recordAnthropicCost` escribe la fila ANTES de que lleguemos aquí).
    if (result.brief === null) {
      throw new PermanentStepError(`N3: la síntesis no produjo brief (status=${result.status})`);
    }

    // Validación determinista T1.9. El perfil sale del ORIGEN del RawContent.
    //
    // `rawContent` NO es opcional en la práctica: es lo que aporta el precio del fast
    // path para el CROSS-CHECK N1==N3 (perfil `url`). Omitirlo desactivaría el check en
    // silencio — exactamente el fallo que costó T1.9 (un fixture cómodo tapó un
    // cross-check roto). Se pasa SIEMPRE; en perfil `manual` el propio validador lo
    // ignora.
    const validated = validateBrief(result.brief, validationOpts);

    // NINGÚN warning del validador MATA el step (T1.15) — y aquí había justo lo contrario: un
    // `if (!validated.ok) throw new PermanentStepError(...)` que hacía terminal el brief sin hero
    // en perfil `url`. La razón que se escribió entonces (una tienda scrapeada sin ni una imagen
    // usable = algo va mal, y CP1 no puede arreglarlo) era falsa para el uso real: en el run de
    // stayforlong.com el step murió con la síntesis de Sonnet YA PAGADA, dejando al usuario sin
    // más salida que leer logs — mientras las imágenes de la página (un about-us, un banner)
    // estaban en el brief, esperando a que alguien las promoviera a hero. El mecanismo bueno ya
    // existía en el perfil manual: `needs_user_decision` → CP1 → el usuario decide (subir fotos,
    // promover una imagen scrapeada, o derivar a packshot IA) y su decisión viaja por
    // `checkpoint_decision` (T1.11) hasta N7a (T4.4). PRD §7.2 N3 y §9.2.
    //
    // Los warnings viajan con el brief al `succeed` de abajo, que es el ÚNICO camino de N3.

    // T1.10b — PERSISTENCIA DEL BRIEF (v1, el de la IA). Hasta aquí el brief vivía SOLO inline
    // en `output_refs`, sin fila ni versión: no había nada que versionar en CP1 ni nada que
    // direccionar desde `GET/PATCH /api/briefs/:id`. Ahora N3 ESTRENA la fila `product_brief`:
    //   - `version`: lo calcula el repo (MAX+1 por url_analysis_id, bajo advisory lock). Es 1 en
    //      el caso normal; un RE-RUN del análisis sobre el MISMO `url_analysis` crearía la
    //      siguiente versión, que es lo correcto (es otro brief de la IA, pedido a conciencia).
    //   - `edited_by_user: false` (esto lo escribió la IA, no el humano — §19.1 mide justo eso).
    //   - `status: 'draft'` (aún no aprobado: lo aprueba el usuario en CP1).
    //   - `originStepRunId`: la clave de idempotencia (ver el bloque de arriba). Es lo que hace
    //      que un REINTENTO de este step reuse ESTE brief en vez de pagar otra síntesis, y lo que
    //      —vía el UNIQUE parcial— impide que el retry deje una segunda "versión de la IA".
    // Se persiste ANTES del collectOutput para que el `briefId` que viaja en el artefacto
    // apunte a una fila que YA existe (nadie puede leer un id que no resuelve).
    const briefRow = await createBriefVersion(deps.db, {
      urlAnalysisId: n1.analysisId,
      data: validated.brief,
      language: parsed.data.targetLanguage,
      editedByUser: false,
      status: 'draft',
      originStepRunId: stepId,
    });

    collectOutput({
      // La FILA es la fuente de verdad del brief desde T1.10b; el inline de abajo se conserva
      // para el panel genérico y el excerpt del SSE (que no van a la BD).
      briefId: briefRow.id,
      // El brief CORREGIDO (precio del fast path, suggested_assets podadas), no el crudo.
      brief: validated.brief,
      // Los warnings del sintetizador y los del validador son de fuentes distintas y
      // ambos importan en CP1 (T1.10b): se acumulan, no se pisan.
      warnings: [...result.warnings, ...validated.warnings],
      status: result.status,
    });
  };
}
