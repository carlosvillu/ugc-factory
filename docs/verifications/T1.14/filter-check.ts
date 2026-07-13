// Chequeo INDEPENDIENTE del verifier (no reutiliza los asserts del implementer):
// entradas elegidas por mí sobre el filtro REAL importado del código de producto.
import { fetchableProductImageUrls } from '../../../packages/services/src/visual-analyze';

const cases: [string, boolean][] = [
  // los DOS casos reales que el filtro viejo descartaba → deben PASAR
  ['https://relatio.chat/mobile-app.avif', true],
  ['https://relatio.chat/videos/landing_relatio_poster.avif', true],
  ['https://www.stayforlong.com/_next/image?url=https%3A%2F%2Fcdn%2Fhero.jpg&w=1080&q=75', true],
  // lo que debe seguir FUERA
  ['data:image/png;base64,iVBORw0KGgo=', false],
  ['blob:https://x/abc', false],
  ['https://cdn.example.com/logo.svg', false],
  ['https://cdn.example.com/LOGO.SVG?v=9', false],
  ['/relative/hero.jpg', false],
  // raster clásico sigue pasando
  ['https://cdn.example.com/hero.JPEG', true],
  ['https://cdn.example.com/x.heic', true], // sin extensión conocida → pasa, lo decide el decode
];

let fails = 0;
for (const [url, expected] of cases) {
  const got = fetchableProductImageUrls([{ url }]).length === 1;
  const ok = got === expected;
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FAIL'}  pasa=${got} (esperado ${expected})  ${url}`);
}
console.log(fails === 0 ? '\nTODOS OK' : `\n${fails} FALLOS`);
process.exit(fails === 0 ? 0 : 1);
