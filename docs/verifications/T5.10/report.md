# Verificación T5.10 — Dashboard y vista de proyecto

- **Tarea**: T5.10 · Dashboard y vista de proyecto (`planning.md`)
- **Fecha**: 2026-07-27 (RE-VERIFICACIÓN tras FAIL #1, ver `report-fail-1.md`)
- **Ejecutor**: verifier (escéptico, contexto fresco) · agent-browser 0.27.x · sesión `t5.10`
- **Sistema**: diff T5.10 sin commitear sobre `be970e9` · `docker-compose.dev.yml` (Postgres 16 en :55432) + `pnpm dev` en :3000 + seeds de arranque (library/gallery/personas + password bootstrap) · Colima runtime · BD dev con gasto real pre-existente. Health `{"ok":true,"db":true}`.

## Verificación esperada (literal de planning.md)
> crear un proyecto desde la UI, lanzar un lote en él → el dashboard muestra el lote activo y el gasto del mes del proyecto; `/projects/[id]` lista sus briefs y variantes con estados correctos.

Aclaración (regla 1 de cua.md): «lanzar un lote» se **siembra por repo** (data en reposo, coste $0); el step bajo verificación es el dashboard MOSTRANDO datos + el CRUD de proyectos.

## Qué cambió respecto al FAIL #1
El FAIL #1 fue: `/projects/[id]` NO listaba variantes con estado individual (solo el agregado del lote "1 de 3 aprobadas"); un flip `qa→rejected` no alteraba la página. El implementer añadió: `VariantStatusSchema` + `ProjectVariantSchema` + `variants[]` en `ProjectDetailSchema` (`contracts/project.ts`); query `projectVariants` (`dashboard.repo.ts`); sección `region[aria-label="Variantes del proyecto"]` en `project-detail-view.tsx` con un `Badge` de estado por variante (`data-testid="project-variant-<id>"`), etiquetas en femenino distintas de las de brief/lote; y extendió `dashboard.spec.ts` para afirmar estado POR VARIANTE (scoped por `data-testid`, con aserción cruzada). Verificado empíricamente abajo, no asumido.

## Escenario sembrado (por repo, $0 — `seed.mjs`)
Proyecto `REVERIF T5.10 x9go0o` con url_analysis + brief `approved` ("Zapatillas REVERIF"). **Dos lotes running en el MISMO proyecto** (probe two-batch que el verifier previo aparcó):
- **B1** (conversion): 5 variantes en estados DISTINTOS que el spec del implementer NO usa — `composing`, `qa`, `published`, `planned`, `generating` (esta última = objetivo del flip probe). Cargos: **$5.55 mes en curso** + **$9.99 hace ~40 días** (mes anterior).
- **B2** (story): 1 variante `approved`. Cargo: **$3.33 mes en curso**.

Valores esperados verificados por SQL (`probe-output.txt`): `project_month=888` ($8.88 = 555+333), `project_alltime=1887` ($18.87), `per_batch_month` = {B1:555, B2:333}, 6 variantes en 6 estados distintos.

## Pasos ejecutados
1. Login `/login` (password bootstrap dev) → dashboard `/`. `r01-dashboard.png`.
2. **`/projects` → "+ Nuevo proyecto" → diálogo → nombre → "Crear proyecto"**: el proyecto aparece en la lista (creado DESDE LA UI). `r04-dialogo-crear.png`.
3. `/` con el escenario: el proyecto de DOS lotes aparece como **dos filas** en «Lotes activos», cada una con badge "generando", progreso y su gasto del mes scoped al lote (B2 `$3.33 este mes`, B1 `$5.55 este mes`). KPI global "Gasto del mes" = `$22.07`. `r01-dashboard.png`, `r08-dashboard-two-batches.png`.
4. `/projects/[id]`: Métricas (Lotes 2 / Variantes 6 / Aprobadas 1 / **Gasto total $18.87** all-time). Briefs con badge "aprobado". **Sección «Variantes del proyecto» lista las 6 variantes, cada una con su estado INDIVIDUAL** (`aprobada`, `en QA`, `planificada`, `publicada`, `en generación`, `componiendo`). `r02-project-detail.png`.
5. **Flip probe (prueba dura del fix)**: en BD, `generating → rejected` de UNA variante; hard-navigate a `/projects/[id]`. La tarjeta de ESA variante pasa a **`rechazada`**; las otras 5 quedan idénticas. Restaurada a `generating`. `r03-variant-flipped-rejected.png`. (En el FAIL #1, el mismo flip no cambiaba NADA — ver `06-...png`.)
6. CRUD por UI: nuevo proyecto vacío → **editar** (rename, persiste en la lista) → **archivar** (diálogo de confirmación, desaparece de la lista; BD confirma `status='archived'`, no delete físico). `r05-empty-state.png`, `r06-crud-archivado.png`, `check-archived.mjs`.
7. Control negativo: el proyecto vacío muestra empty-state en lotes, variantes y briefs; NO aparece en «Lotes activos» del dashboard (0 ocurrencias).
8. Contraste WCAG de badges de estado (dark y light, compositando el `*-soft` translúcido sobre la superficie real). Consola/errores capturados.
9. Suite: `pnpm gate` verde en máquina quieta; `dashboard.spec.ts` + `library.spec.ts` corridos aparte (no están en `test:e2e:phases`).

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Crear proyecto DESDE LA UI → aparece | Diálogo UI, proyecto creado y listado | r04 | OK |
| 2 | Dashboard `/` muestra el lote activo del proyecto | Lote(s) activo(s) por nombre de proyecto, badge "generando", progreso | r01, r08 | OK |
| 3 | Dashboard muestra el **gasto del mes** del proyecto | `$5.55` (B1) y `$3.33` (B2) «este mes», scoped al lote; excluye el cargo de junio $9.99 | r08, SQL 555/333 | OK |
| 4 | `/projects/[id]` lista **briefs** con estados | Brief con badge "aprobado" (per-brief) | r02 | OK |
| 5 | `/projects/[id]` lista **variantes** con estados correctos | **6 variantes, cada una con su estado INDIVIDUAL** (aprobada/en QA/planificada/publicada/en generación/componiendo). Flip de una → SOLO esa cambia a rechazada | r02, r03, SQL | OK |
| 6 | (Entrega) CRUD mínimo de proyectos | Crear/editar/archivar por UI; archive persiste (`status='archived'`) | r05, r06, check-archived | OK |
| 7 | Control negativo: proyecto sin lotes no aporta lote falso | Empty-state en lotes/variantes/briefs; ausente de «Lotes activos» (0) | r05 | OK |

**El punto 5 (que decidió el FAIL #1) ahora PASA de forma dura.** El resto de la Verificación literal sigue pasando.

## Probe two-batch: «gasto del mes DEL PROYECTO» (rareza que el verifier previo aparcó)
El verifier #1 dejó pendiente si el dashboard, con >1 lote por proyecto, agregaría el gasto en UNA cifra "del proyecto". Sembré dos lotes running en el mismo proyecto y lo ejercité:
- El dashboard renderiza **dos filas per-lote**, cada una con su gasto del mes scoped al lote: B1 `$5.55`, B2 `$3.33`. No existe una cifra sumada "$8.88 del proyecto" — **por diseño**.
- **Lectura literal**: el sujeto de la cláusula es «el lote activo»; «el gasto del mes del proyecto» se materializa como el gasto mes-scoped atribuible al lote activo de ese proyecto, y es correcto y honesto (555 y 333 casan con SQL exacto; el $9.99 de junio queda fuera). Nada en el texto exige un agregado sumado por proyecto. **No es desviación**: probe ejecutada, atribución limpia, sin misattribution.

## Contraste WCAG de badges de variante (getComputedStyle + composición del `*-soft`; 11px/600 → umbral 4.5:1)
| Badge (tono DS) | Dark: color / effBg | Dark ratio | Light ratio | OK |
|---|---|---|---|---|
| aprobada / publicada (success) | rgb(34,197,94)/rgb(21,38,29) | 6.96 | 5.27 | OK |
| en QA (warning) | rgb(245,158,11)/rgb(43,34,21) | 7.31 | 5.29 | OK |
| planificada (**neutral**, tono nuevo) | rgb(161,161,170)/rgb(33,33,38) | 6.25 | 6.68 | OK |
| en generación / componiendo (info) | rgb(59,130,246)/rgb(24,31,44) | **4.49** | 5.31 | dark -0.01 |
| rechazada (**danger**, tono nuevo, medido por primera vez) | rgb(239,68,68)/rgb(42,25,27) | **4.46** | 5.30 | dark -0.04 |

**Hallazgo (a rutear, NO bloquea T5.10)**: en DARK, los tonos `info` (4.49) y `danger` (4.46) caen un pelo por debajo del AA. Ambos son tonos de la primitiva `Badge` del DS (clases `text-info/bg-info-soft` y `text-danger/bg-danger-soft/border-danger-border`); T5.10 consume la primitiva estándar, NO hardcodea color. Por cua.md línea 111 = "hallazgo a rutear si el color viene del DS". `info` ya estaba pendiente (memoria del proyecto); `danger` es nuevo en esta medición. Solo dark; light pasa holgado. Recalibrar `--color-info*`/`--color-danger*` en Claude Design + DesignSync.

## Consola del navegador
`browser-console.txt`: solo ruido dev-only de dependencias fijadas (React DevTools info, `[HMR] connected`, `[Fast Refresh]`). CERO `console.error`, cero warnings de código propio, y **NO** apareció ningún `Hydration failed` en `/projects`. `browser-errors.txt` vacío.

## Control negativo
El fix añade tests; el control negativo se apoya en la prueba dura de que MUERDEN y en la evidencia roja preservada del FAIL #1:

1. **Estado por variante (el hueco del FAIL #1)**: flip `generating -> rejected` de UNA variante + hard-navigate -> SOLO esa tarjeta pasa a `rechazada`, las otras 5 intactas (`r03-variant-flipped-rejected.png`). Prueba de que MUERDE: en el FAIL #1 el mismo flip (`qa->rejected`) no cambiaba nada — evidencia roja preservada en `06-variantes-sin-estado-individual.png` + `report-fail-1.md` (veredicto FAIL, punto 5). Los 6 estados que conduje (composing/qa/published/planned/generating/approved) NO son el par approved/rejected sobre el que el spec del implementer fija — el fix se probó en estados que el spec no toca.
2. **Proyecto sin lotes NO aporta lote falso**: el proyecto vacío está ausente de «Lotes activos» (0 ocurrencias); si el dashboard fabricara un lote fantasma -> >=1 -> FAIL. Observado: 0.
3. **El cargo de junio ($9.99) NO se cuela en «gasto del mes»**: B1 muestra `$5.55 este mes` (no $15.54); SQL `per_batch_month` B1=555. El filtro `occurred_at >= date_trunc('month', now())` muerde el cargo antiguo (solo aparece en "Gasto total" all-time = $18.87).

## Gate y suite (medición honesta, leída del LOG)
- **`pnpm gate` en máquina QUIETA** (antes de arrancar `pnpm dev`/CUA, para evitar la contención de Colima que contaminó la corrida #1): `GATE_REAL_EXIT=0` (`gate.log`). 239 test files / **2503 tests unit+integration passed**; lint + typecheck + format + knip + readme:status + check:contrast + e2e:wired + `test:e2e:phases` verde (incl. `f4-generation.spec.ts:94` = flake T5.21 conocido, que en ESTA corrida pasó).
- **`dashboard.spec.ts` + `library.spec.ts`** corridos APARTE (no están en `test:e2e:phases`; el gate no los cubre) con `pnpm dev` detenido para no contender: **`E2E_REAL_EXIT=0`, 11 passed** (5 dashboard + 5 library + setup) (`e2e-dashboard-library.log`). Esto REPRODUCE independientemente el "5/5 dashboard" que el verifier #1 marcó como afirmación no reproducida del implementer, y confirma que `library.spec.ts` (tocado por T5.10, solo sufijo único drive-by en nombres de persona, ninguna aserción relajada) sigue verde. El test `dashboard.spec.ts:242` afirma ahora estado POR VARIANTE scoped por `data-testid` — pasa.
- Rojos NO-deterministas de la suite e2e COMPLETA (`f4-generation:94`, y a veces `gallery:44`/`persona-library-cp2:112`) = **T5.21 conocido** (asserts de recuento GLOBAL sobre tablas compartidas bajo `fullyParallel`), AJENOS a T5.10. No aparecieron en las corridas de esta sesión.

## Coste real
**$0** — todo el escenario sembrado por repo/BD (data en reposo). Ninguna llamada a APIs de pago. vs estimado del planning: $0. Sin recalibración. **Escenario sembrado limpiado al terminar** (`cleanup-final.mjs`): los proyectos `REVERIF%` y sus cargos fabricados fueron borrados; la BD dev queda en su estado previo (el `VERIF T5.10 c9f2a1` que persiste es del verifier #1, no de esta sesión).

## Veredicto
**PASS** — la Verificación literal se cumple entera contra el sistema real: crear proyecto por UI, dashboard con lote(s) activo(s) y gasto del mes scoped correctamente (filtro mensual verificado, cargo antiguo excluido), y `/projects/[id]` listando briefs con estado Y **variantes con estado INDIVIDUAL por variante** — el hueco del FAIL #1, ahora cerrado y comprobado con el flip probe (una tarjeta cambia, el resto no) sobre estados que el spec del implementer no fija. CRUD y control negativo sólidos. Gate verde y specs de T5.10 verdes leídos del log.

**Rarezas** (no bloquean):
- Contraste en DARK: `info` 4.49:1 y `danger` 4.46:1, ambos tonos del DS consumidos sin hardcode -> a rutear a Claude Design + DesignSync (`info` ya pendiente; `danger` nuevo). Light pasa.
- El gasto del mes en el dashboard es per-lote, no un agregado sumado por proyecto: probado con dos lotes, atribución correcta, decisión de diseño coherente con la lectura literal.
- Crear por UI no navega a `/projects/[id]` (solo prepende a la lista): decisión de UX, no fallo.
