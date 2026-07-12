// Página `/analyses/:id` (T1.6): destino del intake. Muestra el análisis creado (o
// REUTILIZADO) — el id en la URL ES la señal observable de reutilización de caché:
// un 2.º submit del mismo texto aterriza en el MISMO id.
//
// Vista MÍNIMA a propósito: el visor completo del análisis (RawContent, imágenes,
// brief) es trabajo de N2/N3 (T1.7+). Aquí solo se confirma la identidad y el estado
// del análisis para cerrar el flujo del intake manual.
import { notFound } from 'next/navigation';
import { getUrlAnalysis } from '@ugc/db';
import { getDb } from '@/server';

// Lee la BD por id en cada carga: dinámica, sin caché.
export const dynamic = 'force-dynamic';

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const analysis = await getUrlAnalysis(getDb(), id);
  if (!analysis) notFound();

  const raw = analysis.rawContent as { markdown?: string; images?: { url: string }[] };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1 font-semibold tracking-h1 text-text">Análisis</h1>
        <p className="font-mono text-small text-text-3" data-testid="analysis-id">
          {analysis.id}
        </p>
        <p className="text-small text-text-2">
          Origen: <span className="font-mono">{analysis.source}</span> · Estado:{' '}
          <span className="font-mono" data-testid="analysis-status">
            {analysis.status}
          </span>
        </p>
      </header>

      {raw.markdown && (
        <section className="flex flex-col gap-2">
          <h2 className="text-h2 font-semibold tracking-h2 text-text">Descripción</h2>
          <p className="whitespace-pre-wrap text-body text-text-2">{raw.markdown}</p>
        </section>
      )}

      {raw.images && raw.images.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-h2 font-semibold tracking-h2 text-text">
            Imágenes de referencia ({raw.images.length})
          </h2>
          <ul className="flex flex-col gap-1.5">
            {raw.images.map((img) => (
              <li key={img.url} className="font-mono text-small text-text-3">
                {img.url}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
