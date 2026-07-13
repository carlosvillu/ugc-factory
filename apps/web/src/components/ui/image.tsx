'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

// Image — 1:1 with the DS mirror (structure/Image.jsx + Image.d.ts, T1.18): the system's ONE
// image primitive. Wraps user content (scraped thumbnails, persona references, generated frames)
// in a neutral frame: 1px --border, --r-lg radius by default, object-fit cover.
//
// Its point is the STATE MACHINE, not the frame. Before the image loads — and, crucially, IF IT
// FAILS — the frame paints the DS's one sanctioned placeholder: the 135° --surface-3/--stripe
// diagonal hatch with a mono label. On error the label becomes «⚠ no disponible» in --danger.
// That error state is FIRST-CLASS and it is why this primitive exists: a raw <img> whose src 403s
// renders a BROKEN glyph, which is exactly what CP1 was showing for a hero candidate the system
// could not download (T1.18). A broken image in a gallery whose purpose is «elige con criterio»
// is a lie about the state of the world; this says «no disponible» and means it.
//
// Presentational and PURE (no network of its own beyond the <img> the browser issues for `src`;
// no domain types). Callers that need to KNOW whether the image is usable must find out
// themselves (fetch it) and pass the outcome via `src` — the DS contract has no onError prop and
// this component does not invent one (see HeroCandidateOption in checkpoints/brief-editor.tsx).
//
// next/image is deliberately NOT used: these are remote URLs from an arbitrary CDN decided at
// runtime (`remotePatterns` is a BUILD-time allowlist) or authenticated same-origin proxies whose
// loader would strip the session cookie. The eslint-disable below is the SINGLE remaining one in
// the app — it lives here, in the primitive, and not scattered across consumers.

/** Radius token → literal Tailwind class. Literal strings: Tailwind only emits classes it can
 *  SEE (design-system.md §3.5 — never `rounded-${radius}`). */
const RADIUS: Record<NonNullable<ImageProps['radius']>, string> = {
  none: 'rounded-none',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  full: 'rounded-full',
};

/** object-fit → literal Tailwind class (same reason). */
const FIT: Record<NonNullable<ImageProps['fit']>, string> = {
  cover: 'object-cover',
  contain: 'object-contain',
  fill: 'object-fill',
  none: 'object-none',
  'scale-down': 'object-scale-down',
};

export interface ImageProps {
  /** Image URL. Omit to render the hatch placeholder only. */
  src?: string;
  /** Alt text — pass a real description for meaningful images. */
  alt?: string;
  /** Lock the frame's aspect ratio before load, e.g. "9/16", "1/1", "16/9". */
  ratio?: string;
  /** Corner radius token. @default "lg" */
  radius?: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** object-fit for the loaded image. @default "cover" */
  fit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  /** Draw the 1px --border frame. @default true */
  bordered?: boolean;
  /** Mono label shown in the placeholder before load. @default "imagen" */
  placeholder?: string;
  /** Size the frame via width / height (or let ratio + a fixed width drive it). */
  style?: React.CSSProperties;
  className?: string;
}

/** El estado de la primitiva: `empty` (sin src), `loading`, `loaded`, `error`. */
type Status = 'empty' | 'loading' | 'loaded' | 'error';

export function Image({
  src,
  alt = '',
  ratio,
  radius = 'lg',
  fit = 'cover',
  bordered = true,
  placeholder = 'imagen',
  style,
  className,
}: ImageProps) {
  const [status, setStatus] = useState<Status>(src ? 'loading' : 'empty');
  // A NEW `src` restarts the machine: without this, swapping the source would keep the previous
  // outcome (a loaded frame would stay painted over a broken new one, and vice versa). Adjusting
  // DURING RENDER (the React docs' pattern for "state that changes when a prop changes") and not
  // in an effect: an effect would paint the stale frame once, then re-render — and the lint rule
  // that bans setState-in-effect exists precisely for that cascade.
  const [lastSrc, setLastSrc] = useState(src);
  if (src !== lastSrc) {
    setLastSrc(src);
    setStatus(src ? 'loading' : 'empty');
  }

  /**
   * RECONCILIACIÓN CON EL DOM REAL — el fix de la regresión de `persona-detail` (verifier de
   * T1.18). Los eventos `onLoad`/`onError` NO son fuente de verdad suficiente: **si la imagen ya
   * está completa cuando React engancha el handler (asset CACHEADO), el evento no vuelve a
   * dispararse NUNCA**. El síntoma medido en producción era demoledor y silencioso: la imagen se
   * había descargado perfectamente (`complete: true`, `naturalWidth: 1638`) y el usuario no la
   * veía JAMÁS — el `<img>` se quedaba en `opacity-0` con la trama pintada encima, para siempre.
   *
   * CP1 se libraba por casualidad (su `src` es un `blob:` creado DESPUÉS del montaje, así que el
   * evento siempre llega); `persona-detail` recibe una URL normal que el navegador ya tiene en
   * caché ⇒ muerta. Por eso la verdad se LEE DEL DOM en cuanto hay nodo, y el evento queda como lo
   * que es: la notificación de lo que aún no había pasado.
   *
   * El ref callback corre al montar Y cada vez que React vuelve a colgar el nodo; `sync` se llama
   * además desde los propios handlers, de modo que hay un ÚNICO sitio que decide el estado:
   *   - `complete && naturalWidth > 0` ⇒ `loaded` (ya estaba: el evento no va a venir).
   *   - `complete && naturalWidth === 0` ⇒ `error`. Es el camino del centinela de CP1
   *     (`data:image/gif;base64,no-es-una-imagen`): un src ya resuelto y roto. Las dos mitades de
   *     la tarea dependen de esta misma línea.
   *   - si no está `complete`, aún se está bajando: se deja en `loading` y el evento decidirá.
   */
  const sync = (img: HTMLImageElement | null): void => {
    if (!img) return;
    if (!img.complete) return; // sigue bajando: `onLoad`/`onError` dirán qué pasó
    setStatus(img.naturalWidth > 0 ? 'loaded' : 'error');
  };

  const showPlaceholder = status !== 'loaded';

  return (
    <div
      data-slot="image"
      data-status={status}
      className={cn(
        'hatch relative overflow-hidden',
        RADIUS[radius],
        bordered && 'border border-border',
        className,
      )}
      // `aspectRatio` is a runtime value the caller chooses ("9/16", "1/1"): Tailwind cannot emit
      // it as a class and TD.6 bans bracket arbitraries → the sanctioned escape hatch is inline
      // style (design-system.md §3.1). The caller's own `style` wins over it (it sizes the box).
      style={{ aspectRatio: ratio, ...style }}
    >
      {src && status !== 'error' ? (
        /* Las fuentes son CDNs remotos decididos en RUNTIME (el host lo elige la web que el
           usuario analiza) o proxies autenticados del mismo origen; `next/image` exige declarar
           los hosts en `remotePatterns` en BUILD y su loader es OTRA request (sin cookie de
           sesión). La excepción vive AQUÍ, en la primitiva, y no en cada consumidor (T1.18 cerró
           las dos que había sueltas). */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          // `key={src}`: cambiar de imagen MONTA un `<img>` nuevo, y con él vuelve a correr el ref
          // callback sobre el nodo nuevo. Sin la key, React reusaría el nodo y la reconciliación
          // solo dependería del evento — que es justo lo que no llega si la nueva ya está en caché.
          key={src}
          ref={sync}
          src={src}
          alt={alt}
          // Los eventos siguen ahí para la carga NORMAL (la imagen que aún no estaba). Delegan en
          // el mismo `sync`: un solo sitio decide el estado, leyendo el DOM en vez de asumir que el
          // evento implica éxito (`onLoad` de un SVG roto, por ejemplo, no garantiza píxeles).
          onLoad={(e) => {
            sync(e.currentTarget);
          }}
          onError={() => {
            setStatus('error');
          }}
          className={cn(
            'absolute inset-0 block size-full transition-opacity',
            FIT[fit],
            status === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}
      {showPlaceholder ? (
        <span
          data-slot="image-placeholder"
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-micro',
            status === 'error' ? 'text-danger' : 'text-text-3',
          )}
        >
          {status === 'error' ? '⚠ no disponible' : placeholder}
        </span>
      ) : null}
    </div>
  );
}
