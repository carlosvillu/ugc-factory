# Verificación T0.12 — Ledger de gasto (esqueleto)

- **Tarea**: T0.12 · Ledger de gasto (esqueleto) (`planning.md`)
- **Fecha**: 2026-07-10
- **Ejecutor**: verifier (agente) · agent-browser 0.27.x · sesión `t0.12`
- **Sistema**: diff T0.12 SIN commitear sobre `21df2b1` (working tree con los ficheros nuevos de spend + migración `0004_shallow_solo.sql`) · Postgres 16 dev (`ugc-postgres-dev`, puerto 55432) · `pnpm dev` (web + worker) · migración 0004 aplicada · sin seeds de datos (solo el seed idempotente de `budget` vía `BUDGET_MONTHLY_LIMIT_CENTS`)

## Verificación esperada (literal de planning.md)
> tras 3 runs de demo con costes ficticios **elegidos por el verifier** (no los fixtures del implementer), `/spend` muestra la suma exacta esperada; un presupuesto de prueba por debajo del gasto dispara la alerta in-app.

## Importes elegidos por el verifier (NO fixtures del implementer)
Fixtures del implementer, todos evitados: 250, 500, 99, 100, 4321, 1, 1000, 1234, 300, 600, 750, 599, 18640, 640.

| Run | Proveedor | costCents |
|---|---|---|
| 1 | fal | 377 |
| 2 | anthropic | 1288 |
| 3 | firecrawl | 842 |

**Suma total esperada calculada a mano ANTES de mirar /spend** = 377 + 1288 + 842 = **2507 cents = $25.07**.
Los 3 runs caen el mismo día UTC (2026-07-10) → tabla por día: 1 fila = $25.07.

## Pasos ejecutados
1. Gate previo: `pnpm gate` → verde (lint + typecheck + format + knip + 477 tests). `pnpm test:e2e` → 21 passed (incluye los 3 specs T0.12 de spend). Confirma que la suite entra al gate en verde.
2. Verifiqué estado limpio de BD ANTES de sembrar: `cost_entry` y `budget` no existían → apliqué `pnpm db:migrate` (migración 0004) → ambas tablas creadas y VACÍAS (0 filas). Evita verificar contra un ledger sucio.
3. Arranqué web+worker con `BUDGET_MONTHLY_LIMIT_CENTS=2000` (POR DEBAJO de 2507). Health `{ok:true,db:true}`. El seed idempotente sembró `budget monthly:2000`.
4. Login por navegador (agent-browser, sesión `t0.12`) con el password de bootstrap → cookie de sesión.
5. Lancé los 3 runs de demo vía `POST /api/runs` (autenticado con cookie), cada uno con un nodo `demo.sleep.N0`, `sleepMs:0`, mi `costCents`/`costProvider`. → 3 runId.
6. Esperé por condición (`cost_entry` count = 3, ~1 s) — el worker ejecutó el path de éxito → `recordCost`. Cross-check psql: las 3 filas EXACTAS que sembré (fal 377 / firecrawl 842 / anthropic 1288).
7. Navegué a `/spend` en el navegador y leí los valores RENDERIZADOS (evidencia primaria), más cruce con psql de los agregados.
8. **Control negativo**: borré la fila `budget` (prep de escenario), reinicié web con `BUDGET_MONTHLY_LIMIT_CENTS=3000` (POR ENCIMA de 2507), recargué `/spend` → la alerta desaparece.

## Resultado observado vs esperado
| # | Esperado | Observado en /spend (navegador) | Cross-check psql | Evidencia | OK |
|---|---|---|---|---|---|
| 1 | Suma total = $25.07 | "$25.07" (barra de presupuesto) | total = 2507 | 01-spend-con-alerta.png | ✅ |
| 2 | Por proveedor: Anthropic $12.88, Firecrawl $8.42, fal.ai $3.77 | exactamente esos 3, orden gasto desc | 1288 / 842 / 377 | 01-...png / psql-crosscheck.txt | ✅ |
| 3 | Por día: 2026-07-10 = $25.07 | fila única "2026-07-10 · $25.07" | 2026-07-10 = 2507 | 01-...png | ✅ |
| 4 | Presupuesto 2000 < gasto → alerta in-app visible | banner `role="alert"` `data-testid=spend-over-limit-alert`: "Gasto por encima del presupuesto: $25.07 de $20.00." | overLimit (2507>=2000) = t | 01-...png | ✅ |
| 5 | Control: presupuesto 3000 > gasto → SIN alerta | 0 elementos `role="alert"`; banner ausente; "$25.07 / $30" | budget = 3000 | 02-spend-sin-alerta-control.png | ✅ |

Sin errores de float/redondeo: céntimos enteros, `formatCost` = `(cents/100).toFixed(2)`. Todos los importes mostrados coinciden al céntimo con lo sembrado.

### Consola del navegador
Limpia: solo `info` de React DevTools y logs de HMR/Fast-Refresh (ruido dev-only de Next). Cero `console.error`/warning de código propio. (`browser-console.txt`.)

### Contraste WCAG del banner de alerta (dark theme, acento danger)
Medido con getComputedStyle + ratio WCAG sobre el fondo efectivo (bg translúcido `rgba(239,68,68,0.1)` compuesto sobre el body `rgb(10,10,11)`):
- Texto (`rgb(161,161,170)`): **7.16:1** ≥ 4.5 ✅
- Glifo ⚠ danger (`rgb(239,68,68)`, `aria-hidden` decorativo): **4.87:1** ≥ 4.5 ✅

## Coste real
**$0.** No se llamó a ninguna API de pago: los "costes" son números ficticios elegidos por el verifier e insertados vía la config del executor de demo. Postgres y worker locales. Estimado del planning: $0. Sin desviación.

## Veredicto
**PASS** — ambas cláusulas cumplen contra el sistema real: `/spend` renderiza la suma exacta ($25.07) y sus desgloses por proveedor y día al céntimo con los 3 importes que elegí (fal 377 / anthropic 1288 / firecrawl 842), y un presupuesto por debajo del gasto (2000) dispara el banner de alerta in-app; el control con presupuesto por encima (3000) confirma que la alerta desaparece.

Notas / rarezas (aunque PASS):
- La página vive en `app/spend/` sin el layout `(dashboard)` con nav lateral (aún no existe esa tarea): coherente con el comentario del código y el alcance de esqueleto. No afecta la Verificación.
- El seed de presupuesto es idempotente (`seedMonthlyBudgetIfAbsent`, JAMÁS sobrescribe): para el control negativo hubo que BORRAR la fila `budget` (prep de escenario, no toca la superficie verificada) y reiniciar web. En F0 no hay panel de settings (T7.7) para cambiar el límite en vivo — el único camino es la env var + reinicio, como documenta el código.
- La migración 0004 estaba sin aplicar en la BD de dev al empezar (el diff está sin commitear); se aplicó con `pnpm db:migrate` antes de verificar. Es parte del arranque normal, no un hallazgo.
