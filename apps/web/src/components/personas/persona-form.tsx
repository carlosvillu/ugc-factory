'use client';

// Formulario de creación/edición de una persona (T2.0). Patrón único de forms.md §1:
// react-hook-form + zodResolver con el MISMO `PersonaBodySchema` de `@ugc/core/persona` que
// re-valida el route handler, submit vía api-client, `mode: 'onBlur'`, `noValidate`, y el estado
// de envío de RHF (nunca un useState paralelo).
//
// EL VOICE MAP ES LA PARTE NO TRIVIAL. El contrato es un `Record<locale, {provider, voiceId}>`
// (§12) y un `Record` anidado no se registra bien campo a campo en RHF. Se resuelve con la misma
// técnica que `settings-form.tsx`: **el schema del FORM no es el de core** — el form trabaja con
// las DOS filas de voz que la UI enseña (es/en, las del mockup 6c) como campos planos, y el
// submit las COMPONE en el voice_map del contrato. El `zodResolver` valida la forma plana; el
// contrato de core valida la compuesta en el servidor. Así el formulario no tiene que fabricar
// una estructura anidada mientras el usuario teclea, y añadir un idioma más adelante es añadir
// una fila (el `voice_map` de la BD no lo limita — §17).
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  PersonaBodySchema,
  VOICE_PROVIDER_LABEL,
  VoiceProviderSchema,
  type Persona,
  type PersonaBody,
} from '@ugc/core/persona';
import { ApiError, personaActions } from '@/lib/api-client';
import { applyEnvelopeToForm } from '@/lib/form-errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';

/** Los idiomas que la ficha enseña (mockup 6c: «voz por idioma», es + en). Es el seed de §17;
 *  añadir uno es añadir una entrada aquí — ni migración ni cambio de contrato. */
const VOICE_LOCALES = [
  { locale: 'es', label: 'Español' },
  { locale: 'en', label: 'English' },
] as const;

/** El schema del FORM: los campos del contrato SIN el voice_map, más las dos filas de voz
 *  planas. Se DERIVA de `PersonaBodySchema` (`.omit`) — nunca se redeclara a mano: un cambio de
 *  contrato debe romper la compilación de este formulario (skill frontend, principio 7). */
const PersonaFormSchema = PersonaBodySchema.omit({ voiceMap: true }).extend({
  voices: z.object({
    es: z.object({
      provider: VoiceProviderSchema,
      // Vacío = «esta persona no tiene voz en este idioma» (el voice_map la omite). No es un
      // error: una persona puede empezar sin voces (F4 traerá la asignación con preview).
      voiceId: z.string(),
    }),
    en: z.object({ provider: VoiceProviderSchema, voiceId: z.string() }),
  }),
});
type PersonaFormValues = z.infer<typeof PersonaFormSchema>;

/** form → contrato: compone el `voice_map`, omitiendo los idiomas sin `voiceId`. */
function toBody(values: PersonaFormValues): PersonaBody {
  const { voices, ...rest } = values;
  const voiceMap: PersonaBody['voiceMap'] = {};
  for (const { locale } of VOICE_LOCALES) {
    const voice = voices[locale];
    if (voice.voiceId.trim() !== '') {
      voiceMap[locale] = { provider: voice.provider, voiceId: voice.voiceId.trim() };
    }
  }
  return { ...rest, voiceMap };
}

/** persona → form (para editar). Único origen del mapeo: lo usa `defaultValues`. */
function toFormValues(persona: Persona | undefined): PersonaFormValues {
  return {
    name: persona?.name ?? '',
    ageRange: persona?.ageRange ?? '25-34',
    gender: persona?.gender ?? 'female',
    ethnicity: persona?.ethnicity ?? '',
    style: persona?.style ?? '',
    descriptor: persona?.descriptor ?? '',
    setting: persona?.setting ?? '',
    personality: persona?.personality ?? '',
    wardrobeNotes: persona?.wardrobeNotes ?? '',
    voices: {
      es: {
        provider: persona?.voiceMap.es?.provider ?? 'elevenlabs',
        voiceId: persona?.voiceMap.es?.voiceId ?? '',
      },
      en: {
        provider: persona?.voiceMap.en?.provider ?? 'elevenlabs',
        voiceId: persona?.voiceMap.en?.voiceId ?? '',
      },
    },
  };
}

interface PersonaFormProps {
  /** La persona que se edita; `undefined` = crear una nueva. */
  persona?: Persona;
  /** El padre refresca su lista con la persona guardada (no hay store: la librería es una
   *  lista estática que el cliente posee — no hay estado vivo por SSE aquí). */
  onSaved: (persona: Persona) => void;
  onCancel: () => void;
}

export function PersonaForm({ persona, onSaved, onCancel }: PersonaFormProps) {
  const { register, handleSubmit, setError, formState } = useForm<PersonaFormValues>({
    resolver: zodResolver(PersonaFormSchema),
    mode: 'onBlur',
    defaultValues: toFormValues(persona),
  });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const body = toBody(values);
      const saved = persona
        ? await personaActions.update(persona.id, body)
        : await personaActions.create(body);
      onSaved(saved);
    } catch (err) {
      // El envelope `{code, message, details}` decide la reacción (forms.md §3): un
      // `validation_error` se ancla al campo (p. ej. `name` cuando el nombre ya existe).
      if (err instanceof ApiError) {
        applyEnvelopeToForm(err, setError);
        return;
      }
      throw err;
    }
  });

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <Field id="persona-name" label="Nombre" error={errors.name?.message}>
        <Input id="persona-name" error={!!errors.name} {...register('name')} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field
          id="persona-age"
          label="Rango de edad"
          hint="Formato 25-34"
          error={errors.ageRange?.message}
        >
          <Input id="persona-age" mono error={!!errors.ageRange} {...register('ageRange')} />
        </Field>

        <Field id="persona-gender" label="Género" error={errors.gender?.message}>
          <Select id="persona-gender" error={!!errors.gender} {...register('gender')}>
            <option value="female">Femenino</option>
            <option value="male">Masculino</option>
            <option value="non_binary">No binario</option>
          </Select>
        </Field>

        <Field id="persona-ethnicity" label="Etnia" error={errors.ethnicity?.message}>
          <Input id="persona-ethnicity" error={!!errors.ethnicity} {...register('ethnicity')} />
        </Field>

        <Field id="persona-style" label="Estilo" error={errors.style?.message}>
          <Input id="persona-style" error={!!errors.style} {...register('style')} />
        </Field>
      </div>

      <Field
        id="persona-descriptor"
        label="Descriptor"
        hint="La línea que va al casting del prompt: «mujer de 29 años, latina, look casual»"
        error={errors.descriptor?.message}
      >
        <Input id="persona-descriptor" error={!!errors.descriptor} {...register('descriptor')} />
      </Field>

      <Field
        id="persona-setting"
        label="Escenario"
        hint="El escenario cotidiano por defecto, con 2–3 anclas"
        error={errors.setting?.message}
      >
        <Input id="persona-setting" error={!!errors.setting} {...register('setting')} />
      </Field>

      <Field
        id="persona-personality"
        label="Personalidad"
        hint="Se inyecta en el casting del prompt"
        error={errors.personality?.message}
      >
        <Textarea
          id="persona-personality"
          rows={4}
          error={!!errors.personality}
          {...register('personality')}
        />
      </Field>

      <Field
        id="persona-wardrobe"
        label="Notas de vestuario"
        hint="Continuidad entre CUTs (opcional)"
        error={errors.wardrobeNotes?.message}
      >
        <Textarea
          id="persona-wardrobe"
          rows={2}
          error={!!errors.wardrobeNotes}
          {...register('wardrobeNotes')}
        />
      </Field>

      <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4">
        <legend className="px-1 text-small font-semibold text-text-2">Voz por idioma</legend>
        {VOICE_LOCALES.map(({ locale, label }) => (
          <div key={locale} className="grid grid-cols-2 gap-3">
            <Field id={`voice-${locale}-provider`} label={`Proveedor · ${label}`}>
              <Select id={`voice-${locale}-provider`} {...register(`voices.${locale}.provider`)}>
                {Object.entries(VOICE_PROVIDER_LABEL).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              id={`voice-${locale}-id`}
              label={`Voice ID · ${label}`}
              error={errors.voices?.[locale]?.voiceId?.message}
            >
              <Input id={`voice-${locale}-id`} mono {...register(`voices.${locale}.voiceId`)} />
            </Field>
          </div>
        ))}
      </fieldset>

      {errors.root?.server && (
        // Errores que no son de un campo (p. ej. un 500): recuperable, no atascado. El
        // `role="alert"` no se pasa: la primitiva ya lo pone sola para `danger`.
        <Alert tone="danger">{errors.root.server.message}</Alert>
      )}

      <div className="mt-1 flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {/* El nombre accesible CAMBIA con el estado de envío: es lo que el E2E espera. */}
          {isSubmitting ? 'Guardando…' : persona ? 'Guardar cambios' : 'Crear persona'}
        </Button>
      </div>
    </form>
  );
}

/** Campo con label asociada, pista y error en `role="alert"` (a11y = API de test, principio 4
 *  de la skill frontend: los tests consultan por rol + accessible name). */
function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-small font-medium text-text-2">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-micro text-text-3">{hint}</p>}
      {error && (
        <p role="alert" className="text-micro text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
