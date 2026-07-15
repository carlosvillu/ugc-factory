'use client';

// El EDITOR del body con validación de slots EN VIVO (T3.8, la pieza central de la Verificación).
//
// La validación es una FUNCIÓN PURA client-side (`invalidBodySlots` de core, §10.4), NO un fetch:
// mientras el usuario escribe, se recalculan los slots inválidos por pulsación y se muestra el
// error EN VIVO en un `role="alert"`. Guardar queda DESHABILITADO mientras haya un slot inválido.
// Solo la PERSISTENCIA (crear v2) va por REST (`templateActions.createVersion`).
//
// Las dos cláusulas de la Verificación viven separadas a propósito: (a) slot inválido → alerta en
// vivo, sin guardar; (b) edición válida → guardar → v2 + diff. El servidor re-valida (400 si un
// slot inválido cuela), pero el guard del cliente hace que ese 400 no ocurra por el camino feliz.
import { useState } from 'react';
import { invalidBodySlots, type TemplateEditResult } from '@ugc/core/gallery';
import { ApiError, templateActions } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface TemplateEditorProps {
  templateId: string;
  initialBody: string;
  onSaved: (result: TemplateEditResult) => void;
  onCancel: () => void;
}

export function TemplateEditor({
  templateId,
  initialBody,
  onSaved,
  onCancel,
}: TemplateEditorProps) {
  const [body, setBody] = useState(initialBody);
  const [changelog, setChangelog] = useState('');
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Validación EN VIVO: pura, sin red, recalculada por render.
  const invalid = invalidBodySlots(body);
  const hasInvalid = invalid.length > 0;
  const unchanged = body === initialBody;

  async function save(): Promise<void> {
    setSaving(true);
    setServerError(null);
    try {
      const result = await templateActions.createVersion(templateId, {
        body,
        changelog: changelog.trim() || undefined,
      });
      onSaved(result);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Textarea
        aria-label="Cuerpo del prompt"
        rows={8}
        value={body}
        error={hasInvalid}
        onChange={(e) => {
          setBody(e.target.value);
        }}
        className="font-mono text-body-sm"
      />

      {/* Error de slot EN VIVO (§10.4). role="alert" para que lectores de pantalla (y el e2e) lo
          anuncien en cuanto aparece. */}
      {hasInvalid ? (
        <p role="alert" className="text-body-sm text-danger">
          Slots inválidos (no §10.4): {invalid.map((s) => `{${s}}`).join(', ')}
        </p>
      ) : (
        <p className="text-micro text-text-3">
          Los slots deben ser canónicos (§10.4), p. ej. {'{product.name}'}, {'{benefit.primary}'}.
        </p>
      )}

      {serverError ? (
        <p role="alert" className="text-body-sm text-danger">
          {serverError}
        </p>
      ) : null}

      <Input
        aria-label="Nota de la versión (changelog)"
        placeholder="Nota de la versión (opcional)"
        value={changelog}
        onChange={(e) => {
          setChangelog(e.target.value);
        }}
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={hasInvalid || unchanged || saving}
          onClick={() => {
            void save();
          }}
        >
          Guardar versión
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
