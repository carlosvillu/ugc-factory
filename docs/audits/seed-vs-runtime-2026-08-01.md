# Auditoría: ¿los catálogos pre-cargados en el boot los lee el runtime desde la tabla o desde un snapshot estático?

**Fecha:** 2026-08-01 · **Disparador:** el usuario detectó que `/gallery` (templates) muestra datos que
el motor de generación ignora, y sospechó que el patrón podía ser generalizado (personas, etc.).
**Método:** 4 subagentes Sonnet en paralelo, read-only, una faceta cada uno; pregunta binaria por catálogo
(`CONECTADO` / `DESCONECTADO` / `SOLO-UI` / `MIXTO`) con cita literal `file:line` del lector de runtime.
Las citas de mayor consecuencia (N7a/N7d ignoran N6; model_profile CONECTADO) las verifiqué a mano.

## Veredicto de una línea

**El problema NO es generalizado a nivel de "tabla vs JSON": de los 9 catálogos sembrados en el boot, 6
están correctamente CONECTADOS.** La desconexión está **concentrada en el eje de "galería/prompt"** —
`prompt_template` y `guard_pack` — y ahí destapa un problema **más profundo y más grave** que el que se
buscaba: **no es solo que el motor N6 ignore la tabla, es que TODOS los nodos de pago (N7*) ignoran también
el output de N6.** El prompt que se paga a fal no es el que la galería edita **ni** el que el motor compila.

## Censo completo (9 catálogos sembrados en `apps/web/src/instrumentation.ts`)

| Catálogo | Seeder (boot) | Lo lee el runtime desde… | Veredicto | ¿UI promete editar? |
|---|---|---|---|---|
| `prompt_template` | `seedGallery` ← `RAW_GALLERY_SEED` | **JSON bundleado** (`compile-prompt.ts:76-80`) | **DESCONECTADO** | **Sí** (`/gallery` edita) |
| `guard_pack` | `seedGallery` ← JSON | **JSON** en N6; tabla solo para la ficha UI (`/api/templates/:id:40`) | **DESCONECTADO** (MIXTO por la UI) | **Sí** |
| `model_profile` | `seedGallery` ← JSON | **Tabla** (`getModelProfile*`, ~12 call-sites de pago) | CONECTADO | No |
| `persona` | `seedPersonas` ← `PERSONA_SEEDS` | **Tabla** (`listPersonas`/`getPersona`) | CONECTADO | Sí |
| `recipe` | `seedLibrary` ← `SEED_LIBRARY` | **Tabla** (`getRecipe`) | CONECTADO | No |
| `hook_line` | `seedLibrary` ← `SEED_LIBRARY` | **Tabla** (`listHookLines`) | CONECTADO | No |
| `cta_line` | `seedLibrary` ← `SEED_LIBRARY` | **Nadie** (solo `count()` de log) | SOLO-UI (huérfana total) | No |
| `app_setting: password_hash` | `seedPasswordHashIfAbsent` ← env | **Tabla** (`getPasswordHash`, login) | CONECTADO | — |
| `budget (monthly)` | `seedMonthlyBudgetIfAbsent` ← env | **Tabla** (`getSpendSummary`, `/spend`) | CONECTADO | — |
| `secret (fal/anthropic/firecrawl)` | `seedSecretIfAbsent` ← env | **Tabla** (`getSecretBlob`, cada llamada) | CONECTADO | — |

## Los tres problemas reales (ordenados por gravedad)

### 1. [GRAVE — hallazgo nuevo] El prompt que se paga a fal NO es el que compila el motor N6

El motor N6 (`compile-prompt.ts`) sí compila un `resolvedPrompt` (resolviendo slots + guard packs, $0) y lo
persiste en `step_run.output_refs`. El DAG cablea `dependsOn:[n6Key,...]` para todos los N7 con el comentario
"los N7 consumen su resolvedPrompt". **Pero ningún N7 lo lee:**

- **N7a (packshot):** `generation.ts:272` → `const resolvedPrompt = buildPackshotPrompt(args.brief);` — su
  propio prompt desde el brief, ignorando N6. *(verificado a mano)*
- **N7d (b-roll):** `generate-broll.ts:154-179` — el payload a `runGenerateBroll` **no incluye `prompt`**;
  cae en `DEFAULT_BROLL_PROMPT = 'A cinematic product b-roll shot.'` *(verificado a mano)*
- N7c/N7e/N7f: idéntico patrón (prompt propio/mood crudo, sin motor).

**Consecuencia:** el código de N6 (motor + wiring `dependsOn`) es **arquitectura muerta en el camino de
gasto**. Cada dólar en fal usa un prompt distinto y más simple que el que el sistema dice compilar. Esto es
más grave que la desconexión de templates porque afecta a la **calidad de la generación de pago**, no solo a
una promesa de UI.

### 2. [MEDIO] `prompt_template` y `guard_pack`: la UI de galería miente sobre la generación

Editar un template (o un guard pack) en `/gallery` persiste en la tabla, pero N6 compila contra
`RAW_GALLERY_SEED` (el JSON bundleado en la imagen) e ignora la tabla. Encadenado con el problema #1, la
edición es **doblemente inerte**. Detalle adicional: `prompt_template.guard_pack_keys` (editable vía
`PATCH /api/templates/:id`) tampoco lo lee nunca el compilador. **Hoy no muerde** porque el `body` de la
tabla de prod coincide con el JSON (nadie ha editado); es divergencia *latente* (seed `onConflictDoNothing`
→ tabla congelada en el primer boot ~14 jul).

### 3. [BAJO] `cta_line`: tabla huérfana total

Se siembra en cada boot y nadie la lee nunca (ni runtime ni UI; solo un `count()` para el log de arranque).
El CTA real lo escribe Sonnet en runtime desde el brief (`script-writer.ts:264`), un mecanismo no
relacionado. Dato muerto de punta a punta. Deuda inerte (sin UI que mienta), coste de retirarla ~$0.

## Lo que NO es un problema (para no planificar de más)

- **Personas.** CONECTADO. El síntoma "en prod no son usables" **no es desconexión**: la fila persona se lee
  y se usa (`getPersona` en `build-variant-generation-plan.ts:96`, voice_map incluido). Lo que falta es el
  **asset de retrato real** (identity-lock F4, cuesta fal); las personas placeholder nacen con un PNG
  abstracto sintético de `sharp`, y `build-variant-generation-plan.ts` lanza `PersonaWithoutReferenceImageError`
  cuando falta. **Remedio: generar retratos con fal, no recablear código.** Solo Maya tiene fotos reales
  committeadas (T5.19).
- **model_profile, recipe, hook_line, secrets, budget, password.** CONECTADOS con cita verificada.
- **budget** se lee pero es informativo (dashboard `/spend`), no bloquea gasto — matiz de producto, no
  desconexión.

## Decisiones que la remediación tiene que tomar (NO implementar sin OK del usuario — alcance MAYOR, regla 7)

Reconectar N6→tabla y N7→N6 toca el camino de compilación del orquestador. Constraints que la tarea debe nombrar:

1. **Validación de frontera.** Hoy N6 recibe el catálogo ya pasado por Zod (`validateGallerySeed`); un
   catálogo roto es `PermanentStepError`. Leer de la tabla mueve la frontera: contenido editado por el
   usuario entra sin ese guard → hay que replicarlo en el read path.
2. **¿Qué versión compila?** La tabla tiene `head_version` + `createTemplateVersion`. ¿Compila el `head` o la
   última `published`? Esa decisión es la que haría que `draft→review→published` **signifique algo**.
3. **Golden tests anclados al seed.** `compile-prompt.golden.test.ts` fija prompts compilados contra el JSON.
   Cambiar la fuente cambia lo que protegen.
4. **El problema #1 es prerequisito del #2.** Reconectar N6→tabla no sirve de nada mientras N7 siga ignorando
   a N6. El orden correcto es: primero que N7 consuma el `resolvedPrompt` de N6; después decidir la fuente de N6.

## Sobre el "sistema adversarial" que el usuario dejó a mi criterio

**No lo monté.** Los hallazgos aquí son verificables por ejecución (un `file:line` con un import de JSON es
cierto o no), no por consenso — un panel de escépticos votaría sobre algo que un `grep` resuelve. En su lugar
exigí a cada agente la cita literal y verifiqué a mano las 3 de mayor consecuencia. Más fuerte que votar, y
una fracción del coste.
