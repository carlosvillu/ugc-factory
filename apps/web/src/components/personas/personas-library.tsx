'use client';

// La LIBRERÍA de personas: la lista + la ficha inmersiva del mockup 6c + el CRUD.
//
// El mockup 6c dibuja SOLO la ficha (una persona abierta). La lista y el formulario no están en
// él, así que se construyen sobrios con primitivas del DS (skill frontend §1: usar el componente
// del DS es OBLIGATORIO; HTML crudo estilado equivalente es un error de review) y sin inventar
// tokens. Lo que el mockup SÍ manda —la ficha— se respeta al detalle en `persona-detail.tsx`.
//
// ESTADO: `useState` del cliente, NO Zustand. La regla de la skill (principio 5) es que el
// estado EN VIVO (el que llega por SSE) tiene un dueño único, el store del run. Aquí no hay nada
// vivo: la librería es una lista que se lee una vez y se muta por REST. Un store aquí sería
// ceremonia sin cliente.
import { useState } from 'react';
import type { Persona } from '@ugc/core/persona';
import { personaActions } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogPopup, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { PersonaDetail } from '@/components/personas/persona-detail';
import { PersonaForm } from '@/components/personas/persona-form';

interface PersonasLibraryProps {
  /** La librería que el RSC leyó de la API. El cliente la posee a partir de aquí. */
  initialPersonas: Persona[];
}

/** Qué diálogo está abierto. Un solo estado (y no dos booleanos) para que sea IMPOSIBLE tener el
 *  de crear y el de editar abiertos a la vez. */
type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; persona: Persona }
  | { kind: 'delete'; persona: Persona };

export function PersonasLibrary({ initialPersonas }: PersonasLibraryProps) {
  const [personas, setPersonas] = useState(initialPersonas);
  const [selectedId, setSelectedId] = useState<string | null>(initialPersonas[0]?.id ?? null);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

  const selected = personas.find((p) => p.id === selectedId);

  /** Aplica una persona guardada (creada o editada) a la lista, manteniendo el orden por nombre
   *  —el mismo que devuelve `GET /api/personas`— para que la lista no salte al editar. */
  function upsert(saved: Persona): void {
    setPersonas((current) => {
      const without = current.filter((p) => p.id !== saved.id);
      return [...without, saved].sort((a, b) => a.name.localeCompare(b.name));
    });
    setSelectedId(saved.id);
    setDialog({ kind: 'none' });
  }

  async function confirmDelete(persona: Persona): Promise<void> {
    await personaActions.remove(persona.id);
    const remaining = personas.filter((p) => p.id !== persona.id);
    setPersonas(remaining);
    setSelectedId(remaining[0]?.id ?? null);
    setDialog({ kind: 'none' });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* La barra de acciones solo aparece cuando HAY personas. Con la librería vacía, el
          EmptyState ya ofrece «Nueva persona» y pintar el botón ADEMÁS en la cabecera dejaba DOS
          controles con el MISMO nombre accesible en la página — un lector de pantalla anuncia dos
          botones idénticos y no distingue cuál es cuál. (Lo cazó el E2E: `getByRole('button',
          {name:/nueva persona/i})` resolvía a dos elementos. La solución es arreglar la UI, no
          desambiguar el selector: si el test no puede nombrar el control sin ambigüedad, el
          usuario tampoco — skill frontend, principio 4.) */}
      {personas.length === 0 ? (
        <EmptyState
          title="Aún no hay personas"
          description="Crea una persona sintética: su demografía y personalidad se inyectan en el casting del prompt, y sus imágenes de referencia son el identity lock."
          actionLabel="Nueva persona"
          onAction={() => {
            setDialog({ kind: 'create' });
          }}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <p className="text-small text-text-3">
              {personas.length} {personas.length === 1 ? 'persona' : 'personas'} en la librería
            </p>
            <Button
              onClick={() => {
                setDialog({ kind: 'create' });
              }}
            >
              Nueva persona
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:persona-library-grid">
            {/* La lista: navegación entre personas. `aria-current` marca la abierta. */}
            <nav aria-label="Personas de la librería">
              <ul className="flex flex-col gap-1">
                {personas.map((persona) => (
                  <li key={persona.id}>
                    <button
                      type="button"
                      data-testid={`persona-item-${persona.id}`}
                      aria-current={persona.id === selectedId ? 'true' : undefined}
                      onClick={() => {
                        setSelectedId(persona.id);
                      }}
                      className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md border border-transparent px-3 py-2 text-left outline-none transition-colors hover:bg-surface-3 focus-visible:ring-3 focus-visible:ring-ring aria-[current]:border-border-2 aria-[current]:bg-surface-3"
                    >
                      <span className="text-mono font-medium text-text">{persona.name}</span>
                      <span className="text-micro text-text-3">
                        {persona.ageRange} · {persona.style}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            {selected && (
              <PersonaDetail
                persona={selected}
                onChange={(updated) => {
                  setPersonas((current) => current.map((p) => (p.id === updated.id ? updated : p)));
                }}
                onEdit={() => {
                  setDialog({ kind: 'edit', persona: selected });
                }}
                onDelete={() => {
                  setDialog({ kind: 'delete', persona: selected });
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Crear / editar: el MISMO formulario (el shape es el mismo; solo cambia si hay id). */}
      <Dialog
        open={dialog.kind === 'create' || dialog.kind === 'edit'}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'none' });
        }}
      >
        <DialogPopup className="max-w-2xl">
          <DialogTitle>
            {dialog.kind === 'edit' ? `Editar ${dialog.persona.name}` : 'Nueva persona'}
          </DialogTitle>
          {(dialog.kind === 'create' || dialog.kind === 'edit') && (
            <PersonaForm
              persona={dialog.kind === 'edit' ? dialog.persona : undefined}
              onSaved={upsert}
              onCancel={() => {
                setDialog({ kind: 'none' });
              }}
            />
          )}
        </DialogPopup>
      </Dialog>

      {/* Borrado: decisión destructiva ⇒ AlertDialog (no se cierra por click fuera). */}
      <AlertDialog
        open={dialog.kind === 'delete'}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'none' });
        }}
      >
        <AlertDialogPopup>
          <AlertDialogTitle>
            ¿Eliminar {dialog.kind === 'delete' ? dialog.persona.name : 'esta persona'}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Se borran sus imágenes de referencia. Los anuncios que ya hizo NO se borran: se quedan
            sin persona asignada.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="ghost">Cancelar</Button>} />
            <Button
              variant="danger"
              onClick={() => {
                if (dialog.kind === 'delete') void confirmDelete(dialog.persona);
              }}
            >
              Eliminar
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
