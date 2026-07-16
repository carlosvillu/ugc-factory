// DAG del LOTE (T2.6, F2): el run que GUIONIZA un lote ya creado. Un único nodo N5 (ScriptWriter)
// que además es CP3 (el checkpoint del editor de guiones). Hermano de `analysisRunDefinition`
// (analysis-dag.ts).
//
// POR QUÉ N5 ES UN RUN NUEVO Y NO UN NODO MÁS DEL DAG DE ANÁLISIS (decisión anclada al código):
//   - El DAG de análisis (N1→N2→N3→N4) se CONGELA en N0: sus nodos se instancian al crear el run,
//     ANTES de que exista ningún `ad_batch`. N5 necesita el `batchId` —el lote que CP2 aprobó—, que
//     no existe hasta que la aprobación de CP2 lo crea. Meter N5 en el DAG de análisis exigiría un
//     `batchId` que ese DAG no puede conocer.
//   - N5 GASTA dinero (Sonnet 5). Los nodos de pago son SIEMPRE executors del worker con retry e
//     idempotencia, nunca un efecto síncrono del route handler.
//   Solución: N5 arranca como el PRIMER (y único) step de un RUN DE LOTE nuevo, creado con
//   `createRun` DENTRO de la misma tx que la aprobación de CP2 (server/batch-checkpoint.ts). El
//   `batchId` viaja en su `config` — el lote ya existe cuando el run se crea, en esa misma tx.
//
// Frontera de core (SKILL.md backend, principio 1): sin BD, sin cola. Habla nodos y config, no filas.
import { z } from 'zod';
import { PACKSHOT_MIN_SHOTS, PACKSHOT_MAX_SHOTS } from '../generation/packshot-prompt';
import type { RunDefinitionInput } from './run-definition';

/**
 * Config del step N5 (guionización): el LOTE que se guioniza. El executor la re-valida al leerla de
 * la BD (`step_run.config` es jsonb opaco), pero contra ESTE schema, no contra una copia — misma
 * disciplina productor(core)/consumidor(worker) que las `AnalysisN*ConfigSchema` (analysis-dag.ts).
 * Del `batchId` el executor saca el `BatchPlan` (`ad_batch.matrix`) y el `briefId`.
 */
export const AnalysisN5ConfigSchema = z.object({
  batchId: z.string().min(1),
});
export type AnalysisN5Config = z.infer<typeof AnalysisN5ConfigSchema>;

/**
 * Config del step N6 (compilador de prompts, T3.5). ESQUELETO: el corte de alcance de T3.5 es el
 * MOTOR completo en core (funciones puras) + este executor de REGISTRO mínimo. El cableado pesado
 * del DAG de generación (N6→N7a-e), la tabla `generation` donde vive `resolved_prompt` y la lectura
 * de brief/persona/guion desde la BD son F4/T4.11 — NO se construyen aquí.
 *
 * Por eso la config apunta a la `variantId` (el forward-pointer estable, como `batchId` en N5): en
 * F4 el executor sacará de ella el guion, la persona y las facetas para compilar. Hoy el executor
 * VALIDA la config y delega en el motor puro de `@ugc/core/gallery` cuando F4 le pase las fuentes.
 */
export const AnalysisN6ConfigSchema = z.object({
  variantId: z.string().min(1),
});
export type AnalysisN6Config = z.infer<typeof AnalysisN6ConfigSchema>;

/**
 * Config del step N7a · PRODUCT SHOTS (T4.4, §7.2). N7a genera los shots del producto según la RUTA
 * que CP1 decidió (§9.2, `checkpoint_decision.images`): `ai_packshot` (packshot generado por IA,
 * sin fotos reales) o —cuando T4.4b lo cablee— la ruta con referencias reales.
 *
 * LA RUTA VIENE POR CONFIG, NO POR UN LOOKUP. T4.11 rellenará este `route` desde la decisión de CP1
 * al construir el DAG; hasta entonces (y en el smoke STEPLESS) la ruta viaja explícita en la config
 * — la MISMA costura stepless que N5/N6 mantienen: el executor no necesita un `step_run_id` real ni
 * leer `checkpoint_decision` de la BD para elegir la ruta. Esto hace que el smoke pueda conducir
 * `ai_packshot` sin run.
 *
 * T4.4 SOLO implementa `ai_packshot`. El enum admite las otras rutas para que el CONTRATO esté
 * completo desde ya (T4.11 y T4.4b no tendrán que ampliarlo), pero el executor las rechaza con
 * `PermanentStepError` — un seam explícito, no un fallthrough silencioso.
 *
 * `briefId` es el forward-pointer estable (como `batchId` en N5, `variantId` en N6): el executor
 * lee de él la descripción del producto para construir el prompt de packshot. `numShots` (2–3) y
 * `aspect` (9:16) los fija el config; el executor los traduce al payload de flux-2.
 */
export const PackshotRouteSchema = z.enum(['ai_packshot', 'upload_images', 'promote_scraped']);
export type PackshotRoute = z.infer<typeof PackshotRouteSchema>;

export const N7aConfigSchema = z.object({
  route: PackshotRouteSchema,
  briefId: z.string().min(1),
  // 2–3 shots (Entrega T4.4). El rango vive en `PACKSHOT_MIN/MAX_SHOTS` (core/generation) y el config
  // lo REUSA por deep-import (`../generation/packshot-prompt`): esas constantes son la ÚNICA fuente de
  // verdad del rango. Deep-import (no el barril `../generation`) porque es idiomático en core y evita
  // arrastrar el barril entero; no hay ciclo (generation no importa de orchestrator).
  numShots: z
    .number()
    .int()
    .min(PACKSHOT_MIN_SHOTS)
    .max(PACKSHOT_MAX_SHOTS)
    .default(PACKSHOT_MIN_SHOTS),
  // Aspecto vertical 9:16 (Entrega). Se deja como enum de un valor por ahora (N7a es 9:16), pero
  // explícito en el contrato para que T4.11/T4.4b no lo asuman.
  aspect: z.enum(['9:16']).default('9:16'),
});
export type N7aConfig = z.infer<typeof N7aConfigSchema>;

/**
 * Construye la definición del run de lote (un solo nodo N5) para un proyecto y un lote ya creado.
 *
 * `autopilot=false` + N5 `isCheckpoint` con `alwaysPause`: CP3 —el editor de guiones— es el
 * checkpoint humano de F2. El run arranca SIN autopilot, así que N5 pausa en `waiting_approval` con
 * sus `ad_script` v1 ya persistidos y linteados, y de ahí los recoge el panel de CP3.
 *
 * ── POR QUÉ `alwaysPause` NO ES OPCIONAL AQUÍ ────────────────────────────────────────────────────
 * Mismo argumento que N4/CP2 (§7.1.b): CP3 es donde se confirman los guiones ANTES de que N6/N7
 * (T3.5/T4.11) gasten en la generación real. Un checkpoint normal con autopilot ON no pausa
 * (`shouldPause` → `!autopilot`), así que N5 pasaría directo a `succeeded` sin que nadie revisara ni
 * aprobara los guiones —ni resolviera un flag FTC bloqueante—, y las variantes nunca llegarían a
 * `scripted`. Autopilot significa «no me preguntes por lo gratis», no «gasta en generación sin que
 * yo vea los guiones».
 */
export function batchRunDefinition(projectId: string, batchId: string): RunDefinitionInput {
  return {
    projectId,
    autopilot: false,
    nodes: [
      {
        key: 'N5',
        nodeKey: 'N5',
        dependsOn: [],
        config: { batchId } satisfies AnalysisN5Config,
        isCheckpoint: true,
        checkpointConfig: { alwaysPause: true },
      },
    ],
  };
}
