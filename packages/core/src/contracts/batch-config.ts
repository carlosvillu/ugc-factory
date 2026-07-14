// LA CONFIG DE CP2 (T2.3): lo que el usuario ELIGE en el panel de la matriz y lo único que
// viaja del navegador al servidor para (a) estimar el coste y (b) confirmar el lote.
//
// POR QUÉ EXISTE ESTE CONTRATO, Y POR QUÉ ES TAN PEQUEÑO. `ComposeMatrixInput`
// (`strategy/matrix.ts`) NO es serializable como petición: lleva el `ProductBrief` entero, la
// librería de hooks y las filas de personas — o sea, lo que el SERVIDOR ya tiene en la BD. Si el
// navegador mandara todo eso, el usuario podría mandar OTRO brief, OTROS costes u OTRAS personas
// que las que el sistema va a usar de verdad: la estimación de coste dejaría de ser una promesa
// del sistema para pasar a ser un eco de lo que el cliente dijo.
//
// Así que el cliente manda SOLO SUS DECISIONES (qué ángulos, cuántos hooks, qué objetivo, qué
// tier, qué idiomas, qué persona) y el servidor resuelve el resto contra la BD (el brief del
// step, la `hook_line` sembrada, la `recipe` del tier, las `persona`). **Ningún número de dinero
// se calcula en el navegador** (decisión vinculante de T2.3): el coste sale de
// `estimateBatchCost` sobre la receta REAL, en el servidor, y la UI solo lo PINTA.
//
// LA MISMA FORMA sirve para las dos operaciones —previsualizar (`POST /api/batches/estimate`) y
// confirmar (la `decision` de `POST /api/steps/:id/approve`)— y eso NO es economía de tipos: es
// la garantía de que **lo que el usuario aprueba es exactamente lo que se le estimó**. Con dos
// shapes distintos, un campo que solo existiera en el de confirmar (o al revés) haría que el
// lote creado difiriera del lote presupuestado, en silencio.
import { z } from 'zod';
import { AdObjectiveSchema, RecipeTierSchema } from '../library/contracts';

/**
 * Cómo se reparte la persona entre las variantes (§11: «el usuario puede FIJAR o dejar que
 * ROTE para el A/B»).
 *
 *  · `rotate` → el compositor recibe TODAS las candidatas de `matchPersonas` y las reparte
 *    (por ángulo+idioma en hook-testing, por variante en modo normal — ver `personaRotationIndex`).
 *  · `fixed`  → el compositor recibe UNA sola persona (`personaId`), así que todas las variantes
 *    llevan la misma cara. No es «filtrar la salida»: es alimentar al compositor con un pool de
 *    uno, que es lo que hace que `sharedScope` (y por tanto la dedup y el coste) sea coherente.
 *  · `none`   → sin personas (`personas: []`). Variantes sin cara fijada, que el contrato permite
 *    (`PlannedVariant.personaName` es nullable) y que es lo único honesto cuando la librería está
 *    vacía o ninguna casó con el segmento (`BatchPlan.personaSelection`).
 */
export const PersonaModeSchema = z.enum(['rotate', 'fixed', 'none']);
export type PersonaMode = z.infer<typeof PersonaModeSchema>;

/**
 * La config del lote que CP2 confirma.
 *
 * LOS ÁNGULOS SE ELIGEN POR ÍNDICE, y los HOOKS POR CANTIDAD — no uno a uno. Es lo que el
 * contrato de T2.2 acepta (`ComposeMatrixInput.angleIndices` + `hooksPerAngle`: el compositor
 * TOMA los `hook_examples` del ángulo y los completa con la librería), y es también lo que dice
 * la Entrega de T2.3 («selección de ángulos (cards con hooks del brief)»). El mockup dibuja un
 * checkbox por HOOK: eso exigiría que `composeMatrix` aceptara una selección explícita de hooks,
 * que es superficie de T2.2 y no se toca aquí. Los hooks del ángulo se MUESTRAN (la card los
 * lleva), pero lo que se elige es el ángulo y cuántos hooks entran por ángulo.
 */
export const BatchConfigSchema = z
  .object({
    /** Índices en `ProductBrief.angles[]`. Al menos uno: sin ángulos no hay matriz (y
     *  `composeMatrix` lanzaría). */
    angleIndices: z.array(z.number().int().nonnegative()).min(1),
    /** Hooks por ángulo (§7.2 N4: «2–3 por ángulo del brief + hook library»). El techo de 6 no es
     *  arbitrario: un ángulo del brief trae 2–3 `hook_examples` y la librería completa el resto;
     *  pedir 50 hooks por ángulo sería multiplicar el gasto por un número que ningún brief real
     *  puede llenar con copy propia. */
    hooksPerAngle: z.number().int().min(1).max(6),
    objective: AdObjectiveSchema,
    tier: RecipeTierSchema,
    /** Idiomas del lote (§12 `ad_batch.languages`). Cada idioma MULTIPLICA las variantes. */
    languages: z.array(z.string().min(1)).min(1),
    personaMode: PersonaModeSchema,
    /** OBLIGATORIO con `personaMode: 'fixed'` (y solo con él): la persona que llevan TODAS las
     *  variantes. El invariante se impone aquí —y no en el llamante— por el mismo motivo que en
     *  `BriefCheckpointDecision.hero_image_url`: un `fixed` sin id es una decisión que el
     *  compositor no podría ejecutar, y descubrirlo al confirmar el gasto es el peor momento. */
    personaId: z.string().min(1).optional(),
  })
  .refine((c) => (c.personaMode === 'fixed') === (c.personaId !== undefined), {
    message: '`personaId` es obligatorio con `personaMode: "fixed"` (y solo con él)',
    path: ['personaId'],
  });
export type BatchConfig = z.infer<typeof BatchConfigSchema>;
