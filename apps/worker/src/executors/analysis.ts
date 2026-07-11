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
import type {
  RawContent,
  VisualAnalysis,
  N1OutputSchema,
  N2OutputSchema,
  RawContentSchema,
  isSkippedOutput,
  type N1Output,
  type N2Output,
  type SkippedOutput,
} from '@ugc/core/contracts';
import { validateBrief } from '@ugc/core/analyze';
import type { StorageAdapter } from '@ugc/core';
import { getUrlAnalysis, type DbClient } from '@ugc/db';
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
    const { collectOutput } = requireExecutorContext(ctx);

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
      { projectId: cfg.projectId, url: cfg.url },
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
    const { collectOutput, deps: stepDeps } = requireExecutorContext(ctx);
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
      { projectId: n1.projectId, raw: n1.raw },
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
    const { collectOutput, deps: stepDeps } = requireExecutorContext(ctx);

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
    const validated = validateBrief(result.brief, {
      profile: n1.raw.source === 'url' ? 'url' : 'manual',
      rawContent: n1.raw,
    });

    // `ok:false` ⇒ FALLO del step, y PERMANENTE.
    //
    // ¿Por qué `failed` y no `reach_checkpoint` (que CP1 lo resuelva con el usuario)? Lo
    // decide el contrato de T1.9, no la intuición: `ok` se DERIVA de `isBlockingWarning`
    // (contracts/brief-warning.ts), y el único código bloqueante de hoy es
    // `missing_hero_image` — cuya definición dice literalmente que en perfil `url` "NO es
    // una decisión de CP1 como en manual (§9.2)", y que `ok:false` significa "el paso no
    // puede continuar NI DELEGAR EN CP1". Los problemas que SÍ son decisión de CP1 (p. ej.
    // `needs_user_decision` del perfil manual: sin hero, el usuario sube imágenes o deriva
    // a packshot IA) NO ponen `ok:false` — viajan como warnings con el brief y llegan a CP1
    // por el camino normal (el `succeed` de abajo). O sea: el mecanismo de "que lo decida
    // CP1" ya existe y ya funciona; `ok:false` es justo el caso en el que NO sirve.
    //
    // PERMANENTE por el mismo motivo de dinero que arriba: la validación es DETERMINISTA
    // sobre un brief dado. Reintentar = pagar otra síntesis para que el validador diga
    // exactamente lo mismo.
    if (!validated.ok) {
      const codes = validated.warnings.map((w) => w.code).join(', ');
      throw new PermanentStepError(
        `N3: el brief no supera la validación determinista (T1.9): ${codes}`,
      );
    }

    collectOutput({
      // El brief CORREGIDO (precio del fast path, suggested_assets podadas), no el crudo.
      brief: validated.brief,
      // Los warnings del sintetizador y los del validador son de fuentes distintas y
      // ambos importan en CP1 (T1.10b): se acumulan, no se pisan.
      warnings: [...result.warnings, ...validated.warnings],
      status: result.status,
    });
  };
}
