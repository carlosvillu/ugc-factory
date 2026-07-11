// Contratos de los ARTEFACTOS que los nodos dejan en `step_run.output_refs` (T1.10a).
//
// Viven en core, y no en el executor que los produce, porque `output_refs` es una
// INTERFAZ PÚBLICA, no un detalle interno: lo consumen (a) el nodo siguiente de la cadena,
// (b) el panel genérico del canvas y (c) CP1 (T1.10b), que renderiza el brief de N3 y el
// motivo del skip de N2. Y `apps/web` NO puede importar de `apps/worker` (son composition
// roots hermanos, architecture.md §1) — si el schema viviera en el executor, web acabaría
// redeclarando la misma forma y tendríamos DOS verdades divergiendo en silencio.
import { z } from 'zod';
import { RawContentSchema } from './raw-content';
import { VisualAnalysisSchema } from './visual-analysis';

/**
 * Lo que persiste CUALQUIER nodo que se autodeclare INAPLICABLE (PRD §7.1: "skipped (nodo
 * no aplicable, p. ej. N2 sin imágenes)"). El nodo cierra con `skip_inapplicable` →
 * `skipped` y deja aquí el MOTIVO, para que la UI explique POR QUÉ se saltó en vez de
 * mostrar un hueco.
 *
 * GENÉRICO a propósito (no `N2SkipOutput`): el auto-skip no es de N2 — es un mecanismo del
 * orquestador que F2–F4 van a reutilizar (un nodo de la matriz que no aplique a una
 * variante, una plataforma no seleccionada…). `reason` es un string libre y no un enum:
 * cada nodo tiene sus motivos, y encerrarlos hoy en un enum obligaría a tocar este contrato
 * cada vez que un nodo nuevo se sepa saltar.
 */
export const SkippedOutputSchema = z.object({
  skipped: z.literal(true),
  reason: z.string(),
});
export type SkippedOutput = z.infer<typeof SkippedOutputSchema>;

/** ¿El `output_refs` de un step es el marcador de auto-skip (y no un artefacto real)? Es
 *  el discriminante que un nodo consumidor usa para saber si su dependencia hizo el trabajo
 *  o se descartó. General: sirve para cualquier nodo saltable, no solo N2. */
export function isSkippedOutput(outputRefs: unknown): outputRefs is SkippedOutput {
  return SkippedOutputSchema.safeParse(outputRefs).success;
}

/**
 * N1 · INGESTA: el `RawContent` + el id del `url_analysis` que lo persiste. N2 y N3 lo leen
 * de aquí (no vuelven a la BD a por el análisis). Es el MISMO artefacto en los dos modos de
 * intake —url (scrapeado) y manual (texto libre)—, que es justo lo que hace a N2/N3
 * agnósticos del modo.
 */
export const N1OutputSchema = z.object({
  analysisId: z.string(),
  projectId: z.string(),
  raw: RawContentSchema,
});
export type N1Output = z.infer<typeof N1OutputSchema>;

/** N2 · ANÁLISIS VISUAL: el `VisualAnalysis` cuando SÍ hubo imágenes que analizar. Cuando
 *  NO las hubo, N2 no escribe esto sino un `SkippedOutput` (ver arriba). */
export const N2OutputSchema = z.object({
  visualAnalysis: VisualAnalysisSchema,
  status: z.string(),
  warnings: z.array(z.string()),
});
export type N2Output = z.infer<typeof N2OutputSchema>;

/**
 * N3 · PRODUCTBRIEF: el brief YA validado (T1.9: precio cruzado, `suggested_assets` podadas)
 * + los warnings acumulados del sintetizador y del validador. Es lo que CP1 (T1.10b) edita
 * campo a campo y lo que el panel genérico muestra hoy como output del nodo.
 *
 * `brief` se deja como `unknown` A PROPÓSITO: tiparlo aquí con `ProductBriefSchema` obligaría
 * a validar el brief ENTERO (un objeto grande) cada vez que alguien lee el output de N3, y el
 * brief ya fue validado en su frontera (N3, con `validateBrief`) antes de persistirse. Quien
 * necesite el brief tipado lo parsea con `ProductBriefSchema` en su punto de uso.
 */
export const N3OutputSchema = z.object({
  brief: z.unknown(),
  status: z.string(),
  warnings: z.array(z.unknown()),
});
export type N3Output = z.infer<typeof N3OutputSchema>;
