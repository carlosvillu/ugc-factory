'use client';

// El DIFF por líneas v2 vs v1 (T3.8). Reusa `diffLines` de core (LCS puro, sin librería): el
// servidor devuelve el par de bodies; el cliente lo renderiza. Cada línea añadida/quitada lleva
// un `data-op` (add/del) y un marcador `+`/`-` para que "diff visible" sea una aserción concreta
// del e2e, no un juicio a ojo.
import { diffLines, type DiffLine } from '@ugc/core/gallery';
import { cn } from '@/lib/utils';

interface VersionDiffProps {
  before: string;
  after: string;
}

/** El marcador de gutter de cada tipo de línea (`+`/`-`/espacio). */
const OP_MARKER: Record<DiffLine['op'], string> = { add: '+', del: '-', same: ' ' };

export function VersionDiff({ before, after }: VersionDiffProps) {
  const lines = diffLines(before, after);
  return (
    <pre
      data-slot="version-diff"
      className="overflow-x-auto rounded-md border border-border bg-surface-2 font-mono text-body-sm"
    >
      {lines.map((line, i) => (
        <div
          key={i}
          data-op={line.op}
          className={cn(
            'px-3 py-0.5',
            line.op === 'add' && 'bg-success-soft text-success',
            line.op === 'del' && 'bg-danger-soft text-danger',
            line.op === 'same' && 'text-text-3',
          )}
        >
          <span aria-hidden className="mr-2 select-none opacity-70">
            {OP_MARKER[line.op]}
          </span>
          {line.text}
        </div>
      ))}
    </pre>
  );
}
