'use client';

// BIBLIOTECA DE VÍDEOS — `/library` (T5.7, mockup 4c). Tres columnas, 1:1 con el mockup:
//   · IZQUIERDA · la lista de variantes aprobadas (con filtros por objetivo/idioma/plataforma arriba).
//   · CENTRO   · el preview: el <video> del máster con el overlay de safe zones conmutable (reusa
//                `SafeZoneFrame`, la MISMA pieza que CP4 de T5.6).
//   · DERECHA  · el LINAJE completo (del máster hasta el hook line y el template@version) + la descarga
//                del bundle (con/sin bed, §14).
//
// PATRÓN (idéntico a `qa-panel` de T5.6): la selección efectiva se DERIVA en el render (no un effect que
// resetee estado — dispara renders en cascada, que el linter veta). El linaje de la variante seleccionada
// se pide por REST al seleccionarla. Descargar NO es un `<a href>` crudo: la ruta del bundle responde 409
// en casos alcanzables (máster null; sin-bed no materializado, F6) y un `<a download>` guardaría el cuerpo
// del error renombrado a `.zip`. La descarga pasa por `libraryActions.downloadBundle`, que MIRA el status:
// 200 → object-URL + descarga; no-200 → `ApiError` que se pinta en un banner (regla 5a).
import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  libraryActions,
  type LibraryVariantSummary,
  type VariantLineageResponse,
} from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Select } from '@/components/ui/select';
import { Tabs } from '@/components/ui/tabs';
import { SafeZoneFrame, type SafeZonePreset } from '@/components/ui/safe-zone-overlay';
import { PublishingPanel } from '@/components/library/publishing-panel';

const PRESET_TABS: { label: string; preset: SafeZonePreset }[] = [
  { label: 'Universal', preset: 'universal' },
  { label: 'TikTok', preset: 'tiktok' },
  { label: 'Meta', preset: 'meta' },
  { label: 'Sin overlay', preset: 'off' },
];

const OBJECTIVE_LABEL: Record<string, string> = {
  hook_test: 'Hook test',
  conversion: 'Conversión',
  story: 'Story',
};

export interface LibraryBrowserProps {
  /** Las variantes aprobadas cargadas por el RSC (la lista inicial sin filtro). */
  initial: LibraryVariantSummary[];
}

export function LibraryBrowser({ initial }: LibraryBrowserProps) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ objective: string; language: string; platform: string }>(
    { objective: '', language: '', platform: '' },
  );
  // Los resultados FILTRADOS (los que el servidor devuelve por SQL). `null` = aún no se ha consultado con
  // filtro; la lista mostrada es entonces `initial`. Se DERIVA la lista visible en el render (no un
  // `setVariants(initial)` síncrono en el effect — eso dispara renders en cascada, que el linter veta).
  const [fetched, setFetched] = useState<LibraryVariantSummary[] | null>(null);
  // Si la re-consulta de un filtro falla, la lista se queda con los datos VIEJOS mientras el `<select>` ya
  // muestra el filtro nuevo: el usuario creería ver el resultado filtrado. Antes se tragaba en silencio; hoy
  // el fallo es VISIBLE (banner) para que no mienta sobre lo que se ve (regla 5a). Se limpia al reintentar.
  const [filterError, setFilterError] = useState<string | null>(null);

  const hasActiveFilter = Boolean(filters.objective || filters.language || filters.platform);
  // SIN filtro activo la lista ES `initial` (la que el RSC ya trajo) — no se re-consulta ni se sincroniza por
  // effect: se DERIVA. Con filtro activo, los resultados del servidor (o `initial` mientras el fetch vuela).
  const variants = hasActiveFilter ? (fetched ?? initial) : initial;

  // Las opciones de idioma/plataforma se DERIVAN de la lista inicial (no de un endpoint aparte): son las
  // que de hecho hay en la biblioteca. Estable → memo.
  const languages = useMemo(() => [...new Set(initial.map((v) => v.language))].sort(), [initial]);
  const platforms = useMemo(
    () => [...new Set(initial.flatMap((v) => v.platformTargets))].sort(),
    [initial],
  );

  // Al ACTIVAR/cambiar un filtro, se re-consulta la lista (el servidor filtra por SQL). SIN filtro activo NO
  // se consulta (la lista deriva a `initial`): se evita el fetch redundante del primer render Y, al volver a
  // «sin filtro», la vista completa se restaura sola por derivación. Todo `setState` vive en `.then/.catch`
  // (asíncrono) — nunca síncrono en el cuerpo del effect (regla del linter contra renders en cascada).
  useEffect(() => {
    if (!hasActiveFilter) return;
    let cancelled = false;
    libraryActions
      .list({
        objective: filters.objective || undefined,
        language: filters.language || undefined,
        platform: filters.platform || undefined,
      })
      .then((res) => {
        if (!cancelled) {
          setFetched(res.variants);
          setFilterError(null);
        }
      })
      .catch((e: unknown) => {
        // No se rompe la página (se conserva la lista actual), pero el fallo se SEÑALA: la lista vieja con un
        // filtro nuevo, sin aviso, es una mentira sobre lo que se ve. El banner lo hace visible.
        if (!cancelled) {
          setFilterError(
            e instanceof ApiError
              ? e.message
              : 'No se pudo aplicar el filtro. Mostrando la lista anterior.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filters.objective, filters.language, filters.platform, hasActiveFilter]);

  const selected = variants.find((v) => v.id === pickedId) ?? variants[0];

  return (
    <div
      data-slot="library-browser"
      // La altura mínima (540px del mockup 4c) es un número fijo → estilo inline (la vía sancionada para
      // valores que Tailwind no emite como token, igual que el `width` de SafeZoneOverlay).
      style={{ minHeight: 540 }}
      className="flex overflow-hidden rounded-xl border border-border bg-bg"
    >
      {/* IZQUIERDA · filtros + lista de variantes aprobadas. */}
      <aside
        data-slot="library-list"
        className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-bg-subtle"
      >
        <div className="flex flex-col gap-2 border-b border-border p-3">
          <div className="font-mono text-micro font-semibold tracking-widest text-text-3">
            {variants.length} {variants.length === 1 ? 'VARIANTE' : 'VARIANTES'}
          </div>
          <label className="sr-only" htmlFor="filter-objective">
            Filtrar por objetivo
          </label>
          <Select
            id="filter-objective"
            data-slot="filter-objective"
            value={filters.objective}
            onChange={(e) => {
              setFilters((f) => ({ ...f, objective: e.target.value }));
            }}
          >
            <option value="">Todos los objetivos</option>
            <option value="hook_test">Hook test</option>
            <option value="conversion">Conversión</option>
            <option value="story">Story</option>
          </Select>
          <label className="sr-only" htmlFor="filter-language">
            Filtrar por idioma
          </label>
          <Select
            id="filter-language"
            data-slot="filter-language"
            value={filters.language}
            onChange={(e) => {
              setFilters((f) => ({ ...f, language: e.target.value }));
            }}
          >
            <option value="">Todos los idiomas</option>
            {languages.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
          <label className="sr-only" htmlFor="filter-platform">
            Filtrar por plataforma
          </label>
          <Select
            id="filter-platform"
            data-slot="filter-platform"
            value={filters.platform}
            onChange={(e) => {
              setFilters((f) => ({ ...f, platform: e.target.value }));
            }}
          >
            <option value="">Todas las plataformas</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>

        {/* El banner se GATEA por `hasActiveFilter`: al volver a «sin filtro» desaparece sin necesidad de
            limpiar `filterError` de forma síncrona en el effect (eso violaría la regla anti-cascada). El
            siguiente fetch con filtro lo pone/limpia en su `.then/.catch`. */}
        {hasActiveFilter && filterError !== null ? (
          <div className="p-2.5">
            <Alert tone="danger" data-slot="library-filter-error">
              {filterError}
            </Alert>
          </div>
        ) : null}

        {variants.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="Sin variantes"
              description="No hay variantes aprobadas que coincidan con los filtros."
            />
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5 p-2.5" data-slot="library-variant-list">
            {variants.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  data-slot="library-variant-item"
                  data-variant-id={v.id}
                  data-selected={v.id === selected?.id}
                  aria-current={v.id === selected?.id}
                  onClick={() => {
                    setPickedId(v.id);
                  }}
                  className={
                    v.id === selected?.id
                      ? 'flex w-full items-center gap-2.5 rounded-md border border-accent-border bg-accent-soft px-2.5 py-2 text-left'
                      : 'flex w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left hover:border-border-2 hover:bg-surface'
                  }
                >
                  <span
                    aria-hidden
                    className="hatch-9x16-wide h-10 w-6 shrink-0 rounded-sm border border-border-2"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-mono font-medium text-text">
                      {v.angleName}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-micro text-text-3">
                      {v.language} · {v.durationTarget}s · ✓
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* CENTRO + DERECHA · el detalle de la variante seleccionada (se remonta al cambiar → estado limpio). */}
      {selected ? (
        <VariantDetail key={selected.id} summary={selected} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            title="Biblioteca vacía"
            description="Aún no hay variantes aprobadas. Aprueba una variante en CP4 para verla aquí."
          />
        </div>
      )}
    </div>
  );
}

/** El detalle de UNA variante: preview (centro) + linaje y descarga (derecha). Carga su linaje al montar. */
function VariantDetail({ summary }: { summary: LibraryVariantSummary }) {
  const [lineage, setLineage] = useState<VariantLineageResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preset, setPreset] = useState<SafeZonePreset>('universal');
  // Estado de la descarga: `downloadError` surfacea un fallo (409 máster null / sin-bed no materializado en
  // F6) EN VEZ de guardar el cuerpo del error como `.zip`. `downloading` es el `audio` en curso (para el
  // aria-busy del botón). El error se limpia en cada nuevo intento.
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<'with_bed' | 'no_bed' | null>(null);

  useEffect(() => {
    let cancelled = false;
    libraryActions
      .lineage(summary.id)
      .then((l) => {
        if (!cancelled) setLineage(l);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadError(e instanceof ApiError ? e.message : 'No se pudo cargar el linaje.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [summary.id]);

  // La versión SIN bed se ofrece cuando el destino es `both` (dual paid+orgánico, T5.7) O cuando la variante
  // usa un sonido NATIVO/TRENDING (§14 pt 1): un `native_trending` NO lleva bed quemado — su export es el
  // máster CON HEADROOM de audio (voz a −14 LUFS sin música), para que el sonido nativo se superponga en la
  // app al publicar. Sin esto, una variante orgánica `native_trending` (destino != 'both') no podría descargar
  // su versión con headroom — exactamente al revés de lo que §14 pt 1 pide.
  const nativeTrending = lineage?.variant.audioSource === 'native_trending';
  const dualExport = lineage?.batch.destination === 'both' || nativeTrending;

  // Descarga MIRANDO EL STATUS: pide el bundle, y solo si llega 200 dispara la descarga desde el blob
  // (object-URL + `<a download>` efímero + revoke). Un no-200 (409 alcanzable) sube como `ApiError` y se
  // pinta en el banner: nunca se descarga el cuerpo de un error renombrado a `.zip`.
  async function handleDownload(audio: 'with_bed' | 'no_bed') {
    setDownloadError(null);
    setDownloading(audio);
    try {
      const { blob, filename } = await libraryActions.downloadBundle(summary.id, audio);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setDownloadError(
        e instanceof ApiError ? e.message : 'No se pudo preparar la descarga del bundle.',
      );
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div
      data-slot="library-detail"
      data-variant-id={summary.id}
      className="flex min-w-0 flex-1 overflow-hidden"
    >
      {/* CENTRO · el preview con el conmutador de safe zones. */}
      <div className="flex w-80 shrink-0 flex-col items-center gap-3 border-r border-border p-6">
        <Tabs
          tabs={PRESET_TABS.map((t) => t.label)}
          onChange={(index) => {
            const next = PRESET_TABS[index];
            if (next) setPreset(next.preset);
          }}
        />
        {summary.masterAssetId !== null ? (
          <div
            data-slot="library-player"
            className="relative aspect-9/16 w-56 overflow-hidden rounded-lg border border-border-2 bg-black"
          >
            <video
              data-slot="library-video"
              src={`/api/assets/${summary.masterAssetId}/download`}
              controls
              preload="metadata"
              className="h-full w-full"
            />
            <SafeZoneFrame preset={preset} data-slot="library-safe-zone" />
          </div>
        ) : (
          <div className="flex aspect-9/16 w-56 items-center justify-center rounded-lg border border-border-2 bg-surface text-mono text-text-3">
            Sin máster
          </div>
        )}
      </div>

      {/* DERECHA · identidad + linaje + descarga. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-6">
        <div className="mb-1 font-mono text-micro text-text-3" data-slot="library-filename">
          {summary.filenameCode}.mp4
        </div>
        <h2 className="text-h3 font-semibold text-text" data-slot="library-angle">
          {summary.angleName}
        </h2>
        <div className="mt-2 mb-5 flex flex-wrap items-center gap-2">
          <Badge tone="success" mono data-slot="library-status">
            ✓ aprobada
          </Badge>
          <Badge tone="neutral" mono>
            C2PA firmado
          </Badge>
          {summary.score !== null ? (
            <Badge tone="neutral" mono data-slot="library-score">
              {summary.score}/100
            </Badge>
          ) : null}
          <Badge tone="info" mono data-slot="library-objective">
            {OBJECTIVE_LABEL[summary.objective] ?? summary.objective}
          </Badge>
        </div>

        {/* LINAJE (§12, panel 4c): del hook line al máster. Tolerante a los nulos (hook del brief, etc.). */}
        <div className="mb-3 font-mono text-micro font-semibold tracking-widest text-text-3">
          LINAJE
        </div>
        {loadError !== null ? (
          <p role="alert" data-slot="library-lineage-error" className="text-mono text-danger">
            {loadError}
          </p>
        ) : lineage === null ? (
          <p className="text-mono text-text-3">Cargando linaje…</p>
        ) : (
          <ul className="flex flex-col gap-3" data-slot="library-lineage">
            <LineageRow label="Hook line" dataSlot="lineage-hook">
              {lineage.hook ? (
                <>
                  <span className="text-text">«{lineage.hook.text}»</span>{' '}
                  <span className="font-mono text-micro text-text-3">{lineage.hook.angle}</span>
                </>
              ) : (
                <span className="text-text-3">del brief (sin línea de librería)</span>
              )}
            </LineageRow>
            <LineageRow label="Template" dataSlot="lineage-template">
              {lineage.template ? (
                <span className="font-mono text-text" data-slot="lineage-template-ref">
                  {lineage.template.slug}@{lineage.template.version}
                </span>
              ) : (
                <span className="text-text-3">sin template registrado</span>
              )}
            </LineageRow>
            <LineageRow label="Persona" dataSlot="lineage-persona">
              {lineage.persona ? (
                <span className="text-text">
                  {lineage.persona.name} · {lineage.variant.language}
                </span>
              ) : (
                <span className="text-text-3">sin persona fijada</span>
              )}
            </LineageRow>
            <LineageRow label="Máster" dataSlot="lineage-master" accent="success">
              {lineage.master ? (
                <span className="font-mono text-text">
                  {lineage.master.width ?? 1080}×{lineage.master.height ?? 1920} · 30fps · −14 LUFS
                </span>
              ) : (
                <span className="text-text-3">sin máster compuesto</span>
              )}
            </LineageRow>
          </ul>
        )}

        {/* DESCARGA del bundle (MP4 + metadata.json). El export dual (§14) muestra las DOS versiones. NO es
            un <a href download> crudo: la ruta responde 409 en casos alcanzables (máster null; sin-bed no
            materializado, F6) y un <a download> guardaría el cuerpo del error como `.zip`, sin señal. Son
            <button> que llaman `downloadBundle` (mira el status) → 200 dispara la descarga desde el blob;
            no-200 pinta el banner. El DS Button no reenvía `data-*`/`onClick` a un contrato estable, así que
            el botón lleva las clases de token del mockup 4c directamente (bg-accent / surface-3). */}
        <div className="mt-6 flex flex-col gap-3" data-slot="library-download">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleDownload('with_bed')}
              disabled={downloading !== null}
              aria-busy={downloading === 'with_bed'}
              data-slot="download-bundle"
              data-audio="with_bed"
              className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-mono font-semibold text-text-on-accent transition-colors hover:bg-accent-hover focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
            >
              ↓ Descargar bundle{dualExport ? ' (con bed · orgánico)' : ''}
            </button>
            {dualExport ? (
              <button
                type="button"
                onClick={() => void handleDownload('no_bed')}
                disabled={downloading !== null}
                aria-busy={downloading === 'no_bed'}
                data-slot="download-bundle-nobed"
                data-audio="no_bed"
                className="inline-flex items-center rounded-md border border-border-2 bg-surface-3 px-4 py-2 text-mono font-medium text-text transition-colors hover:border-border-strong focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
              >
                {/* Para native_trending el sin-bed ES el export con HEADROOM (§14 pt 1): voz a −14 LUFS sin
                    música quemada, para superponer el sonido nativo al publicar. */}
                ↓ {nativeTrending ? 'Con headroom (sonido nativo)' : 'Sin bed (paid)'}
              </button>
            ) : null}
          </div>
          {downloadError !== null ? (
            <Alert tone="danger" data-slot="download-error">
              {downloadError}
            </Alert>
          ) : null}
        </div>

        {/* PUBLICACIÓN (T6.2, §15.4/§preámbulo F6): checklist marcable + opción Spark + CP5 (modo degradado
            manual). Vive bajo la descarga del bundle — misma superficie de la variante aprobada. */}
        <PublishingPanel variantId={summary.id} />
      </div>
    </div>
  );
}

/** Una fila del linaje: un punto de color + la etiqueta + el contenido. `accent` colorea el punto. */
function LineageRow({
  label,
  children,
  dataSlot,
  accent = 'accent',
}: {
  label: string;
  children: React.ReactNode;
  dataSlot: string;
  accent?: 'accent' | 'success';
}) {
  return (
    <li className="flex items-start gap-3" data-slot={dataSlot}>
      <span
        aria-hidden
        className={
          accent === 'success'
            ? 'mt-1.5 size-1.75 shrink-0 rounded-full bg-success'
            : 'mt-1.5 size-1.75 shrink-0 rounded-full bg-accent'
        }
      />
      <span className="min-w-0 text-mono">
        <span className="font-medium text-text-2">{label}</span> {children}
      </span>
    </li>
  );
}
