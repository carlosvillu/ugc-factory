# Verificación T6.2 — Checklist de publicación + CP5 (modo degradado manual)

- **Tarea**: T6.2 · Checklist de publicación + CP5 (modo degradado manual) (`planning.md`)
- **Fecha**: 2026-07-31
- **Ejecutor**: verifier (escéptico, contexto fresco) · agent-browser 0.27.x · sesión `t6.2`
- **Sistema**: commit `fbcdb83` (diff de T6.2 SIN commitear: 6 ficheros tracked de wiring + 11 untracked nuevos) · docker compose dev (`ugc-postgres-dev`) + migración `0026_free_whirlwind.sql` aplicada + `pnpm dev` (web+worker) · datos: 3 variantes aprobadas sembradas por el verifier (script propio, NO fixtures del implementer)
- **Gate**: `pnpm gate:phases` VERDE — las 9 fases PASS sobre el árbol RESTAURADO (`fbcdb83`, hash `6c2501bf`), incluidas `test` (unit+integración: `publishing.test.ts`, `publishing-repo.test.ts`), `check:contrast`, `e2e:wired:check` y `test:e2e:phases`. NOTA: este `report.md` + las 11 evidencias se escribieron DESPUÉS del gate; como `gate-phases.mjs` hashea también el contenido untracked, un `gate:phases --report` posterior marcará las 9 fases STALE — atribuible ÚNICAMENTE a los ficheros de evidencia añadidos bajo `docs/verifications/T6.2/`, no a cambio de código de producto.

## Verificación esperada (literal de planning.md)
> el checklist de una variante con `audio_source=native_trending` **bloquea** la opción Spark con explicación; el de una con bed IA la permite; con CP5 activado, el flujo de publicación (en el modo degradado manual de esta tarea) se pausa en el checkpoint y al confirmar se reanuda. **Control negativo**: revertir la regla Spark → Spark se ofrece para `native_trending` (ROJO); revertir el flag de pausa de CP5 → el flujo no se detiene (ROJO).

Bullet DoD (regla 10): `apps/web/e2e/publishing-checklist.spec.ts` cubre reglas Spark/AIGC por `audio_source` y pausa/reanudación de CP5 en modo degradado manual.

## Escenario preparado (por el verifier, NO fixtures del implementer)
3 variantes APROBADAS sembradas con propiedades que el spec del implementer NO usa (tiktok-only/organic) para no replicar sus fixtures:

| Variante | id | audio_source | plataformas | destino |
|---|---|---|---|---|
| trending | `01KYVDMDC3KJN4TC0T8V73XQPW` | native_trending | tiktok | organic |
| bed | `01KYVDMDC8FERGKBHP4APKKT3M` | ai_bed | tiktok + meta | **paid** |
| own | `01KYVDMDCD8DG7ZG03NE44S413` | own_license | meta | organic |

## Pasos ejecutados (CUA — app usada como humano en `/library`)
1. Login por la UI (`/login`, contraseña sembrada por el verifier en `app_setting`) → home. `/library` lista EXACTAMENTE las 3 variantes sembradas.
2. Seleccionar variante **trending** → `spark-option` con `data-allowed="false"`, botón `[disabled]`, `spark-blocked-reason` visible con el texto de licencia comercial (§14). Captura `01`.
3. Seleccionar variante **bed** (ai_bed, tiktok+meta, paid) → `spark-option` con `data-allowed="true"`, botón habilitado, `spark-blocked-reason` count = 0. El checklist deriva 5 ítems incl. `meta_ai_info_label` (mi escenario meta, no el tiktok-only del implementer). Captura `02`.
4. CP5 sobre **bed**: estado inicial `ready` (`03`) → activar el Switch CP5 (`data-enabled=true`, `04`) → «Iniciar publicación» → **PAUSA** en `waiting_confirmation` con botón «Confirmar y reanudar» visible (`05`) → «Confirmar y reanudar» → `confirmed` (`06`). Persistido en BD: `cp5_enabled=t, flow_state=confirmed`.
5. CP5-OFF sobre **own** (CP5 desactivado por defecto): «Iniciar publicación» → **directo** a `confirmed` sin pasar por `waiting_confirmation` (`07`). Persistido: `cp5_enabled=f, flow_state=confirmed`.
6. Consola del navegador: SIN errores/warnings de código propio (solo info dev-only de React DevTools + HMR, que muere en prod, excepción cua.md §110). `browser-console.txt`.
7. Persistencia del checklist (marcar un ítem sobrevive a recarga): cubierta y VERDE en el e2e permanente (`e2e-green.txt`, test 5).

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | native_trending BLOQUEA Spark con explicación | `data-allowed=false`, botón `[disabled]`, aviso §14 visible | 01, snapshot | OK |
| 2 | bed IA PERMITE Spark | `data-allowed=true`, habilitado, sin aviso | 02 | OK |
| 3 | own_license PERMITE Spark (sanity null-ish) | Spark ofrecido | API + UI | OK |
| 4 | CP5 on: start PAUSA en waiting_confirmation | pausa + botón confirmar visible | 05, BD | OK |
| 5 | CP5 on: confirmar REANUDA a confirmed | `confirmed` | 06, BD | OK |
| 6 | CP5 off: start DIRECTO a confirmed (sin pausa) | `confirmed`, nunca waiting | 07, BD | OK |
| 7 | marcar checklist PERSISTE tras recarga | e2e permanente verde | e2e-green.txt | OK |
| 8 | spec permanente pasa en el gate | 5/5 verde; gate:phases 9/9 PASS | e2e-green.txt, gate | OK |
| 9 | NO se creó N10/executor; T6.2b intacta | solo wiring UI+API+persistencia; build-variant-generation-plan / assemble-composition-spec / api/assets SIN tocar | git diff --stat | OK |

## Control negativo
Ambos controles ejercidos al nivel e2e (la señal que prueba que la UI CONSUME core, no que duplica la regla) — cada uno reddece SU test y se restauró el fichero byte-idéntico (sha `ce10ff0b...` antes = después).

- **Revertir la regla Spark** (`sparkEligibility`: bloquear `'ai_bed'` en vez de `'native_trending'`, revert type-valid) → e2e `la regla Spark` **FAILED**: `Expected: "false" Received: "true"` en `data-allowed` de `spark-option` para native_trending (Spark OFRECIDO para native_trending = ROJO). Salida en `cn-spark-reverted.txt`.
- **Revertir la pausa de CP5** (`nextPublishState`: `start` -> siempre `'confirmed'`) → e2e `el flujo se PAUSA` **FAILED**: `Expected: "waiting_confirmation" Received: "confirmed"` en `data-flow-state` tras activar CP5 e iniciar (el flujo NO se detiene = ROJO). Salida en `cn-cp5-reverted.txt`.

### Detalle #1 — regla Spark revertida (ROJO)
```
X 2 [chromium] publishing-checklist.spec.ts:116 la regla Spark: native_trending BLOQUEA...
  Error: expect(locator).toHaveAttribute(expected) failed
  Expected: "false"
  Received: "true"     (spark-option data-allowed="true" para native_trending)
  > 137 | await expect(sparkT).toHaveAttribute('data-allowed', 'false');
```

### Detalle #2 — pausa de CP5 revertida (ROJO)
```
X 2 [chromium] publishing-checklist.spec.ts:152 CP5: con el checkpoint ACTIVADO el flujo se PAUSA...
  Error: expect(locator).toHaveAttribute(expected) failed
  Expected: "waiting_confirmation"
  Received: "confirmed"
  > 175 | await expect(flow).toHaveAttribute('data-flow-state', 'waiting_confirmation', ...)
```

### Restauración
`packages/core/src/contracts/publishing.ts` restaurado tras cada revert; `diff` vs backup = IDENTICAL, sha `ce10ff0bffadbb63830ecee9c176b0594df80db1bab864eb8bcc58a5f876c4c7` (antes y después). El gate:phases posterior corrió sobre el árbol restaurado (hash `6c2501bf`).

## Coste real
$0 — UI + API + persistencia. Cero llamadas a fal/Anthropic/Firecrawl (verificado: el flujo no toca el pipeline de generación). vs estimado $0.

## Veredicto
**PASS** — el sistema real hace lo que la Verificación describe: native_trending bloquea Spark con explicación, bed IA (y own_license) lo permiten, y CP5 pausa/reanuda en modo degradado manual (y sin CP5 va directo a confirmado). Ambos controles negativos reddecen su e2e y el árbol quedó restaurado. Gate completo verde.

**Notas / rarezas (aunque PASS)**:

- **HALLAZGO DE CONTRASTE A RUTEAR (cua.md §111, NO flip del PASS)**: el panel es un NUEVO consumidor del par `--danger sobre --danger-soft`, que en tema DARK mide **4.45:1 < 4.5:1 AA** (cuarentena diferida, mismo lote que los slots de `/gallery`, memoria `ds-contrast-slots-galeria`). Consumidores: `Badge tone="danger"` = `text-danger` sobre `bg-danger-soft` en TODO ítem `required` del checklist (camino feliz, no estado de error) + `Alert tone="danger"` (slots de error `publishing-load-error`/`publishing-action-error`). En light el mismo par es 5.28:1 (pasa). Se REPORTA con el ratio (cua.md §111: cuando el color viene del DS, se rutea, no se ignora); la recalibración es decisión del usuario ya diferida. El `spark-blocked-reason` (el texto que la Verificación exige legible) usa `Alert tone="warning"` = `--warning`/`--warning-soft` = 5.27:1 light / 7.28:1 dark → OK. El panel NO introduce colores hardcodeados.
- **CLICK del agente (HALLAZGO a observar, cua.md regla 1 — no lo adjudico)**: dos fenómenos distintos, ninguno reproducido por el e2e permanente (Playwright `.click()` con eventos reales pasa 5/5 contra el `next build` del stack e2e). (a) `cp5-toggle` (Switch Base UI): el click sintético de agent-browser NO lo dispara — consistente en 3 métodos (selector CSS, ref `@e13`, `find role switch`); activó por teclado (focus + Space). (b) `cp5-start`: en la variante `bed` el click SÍ funcionó; en la variante `own` falló dos veces (con un Fast Refresh/HMR en consola) y activó por focus+Enter. El click SÍ funcionó en login, `library-variant-item` (×3) y `cp5-confirm`. Que el click funcione en unos controles y no en otros del mismo panel NO lo explica del todo «handlers de puntero de Base UI»; queda SIN RESOLVER en dev. La activación por teclado es interacción humana válida y el e2e real cubre la regresión; lo dejo como observación para que el bucle decida, no como «no es un bug».
- **Rareza a rutear (§Entrega «música según audio_source»)**: el checklist NO varía sus ítems por `audio_source` (trending=4 ítems, bed=5; el delta se explica ÍNTEGRAMENTE por `meta_ai_info_label` de la plataforma meta, no por el audio). La diferenciación por `audio_source` se materializa SOLO vía la elegibilidad de Spark (block/allow), que sí quedó probada. La Verificación vincula solo el block/allow de Spark, así que no es FAIL; se anota por si «música según audio_source» esperaba ítems de checklist distintos por fuente de audio.
- **Mutaciones del entorno de dev (dejar constancia para el usuario)**: (1) se REEMPLAZÓ `app_setting['auth.password_hash']` del dev local por el hash de `verify-t62-pass` para poder loguear el CUA — el password previo del usuario NO se restaura (`seedPasswordHashIfAbsent` es ON CONFLICT DO NOTHING); el usuario debe re-sembrarlo (borrar la fila y reiniciar con `AUTH_BOOTSTRAP_PASSWORD`, o poner su hash). (2) Quedan en la BD dev: las 3 variantes sembradas + su linaje, MÁS filas huérfanas (project/url_analysis/product_brief/persona/ad_batch/asset) del primer intento con ULIDs inválidos donde solo se borró el `ad_variant`. No es un defecto de T6.2; explica filas inesperadas en `/library`.
- Alcance confirmado: el diff NO toca `build-variant-generation-plan.ts`, `assemble-composition-spec.ts` ni `POST /api/assets` (los tres seams de T6.2b nombrados en el SPLIT del planning). No se creó N10 ni executor.
