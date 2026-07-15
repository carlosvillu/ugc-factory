'use client';

// La FICHA de un template (T3.8): body con slots resaltados, beats, guards (los packs que aplican
// §9.5) y versiones con diff. Hospeda el editor (validación de slots en vivo → crear v2) y las
// transiciones de estado (§10.2).
//
// Carga la ficha por REST al abrirse (template + versiones + guards en UNA respuesta). El diff v2
// vs v1 lo renderiza el cliente con la función pura `diffLines` sobre el par que devuelve el PATCH
// (o el par de versiones más recientes), sin librería de diff.
import { useEffect, useState } from 'react';
import type { PromptStatus, TemplateEditResult, TemplateWithVersions } from '@ugc/core/gallery';
import { ApiError, templateActions } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { SlotBody } from '@/components/gallery/slot-body';
import { TemplateEditor } from '@/components/gallery/template-editor';
import { VersionDiff } from '@/components/gallery/version-diff';
import { statusBadgeTone, statusLabel } from '@/components/gallery/status-badge';

interface TemplateDetailProps {
  templateId: string;
  onEdited: (result: TemplateEditResult) => void;
  onStatusChanged: () => void;
}

/** El orden de la máquina de estados §10.2 (draft → review → published). El botón ofrece el
 *  SIGUIENTE estado; deprecated es un camino aparte que hoy no se ofrece desde la ficha. */
const NEXT_STATUS: Partial<Record<PromptStatus, PromptStatus>> = {
  draft: 'review',
  review: 'published',
};

export function TemplateDetail({ templateId, onEdited, onStatusChanged }: TemplateDetailProps) {
  const [data, setData] = useState<TemplateWithVersions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [lastEdit, setLastEdit] = useState<TemplateEditResult | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  // El fetch de la ficha. Solo llama a setState en los CALLBACKS asíncronos (no sincrónicamente en
  // el cuerpo del efecto): el componente se monta fresco por template gracias al `key={id}` que le
  // pone el padre, así que no hace falta resetear estado a mano al cambiar `templateId`.
  useEffect(() => {
    let alive = true;
    templateActions
      .get(templateId)
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'No se pudo cargar la ficha');
      });
    return () => {
      alive = false;
    };
  }, [templateId]);

  if (error) {
    return (
      <p role="alert" className="text-body-sm text-danger">
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-3 py-2">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const { template, versions, appliedGuards } = data;
  const next = NEXT_STATUS[template.status];

  async function changeStatus(to: PromptStatus): Promise<void> {
    setStatusBusy(true);
    try {
      const updated = await templateActions.setStatus(templateId, to);
      setData((cur) => (cur ? { ...cur, template: updated } : cur));
      onStatusChanged();
    } finally {
      setStatusBusy(false);
    }
  }

  function afterEdit(result: TemplateEditResult): void {
    // Refresca la ficha con la nueva cabeza + versiones, y guarda el par para el diff.
    setLastEdit(result);
    setEditing(false);
    setData((cur) =>
      cur
        ? {
            ...cur,
            template: result.template,
            versions: [
              result.created,
              result.previous,
              ...cur.versions.filter(
                (v) =>
                  v.version !== result.created.version && v.version !== result.previous.version,
              ),
            ],
          }
        : cur,
    );
    onEdited(result);
  }

  // El par a diffear: el de la última edición (recién guardada), o las dos versiones más recientes
  // si ya hay historia. Sin par (0 o 1 versión y sin edición) → no hay diff que mostrar aún.
  const diffPair = ((): {
    before: (typeof versions)[number];
    after: (typeof versions)[number];
  } | null => {
    if (lastEdit) return { before: lastEdit.previous, after: lastEdit.created };
    const [newest, prior] = versions; // versiones vienen ordenadas: más nueva primero
    if (newest && prior) return { before: prior, after: newest };
    return null;
  })();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-h3 font-semibold text-text">{template.title}</h3>
            <Badge tone={statusBadgeTone(template.status)}>{statusLabel(template.status)}</Badge>
          </div>
          {next ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={statusBusy}
              onClick={() => {
                void changeStatus(next);
              }}
            >
              Pasar a {statusLabel(next)}
            </Button>
          ) : null}
        </div>
        <p className="font-mono text-micro text-text-3">
          {template.slug}@{String(Math.max(template.headVersion, 1))} · {template.kind} ·{' '}
          {template.language}
        </p>
        {template.description ? (
          <p className="text-body-sm text-text-2">{template.description}</p>
        ) : null}
      </header>

      <Separator />

      {/* ── Body con slots resaltados / editor ── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h4 className="text-body-sm font-semibold text-text-2">Cuerpo del prompt</h4>
          {!editing ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(true);
              }}
            >
              Editar
            </Button>
          ) : null}
        </div>
        {editing ? (
          <TemplateEditor
            templateId={templateId}
            initialBody={template.body}
            onSaved={afterEdit}
            onCancel={() => {
              setEditing(false);
            }}
          />
        ) : (
          <SlotBody body={template.body} />
        )}
      </section>

      {/* ── Diff v2 vs v1 ── */}
      {diffPair ? (
        <section className="flex flex-col gap-2" data-slot="version-diff-section">
          <h4 className="text-body-sm font-semibold text-text-2">
            Diff · v{String(diffPair.after.version)} vs v{String(diffPair.before.version)}
          </h4>
          <VersionDiff before={diffPair.before.body} after={diffPair.after.body} />
        </section>
      ) : null}

      {/* ── Beats ── */}
      {template.beats.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="text-body-sm font-semibold text-text-2">Beats</h4>
          <ol className="flex flex-col gap-1.5">
            {template.beats.map((beat, i) => (
              <li
                key={i}
                className="flex gap-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-body-sm"
              >
                <span className="font-mono text-micro text-text-3">
                  {beat.tStart}s–{beat.tEnd}s
                </span>
                <span className="text-text-2">{beat.action}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* ── Guards (§9.5) ── */}
      <section className="flex flex-col gap-2">
        <h4 className="text-body-sm font-semibold text-text-2">Guard packs que aplican</h4>
        {appliedGuards.length === 0 ? (
          <p className="text-body-sm text-text-3">
            Ninguno (template agnóstico de vertical/plataforma).
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {appliedGuards.map((g) => (
              <Badge key={g.key} tone="info" mono>
                {g.key}
              </Badge>
            ))}
          </div>
        )}
      </section>

      {/* ── Versiones ── */}
      {versions.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h4 className="text-body-sm font-semibold text-text-2">Versiones</h4>
          <ul className="flex flex-col gap-1">
            {versions.map((v) => (
              <li key={v.id} className="flex items-baseline gap-2 text-body-sm">
                <Badge tone="neutral" mono>
                  v{String(v.version)}
                </Badge>
                <span className="text-text-3">{v.changelog ?? '—'}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
