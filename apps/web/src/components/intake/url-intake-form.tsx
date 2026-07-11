'use client';

// Formulario de intake modo URL (T1.10a, N0 — forms.md §2). Es el camino PRINCIPAL del
// producto: pegar la URL de un producto y ver el análisis correr.
//
// A diferencia del modo texto libre (T1.6), el submit NO crea el `url_analysis`: el
// scraping es TRABAJO del pipeline (nodo N1), así que este form arranca el RUN
// (`POST /api/runs` con la definición del DAG N1→N2→N3) y navega al canvas en vivo
// `/runs/:id`, donde el usuario ve progresar los nodos.
//
// RHF + zodResolver con el MISMO `UrlIntakeConfigSchema` de core que valida el cliente
// (aquí) — un solo "válido", cero drift.
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { UrlIntakeConfigSchema } from '@ugc/core/contracts';
import { analysisRunDefinition } from '@ugc/core/orchestrator';
import { ApiError, runActions } from '@/lib/api-client';
import { applyEnvelopeToForm } from '@/lib/form-errors';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface UrlIntakeFormProps {
  /** Proyecto al que cuelga el análisis (FK NOT NULL en url_analysis). */
  projectId: string;
}

// Input/output del schema fijados por separado: `targetLanguage` tiene `.default('es')`,
// así que en el INPUT es opcional y en el OUTPUT ya está resuelto (evita el mismatch de
// zodResolver, mismo criterio que el form de texto libre).
type UrlIntakeValues = z.input<typeof UrlIntakeConfigSchema>;
type UrlIntakeOutput = z.output<typeof UrlIntakeConfigSchema>;

export function UrlIntakeForm({ projectId }: UrlIntakeFormProps) {
  const router = useRouter();
  const { register, handleSubmit, setError, formState } = useForm<
    UrlIntakeValues,
    unknown,
    UrlIntakeOutput
  >({
    resolver: zodResolver(UrlIntakeConfigSchema),
    mode: 'onBlur',
    defaultValues: { source: 'url', projectId, url: '', targetLanguage: 'es' },
  });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (config) => {
    try {
      // El DAG del análisis (N1→N2→N3) se construye en core y se crea vía la ruta
      // GENÉRICA de runs (T0.7b): createRun inserta run+steps y encola los roots en la
      // MISMA tx. No hace falta un endpoint propio del análisis.
      const definition = analysisRunDefinition(config.projectId, {
        source: 'url',
        url: config.url,
        targetLanguage: config.targetLanguage,
      });
      const run = await runActions.createRun(definition);
      // Al canvas EN VIVO: es donde se ve progresar N1→N2→N3 (y donde N2 aparecerá
      // `saltado` si la página no trae imágenes).
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
        <label htmlFor="intake-url" className="text-small font-medium text-text-2">
          URL del producto
        </label>
        <Input
          id="intake-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://tienda.com/products/mi-producto"
          aria-invalid={errors.url ? true : undefined}
          aria-describedby={errors.url ? 'intake-url-error' : 'intake-url-hint'}
          error={errors.url ? true : undefined}
          {...register('url')}
        />
        {errors.url ? (
          <p id="intake-url-error" role="alert" className="text-small text-danger">
            {errors.url.message}
          </p>
        ) : (
          <p id="intake-url-hint" className="text-small text-text-3">
            Se extraerá el contenido de la página (texto, imágenes y captura) para construir el
            brief.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.75">
        <label htmlFor="intake-language" className="text-small font-medium text-text-2">
          Idioma del análisis
        </label>
        <Select id="intake-language" {...register('targetLanguage')}>
          <option value="es">Español</option>
          <option value="en">Inglés</option>
        </Select>
      </div>

      {errors.root?.server && <Alert tone="danger">{errors.root.server.message}</Alert>}

      <div>
        <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
          {isSubmitting ? 'Analizando…' : 'Analizar'}
        </Button>
      </div>
    </form>
  );
}
