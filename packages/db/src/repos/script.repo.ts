// Repo del agregado `ad_script` (T2.6, CP3: el editor de guiones + su aprobación transaccional).
// db.md §4: funciones por caso de uso, executor Drizzle como PRIMER argumento.
//
// TRES CASOS DE USO, todos con su invariante:
//
//   1. `findScriptsByOriginStep` — IDEMPOTENCIA DE DINERO de N5 (patrón `findBriefByOriginStep`).
//      Un reintento de N5 (que conserva el `step_run.id`) relee los guiones que ya persistió en vez
//      de re-pagar Sonnet 5. Devuelve N filas (una por variante del lote), no una — un step de N5
//      escribe TODO el lote, por eso el índice de origen NO es unique (schema/batch.ts).
//
//   2. `createScriptsForBatch` — la persistencia v1 que N5 hace tras escribir + lintear. Un INSERT
//      por lote (todas las filas en una escritura), `version:1`, `edited_by_user:false`,
//      `guardrail_flags` desde el arranque (el bloqueo server-side de CP3 no distingue v1 de v2).
//
//   3. `applyScriptVerdicts` — LA PIEZA TRANSACCIONAL DE CP3. Aplica los veredictos ya DECIDIDOS por
//      el efecto de dominio (`server/script-checkpoint.ts`, que es quien re-lintea server-side): por
//      cada variante, si el guion se editó de verdad inserta la v2 (`edited_by_user:true`) con sus
//      flags; y transiciona la variante a `scripted` SOLO si el veredicto lo autoriza (el efecto ya
//      comprobó que no queda flag bloqueante). Todo en UNA tx: «aprobado», «linteado» y «scripted»
//      no divergen. El repo NO lintea (eso es core, en el efecto): recibe la decisión ya tomada.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { AdScript, GuardrailFlag } from '@ugc/core/contracts';
import type { Db } from '../client';
import { adScript, adVariant, type AdScriptRow, type NewAdScript } from '../schema/batch';

// Alias local: la fila de `ad_script` tal cual sale de la BD. (El nombre `AdScript` del schema
// choca con el CONTRATO `AdScript` de core; se re-exporta como `AdScriptRow` — ver schema/batch.ts.)
export type { AdScriptRow };

/** El estado al que una variante puede transicionar en CP3. Hoy solo `scripted` (aprobada) — el
 *  rechazo NO transiciona (la variante se queda como estaba, sin guion aprobado). */
type ScriptedStatus = 'scripted';

/**
 * Los guiones que un step de N5 persistió, para la idempotencia de dinero (patrón
 * `findBriefByOriginStep`). Devuelve TODAS las filas de ese origen (una por variante) — a diferencia
 * del brief (una fila por step), un step de N5 escribe el lote entero.
 */
export async function findScriptsByOriginStep(db: Db, stepRunId: string): Promise<AdScriptRow[]> {
  return db.select().from(adScript).where(eq(adScript.originStepRunId, stepRunId));
}

/**
 * Un guion `ad_script` POR ID (T4.5, N7b — también lo consumirá T4.11). El executor de voz lee la
 * fila REAL persistida para tomar `scenes[].narration` de la ruta de PRODUCCIÓN (no recibe el texto
 * de narración por config: eso fijaría a mano lo que el pipeline deriva). `undefined` si no existe:
 * el executor lo mapea a `PermanentStepError` (un scriptId que no resuelve es un fallo de cableado,
 * reintentarlo no lo arregla). Devuelve la fila cruda; `scenes`/`subtitles` son jsonb OPACO que el
 * caller VALIDA con `AdScriptSchema`/`AdSceneSchema` (nunca castea).
 */
export async function getScriptById(db: Db, id: string): Promise<AdScriptRow | undefined> {
  const [row] = await db.select().from(adScript).where(eq(adScript.id, id));
  return row;
}

/** Un guion a persistir en v1: el CONTRATO `AdScript` (lo que produce N5) + su variante resuelta +
 *  los flags que el linter marcó. `filenameCode`/`sharedBodyKey` del contrato NO se persisten (viven
 *  en `ad_variant`/`ad_batch.matrix`); el resto mapea 1:1 a la fila. */
export interface ScriptToPersist {
  variantId: string;
  content: AdScript;
  guardrailFlags: GuardrailFlag[];
}

export interface CreateScriptsForBatchInput {
  /** El `step_run.id` de N5: la clave de idempotencia (`origin_step_run_id`). */
  stepRunId: string;
  scripts: ScriptToPersist[];
}

/** Mapea el CONTRATO `AdScript` (+ variante + flags) a una fila `ad_script` de la versión `version`.
 *  `filenameCode`/`sharedBodyKey` del contrato se descartan (no son columnas). */
function toRow(
  variantId: string,
  content: AdScript,
  guardrailFlags: GuardrailFlag[],
  opts: { version: number; editedByUser: boolean; originStepRunId: string | null },
): NewAdScript {
  return {
    variantId,
    version: opts.version,
    hook: content.hook,
    scenes: content.scenes,
    subtitles: content.subtitles,
    cta: content.cta,
    fullText: content.fullText,
    wordCount: content.wordCount,
    estSeconds: content.estSeconds,
    tone: content.tone,
    language: content.language,
    editedByUser: opts.editedByUser,
    guardrailFlags,
    originStepRunId: opts.originStepRunId,
  };
}

/**
 * Persiste los guiones v1 del lote (N5). Un INSERT por lote. Devuelve las filas creadas.
 *
 * La barrera del retry-race es el UNIQUE `(variant_id, version)`: si dos entregas del mismo job de
 * N5 se colasen (la de idempotencia `findScriptsByOriginStep` ya no-opeó la segunda antes, pero por
 * si acaso), el segundo INSERT de la v1 de una variante choca 23505 — el ejecutor lo trata como que
 * los guiones YA existen (reuso), nunca como éxito duplicado.
 */
export async function createScriptsForBatch(
  db: Db,
  input: CreateScriptsForBatchInput,
): Promise<AdScriptRow[]> {
  if (input.scripts.length === 0) return [];
  return db
    .insert(adScript)
    .values(
      input.scripts.map((s) =>
        toRow(s.variantId, s.content, s.guardrailFlags, {
          version: 1,
          editedByUser: false,
          originStepRunId: input.stepRunId,
        }),
      ),
    )
    .returning();
}

/**
 * El guion VIGENTE (la versión más alta) de cada variante del lote. Es lo que CP3 lista para editar
 * y lo que el efecto de dominio compara contra el `editedScript` del cliente para decidir si hubo
 * edición de verdad. Une con `ad_variant` para traer el `filename_code` (que la fila `ad_script` no
 * guarda) y el `batch_id`.
 */
export interface LatestScriptRow {
  script: AdScriptRow;
  variantId: string;
  filenameCode: string;
}

export async function getLatestScriptsByBatch(db: Db, batchId: string): Promise<LatestScriptRow[]> {
  // Trae TODAS las versiones de todas las variantes del lote, ordenadas por versión DESC, y se queda
  // con la primera de cada variante (la más alta). El lote tiene ~6 variantes × pocas versiones: es
  // barato traerlas todas y filtrar en memoria, sin un DISTINCT ON que complique el repo.
  const rows = await db
    .select({ script: adScript, filenameCode: adVariant.filenameCode })
    .from(adScript)
    .innerJoin(adVariant, eq(adScript.variantId, adVariant.id))
    .where(eq(adVariant.batchId, batchId))
    .orderBy(desc(adScript.version));

  const seen = new Set<string>();
  const latest: LatestScriptRow[] = [];
  for (const row of rows) {
    if (seen.has(row.script.variantId)) continue;
    seen.add(row.script.variantId);
    latest.push({
      script: row.script,
      variantId: row.script.variantId,
      filenameCode: row.filenameCode,
    });
  }
  return latest;
}

/**
 * Un veredicto YA DECIDIDO por el efecto de dominio (server/script-checkpoint.ts). El repo no
 * lintea ni decide: recibe qué hacer y lo hace transaccionalmente.
 *   - `newVersion` presente ⇒ el guion se editó de verdad: se inserta como v2+ (`edited_by_user`).
 *     Ausente ⇒ no hubo edición (o el usuario aprobó/rechazó el guion tal cual): NO se crea versión.
 *   - `approve: true` ⇒ la variante pasa a `scripted` (el efecto ya verificó que no quedan flags
 *     bloqueantes). `false` ⇒ la variante NO transiciona (rechazo, o flag bloqueante sin resolver).
 */
export interface DecidedVerdict {
  variantId: string;
  approve: boolean;
  newVersion?: {
    content: AdScript;
    guardrailFlags: GuardrailFlag[];
  };
}

export interface ApplyScriptVerdictsInput {
  batchId: string;
  verdicts: DecidedVerdict[];
}

/**
 * Aplica los veredictos de CP3 en UNA tx: inserta las v2 de los guiones editados y transiciona a
 * `scripted` las variantes aprobadas. Atómico (invariante #1 del blueprint): «aprobado», «linteado»
 * (los flags de la v2) y «scripted» commitean juntos o nada.
 *
 * La versión de la v2 se calcula como MAX(version)+1 POR VARIANTE, bajo la serialización natural de
 * la tx del checkpoint (el step de N5 está en `waiting_approval`: no hay otra escritura concurrente
 * sobre estos guiones — el segundo POST daría 409). El UNIQUE `(variant_id, version)` es la barrera
 * estructural por si acaso.
 */
export async function applyScriptVerdicts(db: Db, input: ApplyScriptVerdictsInput): Promise<void> {
  const editing = input.verdicts.filter((v) => v.newVersion !== undefined);
  const approving = input.verdicts.filter((v) => v.approve).map((v) => v.variantId);

  // MAX(version) actual por variante que se edita, en UNA query (nada de N+1).
  const maxByVariant = new Map<string, number>();
  if (editing.length > 0) {
    const rows = await db
      .select({ variantId: adScript.variantId, version: adScript.version })
      .from(adScript)
      .where(
        inArray(
          adScript.variantId,
          editing.map((v) => v.variantId),
        ),
      );
    for (const r of rows) {
      const prev = maxByVariant.get(r.variantId) ?? 0;
      if (r.version > prev) maxByVariant.set(r.variantId, r.version);
    }
  }

  // Inserta las v2 (una fila por edición). `origin_step_run_id: null`: las ediciones humanas no
  // tienen origen de step (mismo criterio que product_brief v2 de CP1) — y así un retry hipotético
  // de N5 nunca las tomaría por "los guiones que yo escribí". El `flatMap` con `newVersion === undefined
  // → []` estrecha el tipo dentro de la rama sin un non-null assertion (que el linter veta) ni una
  // rama de throw lógicamente imposible.
  const newRows: NewAdScript[] = input.verdicts.flatMap((v) => {
    if (v.newVersion === undefined) return [];
    const nextVersion = (maxByVariant.get(v.variantId) ?? 0) + 1;
    return [
      toRow(v.variantId, v.newVersion.content, v.newVersion.guardrailFlags, {
        version: nextVersion,
        editedByUser: true,
        originStepRunId: null,
      }),
    ];
  });

  await db.transaction(async (tx) => {
    if (newRows.length > 0) {
      await tx.insert(adScript).values(newRows);
    }
    if (approving.length > 0) {
      const scripted: ScriptedStatus = 'scripted';
      await tx
        .update(adVariant)
        .set({ status: scripted })
        .where(and(inArray(adVariant.id, approving), eq(adVariant.batchId, input.batchId)));
    }
  });
}
