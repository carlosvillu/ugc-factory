// DAG del ANÁLISIS (T1.10a, F1): la cadena real N1 (ingesta) → N2 (visión, con
// auto-skip) → N3 (síntesis + validación) — hermano de `demoRunDefinition`
// (demo-dag.ts, léelo para el precedente del invariante `node_key` ÚNICO por run:
// el `singletonKey` de encolado es `${runId}:${nodeKey}` con policy `short`, así que
// dos steps del mismo run con el mismo node_key colisionarían y el 2.º no se encola).
//
// N0 (intake) NO es un step del DAG: es la ACCIÓN que crea el run. Pero LOS DOS MODOS
// DE INTAKE ENTRAN POR EL MISMO DAG, y eso es un requisito, no una comodidad: la
// Verificación exige ver "N2 skipped EN EL GRAFO" en el camino de texto libre — y no
// hay grafo sin `pipeline_run`. Lo que cambia entre modos es de dónde saca N1 su
// `RawContent`:
//
//   - `source: 'url'`    → N1 SCRAPEA (Firecrawl → fallback Jina + mini-crawl,
//                          T1.4/T1.5) y crea la fila `url_analysis` DENTRO del run.
//   - `source: 'manual'` → la fila `url_analysis` YA EXISTE: la creó `POST /api/analyses`
//                          (T1.6: short-circuit texto→RawContent + caché §7.4) ANTES de
//                          arrancar el run. N1 solo la CARGA por id. CERO scraping.
//
// La asimetría es deliberada: deja la ruta de T1.6 funcionando EXACTAMENTE igual (su
// short-circuit y su caché siguen siendo suyos) en vez de re-implementar el intake
// manual dentro del executor. N1 normaliza ambos caminos al MISMO artefacto —un
// `RawContent` en su `output_refs`—, de modo que N2 y N3 son AGNÓSTICOS del modo de
// intake: solo ven contenido crudo.
import { z } from 'zod';
import type { RunDefinitionInput } from './run-definition';

// Las configs de los steps se declaran como SCHEMAS Zod (y los tipos se derivan con
// `z.infer`), no como types a mano. Mismo patrón que `DemoConfigSchema` (executor.ts), que
// vive en core y el executor del worker IMPORTA.
//
// Por qué importa: el PRODUCTOR del `step_run.config` es el DAG (aquí, core) y su CONSUMIDOR
// es el executor (apps/worker). Con dos declaraciones de la misma forma, añadir un campo
// obliga a tocar dos paquetes — y si se olvida uno, el drift es SILENCIOSO (el DAG emite un
// campo que el safeParse del executor tira, o el executor exige uno que el DAG nunca pone y
// revienta en runtime). Con UNA declaración, el desajuste no compila.

/**
 * Config del step N1 (ingesta). Unión discriminada por `source` — el MISMO discriminante
 * que el contrato de intake (contracts/intake.ts). El executor la re-valida al leerla de la
 * BD (`step_run.config` es jsonb opaco), pero contra ESTE schema, no contra una copia.
 */
export const AnalysisN1ConfigSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('url'),
    projectId: z.string().min(1),
    url: z.string().min(1),
  }),
  z.object({
    source: z.literal('manual'),
    projectId: z.string().min(1),
    analysisId: z.string().min(1),
  }),
]);
export type AnalysisN1Config = z.infer<typeof AnalysisN1ConfigSchema>;

/** Config del step N3 (síntesis): el idioma de ANÁLISIS (Entrega de T1.8). */
export const AnalysisN3ConfigSchema = z.object({
  targetLanguage: z.string().min(1),
});
export type AnalysisN3Config = z.infer<typeof AnalysisN3ConfigSchema>;

/** Idioma de análisis por defecto (usuario hispanohablante, PRD mono-usuario). */
export const DEFAULT_ANALYSIS_LANGUAGE = 'es';

/** Lo que N0 (el intake) aporta para armar el run, en cualquiera de sus dos modos.
 *  `targetLanguage` es config del LOTE (N0), no del scraping. */
export type AnalysisIntake =
  | { source: 'url'; url: string; targetLanguage?: string }
  | { source: 'manual'; analysisId: string; targetLanguage?: string };

/**
 * Construye la definición del run de análisis N1→N2→N3 para un proyecto.
 *
 * N2 NO lleva config propia A PROPÓSITO: lee el `RawContent` que N1 dejó en su
 * `output_refs` y decide POR SÍ MISMO si hay imágenes que analizar. Si no las hay se
 * autodeclara inaplicable (`skip_inapplicable` → `skipped`; PRD §7.1 "skipped (nodo
 * no aplicable, p. ej. N2 sin imágenes)" y §7.2, ficha de N2) y N3 avanza igual,
 * porque un nodo saltado SATISFACE la dependencia (T0.8). Por eso tampoco existe un
 * `startSkipped` en la definición: en modo URL no se sabe si habrá imágenes hasta que
 * N1 ha scrapeado — la decisión es necesariamente de RUNTIME.
 *
 * `autopilot=false`: CP1 (el brief editable sobre N3) es un checkpoint humano, pero lo
 * cablea T1.10b — aquí solo se fija el flag del run por coherencia con `createRun`.
 */
export function analysisRunDefinition(
  projectId: string,
  intake: AnalysisIntake,
): RunDefinitionInput {
  const targetLanguage = intake.targetLanguage ?? DEFAULT_ANALYSIS_LANGUAGE;

  const n1Config: AnalysisN1Config =
    intake.source === 'url'
      ? { source: 'url', projectId, url: intake.url }
      : { source: 'manual', projectId, analysisId: intake.analysisId };

  return {
    projectId,
    autopilot: false,
    nodes: [
      {
        key: 'N1',
        nodeKey: 'N1',
        dependsOn: [],
        config: n1Config,
      },
      {
        key: 'N2',
        nodeKey: 'N2',
        dependsOn: ['N1'],
        // Sin config: N2 se autodetermina a partir del output de N1 (ver arriba).
      },
      {
        key: 'N3',
        nodeKey: 'N3',
        // N3 depende de LOS DOS, y lo declara explícitamente: necesita el `RawContent` de N1
        // (el texto con el que sintetiza) Y el `VisualAnalysis` de N2 (o su marcador de skip).
        // Antes declaraba solo `['N2']` y se traía el output de N1 por su cuenta buscándolo
        // por `node_key` entre los steps del run — un atajo que se rompe con el supersede de
        // T0.8 (dos filas con `node_key='N1'` ⇒ podía leer la vieja). Ahora el orquestador le
        // entrega sus deps ya resueltas POR ULID, y para eso tiene que SABER de quién depende.
        // El orden topológico no cambia (N1 precede a N2, que precede a N3), así que declarar
        // la arista N1→N3 no altera la ejecución: solo la hace VERDADERA.
        dependsOn: ['N1', 'N2'],
        config: { targetLanguage } satisfies AnalysisN3Config,
      },
    ],
  };
}
