'use client';

// Visor de JSON con resaltado de sintaxis por TOKENS DEL DS (T1.16). Presentacional
// puro: recibe el texto ya formateado y lo pinta tokenizado (`json-highlight.ts`, donde
// vive la lógica y sus tests).
//
// QUÉ COLOR lleva cada tipo vive en `json-token-palette.ts` (con su tabla de contraste medida
// y su guard: ningún color del contenido puede venir de `--accent`, que es marca y no texto).
// Aquí solo se pinta. Ninguna librería de highlighting (traen su propia paleta hardcodeada;
// ver la nota de json-highlight.ts).
import { memo } from 'react';
import { tokenizeJson } from './json-highlight';
import { JSON_TOKEN_CLASS } from './json-token-palette';

// `memo` (excepción deliberada al "sin memo preventivo" del SKILL.md, y medida): un
// ProductBrief de 22 KB tokeniza a ~2.200 spans. Sin memo, cualquier re-render del diálogo
// —incluido pulsar «Copiar», que cambia un estado que no toca ni un carácter del contenido—
// re-tokeniza y reconcilia los 2.200 spans. `formatted` es una string estable una vez cargada,
// así que el shallow compare corta el trabajo entero (un `useMemo(tokenizeJson)` ahorraría solo
// el tokenizado y seguiría reconciliando el árbol).
export const JsonViewer = memo(function JsonViewer({
  formatted,
  className,
}: {
  formatted: string;
  className?: string;
}) {
  return (
    <pre
      data-slot="json-viewer"
      className={className}
      // `tabIndex` para que el bloque scrollable sea alcanzable por teclado (un
      // contenedor con overflow que no recibe foco no se puede scrollear sin ratón).
      tabIndex={0}
    >
      <code>
        {/* La clave por índice es correcta AQUÍ: la lista es una derivación posicional de
            un texto inmutable (no se reordena, no se filtra, sus items no tienen
            identidad propia). */}
        {tokenizeJson(formatted).map((token, i) => (
          <span key={i} className={JSON_TOKEN_CLASS[token.kind]}>
            {token.text}
          </span>
        ))}
      </code>
    </pre>
  );
});
