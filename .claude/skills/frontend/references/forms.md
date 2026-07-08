# Formularios y editores de checkpoint

Cómo se escribe TODO formulario de `apps/web`: intake, editores de checkpoint (CP1–CP3), settings. Los tests que exige cada pieza los define `testing/references/frontend.md` §5–6 — léelo junto a este documento; aquí solo se marca QUÉ debe ser observable para que esos tests existan.

## Índice

1. [El patrón único: RHF + zodResolver + api-client](#1-el-patrón-único-rhf--zodresolver--api-client)
2. [Anatomía de un formulario: el intake](#2-anatomía-de-un-formulario-el-intake)
3. [El envelope de error `{code, message, details}`](#3-el-envelope-de-error-code-message-details)
4. [Editores de checkpoint: CP1, CP2, CP3](#4-editores-de-checkpoint-cp1-cp2-cp3)
5. [Accesibilidad de formularios = API de test](#5-accesibilidad-de-formularios--api-de-test)
6. [Settings: las API keys nunca se re-renderizan en claro](#6-settings-las-api-keys-nunca-se-re-renderizan-en-claro)
7. [Qué NO va aquí](#7-qué-no-va-aquí)

---

## 1. El patrón único: RHF + zodResolver + api-client

Decisión de sesión (2026-07-07), no negociable:

1. **react-hook-form + `zodResolver` con el MISMO schema Zod de `@ugc/core`.** El schema que valida en el cliente es el mismo objeto que re-valida el route handler (vía `withRoute`, skill backend). Por qué: elimina por construcción el drift cliente/servidor — no hay dos definiciones de "válido" que puedan divergir.
2. **Submit por `fetch` a la API REST vía `lib/api-client.ts`.** Sin Server Actions, sin `useActionState`, sin `useFormStatus`: una sola superficie de mutación, la misma que usan worker, curl y los tests de `testing/references/api.md`. Una action sería una segunda superficie sin envelope y sin cobertura de esa capa.
3. **`mode: 'onBlur'` por defecto.** `onChange` grita errores mientras el usuario aún teclea; `onSubmit` avisa demasiado tarde. `onBlur` valida al abandonar el campo — el punto donde el error es útil. Solo se cambia con motivo escrito en el componente.
4. **El estado de envío es de RHF** (`formState.isSubmitting`), no un `useState` paralelo. Un booleano duplicado acaba desincronizado del ciclo real del submit.

El resolver consume el schema tal cual sale de core (`IntakeConfigSchema`, `ProductBriefSchema`…). Si el formulario edita un subconjunto, el subconjunto se deriva del contrato (`Schema.pick(...)`) en el propio componente — nunca se redeclara un shape a mano: un cambio de contrato debe romper la compilación del form.

## 2. Anatomía de un formulario: el intake

El formulario de N0 (T1.6, PRD §9 N0): URL **o** texto libre + configuración del lote. La conmutación URL/texto libre es la regla cross-field clave: **el modo `manual` no exige URL** — y esa regla vive EN el `IntakeConfigSchema` de core (refine/superRefine), no en un `if` del componente, porque el handler debe rechazar exactamente lo mismo que el cliente.

```tsx
'use client';
// apps/web/src/components/intake/intake-form.tsx
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { IntakeConfigSchema, PipelineRunSchema, type IntakeConfig } from '@ugc/core/contracts';
import { api, ApiError } from '@/lib/api-client';
import { applyEnvelopeToForm } from '@/lib/form-errors';
import { Button } from '@/components/ui/button';

export function IntakeForm() {
  const router = useRouter();
  const { register, handleSubmit, watch, setError, formState } = useForm<IntakeConfig>({
    resolver: zodResolver(IntakeConfigSchema), // EL schema de core, no una copia
    mode: 'onBlur',
    defaultValues: { source: 'url', url: '', freeText: '', languages: ['es'], tier: 'test' },
  });
  const { errors, isSubmitting } = formState;
  const source = watch('source');

  const onSubmit = handleSubmit(async (config) => {
    try {
      const run = await api.post('/api/runs', PipelineRunSchema, config);
      router.push(`/runs/${run.id}`);
    } catch (e) {
      if (e instanceof ApiError) return applyEnvelopeToForm(e, setError); // §3
      throw e; // red caída u otro error no-API: lo captura el error boundary
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset>
        <legend>Origen del producto</legend>
        <label>
          <input type="radio" value="url" {...register('source')} /> URL de producto
        </label>
        <label>
          <input type="radio" value="manual" {...register('source')} /> Texto libre
        </label>
      </fieldset>

      {source === 'url' ? (
        <div>
          <label htmlFor="intake-url">URL</label>
          <input
            id="intake-url"
            type="url"
            aria-invalid={errors.url ? true : undefined}
            aria-describedby={errors.url ? 'intake-url-error' : undefined}
            {...register('url')}
          />
          {errors.url && <p id="intake-url-error" role="alert">{errors.url.message}</p>}
        </div>
      ) : (
        <div>
          <label htmlFor="intake-text">Descripción del producto</label>
          <textarea id="intake-text" rows={8} {...register('freeText')} />
          {/* el modo manual NO renderiza campo URL: la conmutación es de campos, no de disabled */}
        </div>
      )}

      {/* …idiomas, plataformas, objetivo, tier, nº variantes: mismos patrones… */}

      {errors.root?.server && <div role="alert">{errors.root.server.message}</div>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Analizando…' : 'Analizar'}
      </Button>
    </form>
  );
}
```

Puntos que los tests de `testing/references/frontend.md` §6 asertan literalmente — si falta alguno, el test no puede escribirse:

- **Loading observable**: el botón se deshabilita Y cambia su accessible name (`analizar` → `analizando…`). El test hace `getByRole('button', { name: /analizando/i })` y espera `toBeDisabled()`.
- **Error recuperable**: tras un fallo, el submit se re-habilita (RHF lo hace solo al resolver la promesa) y el error vive en `role="alert"`. Un formulario "atascado" en loading tras un 500 es un bug.
- **`noValidate`** en el `<form>`: la validación nativa del navegador pisaría los mensajes del schema y rompería los asserts de texto.
- El upload opcional de imágenes del modo manual (T1.6) sigue el mismo principio — mutación contra la API REST de assets; su endpoint lo gobierna la skill backend.

## 3. El envelope de error `{code, message, details}`

Toda respuesta de error de la API es el envelope del Apéndice E, contrato Zod en `@ugc/core/contracts`. **El frontend hace switch sobre `code`; el wording de `message` nunca es contrato** (skill backend, principio 6). Reacción prescrita por código:

| `code` | Reacción del formulario | Por qué |
|---|---|---|
| `validation_error` | `setError` campo a campo desde `details` (salida de `z.flattenError` del servidor); `formErrors` → error root en `role="alert"` | El usuario corrige en el campo, no en un banner genérico. Además es señal de drift: si cliente y servidor comparten schema, este error no debería ocurrir en un form ya validado — investígalo, no lo silencies |
| `guardrail_blocked` | Alert (`role="alert"`) con la explicación (`message`) + la sugerencia accionable (`details.suggestion`); **Aprobar queda deshabilitado** | PRD §15.2: bloqueo con explicación y sugerencia compliant, no solo aviso — evita quemar renders y rechazos de ads |
| `invalid_transition` | Toast informativo y NADA más: no tocar el form ni el store | El run cambió por debajo (p. ej. otro proceso aprobó el step); el estado real llega por el stream SSE — delta `step_changed` en vivo, o re-snapshot si hubo reconexión (`references/state-and-sse.md` §3). Parchear a mano crearía un segundo dueño del estado |
| 401 (`unauthorized`) | Redirect a login, centralizado en `api-client` | `proxy.ts` protege páginas; un 401 en un fetch significa sesión expirada — ningún formulario debe tratarlo caso a caso |
| Resto (`internal`, red caída…) | Error root genérico en `role="alert"`, submit re-habilitado | Recuperable, no atascado (testing §6) |

El helper que mapea `details` de Zod a `setError` de RHF — vive en `apps/web/src/lib/form-errors.ts` y lo usan TODOS los formularios (un solo patrón):

```ts
// apps/web/src/lib/form-errors.ts
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { z } from 'zod';
import type { ApiError } from '@/lib/api-client'; // lleva code/message/details del envelope (architecture.md §3.1)

// Shape de details para validation_error: lo que produce z.flattenError en el handler
const ValidationDetailsSchema = z.object({
  formErrors: z.array(z.string()).default([]),
  fieldErrors: z.record(z.string(), z.array(z.string())).default({}),
});

export function applyEnvelopeToForm<T extends FieldValues>(
  error: ApiError,
  setError: UseFormSetError<T>,
): void {
  if (error.code === 'validation_error') {
    const parsed = ValidationDetailsSchema.safeParse(error.details);
    if (parsed.success) {
      for (const [field, messages] of Object.entries(parsed.data.fieldErrors)) {
        setError(field as Path<T>, { type: 'server', message: messages[0] ?? error.message });
      }
      if (parsed.data.formErrors.length > 0) {
        setError('root.server', { type: 'server', message: parsed.data.formErrors.join(' — ') });
      }
      return;
    }
  }
  // guardrail_blocked se trata en el componente (necesita UI propia, §4); el resto cae aquí
  setError('root.server', { type: error.code, message: error.message });
}
```

Los errores `root.*` de RHF no sobreviven a la siguiente validación — exactamente el comportamiento deseado: el error del servidor desaparece cuando el usuario reintenta.

**Contrato del helper**: todo formulario que pueda recibir `guardrail_blocked` (los editores que disparan re-lint: CP3, hooks) DEBE interceptarlo ANTES de llamar a `applyEnvelopeToForm` (como hace el snippet de CP3 en §4) — ese código necesita UI propia (explicación + sugerencia + bloqueo de Aprobar) y el fallback `root.server` lo degradaría a un banner genérico.

## 4. Editores de checkpoint: CP1, CP2, CP3

Los checkpoints son la UI con más lógica del producto (testing §5 los llama por su nombre). Regla común: **el formulario edita el artefacto; el estado del run NO es suyo** — aprobar/rechazar son POSTs a `/api/steps/:id/approve|reject` y la transición real llega por SSE al store del run.

### CP1 — Editor de brief (T1.10b)

- **`useFieldArray` para `benefits` y `angles`**: el brief es editable campo a campo y las listas crecen/decrecen; los `fields` de RHF dan keys estables.
- **Los badges extraído/inferido son RENDER del prop, no form state.** `evidence`/`confidence` los produce N3 y el usuario no los edita: se leen del `brief` original por índice. Meterlos en el form invitaría a mutarlos.
- **Los warnings bloqueantes deshabilitan Aprobar.** El warning `missing_hero_image` del perfil `manual` (PRD §9.2, T1.9) exige una decisión explícita (subir imágenes o derivar N7a a packshot IA); hasta que exista, `Aprobar` está `disabled`. El warning viene del servidor — no es un error de RHF ni se valida en cliente.

```tsx
// apps/web/src/components/checkpoints/brief-editor.tsx (extracto)
export function BriefEditor({ brief, warnings, stepId }: BriefEditorProps) {
  const { control, register, handleSubmit, setError, formState } = useForm<BriefFormValues>({
    resolver: zodResolver(BriefFormSchema), // derivado con .pick del ProductBriefSchema
    mode: 'onBlur',
    defaultValues: { benefits: brief.benefits, angles: brief.angles /* …resto editable */ },
  });
  const benefits = useFieldArray({ control, name: 'benefits' });
  const [decisions, setDecisions] = useState<Record<string, WarningDecision>>({});
  const blocked = warnings.some((w) => w.blocking && !decisions[w.code]);

  return (
    <form onSubmit={handleSubmit(async (values) => {
      try {
        await api.post(`/api/steps/${stepId}/edit`, ProductBriefSchema, { artifact: values });
        // el brief versionado (v1 IA → v2 editado) lo persiste el handler; el avance llega por SSE
      } catch (e) {
        if (e instanceof ApiError) return applyEnvelopeToForm(e, setError);
        throw e;
      }
    })} noValidate>
      {benefits.fields.map((field, i) => {
        const evidence = brief.benefits[i]?.evidence; // prop original: render, no form state
        return (
          <fieldset key={field.id} aria-label={brief.benefits[i]?.text ?? `Beneficio ${i + 1}`}>
            <legend className="sr-only">Beneficio {i + 1}</legend>
            <span>{evidence ? 'extraído' : 'inferido'}</span>
            {evidence && <q>{evidence.quote}</q>} {/* la cita es visible: testing §5 la aserta */}
            <label htmlFor={`benefit-${i}`}>Texto</label>
            <input id={`benefit-${i}`} {...register(`benefits.${i}.text` as const)} />
          </fieldset>
        );
      })}

      <Button type="submit" disabled={formState.isSubmitting}>Guardar</Button>
      <Button type="button" disabled={blocked || formState.isSubmitting} onClick={approve}>
        Aprobar
      </Button>
    </form>
  );
}
```

### CP2 — Matriz (T2.3)

Mismo patrón RHF (ángulos, hooks, personas, tier, idiomas, duración son campos), pero la sustancia no es el form: **el recálculo de coste es una función pura del estimador de core** aplicada sobre los valores observados (`useWatch`), nunca una fórmula re-implementada en el componente — testing §5 calcula el valor esperado a mano contra las `recipe`. El coste total vive en un `role="status"` con accessible name (`coste estimado`) para que el test lo encuentre y el usuario con lector de pantalla oiga el cambio.

### CP3 — Editor de guiones (T2.6)

- **`useFieldArray` sobre `scenes`** del `ad_script`; edición por escena y de hook/CTA.
- **Guardar → `POST /api/steps/:id/edit` → el SERVIDOR re-linta** (el linter FTC es lógica de core con sus propios unit tests; la UI solo reacciona a su respuesta). Jamás un lint "aproximado" en cliente: dos linters = dos verdades.
- Un `guardrail_blocked` (422) renderiza explicación + sugerencia y **bloquea Aprobar** hasta que un guardado posterior pase el lint:

```tsx
// apps/web/src/components/checkpoints/script-editor.tsx (extracto)
const [lintBlock, setLintBlock] = useState<ApiError | null>(null);

const onSave = handleSubmit(async (values) => {
  setLintBlock(null);
  try {
    await api.post(`/api/steps/${stepId}/edit`, AdScriptSchema, { artifact: values });
  } catch (e) {
    if (e instanceof ApiError && e.code === 'guardrail_blocked') return setLintBlock(e);
    if (e instanceof ApiError) return applyEnvelopeToForm(e, setError);
    throw e;
  }
});

// En el JSX:
{lintBlock && (
  <div role="alert">
    <p>{lintBlock.message}</p>                             {/* "Claim médico prohibido: …" */}
    <p>Sugerencia: {String(lintBlock.details?.suggestion)}</p> {/* accionable, PRD §15.2 */}
  </div>
)}
<Button type="button" disabled={lintBlock !== null || formState.isSubmitting} onClick={approve}>
  Aprobar
</Button>
```

Estados que los tests de testing §5 exigen observables en los tres editores: loading deshabilita los botones, un error re-habilita con `role="alert"` visible, y la sugerencia del linter es texto renderizado (no un tooltip que jsdom no ve).

## 5. Accesibilidad de formularios = API de test

Correlación directa con las queries de `testing/references/frontend.md` §7 (`getByRole` > `getByLabelText` > …): cada regla de abajo es lo que hace posible una query concreta. Sin esto, el componente no se puede testear NI usar.

1. **Todo campo tiene `<label htmlFor>`** (o `aria-label` si el diseño no muestra label). Habilita `getByRole('textbox', { name: /url/i })` y `getByLabelText`.
2. **Grupos repetidos con `<fieldset>` + `aria-label`** (o `role="group"`): cada beneficio de CP1, cada escena de CP3. Los tests hacen `getByRole('group', { name: /hidrata 24h/i })` y luego `within(...)` — sin nombre de grupo no hay `within`.
3. **Errores de campo**: el mensaje se enlaza con `aria-describedby` y el input marca `aria-invalid`. El lector de pantalla anuncia el error al enfocar el campo; el test lo encuentra junto al input.
4. **El botón de submit cambia su accessible name en loading** (`Analizar` → `Analizando…`, `Guardar` → `Guardando…`) además de `disabled`. Es el indicador de progreso más barato y el único que los tests asertan sin mirar píxeles.
5. **Feedback asíncrono**: errores en `role="alert"` (interrumpe, es urgente); estados informativos (coste recalculado, "guardado") en `role="status"`/`aria-live="polite"`.
6. **`noValidate` siempre**: los mensajes los pone el schema Zod, con el mismo texto en cliente y servidor.

## 6. Settings: las API keys nunca se re-renderizan en claro

Las credenciales (fal, Anthropic, Firecrawl…) viven cifradas en `app_setting` y se editan desde `/settings` (PRD §18.1, Apéndice E `GET/PATCH /api/settings`). Reglas para el formulario:

- **El GET de settings NUNCA devuelve la key en claro y la UI NUNCA la re-renderiza**: el campo muestra un placeholder enmascarado (p. ej. `••••••••` + últimos 4 caracteres si la API los expone). `testing/references/frontend.md` §6 lo verifica con assert negativo (`queryByText(key)` es `null`) — si tu componente rompe ese test, es un incidente de seguridad, no un rojo más.
- El input de una key es **write-only**: vacío por defecto; el PATCH solo incluye la key si el usuario escribió un valor nuevo (enviar el placeholder machacaría la credencial real).
- Tras guardar: `role="status"` de confirmación, el input vuelve a vacío + placeholder enmascarado. Jamás "eco" del valor guardado.
- `autoComplete="new-password"` y `type="password"` en los inputs de key: Chrome y Safari ignoran deliberadamente `autocomplete="off"` en campos password; `new-password` es el valor que sí suprime el autocompletado del gestor (el enmascarado visual lo da `type="password"`).

## 7. Qué NO va aquí

- **Validación del lado servidor, `withRoute`, `AppError` y la construcción del envelope** → skill **backend**, `references/api.md`. Este documento solo consume el envelope.
- **El store del run, el hook SSE y por qué `invalid_transition` se resuelve con re-sync** → `references/state-and-sse.md`.
- **Los componentes visuales del form (`Button`, `Input`, `Textarea`, `Select` —nativo—, `Checkbox`, `Switch`, `Slider`), cva y tokens** → `references/components.md` y `references/design-system.md` (§4 el inventario con sus props reales).
- **Cómo se testean estos formularios** (msw, `useHttpMocks`, FakeEventSource, asserts de loading/error) → `testing/references/frontend.md` §5–6, fuente de verdad. Aquí solo se garantiza que lo observable existe.
- **El flujo completo en navegador** (URL → CP1 → CP2 → CP3) → `testing/references/e2e.md` y el gate CUA (`testing/references/cua.md`).
