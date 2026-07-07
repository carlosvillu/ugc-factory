# Verificación TD.1 — Tokens del DS, fuentes Geist y showcase `/design-system`

- **Tarea**: TD.1 · Tokens del DS, fuentes Geist y showcase `/design-system` (`planning.md`)
- **Fecha**: 2026-07-07
- **Ejecutor**: verifier · agent-browser 0.27.x · sesión `td.1`
- **Sistema**: commit `e68dab6` (working tree con el diff de TD.1 sin commitear) · `next dev` (apps/web, Next 16.2.10 Turbopack) en localhost:3000. Sin docker/seeds/BD: TD.1 es pura UI estática.

## Verificación esperada (literal de planning.md)
> en el navegador, `/design-system` muestra los specimens; los switchers cambian tema/acento/densidad en vivo; comparación visual CUA contra `docs/design-system/guidelines/*.card.html` sin desviaciones perceptibles.

## Pasos ejecutados
1. Gate local (`pnpm gate`) verde: eslint/typecheck(5)/prettier/knip OK, 30 tests pasan.
2. Diff token→globals.css: 110 tokens, 102 literales exactos; 8 restantes son indirecciones correctas (shadows vía `--elevation-*` dark/light; fonts vía `var(--font-geist-*)` = self-hosting).
3. `next dev` arriba (GET /design-system 200); ruta abierta con agent-browser.
4. Snapshot: 12 headings de specimens + 9 botones switcher, 1:1 con los cards.
5. Default: theme=null(dark), accent=null(indigo), --bg=#0a0a0b, --surface=#141416, --accent=#6366f1, --ui-fs=14px, body=GeistSans 14px. Screenshot 01.
6. Tema→light (en vivo, sin reload): --bg=#fbfbfc, --surface=#ffffff, --text=#18181b. Screenshot 02.
7. Acento→emerald sobre dark: --accent=#10b981, --bg sigue #0a0a0b (independiente del tema). Screenshot 03. amber=#f59e0b, cyan=#06b6d4 verificados.
8. Densidad: compact --ui-fs=13px, comfortable=15px, balanced=14px. Screenshots 04/05.
9. Consola: solo React DevTools info + HMR; errors vacío.
10. Red de fuentes: Geist/GeistMono desde /_next/static/media/*.woff2; 0 requests a googleapis/gstatic. ⚠ fuentes cerrada.
11. Comparación visual vs cards: hexes de labels semánticos idénticos, radios/escala tipográfica/familias/glifos fieles. Sin desviaciones perceptibles.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | specimens de fundaciones | 12 secciones 1:1 con cards | 01, snapshot | ✅ |
| 2 | tema en vivo (light invierte) | bg #fbfbfc, surface #ffffff, text #18181b, sin reload | 02 | ✅ |
| 3 | acento cambia primario, independiente | emerald #10b981 sobre dark; amber/cyan/indigo OK | 03 | ✅ |
| 4 | densidad cambia base body | compact 13 / balanced 14 / comfortable 15 px | 04, 05 | ✅ |
| 5 | sin errores de consola | solo DevTools info + HMR | browser-console.txt | ✅ |
| 6 | Geist self-hosted (no Google Fonts) | woff2 local; 0 requests googleapis/gstatic | perf resources | ✅ |
| 7 | sin desviaciones perceptibles | tokens 1:1, labels idénticos, glifos fieles | 01–05 vs *.card.html | ✅ |

## Coste real
$0 — sin APIs de pago. vs estimado $0. ✓

## Veredicto
**PASS** — `/design-system` renderiza todos los specimens fieles a los cards; los tres switchers mutan tema/acento/densidad en vivo sobre `<html>` con los valores exactos de los tokens; sin errores de consola; Geist/Geist Mono self-hosted (⚠ fuentes cerrada).

Notas (PASS igualmente):
- El swatch "indigo" de "Acento de marca" muestra el acento ACTIVO (lee `--accent`): con emerald se ve verde. Coherente con specimen del acento vivo, pero el label "indigo" puede leerse como estático. Cosmético, no bloqueante.
- Los 8 tokens no-literales son indirecciones correctas, no desviaciones (valor resuelto 1:1).
