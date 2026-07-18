# T4.11 — Verificación E2E de fase (F4) · **FAIL**

**Fecha:** 2026-07-19
**Veredicto:** **FAIL** — la variante NO completa N6→N7 en el sistema real. El E2E de fase live cazó un fallo real de correctness+dinero que la suite fake (verde) no podía reproducir.
**Coste real:** fal **28 ¢** (10 `cost_entry`) — gasto real confirmado, no fraude a $0. Muy por debajo del estimado porque el run quedó incompleto (N7a falló, N7d nunca corrió).

## Cómo se ejecutó (stack híbrido live)

- **fake N1–N5** (Firecrawl/Jina/Anthropic al fake local, $0) + **fal REAL N6–N7** — script `scratchpad/live-stack.ts` (adaptación de `apps/web/scripts/e2e-stack.ts`: omite `FAL_BASE_URL`, hereda `FAL_KEY` real vía `--env-file=../../.env`; fail-fast de money-safety que exige key real).
- URL analizada: `https://glow.example/beauty/serum` → brief vertical **beauty** (fake LLM, sin cirugía de brief).
- Persona **Nora F4 Premium** sembrada con voiceId REAL de elevenlabs (`EXAVITQu4vr4xnSDxMaL`) + imagen de referencia real. `matchPersonas` para el hint beauty devolvió SOLO a Nora (score 6; placeholders Lucía/Marcus score 0).
- **1 sola variante** (`01KXVKF3…`) — el acotado a 1 ángulo funcionó (gate de dinero: evitó las 6 variantes = $30-50).

## Estado del run (evidencia: `db-step_run.txt`)

| node_key | status | coste ¢ | nota |
|---|---|---|---|
| N1–N5 | succeeded | 0/8/2 | pipeline de análisis+matriz+guion OK |
| N6 | succeeded | 0 | compilador de prompt OK (resolvedPrompt producido) |
| N7a (product shots) | **failed** | 2 | **← el fallo. Terminal, sin retry (`permanent:true`)** |
| N7b (voz) | succeeded | 0 | tts_audio real (duración 0.879s/2.479s/1.039s) |
| N7c (avatar) | succeeded | **26** | avatar_clip video/mp4 743KB 1.6s — el sub-step más caro |
| N7d (b-roll) | **awaiting_deps** | — | **bloqueado: consume los keyframes de N7a (que falló)** |
| N7e (música) | succeeded | 0 | music_bed audio/wav 2.3MB 12s |

**La variante no puede completar N6→N7**: N7a terminal-failed → N7d (que depende de los keyframes de N7a) queda `awaiting_deps` para siempre → la cláusula literal "una variante real completa N6→N7 con todos los assets reproducibles" es **insatisfecha**.

## El fallo raíz — race de reconciliación en N7a (evidencia: `n7a-error-full.txt`, `db-n7a-race-detail.txt`)

Error de N7a (literal):
> `runGenerate: la generación 01KXVKN7FRJVBVF2JQSKMEJTM5 fue finalizada por otra ruta durante el polling (invariante roto)` · `permanent: true`

El step N7a (`01KXVKN27Y`) lanzó **DOS generaciones de imagen** (N7a produce múltiples product shots). Timing (mismo step_run):

| generación | started | completed | status |
|---|---|---|---|
| `01KXVKN359…` (A) | 55:53.639 | **55:58.06** | completed |
| `01KXVKN7FR…` (B) | **55:58.07** | 56:01.691 | **failed** |

La generación B arrancó **10 ms después** de que A completara. B falló porque "otra ruta la finalizó durante el polling". El payload de fal de B dice `status:"OK"` — fal la aceptó — pero el step la marca failed por invariante roto: hay un desajuste entre la respuesta real de fal (OK) y el invariante del polling del executor.

**Diagnóstico (root cause):** race entre el **polling del executor de N7a** y el **sweeper de reconciliación** (`generationReconcile:true`, `intervalMs:5000` — arranca en el log del worker). Cuando N7a maneja múltiples generaciones concurrentes de shots, una es finalizada por la ruta de reconciliación mientras el executor aún la pollea → rompe el invariante → `PermanentStepError` (sin retry). **Es la deuda de T4.10 (reconcile idempotente) materializada bajo carga real** — invisible en la suite fake porque el fake de fal completa síncronamente sin ventana de race con el sweeper.

Es un bug de **correctness Y de dinero**: el shot que completó (A) se pagó (1-2¢), y la doble finalización rompe la idempotencia que T4.10 debía garantizar.

## Cláusulas — resultado

1. **variante completa N6→N7 + assets reproducibles** — ❌ **FAIL** (N7a failed bloquea N7d). PERO los assets que SÍ se produjeron son reales y reproducibles (evidencia `db-assets.txt`): keyframes 386KB/331KB (576×1024), tts_audio real, music_bed 12s, avatar_clip video/mp4 1.6s. El pipeline funciona; el fallo es la race de N7a.
2. **resolvedPrompt inspeccionable en N6** — N6 succeeded (produjo resolvedPrompt); no verificado en el navegador porque el run no pudo completarse para la inspección de canvas. Parcial.
3. **coste real <15% vs CP2** — **no evaluable**: el lote no completó, así que el coste real (28¢) no es comparable con el estimado de un lote completo. (Nota de calibración conocida pendiente: el estimador CP2 es lineal en segundos, el coste fal real es sublineal — se traslada al resumen de fase, no es un FAIL.)
4. **retry de un sub-step fallado funciona** — ✓ verificado por el spec commiteado `f4-generation.spec.ts` (@f4 @phase, `f4-fake-run2.txt`: 2 passed, incluye "recupera un sub-step con retry granular"). Retry es propiedad de la máquina de estados, no de la salida de fal → cubierto por el arnés fake. **Ironía relevante:** N7a falló con `permanent:true` → NO reintentable por diseño; el retry granular no aplica a este fallo.
5. **`audio_source=ai_bed` en la variante** — ✓ **PASS** (evidencia `db-ad_variant.txt`): `ad_variant.audio_source = 'ai_bed'` (N7e generó su bed).

## Conclusión

**FAIL — F4 no cierra.** El E2E de fase live hizo exactamente lo que debe: bajo fal real, cazó una race de reconciliación en N7a que la suite fake (verde) no podía reproducir. Debe aterrizar una tarea de fix (robustez de N7a / invariante de reconciliación de T4.10) ANTES de cerrar F4. Los sub-steps individuales (N7b voz, N7c avatar, N7e música) funcionan con fal real y producen assets reproducibles — el fallo es específico del manejo concurrente de múltiples generaciones en N7a frente al sweeper.

**Evidencia persistida:** `db-step_run.txt`, `db-generations.txt`, `n7a-error-full.txt`, `db-n7a-race-detail.txt`, `db-cost_entry.txt`, `db-ad_variant.txt`, `db-assets.txt`, `f4-fake-run2.txt` (retry).
