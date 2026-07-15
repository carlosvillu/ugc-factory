# Handoff — Fallo de N3 en producción al reintentar («Reintentar» corrompe el config)

- **Fecha:** 2026-07-15
- **Estado:** diagnosticado, SIN arreglar (pendiente de retomar)
- **Severidad:** alta — bloquea el retry de CUALQUIER step real (N1/N2/N3) desde el canvas
- **Reportado por el usuario (síntoma en prod):**
  1. Primer error: lento, poco detallado, «no se podía generar sin información».
  2. Al pulsar «Reintentar» (R3), error inmediato:
     ```
     N3: config inválida: [
       { "expected": "string", "code": "invalid_type",
         "path": ["targetLanguage"],
         "message": "Invalid input: expected string, received undefined" }
     ]
     ```

## Causa raíz (confirmada por código, no hipótesis)

Son **dos fallos encadenados**. El segundo es el bug.

### 1er error (legítimo, no es el bug)
N3 sintetiza el brief con una llamada real a **Sonnet 5** (timeout 180 s → de ahí la tardanza).
Ante contenido pobre, el sintetizador devuelve refusal/parse_error y NO produce brief; N3 lo
convierte en fallo permanente:

- `apps/worker/src/executors/analysis.ts:348-349`
  ```ts
  if (result.brief === null) {
    throw new PermanentStepError(`N3: la síntesis no produjo brief (status=${result.status})`);
  }
  ```
El step quedó en `failed` **con su config original intacto** (`{ targetLanguage: "es" }`).

### 2º error (EL BUG) — «Reintentar» reemplaza el config por basura de demo
El botón «Reintentar» del canvas envía **siempre** un patch hardcodeado pensado para los nodos de
demo (`fail_rate` es un parámetro del executor de demo, NO de los nodos reales):

- `apps/web/src/components/run-canvas/step-panel.tsx:282`
  ```ts
  onClick={() => void run(() => runActions.retry(stepId, { failRate: 0 }))}
  ```

Y `retryStep` **REEMPLAZA el config entero** (no hace merge):

- `packages/core/src/orchestrator/retry.ts:56-60`
  ```ts
  await stores.steps.update(stepId, {
    status: 'queued',
    resetRetryCount: true,
    ...(input.config !== undefined && { config: input.config }),   // ← reemplaza, no merge
  });
  ```

Resultado: el config de N3 pasa de `{ targetLanguage: "es" }` → `{ failRate: 0 }`. Al reencolarse,
N3 hace `AnalysisN3ConfigSchema.safeParse(ctx.config)` sobre `{ failRate: 0 }` (sin `targetLanguage`)
→ el error exacto, **inmediato** (muere en el 1er `safeParse`, antes de tocar Sonnet):

- `apps/worker/src/executors/analysis.ts:249-252`
  ```ts
  const parsed = AnalysisN3ConfigSchema.safeParse(ctx.config);
  if (!parsed.success) {
    throw new PermanentStepError(`N3: config inválida: ${parsed.error.message}`);
  }
  ```
- `packages/core/src/orchestrator/analysis-dag.ts:57-59` — `AnalysisN3ConfigSchema` exige `targetLanguage: z.string().min(1)`.

**El usuario está atascado**: cada nuevo «R3» reafirma el config roto → nunca puede pasar.

### Por qué el esquema no lo atrapó
`RunNodeSchema.config` es `z.unknown().optional()` (opaco a propósito) —
`packages/core/src/orchestrator/run-definition.ts:30`. La única garantía de que N3 lleve
`targetLanguage` es el default del builder `analysisRunDefinition` (`?? DEFAULT_ANALYSIS_LANGUAGE`,
`analysis-dag.ts:107`) — que el retry pisa. No hay red de seguridad.

## Fix propuesto (3 capas)

### (1) EL FIX del bug — el botón `step-panel.tsx:282` [PRIORITARIO]
«Reintentar» NO debe mandar `{ failRate: 0 }` para nodos reales. Lo correcto es reintentar
**sin patch** (`runActions.retry(stepId)`), que conserva el config original. El `failRate: 0` era
una comodidad de la Verificación de demo (T0.9) que se coló en la UI de producción.
- Ojo: comprobar que el retry de los nodos de DEMO no dependa de ese patch para su propia
  verificación. Si lo necesitan, el patch debe ser condicional al tipo de nodo, no global.

### (2) Defensa en profundidad — `retry.ts:59` [valorar con el usuario]
Hacer que el patch de config sea un **merge** (`{ ...configActual, ...input.config }`) en vez de
reemplazo total, para que un patch parcial nunca borre claves obligatorias. Cambia la semántica del
retry (hoy documentada como «REEMPLAZA», ver `RetryStepInput`, `retry.ts:22-27`); decidir a
conciencia. Requiere leer el config actual del step dentro de la tx antes del update.

### (3) UX aparte (NO es la causa del `undefined`) — intake de texto libre
`apps/web/src/components/intake/intake-form.tsx:125-128` llama a `analysisRunDefinition` sin
`targetLanguage` y el formulario manual no ofrece selector de idioma (siempre `'es'`). El modo URL
sí lo tiene (`url-intake-form.tsx:108-116`). El default lo cubre, así que NO produce el `undefined`,
pero es una carencia real de UX. Anotar/arreglar por separado, no mezclar con el bug.

## Recomendación
Aplicar **(1)** como fix del bug de producción (causa raíz del síntoma). Tratar **(2)** y **(3)** como
mejoras aparte. Llevarlo por el bucle dev-loop (implementer/verifier, gate y evidencia) si se abre
tarea; si es hotfix, dejar constancia en el journal igualmente.

## Nota de producción (pendiente de verificar, no bloquea el diagnóstico)
El diagnóstico se sostiene solo con el código. Si se quiere confirmar en prod para el run afectado:
- `step_run.config` de N3: debería mostrar hoy `{ "failRate": 0 }` (ya corrompido por el retry).
- Debería existir un `cost_entry` de `provider='anthropic'` para ese N3 (prueba de que la síntesis
  SÍ corrió en el 1er intento → confirma que el config era válido antes del retry).

## Archivos tocados por el diagnóstico (referencia rápida)
- `apps/web/src/components/run-canvas/step-panel.tsx:282` — origen del patch tóxico
- `packages/core/src/orchestrator/retry.ts:56-60` — reemplazo (no merge) del config
- `apps/worker/src/executors/analysis.ts:249-252, 348-349` — donde revientan ambos errores
- `packages/core/src/orchestrator/analysis-dag.ts:57-59, 107` — schema N3 + default del builder
- `packages/core/src/orchestrator/run-definition.ts:30` — config opaco (`z.unknown().optional()`)
- `apps/web/src/components/intake/intake-form.tsx:125-128` — hueco de UX (3)
