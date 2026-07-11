'use client';

// Formulario de intake modo TEXTO LIBRE (T1.6, forms.md §2). RHF + zodResolver con
// el MISMO `ManualIntakeConfigSchema` de core que re-valida el route handler — un
// solo "válido", cero drift. Submit por `api.post` a `/api/analyses` (short-circuit
// manual, con su caché §7.4: un 2.º submit del mismo texto reutiliza el MISMO
// análisis).
//
// T1.10a: tras crear el análisis, ARRANCA el DAG (N1→N2→N3) sobre él y navega al
// CANVAS `/runs/:id` (antes terminaba en `/analyses/:id`, una fila sin pipeline). El
// brief lo produce ahora N3, igual que en el modo URL — y es lo que hace observable en
// el grafo que N2 quede `saltado` cuando no hay imágenes (PRD §7.2). Los CAMPOS del
// formulario no cambian: lo que cambia es a dónde lleva el submit.
//
// El upload de imágenes es opcional: cada fichero se sube a `/api/assets` (mutación
// REST, forms.md §112) y su URL de descarga se guarda como ref en `imageRefs`. La
// validación de mime/tamaño la impone el endpoint; el nº máximo lo impone el schema.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ManualIntakeConfigSchema,
  MANUAL_IMAGE_REFS_MAX,
  type IntakeImageRef,
} from '@ugc/core/contracts';
import { analysisRunDefinition } from '@ugc/core/orchestrator';
import { api, ApiError, runActions } from '@/lib/api-client';
import { applyEnvelopeToForm } from '@/lib/form-errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// Respuesta de `/api/analyses` (id del análisis + estado); el cliente valida lo que
// consume (el id para navegar).
const AnalysisResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  source: z.string(),
  reused: z.boolean(),
});

const UploadResponseSchema = z.object({ id: z.string(), url: z.string() });

interface IntakeFormProps {
  /** Proyecto al que cuelga el análisis (FK NOT NULL en url_analysis). */
  projectId: string;
}

// El tipo de los valores del form es el INPUT del schema (imageRefs opcional por su
// `.default([])`); la salida ya resuelta la usa el resolver al validar. Fijar ambos
// evita el mismatch input/output de zodResolver (RHF v5).
type IntakeFormValues = z.input<typeof ManualIntakeConfigSchema>;
type IntakeFormOutput = z.output<typeof ManualIntakeConfigSchema>;

export function IntakeForm({ projectId }: IntakeFormProps) {
  const router = useRouter();
  const { register, handleSubmit, setError, setValue, watch, formState } = useForm<
    IntakeFormValues,
    unknown,
    IntakeFormOutput
  >({
    resolver: zodResolver(ManualIntakeConfigSchema),
    mode: 'onBlur',
    defaultValues: { source: 'manual', projectId, freeText: '', imageRefs: [] },
  });
  const { errors, isSubmitting } = formState;

  const imageRefs: IntakeImageRef[] = watch('imageRefs') ?? [];
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function onFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    const next: IntakeImageRef[] = [...imageRefs];
    try {
      for (const file of Array.from(files)) {
        if (next.length >= MANUAL_IMAGE_REFS_MAX) {
          setUploadError(`Máximo ${String(MANUAL_IMAGE_REFS_MAX)} imágenes`);
          break;
        }
        const form = new FormData();
        form.append('file', file);
        try {
          const res = await api.postForm('/api/assets', UploadResponseSchema, form);
          next.push({ url: res.url, alt: file.name });
        } catch (e) {
          if (e instanceof ApiError) {
            setUploadError(e.message);
          } else {
            throw e;
          }
        }
      }
      setValue('imageRefs', next, { shouldValidate: true });
    } finally {
      setUploading(false);
    }
  }

  function removeImage(index: number) {
    setValue(
      'imageRefs',
      imageRefs.filter((_ref, i) => i !== index),
      { shouldValidate: true },
    );
  }

  const onSubmit = handleSubmit(async (config) => {
    try {
      // 1) El análisis manual: short-circuit texto→RawContent + caché §7.4. SIN cambios
      //    respecto a T1.6 (mismo endpoint, misma respuesta): en un 2.º submit del mismo
      //    texto devuelve el MISMO id (reutilización de caché).
      const analysis = await api.post('/api/analyses', AnalysisResponseSchema, config);

      // 2) T1.10a: el texto libre ARRANCA TAMBIÉN el DAG de análisis (N1→N2→N3) sobre el
      //    análisis recién creado, y navega al CANVAS. Antes (T1.6) el intake manual
      //    terminaba aquí, en una fila `done` sin pipeline; ahora el brief (N3) lo produce
      //    el pipeline igual que en el modo URL — y es lo que permite ver a N2 `saltado` en
      //    el grafo cuando no se han subido imágenes (PRD §7.2). N1 no scrapea en este
      //    modo: solo carga el análisis por id.
      const definition = analysisRunDefinition(config.projectId, {
        source: 'manual',
        analysisId: analysis.id,
      });
      const run = await runActions.createRun(definition);
      router.push(`/runs/${run.runId}`);
    } catch (e) {
      if (e instanceof ApiError) {
        applyEnvelopeToForm(e, setError);
        return;
      }
      throw e; // red caída u otro error no-API: lo captura el error boundary
    }
  });

  return (
    <form
      onSubmit={(e) => {
        void onSubmit(e);
      }}
      noValidate
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-1.75">
        <label htmlFor="intake-text" className="text-small font-medium text-text-2">
          Descripción del producto
        </label>
        <Textarea
          id="intake-text"
          rows={8}
          placeholder="Describe el producto: qué es, para quién, beneficios, tono de marca…"
          aria-invalid={errors.freeText ? true : undefined}
          aria-describedby={errors.freeText ? 'intake-text-error' : undefined}
          error={errors.freeText ? true : undefined}
          {...register('freeText')}
        />
        {errors.freeText && (
          <p id="intake-text-error" role="alert" className="text-small text-danger">
            {errors.freeText.message}
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-1 text-small font-medium text-text-2">
          Imágenes de referencia (opcional)
        </legend>
        <label htmlFor="intake-images" className="text-small font-medium text-text-3">
          Añadir imágenes
        </label>
        <input
          id="intake-images"
          type="file"
          accept="image/*"
          multiple
          disabled={uploading || imageRefs.length >= MANUAL_IMAGE_REFS_MAX}
          onChange={(e) => {
            void onFilesSelected(e.target.files);
            e.target.value = '';
          }}
          className="text-small text-text-2 file:mr-3 file:rounded-sm file:border file:border-border-2 file:bg-surface-3 file:px-3 file:py-1.5 file:text-small file:text-text"
        />

        {uploadError !== null && <Alert tone="danger">{uploadError}</Alert>}

        {imageRefs.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {imageRefs.map((ref, i) => (
              <li
                key={ref.url}
                className="flex items-center justify-between rounded-sm border border-border-2 bg-surface-2 px-3 py-1.5"
              >
                <span className="truncate font-mono text-small text-text-2">
                  {ref.alt ?? ref.url}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    removeImage(i);
                  }}
                  aria-label={`Quitar ${ref.alt ?? ref.url}`}
                >
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        )}
        {errors.imageRefs && (
          <p role="alert" className="text-small text-danger">
            {errors.imageRefs.message}
          </p>
        )}
      </fieldset>

      {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}

      <div>
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={isSubmitting}
          disabled={uploading}
        >
          {isSubmitting ? 'Analizando…' : 'Analizar'}
        </Button>
      </div>
    </form>
  );
}
