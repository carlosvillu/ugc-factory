# Unit testing — `packages/core` y lógica pura

Esta capa cubre todo lo que es **función pura**: contratos Zod, la tabla de transiciones de la máquina de estados, validadores deterministas, el compositor de matriz, el estimador de coste, el linter FTC, el compilador de prompts, los model adapters, el generador ASS y los validadores de seeds. Es la capa más barata de ejecutar y la que más bugs caros previene: casi todo lo que aquí se testea decide **qué se envía a APIs de pago** o **qué estado toma el pipeline**. Un bug aquí quema dinero o corrompe runs; un test aquí cuesta milisegundos.

## Índice

1. [Alcance y principios](#1-alcance-y-principios)
2. [Patrones transversales](#2-patrones-transversales)
3. [Contratos Zod y espejo JSON Schema (T1.1)](#3-contratos-zod-y-espejo-json-schema-t11)
4. [Máquina de estados: exhaustividad por producto cartesiano (T0.7a)](#4-máquina-de-estados-t07a)
5. [BriefValidator: perfiles y warnings tipados (T1.9)](#5-briefvalidator-t19)
6. [Compositor de matriz y estimador de coste (T2.2)](#6-compositor-de-matriz-y-estimador-de-coste-t22)
7. [ScriptWriter y linter FTC (T2.5)](#7-scriptwriter-y-linter-ftc-t25)
8. [Compilador de prompts y model adapters (T3.5, T3.6)](#8-compilador-de-prompts-y-model-adapters-t35-t36)
9. [Generador ASS y safe zone (T5.4)](#9-generador-ass-y-safe-zone-t54)
10. [Validadores de seeds en CI (T2.1, T3.2)](#10-validadores-de-seeds-en-ci-t21-t32)
11. [Criterio de exhaustividad por tipo de código](#11-criterio-de-exhaustividad)

## 1. Alcance y principios

- **Ubicación**: co-locados con el código, `src/**/*.test.ts`, en cualquier paquete. Corren con `pnpm test:unit`, que filtra por `--project '*:unit'` sobre los proyectos `core:unit`, `web:unit`, `worker:unit`… declarados en el `vitest.config.ts` raíz vía `test.projects` (convención de nombres `<paquete>:unit` de stack-setup.md §3.2). Los proyectos `*:unit` **no** declaran el globalSetup de Testcontainers: la suite unit arranca sin Docker y en segundos. Por qué: el feedback loop de la lógica pura debe ser inmediato; si un test "unit" necesita Postgres, está mal clasificado — muévelo a `test/integration/` (ver db-integration.md).
- **No mockees lógica pura.** Una función `(input) => output` se testea llamándola. Los mocks (msw, spies) son para fronteras I/O, y en `packages/core` no debería haber fronteras I/O: si una función del core necesita red o BD, es un olor de diseño — extrae la lógica pura y deja el I/O en el caller (web/worker).
- **Determinismo por inyección, no por mocking de globals.** Si una función necesita tiempo, aleatoriedad o IDs, recibe `clock`, `random` o `idFactory` como parámetro (con default de producción). Así el test pasa valores fijos y no hay `vi.useFakeTimers()` salpicado. Excepción aceptable: fake timers para utilidades de timing puro (backoff, debounce).
- **El input canónico son las factories de `@ugc/test-utils`**: `makeProject()`, `makeRun()`, `makeStep()`, `makeBrief()`, `makeVariant()`, etc. Cada una devuelve un objeto **válido según su schema Zod** y acepta overrides parciales. Por qué: cuando el contrato evoluciona, se actualiza la factory una vez y no cincuenta JSON copiados.

## 2. Patrones transversales

### Table-driven tests

El formato por defecto para validadores, linters y parsers: una tabla de casos con nombre, input y expectativa, ejecutada con `it.each`. Por qué: añadir un caso de regresión cuesta una línea, el nombre del caso aparece en el output de Vitest, y la tabla ES la documentación del comportamiento.

### Golden files

Para outputs textuales largos donde **cada carácter importa** (prompts resueltos, payloads de fal, ficheros `.ass`): compara contra un fichero versionado en git, carácter a carácter. Los goldens viven en `test/golden/` junto a la suite que los usa (p. ej. `packages/core/test/golden/prompting/`). Se regeneran con `UPDATE_GOLDEN=1` — y el diff resultante **se revisa en el PR como código**: regenerar no es "arreglar el test", es declarar conscientemente que el output cambió.

Helper compartido en `@ugc/test-utils`:

```ts
// packages/test-utils/src/golden.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "vitest";

// goldenPath: relativo al fichero de test — el caller lo pasa resuelto con
// new URL("./golden/caso.txt", import.meta.url).pathname
export async function expectGolden(actual: string, goldenPath: string): Promise<void> {
  if (process.env.UPDATE_GOLDEN === "1") {
    await mkdir(path.dirname(goldenPath), { recursive: true });
    await writeFile(goldenPath, actual, "utf8");
  }
  let expected: string;
  try {
    expected = await readFile(goldenPath, "utf8");
  } catch {
    throw new Error(`Golden ausente: ${goldenPath}. Genera con UPDATE_GOLDEN=1 y revisa el diff.`);
  }
  expect(actual).toBe(expected); // toBe: comparación carácter a carácter, sin normalizar
}
```

Reglas: nunca normalices whitespace antes de comparar (un espacio perdido en un prompt es un bug real); serializa JSON con claves ordenadas y `null, 2` para que los diffs sean estables; un golden por caso, con nombre descriptivo (`skincare-pov-ana.es.txt`).

### Fixtures inválidos = fixture válido + mutación dirigida

Nunca escribas a mano un JSON inválido completo: se desincroniza del schema y el test acaba fallando por el motivo equivocado. El patrón es partir de la factory válida y romper exactamente una cosa. Así, cuando el test falla, solo puede ser por la propiedad que rompiste.

## 3. Contratos Zod y espejo JSON Schema (T1.1)

Los contratos (`RawContent`, `VisualAnalysis`, `ProductBrief`, y después `BatchPlan`, `AdScript`, `CompositionSpec`…) son la columna vertebral del pipeline (PRD §7.4). Cada schema tiene una suite con: (a) el fixture canónico válido, (b) una tabla de mutaciones inválidas — una por regla de negocio del schema, (c) las divergencias del Apéndice A.

```ts
// packages/core/src/contracts/product-brief.test.ts
import { describe, expect, it } from "vitest";
import { makeBrief } from "@ugc/test-utils";
import { ProductBriefSchema, type ProductBrief } from "./product-brief";

it("el fixture canónico valida", () => {
  expect(ProductBriefSchema.safeParse(makeBrief()).success).toBe(true);
});

const invalid: Array<[name: string, mutate: (b: ProductBrief) => unknown]> = [
  ["sin ángulos", (b) => ({ ...b, angles: [] })],
  ["11 ángulos (máx. 10)", (b) => ({ ...b, angles: Array(11).fill(b.angles[0]) })],
  ["hook_example de 13 palabras", (b) => ({
    ...b,
    angles: [{ ...b.angles[0], hook_examples: ["una dos tres cuatro cinco seis siete ocho nueve diez once doce trece"] }, ...b.angles.slice(1)],
  })],
  ["source_url no-null con platform=manual", (b) => ({
    ...b, meta: { ...b.meta, platform: "manual", source_url: "https://x.com" },
  })],
  ["awareness_level fuera del enum", (b) => ({
    ...b,
    audience: { ...b.audience, segments: [{ ...b.audience.segments[0], awareness_level: "psychic" }] },
  })],
];

it.each(invalid)("rechaza: %s", (_name, mutate) => {
  expect(ProductBriefSchema.safeParse(mutate(makeBrief())).success).toBe(false);
});
```

**El espejo JSON Schema para Anthropic se testea aparte**, porque diverge a propósito (PRD §13.2, Apéndice A): los structured outputs de Anthropic **no aplican** `minItems`/`maxItems` y exigen `additionalProperties: false` — las cardinalidades viven SOLO en Zod. El test fija ese reparto de responsabilidades para que nadie lo "arregle" moviendo constraints al JSON Schema donde serían ignorados silenciosamente:

```ts
// packages/core/src/contracts/product-brief.json-schema.test.ts
import Ajv2020 from "ajv/dist/2020"; // valida contra el meta-schema draft 2020-12
import { describe, expect, it } from "vitest";
import { makeBrief } from "@ugc/test-utils";
import { ProductBriefSchema } from "./product-brief";
import { productBriefJsonSchema } from "./product-brief.json-schema";

const ajv = new Ajv2020({ strict: true });
const validateMirror = ajv.compile(productBriefJsonSchema); // compile YA falla si el schema no es draft 2020-12 válido

it("todo objeto del espejo lleva additionalProperties:false (requisito Anthropic)", () => {
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.type === "object") expect(n.additionalProperties).toBe(false);
    Object.values(n).forEach(walk);
  };
  walk(productBriefJsonSchema);
});

it("divergencia documentada: 11 ángulos pasan el espejo pero Zod los rechaza", () => {
  const brief = makeBrief();
  const inflated = { ...brief, angles: Array(11).fill(brief.angles[0]) };
  expect(validateMirror(inflated)).toBe(true);            // Anthropic no lo frenaría
  expect(ProductBriefSchema.safeParse(inflated).success).toBe(false); // Zod sí — aquí vive la cardinalidad
});

it("el espejo acepta todo lo que Zod acepta (espejo ⊇ Zod)", () => {
  expect(validateMirror(makeBrief())).toBe(true);
});
```

Si el espejo se genera desde Zod (utilidad de serialización de Zod 4) o se mantiene a mano es indiferente para el test: **se testea el artefacto resultante, no el generador**. Aplica el mismo par de suites a `RawContent` (casos: modo `manual` sin URL, plataforma `shopify` con precio) y `VisualAnalysis` (enums de clasificación `hero/broll/unusable`, paleta hex).

## 4. Máquina de estados (T0.7a)

**Regla del proyecto: toda transición ilegal rechaza, y los tests lo demuestran por producto cartesiano estados × eventos.** La tabla de transiciones (PRD §7.1) es una función pura `nextStatus(status, event)` en `packages/core/src/orchestrator/`. **El cartesiano exhaustivo vive SOLO en esta capa**: la suite de integración (ver orchestrator.md) NO lo repite — cubre las transiciones legales end-to-end más una muestra representativa de ilegales verificando el rollback, y los efectos transaccionales (`SELECT FOR UPDATE`, encolado en pg-boss en la misma tx, `NOTIFY`, `supersedes_id`). Aquí se testea la tabla, y se testea ENTERA: con 13 estados y ~14 eventos hay <200 combinaciones — es trivial de ejecutar y es la única forma de garantizar que añadir un estado o evento nuevo obliga a decidir explícitamente cada celda nueva. Una transición ilegal que pase inadvertida corrompe runs y duplica gasto en fal: este es el test más rentable del proyecto.

Clave del patrón: la lista de transiciones legales del test se **transcribe a mano del PRD §7.1**, independiente de la implementación. Si el test derivara los casos de la propia tabla de producción, sería una tautología que siempre pasa.

```ts
// packages/core/src/orchestrator/state-machine.test.ts
import { describe, expect, it } from "vitest";
import {
  STEP_STATUSES, STEP_EVENTS, nextStatus, IllegalTransitionError,
  type StepStatus, type StepEvent,
} from "./state-machine";

// Transcripción manual de PRD §7.1 — NO derivar de la implementación.
// PRD §7.1 fija los ESTADOS; los NOMBRES de evento los fija T0.7a: este espejo
// y el de orchestrator.md se actualizan desde la misma tabla en la misma sesión.
const LEGAL: Array<[StepStatus, StepEvent, StepStatus]> = [
  ["awaiting_deps", "deps_satisfied", "pending"],
  ["pending", "enqueue", "queued"],
  ["queued", "start", "running"],
  ["running", "succeed", "succeeded"],
  ["running", "fail", "failed"],
  ["running", "require_approval", "waiting_approval"],
  ["running", "expire", "expired"],
  ["waiting_approval", "approve", "succeeded"],
  ["waiting_approval", "edit", "succeeded"], // + invalidación aguas abajo (integración)
  ["waiting_approval", "reject", "rejected"],
  ["failed", "retry", "queued"],
  // …completar con skip / cancel / supersede / submitting según la tabla final de T0.7a
];
const legalMap = new Map(LEGAL.map(([s, e, to]) => [`${s}:${e}`, to]));

describe("máquina de estados — producto cartesiano completo", () => {
  const pairs = STEP_STATUSES.flatMap((s) => STEP_EVENTS.map((e) => [s, e] as const));

  it.each(pairs)("(%s, %s)", (status, event) => {
    const expected = legalMap.get(`${status}:${event}`);
    if (expected !== undefined) {
      expect(nextStatus(status, event)).toBe(expected);
    } else {
      expect(() => nextStatus(status, event)).toThrow(IllegalTransitionError);
    }
  });

  it("los estados terminales no aceptan ningún evento", () => {
    for (const terminal of ["succeeded", "rejected", "cancelled", "superseded", "expired"] as const) {
      expect(LEGAL.some(([s]) => s === terminal)).toBe(false);
    }
  });
});
```

Nota: `failed` NO es terminal (retry, PRD §7.1); `expired` SÍ es terminal — el PRD no le define ninguna transición saliente. Si al implementar T0.9 se decide permitir retry manual desde `expired`, se actualiza PRD §7.1 y ambos espejos LEGAL (este y el de orchestrator.md) en la misma sesión (regla de trabajo 6); la skill no inventa esa transición. `succeeded` no es del todo terminal a nivel de fila (una edición lo supersede, pero eso es crear fila nueva, no transicionar — verifica que NO exista transición saliente de `succeeded`). Añade asserts del **cierre transitivo de invalidación** como función pura si el cálculo del sub-grafo aguas abajo vive en el core: dado un DAG fixture, editar el nodo X devuelve exactamente el conjunto esperado de descendientes.

## 5. BriefValidator (T1.9)

El validador es determinista y tiene **perfiles por origen** (`url` / `manual`) y **warnings tipados** (discriminated union con `code`). Testea cada código de warning con un caso que lo dispara y, para cada perfil, que las reglas ajenas NO se disparan — la diferencia entre perfiles es exactamente lo que un refactor descuidado rompería.

```ts
// packages/core/src/analysis/brief-validator.test.ts
import { describe, expect, it } from "vitest";
import { makeBrief, makeRawContent } from "@ugc/test-utils";
import { validateBrief } from "./brief-validator";

it("url: precio N1≠N3 → warning price_mismatch y gana el precio del fast path", () => {
  const raw = makeRawContent({ product: { price: "29,90 €" } });
  const brief = makeBrief({ pricing: { price: "34,90 €" } });
  const res = validateBrief(brief, { profile: "url", rawContent: raw });
  expect(res.warnings).toContainEqual(expect.objectContaining({ code: "price_mismatch" }));
  expect(res.brief.pricing.price).toBe("29,90 €"); // corrección determinista, no solo aviso
});

it("sin hero image → needs_user_decision, el brief queda válido y NO falla (LOS DOS perfiles)", () => {
  // T1.15: la falta de hero NO ramifica por perfil. El validador NO devuelve `ok` — ningún
  // warning invalida el brief, así que no hay nada que comprobar salvo el warning tipado.
  for (const profile of ["manual", "url"] as const) {
    const res = validateBrief(makeBrief({ assets: { images: [] } }), { profile });
    expect(res.warnings).toContainEqual(
      expect.objectContaining({ code: "needs_user_decision", reason: "missing_hero_image" }),
    );
  }
});

it("manual: NUNCA emite price_mismatch (el cross-check de precio no aplica sin fast path)", () => {
  const res = validateBrief(makeBrief(), { profile: "manual" });
  expect(res.warnings.map((w) => w.code)).not.toContain("price_mismatch");
});

it("suggested_assets fuera de assets.images se podan CON warning", () => {
  const brief = makeBrief();
  const dirty = {
    ...brief,
    angles: [{ ...brief.angles[0], suggested_assets: ["img_inexistente"] }, ...brief.angles.slice(1)],
  };
  const res = validateBrief(dirty, { profile: "url", rawContent: makeRawContent() });
  expect(res.brief.angles[0].suggested_assets).not.toContain("img_inexistente"); // podado
  expect(res.warnings).toContainEqual(expect.objectContaining({ code: "pruned_suggested_asset" }));
});
```

Cubre además: hooks >12 palabras, cardinalidades (5–10 ángulos) — recuerda que el validador es la red de seguridad de las cardinalidades que Anthropic no aplica (§3).

> **Cambio de contrato (T1.15, 2026-07-13)**: aquí decía «`url` sin hero image → **error** (no warning)». Ya no: la falta de hero es **decisión de CP1 en los dos perfiles** y el validador **no puede invalidar un brief** (no devuelve `ok`; `isBlockingWarning`/`BLOCKING_WARNING_CODES` se eliminaron). El fallo duro mataba el run **con la síntesis de Sonnet ya pagada** en webs de servicio sin packshot (stayforlong.com) — PRD §7.2 N3 y §9.2. Un test que asserte `ok:false` o un `PermanentStepError` de N3 por este motivo está probando un contrato que ya no existe.

## 6. Compositor de matriz y estimador de coste (T2.2)

Ambos son deterministas: mismo brief + misma configuración = misma matriz y mismo coste. Testea la **aritmética combinatoria** y la **economía Hook×Body×CTA**, que es la propiedad de negocio central (pagar 5 clips para 3 anuncios, no 9):

```ts
// packages/core/src/strategy/matrix.test.ts
import { describe, expect, it } from "vitest";
import { makeBrief, makePersona, makeRecipe } from "@ugc/test-utils";
import { composeMatrix, estimateBatchCost } from "./matrix";

const base = { brief: makeBrief(), personas: [makePersona()], tier: "standard" as const };

it("2 ángulos × 3 hooks × 1 persona × 2 idiomas = 12 variantes con filename_code únicos", () => {
  const plan = composeMatrix({ ...base, angleCount: 2, hooksPerAngle: 3, languages: ["es", "en"], objective: "conversion" });
  expect(plan.variants).toHaveLength(12);
  expect(new Set(plan.variants.map((v) => v.filenameCode)).size).toBe(12);
});

it("hook-testing: 3 hooks del mismo ángulo comparten body y CTA (1+1+3 generaciones de vídeo, no 9)", () => {
  const plan = composeMatrix({ ...base, angleCount: 1, hooksPerAngle: 3, languages: ["es"], objective: "hook_test" });
  const est = estimateBatchCost(plan, makeRecipe({ tier: "standard" }));
  const videoGens = est.lineItems.filter((li) => li.kind === "video");
  expect(videoGens.filter((li) => li.segment === "hook")).toHaveLength(3);
  expect(videoGens.filter((li) => li.segment === "body")).toHaveLength(1); // compartido
  expect(videoGens.filter((li) => li.segment === "cta")).toHaveLength(1);  // compartido
});

it("el desglose suma el total y el total cuadra con la receta del Apéndice B (±10 %)", () => {
  const plan = composeMatrix({ ...base, angleCount: 2, hooksPerAngle: 3, languages: ["es", "en"], objective: "conversion" });
  const est = estimateBatchCost(plan, makeRecipe({ tier: "standard" }));
  const sum = est.lineItems.reduce((s, li) => s + li.usd, 0);
  expect(est.totalUsd).toBeCloseTo(sum, 6); // el desglose ES el total: sin partidas fantasma
});
```

Añade: cada idioma multiplica assets con voz (el b-roll sin voz se comparte solo si la lógica lo declara — fija el comportamiento actual con un test), y el preset de duración por objetivo (§8.4) determina el número de clips según el presupuesto temporal de §7.5.

## 7. ScriptWriter y linter FTC (T2.5)

El ScriptWriter llama a Anthropic (eso se mockea con msw en su capa), pero **la validación de su output y el linter FTC son puros** y se testean aquí. El linter es determinista a propósito (PRD §15.2): bloquea ANTES de gastar renders, así que sus falsos negativos cuestan dinero y sus bloqueos deben explicarse. Contrato del resultado: `{ ok: true } | { ok: false, violations: [{ rule, excerpt, explanation, suggestion }] }` — el test exige `explanation` y `suggestion` no vacías porque "bloquea con explicación y sugerencia" es requisito de producto, no cortesía.

```ts
// packages/core/src/scripting/ftc-linter.test.ts
import { describe, expect, it } from "vitest";
import { makeScript } from "@ugc/test-utils";
import { lintScript } from "./ftc-linter";

const ctx = { bannedClaims: ["cura el acné", "resultados garantizados"] };

const blocking = [
  { name: "primera persona de compra", text: "I bought this and it changed my life", rule: "first_person_purchase" },
  { name: "claim de banned_or_risky_claims", text: "Este sérum cura el acné en 3 días", rule: "banned_claim" },
  { name: "founder en primera persona", text: "Yo fundé esta empresa y creé este producto", rule: "founder_first_person" },
];

it.each(blocking)("bloquea $name con explicación y sugerencia", ({ text, rule }) => {
  const res = lintScript(makeScript({ fullText: text }), ctx);
  expect(res.ok).toBe(false);
  if (res.ok) return;
  const v = res.violations.find((x) => x.rule === rule);
  expect(v).toBeDefined();
  expect(v!.excerpt.length).toBeGreaterThan(0);      // señala DÓNDE
  expect(v!.explanation.length).toBeGreaterThan(0);  // explica POR QUÉ
  expect(v!.suggestion.length).toBeGreaterThan(0);   // propone alternativa compliant
});

it("creator-style demo pasa limpio (el patrón correcto no puede dar falso positivo)", () => {
  const res = lintScript(makeScript({ fullText: "This serum hydrates in seconds — watch this." }), ctx);
  expect(res.ok).toBe(true);
});

it("founder-origin en tercera persona (educator) pasa", () => {
  const res = lintScript(makeScript({ fullText: "The maker built this because nothing on the market worked." }), ctx);
  expect(res.ok).toBe(true);
});
```

Exhaustividad exigida: **cada regla del catálogo tiene ≥1 caso que bloquea y ≥1 caso legítimo cercano que pasa** (el par positivo/negativo pegado a la frontera es lo que detecta regexes demasiado agresivas). Los claims prohibidos vienen del brief (`banned_or_risky_claims`): testea también matching con variaciones de mayúsculas/acentos si el matcher las normaliza. La validación estructural del output del ScriptWriter (timing `word_count ÷ 2.5 ≤ duración objetivo`, `scenes[]` con campos completos, bodies textualmente idénticos entre variantes hook-testing del mismo ángulo) también es pura: tests table-driven sobre fixtures de `AdScript`.

## 8. Compilador de prompts y model adapters (T3.5, T3.6)

El `resolvedPrompt` es el producto: cada carácter va a un modelo de pago, y una regresión silenciosa (un guard pack que deja de inyectarse, un slot interpolado con el campo equivocado) degrada calidad y quema presupuesto sin que nadie lo vea. Por eso el compilador se testea con **golden files comparados carácter a carácter** (patrón §2), sobre 3+ combinaciones brief-fixture × template × persona usando los templates mínimos de prueba de T3.2:

```ts
// packages/core/src/prompting/compiler.golden.test.ts
import { describe, it } from "vitest";
import { expectGolden, makeBrief, makeHookLine, makePersona } from "@ugc/test-utils";
import { compilePrompt } from "./compiler";
import { loadTestTemplates } from "../gallery/seed-loader";

const golden = (name: string) =>
  new URL(`../../test/golden/prompting/${name}.txt`, import.meta.url).pathname;
const templates = loadTestTemplates(); // los 2–3 templates de prueba del seed (T3.2)

it.each([
  ["skincare-pov-es", makeBrief({ product: { category: "beauty" } }), "pov-selfie-demo", "es"],
  ["app-demo-en", makeBrief({ product: { category: "apps" } }), "app-screen-demo", "en"],
  ["food-unboxing-es", makeBrief({ product: { category: "food" } }), "unboxing", "es"],
])("golden %s", async (name, brief, slug, language) => {
  const result = compilePrompt({
    template: templates[slug], brief, persona: makePersona(), hook: makeHookLine({ language }),
    campaign: { platform: "tiktok", aspect: "9:16", durationS: 24, language },
  });
  await expectGolden(result.resolvedPrompt, golden(name));
});
```

Complementa los goldens con asserts semánticos que sobreviven a regeneraciones: el prompt contiene `no deformation` (fidelity guard SIEMPRE inyectado), contiene el guard pack del vertical resuelto por `product.category` y el de la plataforma destino, y NO contiene ningún `{` sin resolver. **Un slot irresoluble produce un error accionable**: testea que el error nombra la variable y su fuente (`{persona.setting}` ← Persona), porque ese mensaje es lo que el operador verá en el canvas.

Los **model adapters** (T3.6) siguen el mismo patrón con **golden payloads**: el JSON exacto enviado a cada endpoint (Seedance `@image/@video/@audio`, referencias de Kling, Veo/Wan, Seedream/NB2 edit), serializado con claves ordenadas. Y el **troceo de escenas** es lógica pura crítica: una escena que excede `maxDuration` del `ModelProfile` se parte en el plan, jamás revienta en runtime:

```ts
it("escena de 12 s con maxDuration 10 s → 2 clips ≤10 s que suman 12, no un error", () => {
  const plan = planSceneClips(makeScene({ durationS: 12 }), makeModelProfile({ maxDurationS: 10 }));
  expect(plan.clips).toHaveLength(2);
  expect(plan.clips.every((c) => c.durationS <= 10)).toBe(true);
  expect(plan.clips.reduce((s, c) => s + c.durationS, 0)).toBeCloseTo(12);
});
```

Casos frontera obligatorios: escena exactamente igual a `maxDuration` (1 clip, sin trocear), escena que exige 3 clips, y mapeo de `aspect_ratio` a los enums de cada modelo (los enums verificados de T4.8 se fijan aquí como tabla).

## 9. Generador ASS y safe zone (T5.4)

El generador de `.ass` (word timestamps → string ASS) es lógica pura aunque viva en `apps/worker`: sus unit tests siguen esta guía y se co-locan con él. El burn-in real con FFmpeg/libass pertenece a la suite media (`apps/worker/test/media/`, `pnpm test:media`). Diseño que lo hace testeable: el parser (`parseAssDialogues`) es **código de producción** en `apps/worker/src/captions/ass-parser.ts` — el check captions-in-safe-zone del QA (N9) y el script de verificación de T8.3 lo reutilizan, y los tests (unit y media) lo importan de ahí.

```ts
// apps/worker/src/captions/ass-generator.test.ts
import { describe, expect, it } from "vitest";
import { makeWordTimestamps } from "@ugc/test-utils";
import { generateAss, SAFE_ZONE_UNIVERSAL } from "./ass-generator";
import { parseAssDialogues } from "./ass-parser";

// Sobre 1080×1920: top 270, bottom 672, left 65, right 140 → área útil ~875×978 (PRD Apéndice C)
const box = {
  minX: SAFE_ZONE_UNIVERSAL.left,           // 65
  maxX: 1080 - SAFE_ZONE_UNIVERSAL.right,   // 940
  minY: SAFE_ZONE_UNIVERSAL.top,            // 270
  maxY: 1920 - SAFE_ZONE_UNIVERSAL.bottom,  // 1248
};

it("preset karaoke: 1–4 palabras por página y ningún evento fuera de la safe zone", () => {
  const ass = generateAss(makeWordTimestamps({ words: 40 }), { preset: "karaoke", platform: "universal" });
  const events = parseAssDialogues(ass);
  expect(events.length).toBeGreaterThan(0);
  for (const ev of events) {
    expect(ev.words.length).toBeGreaterThanOrEqual(1);
    expect(ev.words.length).toBeLessThanOrEqual(4);
    expect(ev.anchor.x).toBeGreaterThanOrEqual(box.minX);
    expect(ev.anchor.x).toBeLessThanOrEqual(box.maxX);
    expect(ev.anchor.y).toBeGreaterThanOrEqual(box.minY);
    expect(ev.anchor.y).toBeLessThanOrEqual(box.maxY);
  }
});

it("las duraciones \\k de una página suman la duración del evento (sync karaoke)", () => {
  const ass = generateAss(makeWordTimestamps({ words: 12 }), { preset: "karaoke", platform: "universal" });
  for (const ev of parseAssDialogues(ass)) {
    const kSumCs = ev.kTags.reduce((s, k) => s + k.durationCs, 0);
    expect(kSumCs).toBeCloseTo((ev.endMs - ev.startMs) / 10, 0); // \k va en centisegundos
  }
});
```

Qué puede afirmar el unit test y qué no: sin renderizar glifos no se conoce la extensión real del texto, así que aquí se verifican las **constraints de posicionamiento** (anclas `\pos`/márgenes/alignment dentro del área, `PlayResX/Y` = 1080×1920, estilos correctos por plataforma — caja opaca `BorderStyle=3` para Reels, contorno para TikTok); la comprobación píxel-exacta con render pertenece a la suite media. Añade un golden file del `.ass` completo para un fixture fijo de timestamps (el formato ASS es sensible a cada campo de la línea `Dialogue:`), casos frontera (palabra única, texto no latino que activa el fallback de fuente, preset `subtitle` 3–7 palabras/2 líneas) y, cuando lleguen los presets por plataforma (T8.3), la misma suite parametrizada por safe zone.

## 10. Validadores de seeds en CI (T2.1, T3.2)

Los seeds (hooks/CTAs/recetas en T2.1; galería en T3.2) son datos versionados en git que la BD solo materializa. Su validador es una función pura, y sus tests unitarios son **el gate de CI**: el test más importante es el que valida el seed REAL del repo — así, romper un JSON en un PR rompe `pnpm test:unit` sin necesidad de BD ni seed job.

```ts
// packages/core/src/gallery/seed-validator.test.ts
import { describe, expect, it } from "vitest";
import { validateGallerySeed } from "./seed-validator";
import { loadGallerySeed } from "./seed-loader"; // lee packages/core/gallery-seed/*.json

it("el seed real del repo valida — esto ES el gate de CI", () => {
  expect(validateGallerySeed(loadGallerySeed()).errors).toEqual([]);
});

it("slot inexistente contra las variables canónicas §10.4 → error accionable", () => {
  const seed = loadGallerySeed();
  seed.templates[0].body += " {producto.nombre}"; // namespace inválido: es {product.name}
  const { errors } = validateGallerySeed(seed);
  expect(errors).toContainEqual(expect.objectContaining({
    code: "unresolvable_slot",
    templateSlug: seed.templates[0].slug,
    slot: "producto.nombre",
  }));
});

it.each([
  ["guardPackId inexistente", (s) => { s.templates[0].guardPackIds.push("guard.vertical.nope"); }, "unknown_guard_pack"],
  ["slugs duplicados", (s) => { s.templates[1].slug = s.templates[0].slug; }, "duplicate_slug"],
  ["enum sin enumValues", (s) => { s.templates[0].variables.push({ name: "x", type: "enum", required: true, source: "campaign" }); }, "enum_without_values"],
])("galería: %s", (_n, breakSeed, code) => {
  const seed = loadGallerySeed();
  breakSeed(seed);
  expect(validateGallerySeed(seed).errors.map((e) => e.code)).toContain(code);
});
```

Para T2.1, misma estructura: hook sin ángulo, hook >12 palabras, CTA sin `objective`, receta sin coste o sin los 3 tiers → cada uno un código de error con caso propio, y el seed real en verde. Los mensajes de error se testean porque su consumidor es un humano leyendo el log de CI: deben nombrar el fichero, el slug y el campo.

## 11. Criterio de exhaustividad

No todo el código merece el mismo rigor. La vara, de más a menos:

| Código | Exhaustividad | Por qué |
|---|---|---|
| Máquina de estados | **Producto cartesiano completo** estados × eventos | Una transición ilegal aceptada corrompe runs y duplica gasto; el espacio es pequeño y cerrado |
| Linter FTC / guard packs | Todas las reglas × (1 caso que bloquea + 1 legítimo frontera) | Falso negativo = riesgo legal; falso positivo = fricción que invita a desactivarlo |
| Contratos Zod | 1 caso por regla de negocio del schema + divergencias del espejo | El contrato es la frontera con un LLM: lo que no rechace el schema entra al pipeline |
| Compilador / adapters / ASS | Goldens por combinación representativa + fronteras (troceo, slots, safe zone) | Output textual de alta superficie: el golden detecta cualquier cambio; las fronteras son donde revienta |
| Estimador / matriz | Aritmética verificable a mano + propiedad de dedupe | Números que el usuario aprueba en CP2: deben cuadrar con el Apéndice B |
| Utilidades corrientes | Casos representativos + bordes obvios (vacío, uno, muchos) | Rigor proporcional al blast radius |

Regla final: si al escribir un test de esta capa necesitas un mock, para y pregúntate qué I/O se ha colado en la lógica pura — la respuesta correcta casi siempre es mover el I/O fuera, no añadir el mock.
