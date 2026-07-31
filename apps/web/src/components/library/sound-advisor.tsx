'use client';

// TRENDING SOUND ADVISOR (T6.6, §14 pt 1-2) — vive dentro del panel de publicación de una variante aprobada
// de `/library`. Cuatro cosas:
//   · LISTA los trending sounds de TikTok Creative Center (Popular Music) para esta variante, con el FILTRO
//     COMERCIAL ya aplicado por el servidor según el destino del lote (§14 pt 2): orgánico ⇒ todos con su
//     flag; paid/Spark ⇒ solo Commercial Music Library. Cada sonido muestra su badge comercial (CML / no-CML).
//   · SUGERENCIAS POR MOOD: chips de mood (derivados del título, heurística nuestra) que filtran la lista.
//   · SELECCIÓN: elegir un sonido lo marca `audio_source='native_trending'` (§14 pt 1) → el checklist bloquea
//     Spark (coherencia con T6.2). Tras elegir, avisa al padre para que RECARGUE el estado de publicación
//     (así el badge de Spark pasa a BLOQUEADO en vivo).
//   · GUÍA IN-APP del flujo «añadir sonido nativo al publicar», con la RESTRICCIÓN DE CUENTAS BUSINESS
//     documentada (§14 pt 1): los trending no-CML solo se añaden manualmente desde cuentas personales/creator.
//
// Es GUÍA/UI, no automatización: la herramienta NO añade el sonido por API (§14 lo prohíbe para cuentas
// Business). Usa las primitivas del DS (Badge/Button). El badge comercial usa tone success/warning —pares
// VALIDADOS por check:contrast sobre la superficie real (no danger, cuyo par dark está en la deuda diferida).
import { useEffect, useState } from 'react';
import { ApiError, soundAdvisorActions, type TrendingSound } from '@/lib/api-client';
import type { SoundMood } from '@ugc/core/publishing';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const MOOD_LABEL: Record<SoundMood, string> = {
  energetic: 'Enérgico',
  calm: 'Tranquilo',
  hype: 'Hype',
  chill: 'Chill',
  cinematic: 'Cinemático',
  upbeat: 'Alegre',
};

/** El Advisor recibe la variante + un callback para que el padre recargue su `PublishingState` tras elegir un
 *  sonido (así Spark se bloquea en vivo). */
export function SoundAdvisor({
  variantId,
  onSelected,
}: {
  variantId: string;
  onSelected: () => void;
}) {
  const [sounds, setSounds] = useState<TrendingSound[] | null>(null);
  const [commercialOnly, setCommercialOnly] = useState(false);
  const [sourceOk, setSourceOk] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [moodFilter, setMoodFilter] = useState<SoundMood | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    soundAdvisorActions
      .list(variantId)
      .then((res) => {
        if (!cancelled) {
          setSounds(res.sounds);
          setCommercialOnly(res.commercialOnly);
          setSourceOk(res.sourceOk);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadError(
            e instanceof ApiError ? e.message : 'No se pudieron cargar los sonidos trending.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [variantId]);

  async function select(sound: TrendingSound) {
    setActionError(null);
    setBusy(true);
    try {
      await soundAdvisorActions.select(variantId, sound.id);
      setSelectedId(sound.id);
      onSelected(); // el padre recarga el PublishingState → Spark pasa a bloqueado.
    } catch (e: unknown) {
      setActionError(e instanceof ApiError ? e.message : 'No se pudo elegir el sonido.');
    } finally {
      setBusy(false);
    }
  }

  if (loadError !== null) {
    return (
      <div data-slot="sound-advisor">
        <Alert tone="danger" data-slot="sound-advisor-error">
          {loadError}
        </Alert>
      </div>
    );
  }
  if (sounds === null) {
    return (
      <div data-slot="sound-advisor">
        <p className="text-mono text-text-3">Cargando trending sounds…</p>
      </div>
    );
  }

  // Los moods disponibles: unión de los moods de todos los sonidos (chips de filtro). Orden canónico estable.
  const availableMoods = (Object.keys(MOOD_LABEL) as SoundMood[]).filter((m) =>
    sounds.some((s) => s.moods.includes(m)),
  );
  const filtered =
    moodFilter === null ? sounds : sounds.filter((s) => s.moods.includes(moodFilter));

  return (
    <div className="flex flex-col gap-4" data-slot="sound-advisor">
      <div>
        <div className="mb-1 font-mono text-micro font-semibold tracking-widest text-text-3">
          TRENDING SOUND ADVISOR (§14)
        </div>
        <p className="text-mono text-text-2" data-slot="sound-advisor-scope">
          {commercialOnly
            ? 'Destino con promoción/Spark: solo se muestran sonidos de la Commercial Music Library (CML).'
            : 'Destino orgánico: se muestran todos los trending, con su flag comercial.'}
        </p>
      </div>

      {/* FUENTE CAÍDA (§14): distinguir «Creative Center no responde» de «no hay sonidos para este filtro». En
          producción, SIN una sesión de TikTok (T6.1 · apps de developer), la fuente real da 404 → aquí se avisa
          en vez de mostrar una lista vacía silenciosa que parecería un filtro sin resultados. */}
      {!sourceOk ? (
        <Alert tone="warning" data-slot="sound-source-unavailable">
          No se pudo leer TikTok Creative Center (Popular Music) ahora mismo. La lista de sonidos
          trending requiere una sesión de TikTok conectada; hasta entonces no hay catálogo que
          mostrar. Vuelve a intentarlo o añade el sonido manualmente en la app al publicar.
        </Alert>
      ) : null}

      {/* SUGERENCIAS POR MOOD: chips que filtran la lista. */}
      {availableMoods.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-slot="sound-mood-filters">
          <button
            type="button"
            data-slot="sound-mood-chip"
            data-mood="all"
            data-active={moodFilter === null}
            onClick={() => {
              setMoodFilter(null);
            }}
            className={
              moodFilter === null
                ? 'rounded-full border border-accent-border bg-accent-soft px-3 py-1 text-micro font-semibold text-accent'
                : 'rounded-full border border-border-2 bg-surface-3 px-3 py-1 text-micro font-semibold text-text-2'
            }
          >
            Todos
          </button>
          {availableMoods.map((mood) => (
            <button
              key={mood}
              type="button"
              data-slot="sound-mood-chip"
              data-mood={mood}
              data-active={moodFilter === mood}
              onClick={() => {
                setMoodFilter(moodFilter === mood ? null : mood);
              }}
              className={
                moodFilter === mood
                  ? 'rounded-full border border-accent-border bg-accent-soft px-3 py-1 text-micro font-semibold text-accent'
                  : 'rounded-full border border-border-2 bg-surface-3 px-3 py-1 text-micro font-semibold text-text-2'
              }
            >
              {MOOD_LABEL[mood]}
            </button>
          ))}
        </div>
      ) : null}

      {/* LA LISTA de sonidos con su flag comercial + selección. */}
      <ul className="flex flex-col gap-2" data-slot="sound-list">
        {filtered.map((sound) => (
          <li
            key={sound.id}
            data-slot="sound-item"
            data-sound-id={sound.id}
            data-commercial={sound.commercial}
            data-selected={selectedId === sound.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3"
          >
            <div className="min-w-0">
              <div className="truncate text-mono text-text">{sound.title}</div>
              <div className="truncate font-mono text-micro text-text-3">
                {sound.author} · {sound.durationSeconds}s · #{sound.rank}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {/* FLAG COMERCIAL: success (CML) / warning (no-CML). Ambos pares están VALIDADOS por
                    check:contrast sobre la superficie real. */}
                {sound.commercial ? (
                  <Badge
                    tone="success"
                    mono
                    data-slot="sound-commercial-flag"
                    data-commercial="true"
                  >
                    ✓ CML (comercial)
                  </Badge>
                ) : (
                  <Badge
                    tone="warning"
                    mono
                    data-slot="sound-commercial-flag"
                    data-commercial="false"
                  >
                    ⚠ no-CML (solo orgánico)
                  </Badge>
                )}
                {sound.moods.map((mood) => (
                  <Badge key={mood} tone="neutral" mono>
                    {MOOD_LABEL[mood]}
                  </Badge>
                ))}
              </div>
            </div>
            <Button
              variant="secondary"
              data-slot="sound-select"
              disabled={busy || selectedId === sound.id}
              onClick={() => void select(sound)}
            >
              {selectedId === sound.id ? 'Elegido' : 'Elegir'}
            </Button>
          </li>
        ))}
        {filtered.length === 0 && sourceOk ? (
          <li className="text-mono text-text-3" data-slot="sound-list-empty">
            No hay sonidos para este filtro.
          </li>
        ) : null}
      </ul>

      {actionError !== null ? (
        <Alert tone="danger" data-slot="sound-advisor-action-error">
          {actionError}
        </Alert>
      ) : null}

      {/* GUÍA IN-APP del flujo «añadir sonido nativo al publicar» + la RESTRICCIÓN de cuentas Business (§14
          pt 1). Es guía/UI: la herramienta NO añade el sonido por API. */}
      <div
        className="rounded-md border border-border bg-surface-2 p-3"
        data-slot="native-sound-guide"
      >
        <div className="mb-1 font-mono text-micro font-semibold tracking-widest text-text-3">
          CÓMO AÑADIR EL SONIDO NATIVO AL PUBLICAR
        </div>
        <ol className="ml-4 list-decimal text-mono text-text-2 [&>li]:mt-1">
          <li>Descarga el máster SIN bed (con headroom de audio) de esta variante.</li>
          <li>Súbelo a TikTok desde la app, en el editor.</li>
          <li>Añade el sonido trending elegido con el botón «Sonidos» del editor nativo.</li>
          <li>Activa el disclosure AIGC antes de publicar (obligatorio, §15.4).</li>
        </ol>
        <Alert tone="warning" data-slot="native-sound-business-restriction" className="mt-2">
          Restricción de cuentas Business (§14): los trending sounds no-CML solo están disponibles
          en cuentas personales/creator. En cuentas Business —las que usa la publicación por API— el
          selector se limita a la Commercial Music Library, así que un sonido no-CML solo puede
          añadirse publicando MANUALMENTE desde una cuenta personal/creator. Además, un post con
          sonido trending no-CML NO puede promocionarse después (Spark queda bloqueado).
        </Alert>
      </div>
    </div>
  );
}
