// EL COMPOSITOR DE MATRIZ (N4, §7.2): «elegir ángulos y componer la matriz: ángulos × hooks
// (2–3 por ángulo del brief + hook library) × avatares × duración (preset por objetivo, §8.4)
// × idiomas × tier».
//
// DETERMINISTA Y $0 (§7.2 lo marca así): sin LLM, sin red, sin BD. Mismo brief + misma config
// = misma matriz, byte a byte. La única «inteligencia» es la recomendación de personas, que
// REUTILIZA `matchPersonas` (T2.0, §11) en vez de re-implementarla.
//
// LA ECONOMÍA HOOK×BODY×CTA (§7.2 N5 + §16.1: «3×2×2 = 12 anuncios pagando 7 clips»). En modo
// `hook_test` el body y el CTA son **compartidos por ángulo**: las 3 variantes de un ángulo
// dicen lo mismo después del gancho, así que su body y su CTA se generan UNA vez. Aquí eso se
// materializa en `segmentKeys`: dos variantes con la misma clave de `body` comparten
// generación (y el estimador la cobra una vez). En modo normal (`conversion`/`story`) cada
// variante lleva sus tres claves propias — §7.2 N5: «en lotes normales: 1 guion por variante».
//
// QUÉ COMPARTE UNA CLAVE COMPARTIDA. La clave del body en hook-testing es
// `angleIndex|language|persona`: el idioma porque el body se HABLA (un body en español no
// sirve para el anuncio en inglés), y la persona porque el clip lleva su cara. Compartir por
// ángulo A SECAS habría sido más barato… y falso: se estaría prometiendo reutilizar un clip
// que no existe.
import type { ProductBrief } from '../contracts/product-brief';
import type { AdSegment, BatchPlan, PlannedHook, PlannedVariant } from '../contracts/batch-plan';
import type { AdObjective, HookLineSeed, RecipeTier } from '../library/contracts';
import type { MatchablePersona } from '../persona/contracts';
import { matchPersonas } from '../persona/candidates';
import { BRIEF_FRAMEWORK_TO_HOOK_ANGLE } from './hook-angle-bridge';
import { DURATION_PRESETS } from './presets';

/**
 * Una persona tal y como la consume el compositor: lo que la regla de matching de T2.0 necesita
 * (`MatchablePersona`, estructural) **más su `id` opcional**, que es lo que da claves ESTABLES de
 * dedup y de `filename_code` (ver `personaKey`).
 *
 * No se toca `MatchablePersona`: T2.0 la dejó estructural y genérica precisamente para que cada
 * consumidor le añada lo suyo. Las filas de `@ugc/db` (lo que pasará T2.3) encajan aquí tal cual.
 */
export type PlannablePersona = MatchablePersona & { id?: string };

/** Config del compositor: lo que CP2 (T2.3) pondrá en la UI y el usuario confirma. */
export interface ComposeMatrixInput {
  brief: ProductBrief;
  /** Cuántos ángulos del brief entran en el lote (los primeros `angleCount` de `brief.angles`).
   *  El usuario los ELIGE en CP2; el compositor recibe la selección ya hecha vía `angleIndices`
   *  o, por defecto, toma los `angleCount` primeros. */
  angleIndices?: number[];
  angleCount?: number;
  /** Hooks por ángulo. Se toman primero los `hook_examples` del ángulo (2–3, §7.2 N4) y se
   *  completan con la librería (`libraryHooks`) filtrada por ángulo+idioma si hacen falta más. */
  hooksPerAngle: number;
  /** La librería sembrada (T2.1), ya filtrada o no: el compositor la filtra por `angle` +
   *  `language`. Vacía = solo hooks del brief. */
  libraryHooks?: HookLineSeed[];
  /** Las personas disponibles (filas de `@ugc/db`, que traen `id`). Vacío = variantes sin persona
   *  fijada («el usuario puede fijar o dejar que rote», §11). */
  personas?: PlannablePersona[];
  languages: string[];
  objective: AdObjective;
  tier: RecipeTier;
  /**
   * EL DESAMBIGUADOR DEL LOTE — la defensa real contra una colisión de `filename_code`.
   *
   * EL PROBLEMA (§12): `ad_variant.filename_code` es **UNIQUE GLOBAL**, no único por lote. El
   * compositor garantiza unicidad DENTRO del plan (producto-ángulo-hook-persona-idioma-duración),
   * pero **dos lotes compuestos del MISMO brief con la MISMA config producen los mismos códigos**
   * — y el segundo `INSERT` reventaría contra el UNIQUE. Justo al confirmar el gasto en CP2: un
   * 500 en la cara del usuario en el peor momento posible.
   *
   * POR QUÉ AQUÍ Y NO «QUE LO ARREGLE T2.3»: core no puede consultar lotes previos (no conoce la
   * BD), pero **sí puede aceptar que le digan cuál es este lote**. Eso basta: el llamante (T2.3,
   * que sí tiene el `ad_batch.id` delante al crear las filas) pasa un discriminante —el ULID del
   * lote, o un contador— y el código pasa a ser único por construcción. Dejar la única defensa en
   * un comentario que T2.3 puede no leer no es una defensa.
   *
   * Opcional y con default vacío: sin él el comportamiento es el de antes (único dentro del plan),
   * que es lo correcto para previsualizar la matriz en CP2 ANTES de que el lote exista. El sitio
   * donde es OBLIGATORIO pasarlo es al PERSISTIR.
   */
  batchDiscriminator?: string;
}

/** El slug de un texto: minúsculas, sin acentos, sin puntuación, guiones. Es lo que hace
 *  `filename_code` LEGIBLE (§8.3: «filename que codifica la combinación … para trazabilidad
 *  en Ads Manager») y estable entre corridas. */
function slugify(text: string, maxLength = 24): string {
  const normalized = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.slice(0, maxLength).replace(/-+$/, '') || 'x';
}

/**
 * Los hooks de UN ángulo en UN idioma: primero los del brief (`angles[].hook_examples`), luego
 * los de la librería (T2.1) filtrados por el `framework` del ángulo y el idioma — que es
 * exactamente para lo que `hook_line.angle` es de vocabulario cerrado.
 *
 * Si no llegan a `hooksPerAngle` se devuelven los que haya: el compositor no INVENTA copy (eso
 * es N5), y una matriz con menos hooks de los pedidos es un hecho que CP2 debe poder enseñar.
 */
function hooksForAngle(
  brief: ProductBrief,
  angleIndex: number,
  language: string,
  hooksPerAngle: number,
  libraryHooks: HookLineSeed[],
): PlannedHook[] {
  const angle = brief.angles[angleIndex];
  if (!angle) return [];

  const hooks: PlannedHook[] = angle.hook_examples.map((text) => ({
    text,
    source: 'brief' as const,
  }));

  if (hooks.length < hooksPerAngle) {
    // El framework del brief y el ángulo de la librería son DOS ENUMS DISTINTOS que solo
    // coinciden en 4 de sus valores: sin el puente, 6 de los 10 frameworks que Sonnet puede
    // escribir no casarían con NINGÚN hook de librería, en silencio (ver `hook-angle-bridge.ts`).
    const libraryAngle = BRIEF_FRAMEWORK_TO_HOOK_ANGLE[angle.framework];
    // La línea de librería se identifica por su CLAVE NATURAL —(language, text), el UNIQUE de
    // `hook_line`—, que ya viaja en el plan: no por su posición en este array, que no existe
    // cuando alguien relee la matriz persistida (ver `PlannedHookSchema`).
    for (const seed of libraryHooks) {
      if (hooks.length >= hooksPerAngle) break;
      if (seed.angle !== libraryAngle) continue;
      if (seed.language !== language) continue;
      hooks.push({ text: seed.text, source: 'library' });
    }
  }

  return hooks.slice(0, hooksPerAngle);
}

/**
 * La persona de una variante. §11: «en N4, el `avatar_hint` de cada segmento de audiencia del
 * brief sugiere personas compatibles; el usuario puede fijar o dejar que rote para el A/B».
 *
 * Aquí se implementa el «dejar que rote»: se toman las candidatas de `matchPersonas` (la regla
 * de T2.0, REUTILIZADA) sobre el `avatar_hint` del primer segmento de audiencia, y se rotan
 * de forma determinista según `rotationIndex`. Sin candidatas → `null` (variante sin persona
 * fijada, que el schema permite y que CP2 dejará elegir a mano).
 *
 * ⚠ QUIÉN DECIDE `rotationIndex` ES UNA DECISIÓN DE DINERO — ver `personaRotationIndex()`.
 *
 * ⚠ SIMPLIFICACIÓN ANOTADA PARA T2.3: §11 dice «el `avatar_hint` de **cada** segmento de
 * audiencia»; aquí se usa solo el del PRIMER segmento (`segments[0]`). Es suficiente para la
 * Verificación de T2.2 (1 persona) y para el caso normal (el brief trae ≤4 segmentos y el
 * primario es el que manda), pero CP2 —donde el usuario ELIGE la persona— es quien debe ofrecer
 * las candidatas de TODOS los segmentos. No se anticipa aquí: sería trabajo de T2.3.
 */
function pickPersona(
  candidates: PlannablePersona[],
  rotationIndex: number,
): PlannablePersona | null {
  // Sin candidatas compatibles NO se cae en «pues la primera de la lista»: eso sería
  // recomendar a quien la regla acaba de descartar. La variante queda sin persona y CP2 la pide.
  if (candidates.length === 0) return null;
  return candidates[rotationIndex % candidates.length] ?? null;
}

/**
 * LAS CANDIDATAS DEL LOTE — se calculan UNA VEZ, no por variante.
 *
 * El conjunto de candidatas es propiedad del BRIEF (sale de `audience.segments[0].avatar_hint`),
 * no de la variante: no depende del ángulo, ni del idioma, ni del hook. Calcularlo dentro del
 * bucle repetía `matchPersonas` —que tokeniza el hint y puntúa a TODAS las personas— una vez por
 * variante, reconstruyendo el mismo array 30 veces en una matriz típica.
 *
 * Izarlo aquí no solo es más barato: hace VISIBLE que las candidatas son del brief. Lo que sigue
 * variando por variante es el `rotationIndex` —y eso, quién lo decide, es la decisión de dinero
 * (ver `personaRotationIndex`)—, no el conjunto sobre el que rota.
 *
 * `matchPersonas` es GENÉRICA en `T` (T2.0 la dejó estructural precisamente para esto), así que
 * aquí recupera `PlannablePersona` ENTERA —con su `id`— sin castear nada.
 */
function matchingPersonas(brief: ProductBrief, personas: PlannablePersona[]): PlannablePersona[] {
  if (personas.length === 0) return [];
  const hint = brief.audience.segments[0]?.avatar_hint ?? '';
  return matchPersonas(personas, hint).map((c) => c.persona);
}

/**
 * LA CLAVE ESTABLE DE UNA PERSONA — y por qué no puede ser su nombre (hallazgo del code-review).
 *
 * El identificador de la persona entra en DOS sitios que no perdonan: en `sharedScope` (LA CLAVE
 * DE DEDUP: decide qué se paga una vez) y en `filename_code` (LA TRAZABILIDAD de §8.3: el fichero
 * que el usuario busca en Ads Manager). Si esa clave fuera el NOMBRE, **renombrar una persona
 * reescribiría el código de fichero de todas sus variantes futuras** — rompiendo justo la
 * trazabilidad que el `filename_code` existe para dar.
 *
 * Por eso se usa el `id` cuando lo hay: es lo único que sobrevive a un renombrado. El nombre se
 * queda para lo LEGIBLE (`PlannedVariant.personaName`, que es lo que CP2 pinta).
 *
 * `id` es OPCIONAL porque `MatchablePersona` (T2.0) es un tipo ESTRUCTURAL sin id — y así debe
 * seguir: su misión es que la regla de matching funcione con cualquier forma de persona. Quien
 * viene de la BD (T2.3: filas de `@ugc/db`) SÍ trae id y obtiene claves estables; un test o un
 * preview con personas sintéticas puede no traerlo y cae al nombre, que es un degradado honesto.
 */
function personaKey(persona: PlannablePersona): string {
  return persona.id ?? persona.name;
}

/**
 * EL ÍNDICE POR EL QUE ROTA LA PERSONA — y por qué esto es un BUG DE DINERO si se elige mal.
 *
 * EL BUG (code-review de T2.2): la persona rotaba por `hookIndex`. Pero la persona entra en
 * `sharedScope`, que es LA CLAVE DE DEDUP del body y el CTA. En `hook_test`, con 2+ personas
 * compatibles, cada hook recibía una cara distinta → `sharedScope` cambiaba → **el body dejaba de
 * compartirse**: 3 hooks producían 7 generaciones en vez de 5, y el estimador cobraba de MÁS.
 * La economía Hook×Body×CTA —«3×2×2 = 12 anuncios pagando 7 clips», §16.1: LA RAZÓN DE SER del
 * modo— desaparecía en silencio. Ningún test lo cazó porque la Verificación usa UNA sola persona,
 * y con una candidata `hookIndex % 1 === 0` siempre: el bug vivía justo detrás del caso probado.
 *
 * Y el daño conceptual es peor que el económico: en hook-testing las variantes de un ángulo deben
 * diferir **SOLO en el hook** (§7.2 N5) — eso ES el experimento. Si además cambian de cara, ya no
 * mides el hook: no sabrías si el ganador ganó por el gancho o por quién lo dice. El A/B queda
 * contaminado.
 *
 * LA REGLA (decisión (a) del review, la única honesta):
 *
 *  · **`hook_test` → la persona rota por ÁNGULO+IDIOMA**, no por hook. Todas las variantes de un
 *    ángulo comparten cara ⇒ comparten `sharedScope` ⇒ el body y el CTA se generan UNA vez, de
 *    verdad. El A/B de persona sigue existiendo: pasa a ser ENTRE ángulos (y entre lotes), que es
 *    donde no contamina el experimento del hook.
 *
 *  · **`conversion` / `story` → la persona rota por VARIANTE** (incluye el hook). Ahí no se
 *    comparte NADA (§7.2 N5: «1 guion por variante»), así que rotar la cara por variante no
 *    destruye ninguna dedup y da más variedad para el A/B. Es legítimo y se conserva.
 *
 * La alternativa (b) —sacar la persona de `sharedScope` y seguir rotando por hook— se DESCARTA:
 * compartiría un clip de body entre variantes con caras DISTINTAS, o sea prometería reutilizar un
 * clip que no existe. Sería el estimador mintiendo sobre lo que se va a facturar, que es
 * exactamente lo que este módulo existe para no hacer.
 */
function personaRotationIndex(
  sharedBodyAndCta: boolean,
  angleIndex: number,
  languageIndex: number,
  hookIndex: number,
): number {
  // hook_test: la cara NO puede depender del hook (rompería la dedup y el experimento).
  if (sharedBodyAndCta) return angleIndex + languageIndex;
  // Modo normal: nada se comparte → rotar por variante es libre y da variedad al A/B.
  return angleIndex + languageIndex + hookIndex;
}

/**
 * Compone la matriz: el producto cartesiano ángulos × hooks × idiomas (× la persona que rota),
 * con la duración del preset y el tier del lote.
 *
 * El orden de iteración es ángulo → idioma → hook: determinista y estable, y es el que hace
 * que la rotación de persona reparta caras dentro de un mismo ángulo+idioma (que es donde el
 * A/B de §11 tiene sentido).
 */
export function composeMatrix(input: ComposeMatrixInput): BatchPlan {
  const { brief, hooksPerAngle, languages, objective, tier } = input;
  const libraryHooks = input.libraryHooks ?? [];
  const personas = input.personas ?? [];
  const preset = DURATION_PRESETS[objective];
  // §7.2 N5: el body/CTA compartido por ángulo es LO QUE DEFINE un lote de hook-testing.
  const sharedBodyAndCta = objective === 'hook_test';

  // ── LA SELECCIÓN DE ÁNGULOS ────────────────────────────────────────────────────────────
  // EL BUG (code-review): el default de `angleCount` era **0**, así que llamar sin `angleIndices`
  // NI `angleCount` devolvía `variants: []` — un plan que NO valida contra su propio schema, y
  // que si el llamante no parsea acaba en un `ad_batch.matrix` vacío enseñándole al usuario un
  // lote de 0 variantes con coste $0. **Un olvido de parámetro degradaba a SILENCIO, no a error.**
  //
  // EL DEFAULT SENSATO ES «TODOS LOS ÁNGULOS DEL BRIEF»: es lo único que un cero no puede ser.
  // Quien quiera menos, lo dice (`angleCount`) o los elige (`angleIndices`).
  const angleIndices =
    input.angleIndices ??
    (input.angleCount === undefined
      ? brief.angles.map((_angle, i) => i)
      : Array.from({ length: Math.min(input.angleCount, brief.angles.length) }, (_u, i) => i));

  if (angleIndices.length === 0) {
    throw new Error('composeMatrix: no hay ángulos seleccionados (la matriz no tendría variantes)');
  }
  if (languages.length === 0) {
    throw new Error('composeMatrix: no hay idiomas (la matriz no tendría variantes)');
  }

  // Las candidatas: UNA vez para todo el lote (son propiedad del brief, no de la variante).
  const candidates = matchingPersonas(brief, personas);

  const variants: PlannedVariant[] = [];
  const productSlug = slugify(brief.product.name, 16);
  // El sufijo de lote que hace GLOBALMENTE único el `filename_code` (ver `batchDiscriminator`).
  // Vacío por defecto: previsualizar la matriz en CP2 no exige que el lote exista todavía.
  const batchSlug = input.batchDiscriminator ? `-${slugify(input.batchDiscriminator, 12)}` : '';

  for (const angleIndex of angleIndices) {
    const angle = brief.angles[angleIndex];
    if (!angle) continue;
    const angleSlug = slugify(angle.name, 16);

    languages.forEach((language, languageIndex) => {
      const hooks = hooksForAngle(brief, angleIndex, language, hooksPerAngle, libraryHooks);

      hooks.forEach((hook, hookIndex) => {
        // La rotación de la cara NO puede depender del hook cuando el body se comparte: sería
        // romper la dedup (y contaminar el A/B). Ver `personaRotationIndex`.
        const rotationIndex = personaRotationIndex(
          sharedBodyAndCta,
          angleIndex,
          languageIndex,
          hookIndex,
        );
        const persona = pickPersona(candidates, rotationIndex);
        const personaName = persona?.name ?? null;
        // La clave de dedup/filename usa el `id` (estable ante renombrados), NO el nombre.
        const personaSlug = persona ? slugify(personaKey(persona), 12) : 'norot';
        const hookCode = `hook${String(hookIndex + 1).padStart(2, '0')}`;

        // La clave de compartición (ver la cabecera): en hook-testing, body y CTA son los
        // MISMOS para todas las variantes de un ángulo+idioma+persona; el hook nunca se
        // comparte (es lo que se está testeando). En modo normal, nada se comparte: la clave
        // de cada segmento incluye el hook, así que es única por variante.
        const sharedScope = `${String(angleIndex)}|${language}|${personaSlug}`;
        const ownScope = `${sharedScope}|${hookCode}`;
        const segmentKeys: Record<AdSegment, string> = {
          hook: `hook:${ownScope}`,
          body: `body:${sharedBodyAndCta ? sharedScope : ownScope}`,
          cta: `cta:${sharedBodyAndCta ? sharedScope : ownScope}`,
        };

        variants.push({
          angleIndex,
          angleName: angle.name,
          framework: angle.framework,
          hook,
          personaName,
          language,
          durationTargetSeconds: preset.targetSeconds,
          // §8.3: el filename codifica la combinación. Lleva el hook y el idioma, que es lo
          // que distingue dos variantes del mismo ángulo — sin ellos habría colisión DENTRO
          // del plan. `batchSlug` (opcional) es lo que la hace única ENTRE lotes, que es lo que
          // exige el UNIQUE GLOBAL de `ad_variant.filename_code` (§12).
          filenameCode: `${productSlug}-${angleSlug}-${hookCode}-${personaSlug}-${language}-${String(preset.targetSeconds)}s${batchSlug}`,
          segmentKeys,
        });
      });
    });
  }

  // LA INVARIANTE: `composeMatrix` NO PUEDE devolver un plan que no valide contra su propio
  // schema (`BatchPlanSchema` exige `variants.min(1)`). Si llegados aquí no hay ni una variante,
  // los ángulos seleccionados no tenían hooks (ni en el brief ni en la librería para su idioma):
  // se LANZA nombrando la causa, en vez de devolver un plan vacío que el llamante persistiría
  // como un lote de 0 variantes y coste $0.
  if (variants.length === 0) {
    throw new Error(
      'composeMatrix: ningún ángulo seleccionado produjo hooks (ni `hook_examples` en el brief ni líneas de librería para sus idiomas): la matriz quedaría vacía',
    );
  }

  // POR QUÉ no hay personas, cuando no las hay (ver `BatchPlan.personaSelection`): «la librería
  // está vacía» y «ninguna casó con el segmento» son cosas MUY distintas para el usuario, y sin
  // esta señal CP2 no podía distinguirlas — solo enseñar un lote mudo.
  // Se deriva de los datos que YA tenemos (personas de entrada + candidatas), no escaneando las
  // variantes: el hecho «¿había personas? ¿casó alguna?» es del BRIEF, y recorrer la salida para
  // redescubrirlo era calcular por tercera vez lo mismo.
  const personaSelection: BatchPlan['personaSelection'] =
    personas.length === 0 ? 'no_personas' : candidates.length === 0 ? 'no_match' : 'matched';

  return {
    objective,
    tier,
    durationTargetSeconds: preset.targetSeconds,
    languages,
    sharedBodyAndCta,
    personaSelection,
    variants,
  };
}
