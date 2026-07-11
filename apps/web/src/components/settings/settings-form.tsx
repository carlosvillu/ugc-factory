'use client';

// Formulario de credenciales + preferencias de /settings (T0.14). Patrón único de
// forms.md §1: RHF + zodResolver con el MISMO contrato de core que re-valida el handler
// (SettingsPatchSchema), submit vía api-client (PATCH /api/settings), estado de envío de
// RHF, mode 'onBlur', noValidate.
//
// SEGURIDAD (forms.md §6): las API keys son WRITE-ONLY. El GET nunca devuelve la key en
// claro; aquí solo mostramos el estado enmascarado (`set` + `last4`) como placeholder, el
// input arranca VACÍO y el PATCH solo incluye la key si el usuario escribió una nueva
// (enviar el placeholder machacaría la real). type="password" + autoComplete="new-password"
// suprimen el autocompletado del gestor. Tras guardar: role="status" y los inputs vuelven
// a vacío + placeholder enmascarado (jamás eco del valor guardado).
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  SecretProviderSchema,
  SettingsViewSchema,
  ExperimentThresholdsSchema,
  SECRET_PROVIDERS,
  type SettingsView,
  type SettingsPatch,
  type SecretProvider,
} from '@ugc/core/contracts';
import { api, ApiError } from '@/lib/api-client';
import { applyEnvelopeToForm } from '@/lib/form-errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';

// Nombres legibles por proveedor (el enum es técnico; la UI muestra la marca).
const PROVIDER_LABEL: Record<SecretProvider, string> = {
  fal: 'fal.ai',
  anthropic: 'Anthropic',
  firecrawl: 'Firecrawl',
};

// Schema del FORM (no del PATCH): TODOS los campos son lo que el textbox produce (texto),
// no la forma final de core. Esto evita el `setValueAs` (que NO transforma defaultValues
// ni reset — RHF docs: solo la ruta de change), así que defaultValues y reset trabajan
// siempre con strings coherentes con lo que el input muestra. El mapeo a la forma de core
// (split de idiomas, omitir keys vacías) se hace EN el submit.
const SecretsFormSchema = z.record(
  SecretProviderSchema,
  // Una key puede estar vacía (no cambiar); si trae valor, el submit aplica las reglas del
  // PATCH. Permitimos '' aquí para no gritar en blur sobre un campo vacío.
  z.string(),
);
// Idiomas como TEXTO ("es, en"); se valida (≥1 código BCP-47) y se parte a array en el
// submit. La validación de forma vive en el refine de abajo para dar un mensaje útil.
const LANGUAGES_RE = /^[a-z]{2}(-[A-Z]{2})?$/;
function parseLanguages(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
const SettingsFormSchema = z.object({
  secrets: SecretsFormSchema,
  preferences: z.object({
    defaultLanguages: z.string().refine((text) => {
      const langs = parseLanguages(text);
      return langs.length > 0 && langs.every((l) => LANGUAGES_RE.test(l));
    }, 'Introduce al menos un código de idioma válido (ej. es, en, pt-BR)'),
    durationPreset: z.enum(['short', 'standard', 'long']),
    thresholds: ExperimentThresholdsSchema,
  }),
});
type SettingsFormValues = z.infer<typeof SettingsFormSchema>;

/**
 * Deriva los valores del form desde una vista de settings. Los inputs de key arrancan
 * SIEMPRE vacíos (write-only: el placeholder muestra el estado, jamás se hace eco del
 * valor); los idiomas se serializan a TEXTO ("es, en") porque el input es de texto y el
 * split a array ocurre en el submit. Único origen del mapeo view→form: lo usan tanto
 * `defaultValues` (carga inicial) como el `reset` post-guardado, así no divergen.
 */
function formValuesFromView(view: SettingsView): SettingsFormValues {
  return {
    secrets: Object.fromEntries(SECRET_PROVIDERS.map((p) => [p, ''])) as Record<
      SecretProvider,
      string
    >,
    preferences: {
      defaultLanguages: view.preferences.defaultLanguages.join(', '),
      durationPreset: view.preferences.durationPreset,
      thresholds: view.preferences.thresholds,
    },
  };
}

function maskedPlaceholder(masked: SettingsView['secrets'][SecretProvider]): string {
  if (!masked?.set) return 'sin configurar';
  return masked.last4 ? `••••••••${masked.last4}` : '•••••••• (configurada)';
}

export function SettingsForm({ initialView }: { initialView: SettingsView }) {
  // Confirmación de guardado EXPLÍCITA (no `isSubmitSuccessful`): un submit que falla con
  // un `validation_error` de CAMPO se resuelve normal (el catch hace setError en el/los
  // campos, no en root.server) → RHF marcaría isSubmitSuccessful=true y el banner verde
  // se renderizaría A LA VEZ que el error de campo rojo. `saved` solo es true en la rama
  // de éxito real, así que es inmune a cualquier error (root o de campo).
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(SettingsFormSchema),
    mode: 'onBlur',
    defaultValues: formValuesFromView(initialView),
  });

  const onSubmit = handleSubmit(async (values) => {
    setSaved(false); // limpia una confirmación previa antes de intentar de nuevo
    // Mapea el form → PATCH: solo las keys NO vacías (tras trim) viajan; las preferencias
    // siempre. Así el PATCH nunca incluye una key vacía (que machacaría la real).
    const secrets: NonNullable<SettingsPatch['secrets']> = {};
    for (const provider of SECRET_PROVIDERS) {
      const raw = values.secrets[provider].trim();
      if (raw) secrets[provider] = raw;
    }
    const patch: SettingsPatch = {
      // Mapea el form (texto) → la forma de core: parte los idiomas a array. El resto ya
      // tiene la forma correcta. El handler re-valida con SettingsPreferencesSchema.
      preferences: {
        defaultLanguages: parseLanguages(values.preferences.defaultLanguages),
        durationPreset: values.preferences.durationPreset,
        thresholds: values.preferences.thresholds,
      },
      ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
    };
    try {
      const view = await api.patch('/api/settings', SettingsViewSchema, patch);
      // Tras guardar: inputs de key de vuelta a vacío + placeholder enmascarado nuevo
      // (jamás eco del valor). Las preferencias reflejan lo persistido. Mismo mapeo
      // view→form que la carga inicial (idiomas como TEXTO, no el array crudo, que
      // rompería el display al re-hidratar el campo).
      reset(formValuesFromView(view));
      setSaved(true); // confirmación SOLO en la rama de éxito real
    } catch (e) {
      if (e instanceof ApiError) {
        applyEnvelopeToForm(e, setError);
        return;
      }
      throw e;
    }
  });

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      noValidate
      className="flex flex-col gap-8"
    >
      {/* ── Credenciales (write-only, enmascaradas) ─────────────────────────── */}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-h3 font-semibold text-text">Credenciales de API</legend>
        <p className="max-w-2xl text-small text-text-3">
          Se guardan cifradas en el servidor. Nunca se muestran en claro: el campo queda vacío y
          solo verás los últimos 4 caracteres de la clave guardada. Escribe una clave nueva solo si
          quieres reemplazarla.
        </p>
        {SECRET_PROVIDERS.map((provider) => {
          const inputId = `secret-${provider}`;
          return (
            <div key={provider} className="flex flex-col gap-1.5">
              <label htmlFor={inputId} className="text-small font-medium text-text-2">
                {PROVIDER_LABEL[provider]}
              </label>
              <Input
                id={inputId}
                mono
                type="password"
                autoComplete="new-password"
                placeholder={maskedPlaceholder(initialView.secrets[provider])}
                {...register(`secrets.${provider}` as const)}
              />
            </div>
          );
        })}
      </fieldset>

      {/* ── Preferencias ────────────────────────────────────────────────────── */}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-h3 font-semibold text-text">Preferencias por defecto</legend>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="pref-languages" className="text-small font-medium text-text-2">
            Idiomas por defecto (códigos separados por coma, ej. es, en)
          </label>
          {/* Campo de TEXTO: el valor se mantiene como string en el form (defaultValues +
              reset lo controlan); el split a array se hace en el submit. Sin setValueAs
              (que no toca defaultValues/reset) ni defaultValue (lo gobierna defaultValues). */}
          <Input
            id="pref-languages"
            mono
            aria-invalid={errors.preferences?.defaultLanguages ? true : undefined}
            {...register('preferences.defaultLanguages')}
          />
          {errors.preferences?.defaultLanguages && (
            <p role="alert" className="text-small text-danger">
              {errors.preferences.defaultLanguages.message ?? 'Idiomas inválidos'}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="pref-duration" className="text-small font-medium text-text-2">
            Preset de duración
          </label>
          <Select
            id="pref-duration"
            className="max-w-xs"
            {...register('preferences.durationPreset')}
          >
            <option value="short">short</option>
            <option value="standard">standard</option>
            <option value="long">long</option>
          </Select>
        </div>

        <div className="flex flex-wrap gap-6">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pref-kill" className="text-small font-medium text-text-2">
              Umbral kill (hook-rate, 0–1)
            </label>
            <Input
              id="pref-kill"
              mono
              type="number"
              step="0.01"
              min="0"
              max="1"
              className="max-w-40"
              aria-invalid={errors.preferences?.thresholds?.killHookRate ? true : undefined}
              {...register('preferences.thresholds.killHookRate', { valueAsNumber: true })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="pref-scale" className="text-small font-medium text-text-2">
              Umbral scale (hook-rate, 0–1)
            </label>
            <Input
              id="pref-scale"
              mono
              type="number"
              step="0.01"
              min="0"
              max="1"
              className="max-w-40"
              aria-invalid={errors.preferences?.thresholds?.scaleHookRate ? true : undefined}
              {...register('preferences.thresholds.scaleHookRate', { valueAsNumber: true })}
            />
          </div>
        </div>
      </fieldset>

      {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}

      {saved && (
        <p role="status" className="text-small text-success">
          Ajustes guardados.
        </p>
      )}

      <div>
        <Button type="submit" variant="primary" loading={isSubmitting}>
          {isSubmitting ? 'Guardando…' : 'Guardar ajustes'}
        </Button>
      </div>
    </form>
  );
}
