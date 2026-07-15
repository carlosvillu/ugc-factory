// Unit del SCRIPTWRITER (T2.4, N5): la llamada a Sonnet 5 mockeada con msw a nivel de RED
// (POST /v1/messages). PROHIBIDA la red real (skill testing): `onUnhandledRequest:'error'`
// revienta cualquier fuga — escribir 12 guiones de verdad cuesta dinero.
//
// QUÉ SE PRUEBA AQUÍ (offline, $0) y QUÉ NO:
//  - Aquí: la ECONOMÍA del modo hook-testing (UNA llamada por ángulo ⇒ bodies textualmente
//    idénticos POR CONSTRUCCIÓN), el CONTRATO DE REQUEST (modelo, sin sampling params, thinking
//    disabled, cache_control, el idioma destino y las semillas ya renderizadas en el user
//    message), el TIMING calculado por nosotros, el reintento por presupuesto y las ramas tipadas.
//  - NO aquí: que el modelo REAL escriba en inglés cuando la semilla viene en español, ni el coste
//    real. Un mock que devuelve inglés no prueba que el modelo lo haga: eso es comportamiento del
//    proveedor y vive en `script-writer.live.test.ts` (tier live, con guard de presupuesto).
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeAngle, makeBrief, server } from '@ugc/test-utils';

import { SCRIPT_WRITER_SYSTEM_PROMPT } from '../../prompts/script-writer';
import { AdScriptSchema, type AdScript, type BatchPlan } from '../contracts';
import { HOOK_LINE_SEEDS } from '../library/seed-data';
import { composeMatrix } from '../strategy/matrix';
import { DURATION_PRESETS } from '../strategy/presets';
import {
  budgetViolation,
  buildScriptUserMessage,
  groupVariantsForScripting,
  hookBijectionProblem,
  makeScriptWriter,
  SCRIPT_WRITER_MODEL,
  type ScriptDraft,
} from './script-writer';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

const ANTHROPIC_BASE = 'https://api.anthropic.com';
const MESSAGES_ENDPOINT = `${ANTHROPIC_BASE}/v1/messages`;

const writer = makeScriptWriter({ apiKey: 'sk-ant-test-key', baseURL: ANTHROPIC_BASE });

// EL BRIEF DE LA VERIFICACIÓN, con un `pain` de 12 palabras (el caso que muerde: el presupuesto de
// `{pain}` son 6). Y en ESPAÑOL: es la semilla que las variantes `en` reciben sin traducir (deuda
// de T2.2).
const PAIN_12_WORDS = 'la piel tira y se ve apagada al salir de la ducha';
const BRIEF = makeBrief({
  pain_points: [
    { pain: PAIN_12_WORDS, severity: 'high', current_alternative: 'cremas', evidence: null },
  ],
  angles: [
    makeAngle({ name: 'El dolor de la piel tirante', framework: 'pain_point' }),
    makeAngle({ name: 'Lo que nadie te cuenta', framework: 'curiosity' }),
  ],
});

/** LA MATRIZ DE T2.2 (la que la Verificación nombra): 2 ángulos × 3 hooks × es+en = 12 variantes.
 *  Se construye con el `composeMatrix` REAL, no a mano: probar N5 contra un plan inventado sería
 *  probarlo contra un contrato que N4 no produce. */
function planFor(objective: 'hook_test' | 'conversion'): BatchPlan {
  return composeMatrix({
    brief: BRIEF,
    libraryHooks: HOOK_LINE_SEEDS,
    angleCount: 2,
    hooksPerAngle: 3,
    languages: ['es', 'en'],
    objective,
    tier: 'standard',
  });
}

/** Un borrador válido del modelo. `nonce` hace que CADA llamada devuelva un texto DISTINTO: es lo
 *  que convierte «los bodies son idénticos» en un test que DISCRIMINA. Si el código llamara una vez
 *  por variante (el bug que rompe la economía del modo), los bodies llevarían nonces distintos y el
 *  diff dejaría de estar vacío. */
function draftResponse(nonce: number, hookCount: number) {
  return {
    id: `msg_test_script_${String(nonce)}`,
    type: 'message',
    role: 'assistant',
    model: SCRIPT_WRITER_MODEL,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          tone: 'cercano',
          hooks: Array.from({ length: hookCount }, (_, i) => ({
            seedIndex: i,
            narration: `Hook ${String(i)} de la llamada ${String(nonce)} corto`,
            visual: 'primer plano de la cara',
            camera: 'handheld a la altura de los ojos',
            emotion: 'complicidad',
          })),
          body: [
            {
              narration: `Body de la llamada ${String(nonce)} contando el problema con calma`,
              visual: 'plano medio en el baño',
              camera: 'lenta panorámica',
              emotion: 'confianza',
            },
          ],
          cta: [
            {
              narration: `CTA ${String(nonce)} link abajo`,
              visual: 'producto en la mano',
              camera: 'estática',
              emotion: 'entusiasmo',
            },
          ],
        }),
      },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 4200,
      output_tokens: 900,
      cache_creation_input_tokens: nonce === 1 ? 3000 : 0,
      cache_read_input_tokens: nonce === 1 ? 0 : 3000,
    },
  };
}

/** Mock que devuelve contenido DISTINTO en cada llamada y cuenta cuántas hubo. */
function countingMock(hookCount: () => number): { calls: () => number; bodies: string[] } {
  let calls = 0;
  const bodies: string[] = [];
  server.use(
    http.post(MESSAGES_ENDPOINT, async ({ request }) => {
      calls += 1;
      bodies.push(JSON.stringify(await request.json()));
      return HttpResponse.json(draftResponse(calls, hookCount()));
    }),
  );
  return { calls: () => calls, bodies };
}

describe('ScriptWriter — modo hook-testing: la identidad textual del body es POR CONSTRUCCIÓN', () => {
  it('UNA llamada por ángulo+idioma (no por variante): 12 variantes → 4 llamadas', async () => {
    const plan = planFor('hook_test');
    expect(plan.variants).toHaveLength(12);
    expect(plan.sharedBodyAndCta).toBe(true);

    const mock = countingMock(() => 3);
    const res = await writer.write({ plan, brief: BRIEF });

    // 2 ángulos × 2 idiomas = 4 grupos. NO 12: eso sería pagar el body 3 veces por ángulo, y el
    // estimador de T2.2 solo lo cobra UNA (la dedup de N7 que este modo existe para habilitar).
    expect(mock.calls()).toBe(4);
    expect(res.status).toBe('scripted');
    expect(res.scripts).toHaveLength(12);
  });

  it('DIFF VACÍO: los bodies (y CTAs) de las variantes del mismo ángulo son textualmente idénticos', async () => {
    const plan = planFor('hook_test');
    countingMock(() => 3); // cada llamada devuelve un texto DISTINTO: el test discrimina.
    const res = await writer.write({ plan, brief: BRIEF });

    // Se agrupan los guiones por su `sharedBodyKey` (= `segmentKeys.body` de N4) y se exige que el
    // texto de body y cta de cada grupo sea UNO SOLO. Es el `diff` de la Verificación, en código.
    const porClave = new Map<string, Set<string>>();
    for (const script of res.scripts) {
      const bodyText = script.scenes
        .filter((s) => s.segment === 'body' || s.segment === 'cta')
        .map((s) => `${s.narration}|${s.visual}|${s.camera}|${s.emotion}`)
        .join('\n');
      const set = porClave.get(script.sharedBodyKey) ?? new Set<string>();
      set.add(bodyText);
      porClave.set(script.sharedBodyKey, set);
    }

    expect(porClave.size).toBe(4); // 4 grupos
    for (const [key, textos] of porClave) {
      expect(`${key}: ${String(textos.size)} bodies distintos`).toBe(`${key}: 1 bodies distintos`);
    }

    // Y los HOOKS del mismo grupo sí son distintos entre sí: eso ES el experimento.
    const hooksDelPrimerGrupo = res.scripts
      .filter((s) => s.sharedBodyKey === res.scripts[0]?.sharedBodyKey)
      .map((s) => s.hook);
    expect(new Set(hooksDelPrimerGrupo).size).toBe(3);
  });

  it('CONTROL NEGATIVO: en modo normal (conversion) NO se comparte nada — 12 llamadas, 12 bodies', async () => {
    // La contraparte del test de arriba: con `sharedBodyAndCta: false` cada variante es su propio
    // grupo, cada una paga su llamada, y los bodies SON distintos. Si el agrupado estuviera roto
    // (agrupara siempre, o nunca), uno de los dos tests se pone rojo.
    const plan = planFor('conversion');
    expect(plan.sharedBodyAndCta).toBe(false);

    const mock = countingMock(() => 1);
    const res = await writer.write({ plan, brief: BRIEF });

    expect(mock.calls()).toBe(12);
    const bodies = new Set(
      res.scripts.map((s) =>
        s.scenes
          .filter((sc) => sc.segment === 'body')
          .map((sc) => sc.narration)
          .join(' '),
      ),
    );
    expect(bodies.size).toBe(12);
  });
});

describe('ScriptWriter — el contrato de REQUEST', () => {
  it('modelo, thinking disabled, SIN sampling params (Sonnet 5 los rechaza con 400) y system cacheado', async () => {
    const plan = planFor('hook_test');
    const mock = countingMock(() => 3);
    await writer.write({ plan, brief: BRIEF });

    const body = JSON.parse(mock.bodies[0] ?? '{}') as Record<string, unknown>;
    expect(body.model).toBe(SCRIPT_WRITER_MODEL);
    expect(body.thinking).toEqual({ type: 'disabled' });
    // §9.4: «Sin parámetros de sampling (Sonnet 5 los rechaza con 400)».
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('top_k');
    // Sin output_config: la API 400ea con schemas no triviales e IGNORA las cardinalidades de
    // array (§13.2). El schema viaja como TEXTO en el system; la red real es el Zod.
    expect(body).not.toHaveProperty('output_config');
    expect(body.system).toEqual([
      {
        type: 'text',
        text: SCRIPT_WRITER_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('el system es BYTE-IDÉNTICO entre llamadas (si no, la caché no entra y se paga 12 veces)', async () => {
    const plan = planFor('hook_test');
    const mock = countingMock(() => 3);
    await writer.write({ plan, brief: BRIEF });

    const systems = mock.bodies.map((raw) =>
      JSON.stringify((JSON.parse(raw) as { system: unknown }).system),
    );
    expect(new Set(systems).size).toBe(1);
    // Y el idioma destino, que ES variable, viaja en el USER (nunca en el system).
    expect(SCRIPT_WRITER_SYSTEM_PROMPT).not.toContain('TARGET LANGUAGE: ');
  });
});

describe('buildScriptUserMessage — las dos deudas heredadas, en el prompt', () => {
  const plan = planFor('hook_test');
  const groups = groupVariantsForScripting(plan);

  it('DEUDA T2.2 — el idioma destino MANDA: una variante `en` con semilla en español pide inglés', () => {
    const grupoEn = groups.find((g) => g.variants[0]?.language === 'en');
    expect(grupoEn).toBeDefined();

    const msg = buildScriptUserMessage({
      group: grupoEn ?? groups[0]!,
      brief: BRIEF,
      plan,
      variationIndex: 0,
    });

    expect(msg).toContain('TARGET LANGUAGE: en');
    // La semilla llega EN ESPAÑOL (así la copió N4 del brief) y el mensaje lo dice explícitamente:
    // no se traduce, se reescribe nativa.
    expect(msg).toContain('HOOK SEEDS');
    expect(msg).toContain('ÍNTEGRAMENTE en en');
    expect(msg).toContain('reescríbelas nativas, no las traduzcas');
  });

  it('DEUDA T2.1 — las semillas llegan RENDERIZADAS y TRUNCADAS: ningún {placeholder} sobrevive', () => {
    const seedBlocks = groups
      .map((group) => buildScriptUserMessage({ group, brief: BRIEF, plan, variationIndex: 0 }))
      .map((msg) => msg.slice(msg.indexOf('HOOK SEEDS'), msg.indexOf('ANGLE:')))
      .join('\n');

    // El `{pain}` de la librería está SUSTITUIDO (ningún placeholder llega crudo al modelo)…
    expect(seedBlocks).not.toMatch(/\{(pain|benefit|product|category)\}/);
    // …y TRUNCADO a su presupuesto: el `pain` del brief tiene 12 palabras y solo entran 6.
    // (El ángulo 0 es `pain_point`, así que la librería SÍ aporta hooks con `{pain}`: si el
    // renderizador dejara de truncar, el `pain` entero aparecería aquí.)
    expect(seedBlocks).toContain('la piel tira y se ve');
    expect(seedBlocks).not.toContain(PAIN_12_WORDS);
    expect(seedBlocks).not.toContain('la piel tira y se ve apagada');
  });

  it('lleva el presupuesto de palabras del preset y el objetivo (el CTA se escribe PARA él)', () => {
    const msg = buildScriptUserMessage({
      group: groups[0]!,
      brief: BRIEF,
      plan,
      variationIndex: 0,
    });
    expect(msg).toContain('OBJECTIVE: hook_test');
    expect(msg).toContain(`TARGET DURATION: ${String(DURATION_PRESETS.hook_test.targetSeconds)}s`);
    // La MIRA va apretada al 80% (PROMPT_AIM_FACTOR): hook 8 / body 12 / cta 4, no 10/15/5.
    expect(msg).toContain('hook: 8 palabras');
    expect(msg).toContain('body: 12 palabras');
    expect(msg).toContain('cta: 4 palabras');
    // §7.5: el body de hook_test es 1 clip = 1 escena. El prompt lo pide explícitamente (y
    // `budgetViolation` lo obliga). Fue la palanca que disolvió el overshoot de duración.
    expect(msg).toContain(
      `BODY SCENES: máximo ${String(DURATION_PRESETS.hook_test.maxBodyScenes)} escena(s) de body`,
    );
  });

  it('la DIVERSIDAD se instruye en el prompt (§9.4) y varía por grupo', () => {
    const variaciones = groups.map((group, i) =>
      buildScriptUserMessage({ group, brief: BRIEF, plan, variationIndex: i }),
    );
    const lineas = variaciones.map((m) => m.split('\n').find((l) => l.startsWith('VARIATION:')));
    expect(new Set(lineas).size).toBe(groups.length);
  });
});

describe('ScriptWriter — el TIMING lo calculamos nosotros', () => {
  it('scenes[] y subtitles[] salen de contar palabras; est_seconds ≤ duración objetivo', async () => {
    const plan = planFor('hook_test');
    countingMock(() => 3);
    const res = await writer.write({ plan, brief: BRIEF });

    for (const script of res.scripts) {
      expect(AdScriptSchema.safeParse(script).success).toBe(true);
      // La cláusula de la Verificación (con el ajuste objetivo↔techo de §8.4): `est_seconds` ≤ el
      // TECHO del rango del objetivo, en TODOS.
      expect(script.estSeconds).toBeLessThanOrEqual(DURATION_PRESETS.hook_test.maxSeconds);
      // Y el timing es DERIVADO del texto, no inventado: el `seconds` de cada escena es
      // `palabras ÷ 2,5` (con el suelo de 0,5 s), y los subtítulos son sus mismos instantes.
      expect(script.subtitles).toHaveLength(script.scenes.length);
      expect(script.subtitles[0]?.start).toBe(0);
      expect(script.wordCount).toBe(
        script.scenes.reduce((n, s) => n + s.narration.trim().split(/\s+/).length, 0),
      );
    }
  });

  it('un guion que se pasa del presupuesto se REINTENTA con la desviación exacta, no se guarda', async () => {
    const plan = planFor('hook_test');
    let calls = 0;
    const userMessages: string[] = [];
    server.use(
      http.post(MESSAGES_ENDPOINT, async ({ request }) => {
        calls += 1;
        const body = (await request.json()) as { messages: { content: string }[] };
        userMessages.push(body.messages[0]?.content ?? '');
        // 1ª llamada de cada grupo: un body ENORME (60 palabras = 24 s en un anuncio de 12 s).
        const largo = calls % 2 === 1;
        const draft = draftResponse(calls, 3);
        if (largo) {
          const parsed = JSON.parse((draft.content[0] as { text: string }).text) as {
            body: { narration: string }[];
          };
          parsed.body[0]!.narration = Array.from(
            { length: 60 },
            (_, i) => `palabra${String(i)}`,
          ).join(' ');
          (draft.content[0] as { text: string }).text = JSON.stringify(parsed);
        }
        return HttpResponse.json(draft);
      }),
    );

    const res = await writer.write({ plan, brief: BRIEF });

    // 4 grupos × 2 intentos = 8 llamadas: cada grupo se pasó en el 1º y cupo en el 2º (aunque hay
    // hasta 2 reintentos disponibles, se PARA en cuanto cabe).
    expect(calls).toBe(8);
    // El reintento llevó la CORRECCIÓN con el número real de la desviación.
    const correccion = userMessages.find((m) => m.includes('CORRECCIÓN OBLIGATORIA'));
    expect(correccion).toBeDefined();
    expect(correccion).toContain('NO CABE');
    // El rechazo es contra el TECHO de §8.4 (15 s para hook_test), no contra el objetivo (12 s):
    // el objetivo guía el prompt, el techo acota la aceptación. Un body de 60 palabras (24 s) se
    // pasa de LOS DOS, así que reintenta igual.
    expect(correccion).toMatch(/dura \d+s y el techo del objetivo son 15s/);
    // Y lo que se devuelve es el guion que SÍ cabe (≤ techo).
    expect(res.status).toBe('scripted');
    for (const script of res.scripts) {
      expect(script.estSeconds).toBeLessThanOrEqual(DURATION_PRESETS.hook_test.maxSeconds);
    }
    expect(res.warnings.some((w) => w.startsWith('script_writer_retry_budget'))).toBe(true);
  });

  it('FAIL-CLOSED (code-review): si tras TODOS los reintentos el guion SIGUE pasándose del techo → estado over_budget, NUNCA scripted', async () => {
    // El bug que cazó el verifier: un guion de 16 s salía como `scripted` + warning. Ahora, si el
    // modelo NUNCA mete el guion bajo el techo (mock que SIEMPRE emite un body enorme), el grupo
    // sale `over_budget` — el estado dice la verdad. Los guiones pagados se devuelven (CP3 recorta).
    const plan = planFor('hook_test');
    let calls = 0;
    server.use(
      http.post(MESSAGES_ENDPOINT, () => {
        calls += 1;
        const draft = draftResponse(calls, 3);
        const parsed = JSON.parse((draft.content[0] as { text: string }).text) as {
          body: { narration: string }[];
        };
        // 60 palabras de body → 24 s: MUY por encima del techo de 15 s, SIEMPRE.
        parsed.body[0]!.narration = Array.from(
          { length: 60 },
          (_, i) => `palabra${String(i)}`,
        ).join(' ');
        (draft.content[0] as { text: string }).text = JSON.stringify(parsed);
        return HttpResponse.json(draft);
      }),
    );

    const res = await writer.write({ plan, brief: BRIEF });

    // 4 grupos × 3 rondas (1 intento + 2 reintentos) = 12 llamadas: se agotan los reintentos.
    expect(calls).toBe(12);
    // FAIL-CLOSED: el lote NO es `scripted`. `over_budget` es el estado más severo visto.
    expect(res.status).toBe('over_budget');
    // Los guiones pagados SÍ se devuelven (útiles para CP3), pero ninguno cabe: la cláusula
    // «est_seconds ≤ techo» NO se viola en silencio — el estado lo declara.
    expect(res.scripts.length).toBeGreaterThan(0);
    expect(res.scripts.every((s) => s.estSeconds > DURATION_PRESETS.hook_test.maxSeconds)).toBe(
      true,
    );
    expect(res.warnings.some((w) => w.startsWith('script_over_budget'))).toBe(true);
  });

  // EL CONTROL NEGATIVO DEL BOUND RELAJADO (objetivo↔techo de §8.4, decidido en T2.4). El bound se
  // relajó del objetivo (12 s) al techo del rango (15 s) porque el presupuesto de palabras de
  // hook_test da 12,0 s EXACTOS sin margen y tiraba guiones de 13 s que §8.4 declara embarcables.
  // Estos asserts prueban que el techo relajado NO es decorativo: 13 s PASA, 17 s se RECHAZA.
  function scriptOf(estSeconds: number): AdScript {
    return {
      filenameCode: 'x',
      hook: 'h',
      cta: 'c',
      subtitles: [{ start: 0, end: 1, text: 'x' }],
      fullText: 'x',
      tone: 't',
      language: 'es',
      sharedBodyKey: 'k',
      scenes: [
        {
          t: 0,
          seconds: estSeconds,
          segment: 'body' as const,
          narration: 'x',
          visual: 'v',
          camera: 'c',
          emotion: 'e',
        },
      ],
      wordCount: Math.round(estSeconds * 2.5),
      estSeconds,
    };
  }

  it('CONTROL NEGATIVO del techo relajado: 13s PASA (§8.4 lo declara embarcable), 17s se RECHAZA', () => {
    const plan = planFor('hook_test'); // objetivo 12 s, techo 15 s.

    // 13 s: por encima del OBJETIVO pero dentro del RANGO de §8.4 (8–15 s) ⇒ embarcable ⇒ null.
    // Con el bound viejo (rechazaba contra el objetivo 12 s) esto DABA violación: es justo el
    // guion real que el modelo produjo y que hizo tomar la decisión.
    expect(budgetViolation(scriptOf(13), plan)).toBeNull();

    // 15 s: el techo EXACTO ⇒ sigue cabiendo (≤, no <).
    expect(budgetViolation(scriptOf(15), plan)).toBeNull();

    // 17 s: por encima del techo ⇒ rechazado, con el número exacto de la desviación.
    const violation = budgetViolation(scriptOf(17), plan);
    expect(violation).toContain('dura 17s y el techo del objetivo son 15s');
    expect(violation).toContain('NO CABE');
  });

  it('budgetViolation también rechaza el hook de >12 palabras (aunque el guion entero quepa)', () => {
    const plan = planFor('hook_test');
    const hookLargo: AdScript = {
      ...scriptOf(5),
      scenes: [
        {
          t: 0,
          seconds: 5,
          segment: 'hook' as const,
          narration: 'una dos tres cuatro cinco seis siete ocho nueve diez once doce trece',
          visual: 'v',
          camera: 'c',
          emotion: 'e',
        },
      ],
      wordCount: 13,
      estSeconds: 5,
    };
    expect(budgetViolation(hookLargo, plan)).toContain('el hook tiene 13 palabras');
  });

  // §7.5: el body de hook_test es 1 clip b-roll = 1 ESCENA. Un body de 2 escenas viola §7.5 Y
  // fue la CAUSA RAÍZ del overshoot de duración (cada escena arrastra su narración → el anuncio se
  // iba a 15–16 s pegado al techo). Enforcement determinista ⇒ test permanente en el gate.
  it('§7.5 CONTROL NEGATIVO: un body de 2 escenas en hook_test se RECHAZA (1 escena PASA)', () => {
    const plan = planFor('hook_test'); // maxBodyScenes = 1.
    const bodyScene = (i: number) => ({
      t: i,
      seconds: 2,
      segment: 'body' as const,
      narration: `escena ${String(i)} corta`,
      visual: 'v',
      camera: 'c',
      emotion: 'e',
    });

    // 1 escena de body (§7.5) y corto ⇒ cabe.
    expect(budgetViolation({ ...scriptOf(6), scenes: [bodyScene(0)] }, plan)).toBeNull();

    // 2 escenas de body ⇒ viola §7.5 aunque el guion entero quepa en tiempo.
    const dosEscenas: AdScript = {
      ...scriptOf(6),
      scenes: [bodyScene(0), bodyScene(2)],
      estSeconds: 4,
      wordCount: 6,
    };
    const violation = budgetViolation(dosEscenas, plan);
    expect(violation).toContain('el body tiene 2 escenas y §7.5 permite 1');

    // Y en `conversion` (maxBodyScenes = 2) esas mismas 2 escenas SÍ son válidas: el límite es
    // por preset, no global. Si estuviera hardcodeado a 1, este assert se pondría rojo.
    expect(budgetViolation({ ...dosEscenas }, planFor('conversion'))).toBeNull();
  });
});

describe('ScriptWriter — biyección hook↔semilla (code-review): el A/B no puede contaminarse en silencio', () => {
  const draftWithSeedIndices = (seedIndices: number[]): ScriptDraft => ({
    tone: 'cercano',
    hooks: seedIndices.map((seedIndex, i) => ({
      seedIndex,
      narration: `Hook posición ${String(i)} semilla ${String(seedIndex)}`,
      visual: 'v',
      camera: 'c',
      emotion: 'e',
    })),
    body: [{ narration: 'body', visual: 'v', camera: 'c', emotion: 'e' }],
    cta: [{ narration: 'cta', visual: 'v', camera: 'c', emotion: 'e' }],
  });

  it('hookBijectionProblem: cobertura perfecta [0,1,2] para 3 variantes → null', () => {
    expect(hookBijectionProblem(draftWithSeedIndices([0, 1, 2]), 3)).toBeNull();
    expect(hookBijectionProblem(draftWithSeedIndices([0]), 1)).toBeNull();
    // El orden no importa: lo que importa es que CUBRA {0,1,2}.
    expect(hookBijectionProblem(draftWithSeedIndices([2, 0, 1]), 3)).toBeNull();
  });

  it('CONTROL NEGATIVO: [0,0,2] (repite 0, salta 1) para 3 variantes → problema detectado', () => {
    // Este es EL caso: con el fallback posicional viejo, la variante seedIndex=1 recibía en SILENCIO
    // el hook de otra semilla y el A/B quedaba contaminado con un test verde. Ahora se caza.
    expect(hookBijectionProblem(draftWithSeedIndices([0, 0, 2]), 3)).toContain('REPETIDOS');
    expect(hookBijectionProblem(draftWithSeedIndices([0, 2, 3]), 3)).toContain('faltan hooks');
    expect(hookBijectionProblem(draftWithSeedIndices([0, 1]), 3)).toContain('2 hooks para 3');
  });

  it('INTEGRACIÓN — un draft con seedIndex [0,0,2] dispara parse_error → reintento (no un A/B roto)', async () => {
    const plan = planFor('hook_test'); // grupos de 3 variantes.
    let calls = 0;
    server.use(
      http.post(MESSAGES_ENDPOINT, () => {
        calls += 1;
        // Siempre emite [0,0,2]: 3 hooks para 3 semillas pero repite 0 y salta 1. Con el fallback
        // viejo, esto habría ENSAMBLADO 3 guiones (verde) con el hook 1 mal asignado.
        const draft = draftResponse(calls, 3);
        const parsed = JSON.parse((draft.content[0] as { text: string }).text) as {
          hooks: { seedIndex: number }[];
        };
        parsed.hooks[1]!.seedIndex = 0;
        parsed.hooks[2]!.seedIndex = 2;
        (draft.content[0] as { text: string }).text = JSON.stringify(parsed);
        return HttpResponse.json(draft);
      }),
    );

    const res = await writer.write({ plan, brief: BRIEF });
    // 4 grupos × 3 rondas (la biyección falla las tres veces, se agotan los reintentos).
    expect(calls).toBe(12);
    expect(res.status).toBe('parse_error');
    expect(res.scripts).toEqual([]);
    expect(res.warnings.some((w) => w.startsWith('script_hooks_not_bijective'))).toBe(true);
  });
});

describe('ScriptWriter — ramas tipadas (nunca lanza)', () => {
  it('api_error: un 400 no se confunde con un output malformado y NO se reintenta', async () => {
    const plan = planFor('conversion');
    let calls = 0;
    server.use(
      http.post(MESSAGES_ENDPOINT, () => {
        calls += 1;
        return HttpResponse.json(
          {
            type: 'error',
            error: { type: 'invalid_request_error', message: 'temperature: unsupported' },
          },
          { status: 400 },
        );
      }),
    );

    const res = await writer.write({ plan, brief: BRIEF });
    expect(res.status).toBe('api_error');
    expect(res.scripts).toEqual([]);
    // 12 grupos × 1 intento: un 400 es determinista, repetirlo no lo arregla (lección de T1.8).
    expect(calls).toBe(12);
    expect(res.warnings.some((w) => w.startsWith('script_writer_api_error_400'))).toBe(true);
  });

  it('refusal: se devuelve el usage (se pagaron los tokens) y el estado tipado', async () => {
    const plan = planFor('conversion');
    server.use(
      http.post(MESSAGES_ENDPOINT, () =>
        HttpResponse.json({
          id: 'msg_x',
          type: 'message',
          role: 'assistant',
          model: SCRIPT_WRITER_MODEL,
          content: [],
          stop_reason: 'refusal',
          usage: { input_tokens: 100, output_tokens: 0 },
        }),
      ),
    );

    const res = await writer.write({ plan, brief: BRIEF });
    expect(res.status).toBe('refused');
    expect(res.usage?.inputTokens).toBe(1200); // 12 grupos × 100: TODO lo pagado se registra.
    expect(res.warnings).toContain('script_writer_refused');
  });

  it('parse_error: cardinalidad inválida (0 hooks) la caza el Zod, y se reintenta una vez', async () => {
    const plan = planFor('conversion');
    let calls = 0;
    server.use(
      http.post(MESSAGES_ENDPOINT, () => {
        calls += 1;
        // La API de Anthropic NO aplica constraints de array (§13.2): el modelo puede devolver
        // `hooks: []` y ningún structured output lo impediría. El Zod es la red real.
        return HttpResponse.json({
          id: 'msg_x',
          type: 'message',
          role: 'assistant',
          model: SCRIPT_WRITER_MODEL,
          content: [
            { type: 'text', text: JSON.stringify({ tone: 't', hooks: [], body: [], cta: [] }) },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        });
      }),
    );

    const res = await writer.write({ plan, brief: BRIEF });
    expect(res.status).toBe('parse_error');
    expect(calls).toBe(36); // 12 grupos × 3 rondas (el reintento re-tira el dado: temperature 1).
    expect(res.warnings.some((w) => w.startsWith('script_schema_invalid'))).toBe(true);
    // El coste de los TRES intentos se registra: los tres se pagaron.
    expect(res.usage?.outputTokens).toBe(36 * 50);
  });
});
