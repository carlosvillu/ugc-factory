// apps/web/vitest.setup.ts — mocks de DOM que React Flow exige en jsdom
// (testing/references/frontend.md §2). Sin ellos el canvas monta vacío y los
// tests dan falsos negativos silenciosos. Los mocks tienen métodos vacíos a
// propósito (no-op deliberado del doble de test): se desactiva no-empty-function.
/* eslint-disable @typescript-eslint/no-empty-function */
import '@testing-library/jest-dom/vitest';

class ResizeObserverMock {
  constructor(private cb: ResizeObserverCallback) {}
  observe(target: Element) {
    // @xyflow/system 0.0.79 lee `entry.contentRect.width/height` al observar el
    // pane (XYPanZoom.extentResizeObserver) — sin un `contentRect` medible el mock
    // revienta con "Cannot read properties of undefined (reading 'width')". Se le da
    // el viewport que también fingen offsetWidth/Height abajo.
    const contentRect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1280,
      bottom: 720,
      width: 1280,
      height: 720,
    };
    this.cb([{ target, contentRect } as unknown as ResizeObserverEntry], this);
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock;

// React Flow lee el zoom del transform CSS vía DOMMatrixReadOnly
class DOMMatrixReadOnlyMock {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale ? Number(scale) : 1;
  }
}
globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyMock as unknown as typeof DOMMatrixReadOnly;

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }),
});

// jsdom devuelve 0 en offsetWidth/Height: React Flow necesita un viewport medible
Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: { get: () => 1280 },
  offsetHeight: { get: () => 720 },
});
(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
  ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
