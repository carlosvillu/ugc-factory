# Verificación TD.7 — Skill frontend cerrada contra la realidad + E2E de fase FD

- **Tarea**: TD.7 · E2E de fase FD (showcase `/design-system`) (`planning.md`)
- **Fecha**: 2026-07-08
- **Ejecutor**: verifier (contexto fresco) · chrome-devtools-mcp (conexión persistente) · sin agent-browser (inestable con overlays Base UI en TD.4/TD.5)
- **Sistema**: commit `288af62` · `pnpm --filter @ugc/web dev` (:3000) para el recorrido + `next build && next start` (:3100) para el chequeo de consola en producción · código de producto limpio (git status sin cambios en apps/ ni packages/)

## Alcance de este veredicto
Cubre **la parte AUTOMATIZABLE** de la Verificación de TD.7: recorrido CUA de las 4 combinaciones tema×acento, coherencia de todos los componentes y overlays, consola y `pnpm gate`.
La **revisión humana final del showcase (OK visual del usuario)** es una parada de fin de fase y **queda PENDIENTE** — no la ejecuta el verifier. Esta evidencia está preparada y navegable para ese OK.

## Verificación esperada (literal de planning.md)
> recorrido CUA completo de `/design-system` — dark, light y 2 acentos — con evidencia visual en `docs/verifications/TD.7/`; `pnpm gate` verde; y **revisión humana final del showcase** (parada de fin de fase: el usuario da el OK visual).

## Pasos ejecutados
1. `pnpm gate` desde la raíz (ORDEN: gate verde antes del CUA) → EXIT 0 (lint + typecheck + format:check + knip + test 35/35). `test:e2e` está deshabilitado a propósito hasta T0.4 (aún no hay suite Playwright), así que el gate lo excluye correctamente. Ver `gate-output.txt`.
2. Levantar dev (:3000), `curl /design-system` → 200; next-server confirmado sirviendo el commit del diff.
3. Inventario del DOM: 1×h1 + 32×h2 → confirmadas TODAS las secciones/componentes enumerados (foundations, core+forms, feedback/nav/datos, overlay/estructura, producto).
4. **Recorrido en 4 combinaciones**, conmutando con los switchers reales (clicks CUA sobre los botones de la barra TD.1), con verificación OBJETIVA del token en cada una:
   - (a) **dark + indigo** (default): `--accent`→#6366f1, botón primario rgb(99,102,241), bodyBg rgb(10,10,11). `01-full-dark-indigo.png`.
   - (b) **light + indigo**: `data-theme=light`, bodyBg rgb(251,251,252). `02-full-light-indigo.png`.
   - (c) **dark + emerald**: `data-accent=emerald`, `--accent`→#10b981, botón primario rgb(16,185,129). `03-full-dark-emerald.png`.
   - (d) **light + amber** (3er acento): `data-theme=light` + `data-accent=amber`, `--accent`→#f59e0b, botón primario rgb(245,158,11). `04-full-light-amber.png`.
5. **Overlays abiertos en dark Y light** (dialog, sheet, alert-dialog, toast, tooltip):
   - Dialog: `05-dialog-dark.png`, `09-dialog-light.png`.
   - Sheet: `06-sheet-dark.png`, `11-sheet-light.png`.
   - Alert-dialog: `08-alertdialog-dark.png`, `10-alertdialog-light.png`.
   - Tooltip (hover CUA real): `16-tooltip-dark.png` (bg rgb(33,33,38), texto rgb(244,244,245)), `15-tooltip-light.png` (bg rgb(238,238,241), texto rgb(24,24,27)).
   - Toast: prueba de render por computed-style en ambos temas (ver nota) + intentos `13-toast-dark.png`, `14-toast-light.png`.
6. **Consola**: única entrada en toda la sesión = warning dev-only de Base UI Toast (`flushSync`), disparado solo al encolar toast. Ver `browser-console.txt`.
7. **Chequeo en producción**: `next build` (EXIT 0, `/design-system` prerenderizada estática) + `next start` (:3100); tras encolar los 4 toasts la consola queda LIMPIA. Ver `prod-build.log`, `prod-build-console.txt`.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | `pnpm gate` verde | EXIT 0, 35/35 tests | gate-output.txt | ✅ |
| 2 | Recorrido en dark | dark+indigo y dark+emerald, todas las secciones | 01, 03 | ✅ |
| 3 | Recorrido en light | light+indigo y light+amber, todas las secciones | 02, 04 | ✅ |
| 4 | 2 acentos | indigo + emerald + amber (3), probados por token (#6366f1/#10b981/#f59e0b en el botón primario) | 01–04 | ✅ |
| 5 | Acento cambia botones/anillos/badges accent | Botón primario y pills activas cambian con el acento; anillos de foco siguen `--accent` | 01,03,04 | ✅ |
| 6 | Tema cambia superficies/texto | bodyBg y superficies/texto se invierten dark↔light desde tokens | 01–04 | ✅ |
| 7 | Nada con color hardcodeado fuera del tema/acento | Semánticos (success/warning/danger/info) FIJOS a propósito; danger sigue rojo; sin superficies filtradas | 01–04 | ✅ |
| 8 | Sin roturas visuales | Ninguna observada | 01–04 | ✅ |
| 9 | Overlays coherentes en cada tema | dialog/sheet/alert-dialog/tooltip en dark y light; toast probado por render en ambos | 05,06,08,09,10,11,15,16 (+probes) | ✅ |
| 10 | Consola sin errores propios | Único ruido = flushSync dev-only de Base UI; LIMPIA en prod build | browser-console.txt, prod-build-console.txt | ✅ |

## Nota sobre el toast (conflicto DOM vs captura, resuelto)
El toast **renderiza y se re-tematiza correctamente** — probado por computed-style en ambos temas:
- dark: `bg rgb(20,20,22)`, opacity 1, visible, dentro de viewport, barra success verde rgb(34,197,94).
- light: `bg rgb(255,255,255)`, borde rgb(229,229,233), título rgb(24,24,27), opacity 1, dentro de viewport, barra success verde.
Las capturas de píxeles (`13`, `14`) salieron sin el toast: es una **limitación de tooling** (el toast de Base UI se auto-descarta a ~5 s y la latencia entre `evaluate` y `take_screenshot` agota ese margen), **no un defecto del producto**.

## Deuda / rarezas (no bloquean)
- **flushSync (Base UI Toast, dev-only)**: solo al encolar toast; dependencia fijada, no código propio; **desaparece en prod build** (re-confirmado; coincide con TD.4). Excepción estrecha cua.md §Paso 3 → deuda upstream. Documentado en `apps/web/src/components/ui/toast.tsx`.
- `ToastProvider` del showcase está scoped al specimen; viewport `fixed bottom-4 right-4` (correcto), pero su transitoriedad complica la captura por CUA.

## Coste real
$0 (todo local, sin APIs de pago). vs estimado de fase $0. ✓

## Veredicto
**PASS** (parte automatizable) — el showcase recorre las 4 combinaciones dark/light × indigo/emerald/amber re-tematizando todos los componentes y overlays desde los tokens, sin roturas, con semánticos fijos y consola limpia (único warning = deuda upstream dev-only que muere en prod, verificado). `pnpm gate` verde.
**Pendiente (no del verifier)**: revisión humana final / OK visual del usuario — parada de fin de fase FD. La evidencia visual (16 capturas + consolas) queda lista para ese OK.

_(Report persistido por el bucle principal: el harness bloquea la Write en subagentes para este path; contenido literal emitido por el verifier.)_

---

## Revisión humana final — OK VISUAL DADO (2026-07-08)

El usuario revisó el showcase `/design-system` en vivo (parada de fin de fase FD). **Hallazgo del OK visual**: reportó mal contraste texto/fondo en botones de acento. Diagnóstico objetivo (DOM + getComputedStyle + ratios WCAG) reveló DOS bugs, ambos corregidos antes del OK:
- **(A) código**: `cn`/`tailwind-merge` sin configurar borraba `text-text-on-accent` (confundía `text-mono` font-size con text-color) → texto en `--text` heredado (negro en light). Fix: `extendTailwindMerge` con los font-size tokens custom (`apps/web/src/lib/utils.ts`). Afectaba a 20 componentes.
- **(B) valores del DS** (decisión del usuario): blanco sobre acentos claros fallaba AA (emerald 2.54 / amber 2.15 / cyan 2.43). Fix: `--text-on-accent` por acento (indigo blanco, resto oscuro `#0a0a0b`) + indigo oscurecido `#6366f1`→`#5457e5`. Subido al DS remoto + espejo + código.

**Matriz de contraste final del botón primary (verificada, todos AA)**: indigo 5.42 · emerald 7.80 · amber 9.21 · cyan 8.15 — dark y light.

Añadida al protocolo `cua.md` una aserción de contraste obligatoria (ningún verifier de la fase lo medía — agujero cerrado para F0).

**El usuario dio el OK visual con los fixes vivos.** TD.7 y la fase FD quedan cerradas.
