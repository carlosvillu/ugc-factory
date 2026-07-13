// Tests de la primitiva `Image` del DS (T1.18) — y existen por una regresión que NADIE vio venir:
// la primera versión sacaba el estado de `loading` SOLO con el evento `onLoad`, y **si la imagen ya
// está completa cuando React engancha el handler (asset CACHEADO), ese evento no se dispara NUNCA**.
// La imagen se descargaba perfectamente (`complete: true`, `naturalWidth: 1638`) y el usuario no la
// veía jamás: el `<img>` se quedaba en `opacity-0` con la trama encima, para siempre. Rompió
// `persona-detail` en PRODUCCIÓN (`next build && next start`, sin StrictMode ni HMR).
//
// POR QUÉ LOS 1243 TESTS VERDES NO VIERON NADA — principio 9, otra vez, y por el ángulo de siempre:
// EL ARNÉS ERA MÁS CÓMODO QUE LA REALIDAD. Ni en jsdom ni en Playwright una imagen llega jamás YA
// CACHEADA al montar: siempre se carga fresca, así que el evento siempre llegaba y el agujero era
// literalmente inobservable. El estado en el que el bug vive no lo producía ningún test.
//
// De ahí el fixture de este fichero: se FUERZA el estado real (`complete`/`naturalWidth` del DOM,
// que es lo que el navegador expone de una imagen cacheada) en vez de simular un evento cómodo.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { Image } from './image';

afterEach(() => {
  cleanup();
  restoreImageDom();
});

/**
 * jsdom NO carga imágenes: su `HTMLImageElement.complete` es siempre `true` y su `naturalWidth`
 * siempre `0` — o sea, jsdom por defecto finge «imagen rota YA resuelta», que casualmente NO es el
 * estado que rompió nada. Para poder escribir los tres estados que importan (cacheada-ok,
 * cacheada-rota, aún-cargando) se controlan las dos propiedades que el navegador expone y que el
 * fix LEE. Es el ÚNICO doble honesto posible: son exactamente los bits que decide el navegador.
 */
let imageDom: { complete: boolean; naturalWidth: number } = { complete: false, naturalWidth: 0 };

function setImageDom(state: { complete: boolean; naturalWidth: number }): void {
  imageDom = state;
}

beforeEach(() => {
  Object.defineProperties(HTMLImageElement.prototype, {
    complete: { configurable: true, get: () => imageDom.complete },
    naturalWidth: { configurable: true, get: () => imageDom.naturalWidth },
  });
  // Default: la imagen AÚN se está bajando (el caso normal: el evento decidirá).
  setImageDom({ complete: false, naturalWidth: 0 });
});

function restoreImageDom(): void {
  setImageDom({ complete: false, naturalWidth: 0 });
}

/** El marco de la primitiva (su `data-status` ES el contrato observable de la máquina). */
function frame(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-slot="image"]')!;
}
function img(): HTMLImageElement {
  return document.querySelector<HTMLImageElement>('img')!;
}

describe('Image (primitiva del DS, T1.18)', () => {
  test('LA REGRESIÓN: una imagen YA CACHEADA (complete, con píxeles) se ve — sin esperar un evento que no llegará', () => {
    // EL CASO QUE ROMPIÓ persona-detail. El navegador ya tenía el asset, así que cuando React monta
    // el `<img>` la imagen YA está completa: `onLoad` no se disparará nunca. Si el estado solo
    // saliera de `loading` por el evento, esto se quedaría en `opacity-0` para siempre.
    setImageDom({ complete: true, naturalWidth: 1638 });
    render(<Image src="/api/assets/abc/download" alt="Retrato" ratio="4/5" />);

    expect(frame()).toHaveAttribute('data-status', 'loaded');
    // Y SE VE de verdad: sin `opacity-0` encima (que era el síntoma exacto), y sin la trama.
    expect(img().className).toContain('opacity-100');
    expect(img().className).not.toContain('opacity-0');
    expect(document.querySelector('[data-slot="image-placeholder"]')).toBeNull();
  });

  test('una imagen YA RESUELTA Y ROTA (complete, sin píxeles) muestra el estado de ERROR', () => {
    // La otra mitad de la misma reconciliación — y es el camino del centinela de CP1
    // (`data:image/gif;base64,no-es-una-imagen`): un `src` que el navegador resuelve al instante y
    // sin píxeles. Si la reconciliación se hiciera mal (p. ej. tratando `complete` como éxito), la
    // candidata inservible de T1.18 volvería a ofrecerse como buena.
    setImageDom({ complete: true, naturalWidth: 0 });
    render(<Image src="data:image/gif;base64,no-es-una-imagen" alt="" ratio="1/1" />);

    expect(frame()).toHaveAttribute('data-status', 'error');
    expect(screen.getByText('⚠ no disponible')).toBeInTheDocument();
  });

  test('carga NORMAL (la imagen no estaba en caché): el evento onLoad la pone `loaded`', () => {
    setImageDom({ complete: false, naturalWidth: 0 });
    render(<Image src="https://cdn.example/hero.jpg" alt="Hero" />);

    // Mientras baja: trama + etiqueta, y la imagen transparente (sin salto de layout).
    expect(frame()).toHaveAttribute('data-status', 'loading');
    expect(screen.getByText('imagen')).toBeInTheDocument();

    // Llega el evento CON píxeles de verdad.
    setImageDom({ complete: true, naturalWidth: 800 });
    fireEvent.load(img());

    expect(frame()).toHaveAttribute('data-status', 'loaded');
    expect(img().className).toContain('opacity-100');
  });

  test('un `onError` (404/403 del CDN) pinta «⚠ no disponible», nunca un icono roto', () => {
    render(<Image src="https://cdn.example/403.jpg" alt="X" />);
    fireEvent.error(img());

    expect(frame()).toHaveAttribute('data-status', 'error');
    expect(screen.getByText('⚠ no disponible')).toBeInTheDocument();
    // Y el `<img>` roto ya NO está en el DOM: no hay glifo roto que ver.
    expect(document.querySelector('img')).toBeNull();
  });

  test('cambiar de `src` REINICIA la máquina (no hereda el veredicto de la imagen anterior)', () => {
    // Sin esto, una imagen rota dejaría su «⚠ no disponible» pintado sobre la siguiente (y una
    // cargada dejaría su frame sobre una que falla) — el estado imposible que la tarea elimina.
    const { rerender } = render(<Image src="https://cdn.example/rota.jpg" alt="" />);
    fireEvent.error(img());
    expect(frame()).toHaveAttribute('data-status', 'error');

    // La nueva imagen SÍ carga (y encima ya está cacheada: la reconciliación tiene que correr
    // también en el reset, no solo al montar).
    setImageDom({ complete: true, naturalWidth: 1200 });
    rerender(<Image src="https://cdn.example/buena.jpg" alt="" />);

    expect(frame()).toHaveAttribute('data-status', 'loaded');
    expect(screen.queryByText('⚠ no disponible')).toBeNull();
  });

  test('sin `src`: `empty` — la trama con su etiqueta y NINGÚN `<img>`', () => {
    render(<Image ratio="9/16" placeholder="sin render" />);

    expect(frame()).toHaveAttribute('data-status', 'empty');
    expect(screen.getByText('sin render')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    // La caja se reserva igual (el `ratio` evita el salto de layout).
    expect(frame().style.aspectRatio).toBe('9/16');
  });
});
