# Verificación T5.10 — Dashboard y vista de proyecto

- **Tarea**: T5.10 · Dashboard y vista de proyecto (`planning.md` línea 892)
- **Fecha**: 2026-07-27
- **Ejecutor**: verifier (escéptico, contexto fresco) · agent-browser 0.27.x · sesión `t5.10`
- **Sistema**: diff T5.10 sin commitear sobre `be970e9` · `docker-compose.dev.yml` (Postgres 16 en :55432) + `pnpm dev` en :3000 + seeds de arranque (library/gallery/personas) · Colima runtime · BD dev con gasto real pre-existente ($7.64 en el mes en curso)

## Verificación esperada (literal de planning.md)
> crear un proyecto desde la UI, lanzar un lote en él → el dashboard muestra el lote activo y el gasto del mes del proyecto; `/projects/[id]` lista sus briefs y variantes con estados correctos.

Aclaración del planning (regla 1 de cua.md): «lanzar un lote» se **siembra por repo** (data en reposo, coste $0); el step bajo verificación es el dashboard MOSTRANDO datos + el CRUD de proyectos.

## Pasos ejecutados
1. Login en `/login` → sesión iniciada, aterrizo en `/` (dashboard real). `01-dashboard-inicial.png`: KPIs reales ($7.64 gasto del mes, 2 lotes activos), lote "Mi proyecto" existente.
2. `/projects` → "+ Nuevo proyecto" → diálogo (`02-dialogo-crear-proyecto.png`) → "Nombre" = `VERIF T5.10 c9f2a1` → "Crear proyecto". El proyecto **aparece en la lista** (creado DESDE LA UI, no por API).
3. Entro al detalle del proyecto recién creado → `/projects/01KYGFF0RQY4E3HY8SAXS73GS2`. Empty-state honesto (`03-proyecto-vacio-empty-state.png`): Métricas a 0, "Aún no hay lotes", "Aún no hay briefs", Gasto total $0.00.
4. **Siembro un lote EN ESE proyecto por repo** (script tsx contra BD dev, $0): url_analysis + brief `approved` ("Zapatillas VERIF T5.10") + lote `running` con **3 variantes en estados distintos** (`approved`, `generating`, `qa`) + run + step + **DOS cargos**: **$5.55 mes en curso** (2026-07-27) y **$9.99 hace ~40 días** (2026-06-17, mes anterior). Amounts elegidos por el verifier (NO los 777/1234 del spec del implementer).
5. `/` recargado (`04-dashboard-con-lote-activo.png`): el lote sembrado aparece en «Lotes activos» por su proyecto, badge "generando", progreso "1 de 3 aprobadas", **"$5.55 este mes"** (mes ∧ proyecto). KPI global "Gasto del mes" → **$13.19** (= $7.64 previos + $5.55; el cargo de junio $9.99 EXCLUIDO).
6. `/projects/[id]` (`05-projects-id-briefs-variantes.png`): Métricas Lotes 1 / Variantes 3 / Aprobadas 1 / **Gasto total $15.54** (all-time = $5.55 + $9.99). Lote badge "generando", "$15.54". Brief "Zapatillas VERIF T5.10" badge "aprobado".
7. **Probe de estado de variante**: en BD, flip `qa → rejected`; recargo `/projects/[id]`. La página renderiza **idéntica** ("3 variantes · 1 de 3 aprobadas"); "rejected"/"rechazado" NO aparece (`06-variantes-sin-estado-individual.png`). Restaurada a `qa`.
8. CRUD completo (Entrega, no en la Verificación literal): 2º proyecto vacío `VERIF vacio d4e8b2` → **editar** (rename a `VERIF renombrado d4e8b2`, persiste) → **archivar** (confirmación, PATCH ok, desaparece; BD confirma `status='archived'`).
9. Contraste WCAG en badges (dark y light). Consola capturada (`browser-console.txt`).

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Crear proyecto DESDE LA UI → aparece | Diálogo UI, `VERIF T5.10 c9f2a1` creado y listado | 02 | OK |
| 2 | Dashboard `/` muestra el lote activo del proyecto | Lote sembrado en «Lotes activos», por nombre de proyecto, badge "generando" | 04 | OK |
| 3 | Dashboard muestra el **gasto del mes** del proyecto | «$5.55 este mes» (mes-scoped): excluye el cargo de junio $9.99; KPI global $13.19 también lo excluye | 04 + SQL 555/1319 | OK |
| 4 | `/projects/[id]` lista **briefs** con estados correctos | Brief con badge "aprobado" (per-brief) | 05 | OK |
| 5 | `/projects/[id]` lista **variantes** con estados correctos | Variantes NO listadas individualmente ni con estado por variante; solo agregado "3 variantes · 1 de 3 aprobadas". Flip `qa→rejected` no cambia NADA en la página | 05, 06, SQL | FAIL |
| 6 | (Entrega) CRUD mínimo de proyectos | Crear/editar/archivar por UI; archive persiste (`status='archived'`) | paso 8 | OK |
| 7 | Control negativo: proyecto sin lotes no aporta lote falso | `VERIF vacio d4e8b2` ausente de «Lotes activos» (count 0); su detalle = empty-state | 03, count=0 | OK |

**El punto 5 decide el veredicto.** El resto de la Verificación literal PASA.

## Prueba del filtro «gasto del mes» (probe discriminante)
`dashboard.repo.ts` aplica `occurred_at >= date_trunc('month', now())` por lote en el dashboard; `/projects/[id]` "Gasto total" NO filtra por mes. Sembré dos cargos para distinguirlos:

| Superficie | Filtro | Valor | Cargos incluidos |
|---|---|---|---|
| `/` — lote, "este mes" | mes en curso ∧ lote | **$5.55** | solo julio ($5.55) |
| `/` — KPI global "Gasto del mes" | mes en curso (global) | **$13.19** | $7.64 previos + $5.55; **excluye** $9.99 junio |
| `/projects/[id]` — "Gasto total" | all-time ∧ proyecto | **$15.54** | $5.55 + $9.99 |

SQL de contraste: `month_batch_spend=555`, `alltime_project_spend=1554`, `global_month=1319`. La ventana mensual está genuinamente aplicada.

## Contraste WCAG de badges de estado (getComputedStyle + ratio WCAG; 11px/600 → umbral 4.5:1)
| Badge | Tono (token DS) | Tema | color / fondo | Ratio | OK |
|---|---|---|---|---|---|
| generando | info | **dark** | rgb(59,130,246) / rgb(24,31,44) | **4.49** | FAIL (-0.01) |
| aprobado | success | dark | rgb(34,197,94) / rgb(21,38,29) | 6.96 | OK |
| planificado | warning | dark | rgb(245,158,11) / rgb(43,34,21) | 7.31 | OK |
| generando | info | light | rgb(10,88,216) / rgb(231,238,251) | 5.31 | OK |
| aprobado | success | light | rgb(20,113,54) / rgb(232,241,235) | 5.27 | OK |
| planificado | warning | light | rgb(136,88,6) / rgb(243,238,230) | 5.29 | OK |

**Hallazgo (a rutear, NO bloquea T5.10)**: tono `info` en dark = 4.49:1, un pelo por debajo del AA. Token del DS (`Badge` tone `info`, TD.3 commit 0a1e330); T5.10 consume la primitiva estándar, no hardcodea color. Por cua.md línea 111 = "hallazgo a rutear si el color viene del DS". Solo dark; light pasa. Recalibrar `--color-info`/`--color-info-soft` en Claude Design + DesignSync.

## Consola del navegador
`browser-console.txt`: solo ruido dev-only de dependencias fijadas (React DevTools info, `[HMR] connected`, `[Fast Refresh]`). CERO `console.error`, cero warnings de código propio, y **NO** apareció el `Hydration failed` en `/projects` que la nota del planning (línea ~801) advertía bajo HMR — no se reprodujo. `errors` vacío.

## Control negativo
Sin tests nuevos del verifier; el control negativo se construye con dos probes de datos que MUERDEN sin tocar código de producto:

1. **Proyecto sin lotes NO aporta lote falso**: `VERIF vacio d4e8b2` creado por UI (sin lotes). En `/` la región «Lotes activos» lo muestra con `count = 0` (ausente); su detalle = empty-state "Aún no hay lotes". Si el dashboard fabricara un lote fantasma → count >= 1 → FAIL. Observado: count 0.
2. **El cargo de junio ($9.99) NO se cuela en «gasto del mes»**: si el filtro mensual estuviera roto (all-time), el lote mostraría `$15.54 este mes` y el KPI global `$23.18`. Observado: lote `$5.55 este mes`, global `$13.19` (SQL `month_batch_spend=555`, no 1554); el cargo de junio SOLO en "Gasto total" all-time ($15.54). El filtro muerde el cargo antiguo.

## Gate y flakes conocidos (T5.21)
- `pnpm gate` en máquina QUIETA (sin `pnpm dev`/CUA compitiendo por Colima): **GATE_REAL_EXIT=0**, 239 files / **2503 tests unit+integration passed**. IMPORTANTE sobre el alcance: esta corrida cubrió lint + typecheck + format:check + knip + la suite unit/integration (2503). **NO ejecuté yo el `test:e2e` (Playwright) en esta sesión** — el veredicto es FAIL sobre una cláusula que NINGÚN spec afirma, así que re-correr los e2e no cambiaría el resultado; el "5/5 de `dashboard.spec.ts`" es la afirmación del implementer/brief, no un dato que este verifier haya reproducido independientemente. La verificación real la hice conduciendo el sistema (UI/API/BD), no vía los specs.
- Una PRIMERA corrida del gate CONTAMINADA (gate + dev + CUA a la vez en el mismo VM) dio 2 fallos por CONTENCIÓN (`generate-concurrent-dedup.test.ts` → `FalProviderError: polling agotó 10000ms` = timeout bajo carga; `sse-contract.test.ts` "2 skipped" + FAIL = colisión de hook/puerto); NINGUNO toca dashboard/projects, y AMBOS desaparecieron al re-correr el gate solo. Se reporta la corrida limpia.
- Rojos NO-DETERMINISTAS de la suite e2e completa (`f4-generation:94`, y a veces `gallery:44`/`persona-library-cp2:112`) = **T5.21 conocido** (asserts de recuento GLOBAL sobre tablas compartidas bajo `fullyParallel`), AJENOS a T5.10. Esto hace visible el juicio de known-flake, no una vara rebajada.
- **Punto ciego del spec permanente**: `dashboard.spec.ts` pasa 5/5 y AUN ASÍ no caza este fallo — su test de `/projects/[id]` afirma `2 variantes` (recuento) y `aprobado` (brief), que es EXACTAMENTE el agregado que oculta el hueco de estado por variante. El fix del implementer debe extender ese spec para afirmar estado POR VARIANTE, o el próximo verifier verá verde sobre el mismo agujero.

## Coste real
**$0** — todo el escenario sembrado por repo/BD (data en reposo). Ninguna llamada a APIs de pago. El gasto mostrado es el real pre-existente de la BD dev + cargos sembrados en reposo. vs estimado del planning: $0. Sin recalibración.

## Veredicto
**FAIL** — la cláusula «`/projects/[id]` lista sus briefs y **variantes** con estados correctos» NO se cumple LITERAL: las variantes no se listan individualmente ni exponen su estado por variante — solo un agregado ("3 variantes · 1 de 3 aprobadas"). Confirmado empíricamente (flip `qa→rejected` no altera la página) y a nivel de código (`project-detail-view.tsx` pinta solo Métricas + Lotes + Briefs; `ProjectDetailSchema` ni siquiera transporta datos por variante). Los briefs SÍ se listan con estado; el resto de la Verificación (crear proyecto por UI, lote activo en `/`, gasto del mes del proyecto con filtro mensual correcto, control negativo, CRUD) PASA sólidamente.

**Qué debe arreglar el implementer (accionable)**: en `/projects/[id]` (`project-detail-view.tsx` + `getProjectDetail`/`dashboard.repo.ts` + `ProjectDetailSchema` en `contracts/project.ts`), añadir el listado de VARIANTES del proyecto con su estado individual (badge por variante: `planned|scripting|scripted|generating|composing|qa|approved|rejected|published`), coherente con PRD §8.1 (enumera "variantes" como sección de primer nivel de la vista de proyecto) y con la Verificación. Hoy el detalle sirve briefs + lotes + métricas, pero las variantes solo como recuento. La decisión de si el agregado basta para "variantes con estados correctos" es un cambio de alcance que corresponde al bucle/usuario, no al verifier.

**Rarezas**:
- Contraste `info` en dark = 4.49:1 (-0.01 del AA): defecto de token del DS (TD.3), a rutear a Claude Design + DesignSync; no bloquea T5.10. Solo dark; light pasa.
- Nota prospectiva (NO observada como fallo): el dashboard muestra el gasto del mes **por lote**. Con el proyecto de un solo lote que verifiqué, la cifra por lote ES el gasto del mes del proyecto y fue correcta ($5.55). Un proyecto con dos lotes activos no la agregaría en una sola cifra "del proyecto" — pero ese escenario no lo probé; queda como observación a futuro, no como desviación observada.
- Crear por UI NO navega a `/projects/[id]` (solo prepende a la lista); decisión de UX, no fallo.
