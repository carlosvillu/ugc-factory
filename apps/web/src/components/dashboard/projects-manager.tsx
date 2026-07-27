'use client';

// El índice de proyectos `/projects` con su CRUD MÍNIMO (T5.10, §8.1: crear, editar,
// archivar). El mockup 2a no dibuja esta lista (dibuja el dashboard); se construye sobria
// con primitivas del DS (skill frontend §1: usar el componente del DS es OBLIGATORIO) sin
// inventar tokens.
//
// ESTADO: `useState` del cliente, NO Zustand (mismo criterio que `personas-library`): aquí
// no hay nada VIVO por SSE — es una lista que se lee una vez y se muta por REST. Toda
// mutación pasa por `projectActions` (API REST), nunca por la BD directa.
//
// ARCHIVAR es el "delete" de CRUD mínimo: retira sin borrar (un DELETE físico cascadearía
// análisis/briefs/lotes/variantes reales). Los archivados se ocultan de la lista activa.
import { useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateProjectSchema, type CreateProject, type ProjectSummary } from '@ugc/core/contracts';
import { projectActions, ApiError } from '@/lib/api-client';
import { applyEnvelopeToForm } from '@/lib/form-errors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; project: ProjectSummary }
  | { kind: 'archive'; project: ProjectSummary };

export function ProjectsManager({ initialProjects }: { initialProjects: ProjectSummary[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  // Estado de la acción de archivar: en curso (deshabilita el botón) y mensaje de error a
  // superficie DENTRO del diálogo. Sin esto, un PATCH que falle (404 ya-archivado, 500) sería
  // una promesa rechazada silenciada (regla 5a: un fallo que se traga NO se difiere).
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // Solo los activos en la lista principal; los archivados se retiran de la vista.
  const active = projects.filter((p) => p.status === 'active');

  function upsert(saved: ProjectSummary): void {
    setProjects((current) => {
      const without = current.filter((p) => p.id !== saved.id);
      return [saved, ...without];
    });
    setDialog({ kind: 'none' });
  }

  function openArchive(project: ProjectSummary): void {
    setArchiveError(null);
    setDialog({ kind: 'archive', project });
  }

  function closeDialog(): void {
    setArchiveError(null);
    setDialog({ kind: 'none' });
  }

  async function confirmArchive(project: ProjectSummary): Promise<void> {
    setArchiving(true);
    setArchiveError(null);
    try {
      const archived = await projectActions.archive(project.id);
      // La respuesta es un `Project` (sin recuentos); se conserva el resumen y se marca
      // archivado para que el filtro lo retire de la lista.
      setProjects((current) =>
        current.map((p) => (p.id === project.id ? { ...p, status: archived.status } : p)),
      );
      setDialog({ kind: 'none' });
    } catch (err) {
      // Error ESPERADO de la API (404 ya archivado, 409, 500 con envelope): se superficie al
      // usuario en el diálogo y NO se cierra (no ha archivado; que lo vea y reintente/cancele).
      if (err instanceof ApiError) {
        setArchiveError(err.message);
        return;
      }
      // Inesperado (red, parseo): re-lanzar para que suba al error boundary y a los logs — no
      // se traga.
      throw err;
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {active.length === 0 ? (
        <EmptyState
          title="Aún no hay proyectos"
          description="Un proyecto agrupa los briefs, lotes y variantes de un producto o campaña."
          actionLabel="Nuevo proyecto"
          onAction={() => {
            setDialog({ kind: 'create' });
          }}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            <p className="text-mono text-text-3">
              {active.length} {active.length === 1 ? 'proyecto' : 'proyectos'}
            </p>
            <Button
              onClick={() => {
                setDialog({ kind: 'create' });
              }}
            >
              + Nuevo proyecto
            </Button>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {active.map((project) => (
              <li key={project.id}>
                <Card data-testid={`project-card-${project.id}`}>
                  <CardBody className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-body font-semibold text-text hover:text-accent focus-visible:text-accent focus-visible:outline-none"
                      >
                        {project.name}
                      </Link>
                      {project.activeBatchCount > 0 ? (
                        <Badge tone="info" dot mono>
                          {project.activeBatchCount} activo
                          {project.activeBatchCount === 1 ? '' : 's'}
                        </Badge>
                      ) : null}
                    </div>
                    <span className="font-mono text-small text-text-3">
                      {project.batchCount} {project.batchCount === 1 ? 'lote' : 'lotes'} ·{' '}
                      {project.defaultLocale}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setDialog({ kind: 'edit', project });
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          openArchive(project);
                        }}
                      >
                        Archivar
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog
        open={dialog.kind === 'create' || dialog.kind === 'edit'}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'none' });
        }}
      >
        <DialogPopup>
          <DialogTitle>{dialog.kind === 'edit' ? 'Editar proyecto' : 'Nuevo proyecto'}</DialogTitle>
          {dialog.kind === 'create' || dialog.kind === 'edit' ? (
            <ProjectForm
              project={dialog.kind === 'edit' ? dialog.project : undefined}
              onSaved={upsert}
              onCancel={() => {
                setDialog({ kind: 'none' });
              }}
            />
          ) : null}
        </DialogPopup>
      </Dialog>

      <AlertDialog
        open={dialog.kind === 'archive'}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <AlertDialogPopup>
          <AlertDialogTitle>Archivar proyecto</AlertDialogTitle>
          <AlertDialogDescription>
            {dialog.kind === 'archive'
              ? `«${dialog.project.name}» se retirará de la lista. Sus lotes y variantes no se borran.`
              : ''}
          </AlertDialogDescription>
          {archiveError ? (
            <Alert tone="danger" className="mt-3">
              {archiveError}
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost">Cancelar</Button>} />
            <Button
              variant="danger"
              loading={archiving}
              onClick={() => {
                if (dialog.kind === 'archive') void confirmArchive(dialog.project);
              }}
            >
              Archivar
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

/** Valores del formulario: el subconjunto editable en CRUD mínimo (nombre + notas). Se
 *  valida con el MISMO schema de core que el endpoint (`CreateProjectSchema`) — react-hook-form
 *  + zodResolver, el patrón único de formularios (skill frontend §6). Las notas vacías se
 *  normalizan a null al enviar. */
const ProjectFormSchema = CreateProjectSchema.omit({ defaultLocale: true });
type ProjectFormValues = z.infer<typeof ProjectFormSchema>;

/** El formulario de crear/editar un proyecto. Un error de validación del servidor se
 *  reparte a su campo (o al banner) vía `applyEnvelopeToForm` (forms.md §3). */
function ProjectForm({
  project,
  onSaved,
  onCancel,
}: {
  project?: ProjectSummary;
  onSaved: (saved: ProjectSummary) => void;
  onCancel: () => void;
}) {
  const { register, handleSubmit, setError, formState } = useForm<ProjectFormValues>({
    resolver: zodResolver(ProjectFormSchema),
    mode: 'onBlur',
    defaultValues: { name: project?.name ?? '', notes: project?.notes ?? '' },
  });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    // Notas vacías → null: una cadena en blanco es "sin notas", no un valor a persistir.
    const trimmedNotes = values.notes?.trim();
    const notes = trimmedNotes && trimmedNotes.length > 0 ? trimmedNotes : null;
    const payload: CreateProject = { name: values.name, notes };
    try {
      if (project) {
        const updated = await projectActions.update(project.id, payload);
        // La respuesta es un `Project`; se conservan los recuentos del resumen previo.
        onSaved({ ...project, ...updated });
      } else {
        const created = await projectActions.create(payload);
        onSaved({ ...created, batchCount: 0, activeBatchCount: 0 });
      }
    } catch (err) {
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
      className="mt-4 flex flex-col gap-4"
    >
      <label htmlFor="project-name" className="flex flex-col gap-1.5">
        <span className="text-small font-medium text-text-2">Nombre</span>
        <Input
          id="project-name"
          error={!!errors.name}
          placeholder="Nombre del producto o campaña"
          autoFocus
          {...register('name')}
        />
        {errors.name ? (
          <span role="alert" className="text-small text-danger">
            {errors.name.message}
          </span>
        ) : null}
      </label>
      <label htmlFor="project-notes" className="flex flex-col gap-1.5">
        <span className="text-small font-medium text-text-2">Notas (opcional)</span>
        <Textarea id="project-notes" rows={3} {...register('notes')} />
      </label>
      {errors.root ? (
        <div role="alert" className="text-small text-danger">
          {errors.root.message}
        </div>
      ) : null}
      <DialogFooter>
        <DialogClose
          render={
            <Button variant="ghost" type="button" onClick={onCancel}>
              Cancelar
            </Button>
          }
        />
        <Button type="submit" loading={isSubmitting}>
          {project ? 'Guardar' : 'Crear proyecto'}
        </Button>
      </DialogFooter>
    </form>
  );
}
