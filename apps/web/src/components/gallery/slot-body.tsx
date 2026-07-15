'use client';

// El body del template con los slots `{...}` RESALTADOS (T3.8). Reusa `splitBodySlots` de core
// (§10.4, la MISMA regla del validador y el compilador): un slot canónico se pinta en verde
// (accent), uno inválido en rojo (danger). El texto plano queda tal cual. Es la vista de lectura;
// el editor (con validación en vivo) es `TemplateEditor`.
import { splitBodySlots } from '@ugc/core/gallery';
import { cn } from '@/lib/utils';

interface SlotBodyProps {
  body: string;
}

export function SlotBody({ body }: SlotBodyProps) {
  const segments = splitBodySlots(body);
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-body-sm text-text-2">
      {segments.map((seg, i) =>
        seg.kind === 'text' ? (
          <span key={i}>{seg.value}</span>
        ) : (
          <span
            key={i}
            data-slot="prompt-slot"
            data-valid={seg.valid}
            className={cn(
              'rounded px-0.5 font-semibold',
              seg.valid ? 'bg-accent-soft text-accent' : 'bg-danger-soft text-danger',
            )}
          >
            {`{${seg.token}}`}
          </span>
        ),
      )}
    </pre>
  );
}
