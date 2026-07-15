'use client';

// Formulario de «+ Nuevo template» (T3.8): los campos mínimos de la anatomía §10.1 para nacer un
// template en `draft`. react-hook-form + zodResolver (forms.md, principio 6), con un schema de
// formulario propio (los campos que el usuario teclea) que se mapea al `PromptTemplateSeed` del
// contrato al enviar.
//
// La validación de slots del body es EN VIVO (pura, `invalidBodySlots`): igual que en el editor,
// guardar queda deshabilitado si el body usa un slot no canónico §10.4.
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { invalidBodySlots, type TemplateSummary } from '@ugc/core/gallery';
import { ApiError, templateActions } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const NewTemplateFormSchema = z.object({
  slug: z
    .string()
    .min(1, 'El slug es obligatorio')
    .regex(/^[a-z0-9-]+$/, 'Solo minúsculas, números y guiones'),
  title: z.string().min(1, 'El título es obligatorio'),
  kind: z.enum(['video', 'image', 'script', 'voiceover']),
  language: z.enum(['es', 'en']),
  body: z.string().min(1, 'El cuerpo es obligatorio'),
});
type NewTemplateFormValues = z.infer<typeof NewTemplateFormSchema>;

interface NewTemplateFormProps {
  onCreated: (summary: TemplateSummary) => void;
}

export function NewTemplateForm({ onCreated }: NewTemplateFormProps) {
  const { register, handleSubmit, setError, watch, formState } = useForm<NewTemplateFormValues>({
    resolver: zodResolver(NewTemplateFormSchema),
    defaultValues: { kind: 'video', language: 'es', body: '' },
  });
  const { errors, isSubmitting } = formState;

  const body = watch('body');
  const invalid = invalidBodySlots(body);
  const hasInvalid = invalid.length > 0;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const created = await templateActions.create({
        slug: values.slug,
        title: values.title,
        kind: values.kind,
        body: values.body,
        language: values.language,
      });
      onCreated(created);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'validation_error') {
        const details = err.details as { fieldErrors?: { slug?: string[] } } | undefined;
        if (details?.fieldErrors?.slug) {
          setError('slug', { message: details.fieldErrors.slug[0] });
          return;
        }
      }
      setError('root', { message: 'No se pudo crear el template' });
    }
  });

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tpl-slug" className="text-body-sm font-medium text-text-2">
          Slug
        </label>
        <Input id="tpl-slug" mono error={!!errors.slug} {...register('slug')} />
        {errors.slug ? (
          <p role="alert" className="text-micro text-danger">
            {errors.slug.message}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tpl-title" className="text-body-sm font-medium text-text-2">
          Título
        </label>
        <Input id="tpl-title" error={!!errors.title} {...register('title')} />
        {errors.title ? (
          <p role="alert" className="text-micro text-danger">
            {errors.title.message}
          </p>
        ) : null}
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="tpl-kind" className="text-body-sm font-medium text-text-2">
            Tipo
          </label>
          <Select id="tpl-kind" {...register('kind')}>
            <option value="video">video</option>
            <option value="image">image</option>
            <option value="script">script</option>
            <option value="voiceover">voiceover</option>
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="tpl-language" className="text-body-sm font-medium text-text-2">
            Idioma
          </label>
          <Select id="tpl-language" {...register('language')}>
            <option value="es">es</option>
            <option value="en">en</option>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="tpl-body" className="text-body-sm font-medium text-text-2">
          Cuerpo del prompt
        </label>
        <Textarea
          id="tpl-body"
          rows={6}
          error={!!errors.body || hasInvalid}
          className="font-mono text-body-sm"
          {...register('body')}
        />
        {hasInvalid ? (
          <p role="alert" className="text-micro text-danger">
            Slots inválidos (no §10.4): {invalid.map((s) => `{${s}}`).join(', ')}
          </p>
        ) : errors.body ? (
          <p role="alert" className="text-micro text-danger">
            {errors.body.message}
          </p>
        ) : (
          <p className="text-micro text-text-3">
            Usa slots canónicos §10.4, p. ej. {'{product.name}'}.
          </p>
        )}
      </div>

      {errors.root ? (
        <p role="alert" className="text-body-sm text-danger">
          {errors.root.message}
        </p>
      ) : null}

      <Button type="submit" size="sm" disabled={hasInvalid || isSubmitting}>
        Crear template
      </Button>
    </form>
  );
}
