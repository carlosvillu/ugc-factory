# T5.9 · E2E de la fase F5 — report (BLOCKED, $0)

- **Tarea**: T5.9 · E2E de la fase (F5) — export (`planning.md:778-785`)
- **Fecha**: 2026-07-23
- **Veredicto**: **BLOCKED** (estado del árbol) — NO PASS, NO FAIL
- **Coste real**: **$0** (no se llamó a ninguna API de pago; el bloqueo se detectó ANTES de gastar)
- **Detalle completo**: ver `VERIFY.md` (prueba guiada + plan de reanudación) y `run-context.txt`.

> El `report.md` lo materializa el coordinador: un guard del harness impide que un subagente
> escriba ficheros `report*`. El contenido y el veredicto son del verifier (agente
> `a4bdb81ecf869eb16`), sin modificación.

## Por qué BLOCKED

El working tree carga trabajo UNCOMMITTED de una tarea ADYACENTE (la «auditoría del journal /
determinismo-primero» del 2026-07-23), aparecido/editado DURANTE la sesión de verificación. El diff
REAL de T5.9 (`planning.md`, `PRD.md`, `apps/web/e2e/phases/f5-export.spec.ts`, el project f5-export en
`playwright.config.ts`) está verde y ya certificado (2394 tests + e2e 76 passed). Lo ajeno es:
`.claude/hooks/guard-planning.sh` (hook, sin efecto en runtime), `scripts/check-contrast.mjs` y
`scripts/check-e2e-wired.mjs` (tooling nuevo sin cablear, sin efecto en runtime).

Consecuencia: `pnpm gate` está ROJO por esos ficheros ajenos (`format:check` y `knip` fallan solo por
los dos `scripts/*.mjs`; typecheck verde). No hay baseline verde atribuible. El verifier se negó
—correctamente— a arrancar un run de fal REAL (~$15, ~45 min, ESTATEFUL) contra un árbol compartido que
otra tarea edita: no habría estado atribuible respaldando el gasto. **$0 gastado, cap ($15) intacto.**

Verificación del coordinador (2026-07-23 23:06, tras recibir el BLOCKED): el money-path
(`generate-broll.ts`, `content-hash.ts`, `globals.css`) está LIMPIO en el árbol actual; el escritor
externo lleva >10 min inactivo (mtimes 22:46-22:55). El temor del verifier a una colisión con el
money-path no se materializó; el bloqueo se sostiene por el gate rojo no atribuible, no por mutación en curso.

## Resultado por cláusula
| Cláusula | Estado |
|---|---|
| (a) lote real ≥6 var 15–30s, captions, C2PA, <$15, <45 min | **NO EJECUTADA** ($0) |
| (b) texto libre 0-img → CP1 packshot → variante sintética | **NO EJECUTADA** ($0) |
| (c) voces es/en nativas ↔ voice_map (juicio humano) | **NO EJECUTADA** ($0) |

## Control negativo
N/A — verificación de fase con fal REAL bloqueada por estado del árbol ANTES de ejecutar; esta
verificación no añade tests. El control negativo del comportamiento de F5 vive en el spec permanente
`f5-export.spec.ts` (`@f5 @phase`, journey mockeado a $0) y en los controles negativos ROJOS ya
verificados de T5.8a/T5.8b/T5.8 (compose máster + ducking + regen), verdes en el gate.

## Para reanudar
El plan (a)/(b)/(c) está destilado en `run-context.txt` y `VERIFY.md` (no hay que re-derivarlo). Requiere
antes: el dueño de la tarea adyacente commitea o stashea su trabajo → árbol = solo diff de T5.9 y
`pnpm gate` verde → re-despachar el verifier.

## ACTUALIZACIÓN 2026-07-24 (coordinador): RUN REAL EJECUTADO → **FAIL de (a)** · coste $5,78

Tras el desbloqueo (abajo), el run real corrió con bound recalibrado <$40 (autorizado por el usuario).
Veredicto rendido desde la evidencia persistida (el verifier murió por el 6º stall de API tras entregar
el hallazgo; el coordinador NO se auto-evalúa — el contenido es del verifier + verificación $0 del coordinador).

**VEREDICTO: FAIL de la cláusula (a)** — 0/6 variantes barrera compusieron un máster. Coste real **$5,78**
(578¢, 19 cost_entry con fal_request_id reales, run `01KYA3ZFF5QQ5BQVRWW3Y93QQ0`). Contenido muy bajo el
techo $40 (se paró al ver el FAIL — no se gasta para confirmar un FAIL ya visible). Solo 6 variantes barrera
(calibración), no las 12.

Tres hallazgos, decompuestos:
1. **es (3): N7b 422 = ARTEFACTO DE FIXTURE** (no bug de producto). `voice_map` seed mezcla formatos:
   `en→"Rachel"` (nombre, OK) vs `es→"EXAVITQu4vr4xnSDxMaL"` (hash de Sarah → 422 en el proxy elevenlabs de
   fal). Se retira como el cache-MISS de T5.8. FIX: corregir el voiceId es del seed al formato aceptado.
2. **objetivo `hook_test` (12s) = CONFIG del run**, no contradicción del criterio. 22.1 pide 15-30s =
   `conversion` (30s) / `story` (45s), NO `hook_test` (12s, `presets.ts:16`). 2 áng × 3 hooks NO fuerza
   hook_test. El run eligió el objetivo equivocado → solo 3/12 proyectadas ≥15s.
3. **N8 clip < narración = BUG REAL, el bloqueador de fase.** `fitSegmentFile` falla: el clip b-roll (6s en
   hook_test) es más CORTO que la narración del body (8.68s en EN); N8 se niega a componer. CAUSA RAÍZ
   (`scene-planner.ts:104-105`): «⚠ ASUNCIÓN DOWNSTREAM: N8 (recorte a narración) no existe aún». T5.3
   construyó N8 para RECORTAR clips LARGOS, nunca para manejar clips CORTOS. El clip se dimensiona desde
   `quantizeDurationToEnum(secondsForText)` (words/2.5) que SUBESTIMA el TTS inglés real (8.68s) → vídeo <
   audio → hard-fail. **Objective-independent**: a 30s el gap recurre (peor). Deuda PRE-EXISTENTE de T5.3
   destapada por el E2E de fase, no defecto de T5.9. ENRUTAR a implementer (tarea nueva). Bloquea cierre de F5.

Estado `step_run` del run: N6/N7a/N7d/N7e/N7f 6/6 succeeded, N7c 6/6, N7b 3 succeeded (en) + 3 failed (es
422), N8 3 failed (en fitSegment) + 3 awaiting_deps (es, por N7b), N9 6 awaiting_deps. El pipeline generó
casi todo; los 2 fallos son puntuales (1 fixture, 1 bug real).

## ACTUALIZACIÓN 2026-07-24 (coordinador): BLOQUEO LEVANTADO
El trabajo adyacente de la auditoría del journal fue **COMMITEADO** (commit `d5c0e7e` «harness: 4
deterministic guards from journal audit (hooks/gate)»). `git status` = solo el diff de T5.9
(`PRD.md`, `planning.md`, `f5-export.spec.ts`, `docs/verifications/T5.9/`). Los scripts nuevos
(`check-contrast.mjs`, `e2e:wired:check`) YA están cableados en `package.json` y en `pnpm gate`; el hook
`guard-planning.sh` endurecido (sección `## Control negativo` obligatoria) está en HEAD por decisión del
usuario (mantenerlo). El bloqueo de estado del árbol ya NO aplica → el verify de T5.9 se re-despacha sobre
árbol estable. (El apartado de arriba sobre «árbol contaminado» queda como registro histórico del estado
en que el verifier paró, correctamente, sin gastar.)

---

# ACTUALIZACIÓN 2026-07-25 · RUN REANUDADO TRAS CERRAR T5.8c → **FAIL de fase** + PARADA EXTERNA

- **Veredicto**: **FAIL de fase** + **PARADA POR PREREQUISITO EXTERNO** (saldo de Anthropic agotado)
- **Coste real**: **$4,62** (fal $3,86 · Anthropic $0,76 · Firecrawl $0,00) de **$40** autorizados. Techo intacto.
- **Matriz**: recortada a 6 variantes por decisión del usuario (la cláusula pide «≥6»), objetivo
  `conversion` (30s), tier premium.
- **Evidencia**: `VERIFY.md` + `probes/` (×8) + capturas `b-01`…`b-09`, `a-01`, `a-02`. El VERIFY del
  intento del 2026-07-23 se preserva íntegro en `VERIFY-2026-07-23-blocked.md`.

> Contenido y veredicto del verifier (agente `a0c9c63ef5640bf28`), sin modificación.

## Resultado por cláusula

| Cláusula | Esperado | Observado | Estado |
|---|---|---|---|
| (a) URL real → ≥6 var 15–30s es+en, captions, C2PA, <$40, <45 min | lote completo aprobado | **NO EJECUTADA**: N5 escribió 5/12 guiones (saldo Anthropic agotado). NO se aprobó CP3 ⇒ **$0 de fal** en esta rama | **FAIL** |
| (b) texto libre 0 img → packshot-IA en CP1 → `synthetic_product=true` | ≥1 variante aprobada | variante `01KYCMTTKYA5JMF3DZ29ETF0XX` **approved**, N7a ×2 con `synthetic_product=t`, N2 `skipped` (0 img) | **PASS** |
| (c) voces es/en nativas ↔ `voice_map` (revisión humana) | 1 clip por idioma | solo existe el clip **es**; el **en** no llegó a generarse | **PENDIENTE-JUICIO-HUMANO** |

## ✅ T5.8c validado en el FLUJO REAL (el desbloqueo funcionó)

N8 compuso máster **sin `FitError`**, con **N7d = 2 entries** (escena troceada y CONCATENADA — justo lo
que T5.8c construyó). ffprobe del verifier: `duration=16.636`, `1080x1920`, `h264/aac`, QA 100,
`captionViolations=0`. Duraciones de los guiones 16,0–22,0s: **todas dentro de 15–30s**. El temor a que
`conversion` desbordara los 30s no se materializó.

## Causa raíz del FAIL de (a): 3 defectos de producto + 1 parada externa

1. **N6 `PermanentStepError` por `product.category` NO canónica** (3 de 4 análisis). La MISMA URL de
   CeraVe dio `beauty` el día 24 y `Cuidado de la piel` el 25: lotería por análisis. Los guard packs
   degradan ante el desajuste; los templates revientan.
2. **10 de las 11 personas del seed tienen voiceIds que fal RECHAZA** (`placeholder-*` → 422).
3. **`avatar_hint` no es editable** en `brief-editor.tsx` ⇒ **no hay camino DENTRO del producto** hasta
   una persona con voz usable.
4. **Externo**: saldo de Anthropic agotado (verificado con probe directo → 400 credit balance).

**Un usuario real, hoy, con esa URL, no puede terminar un lote sin intervención manual.** Por eso el
verde de (b) no basta para un PASS de fase.

## Defecto silencioso, severidad alta (candidato a tarea propia)

N5 acabó con `output_refs.status="api_error"` y 5/12 guiones, **pero** `step_run.status=waiting_approval`,
`error=NULL`, la UI afirma «N5 escribió un guion por variante» (FALSO) y deja **«Confirmar guiones»
HABILITADO**. Se puede aprobar un lote truncado y disparar gasto real sin enterarse. Es exactamente el
patrón que el arnés persigue: el fallo existe y el sistema lo presenta como éxito.

## Control negativo

N/A como test nuevo — es una verificación de fase (conduce el sistema real, no añade suite). El control
negativo del comportamiento de F5 vive en el spec permanente `f5-export.spec.ts` (`@f5 @phase`, journey
mockeado a $0, verde en el gate) y en los controles negativos ROJOS ya verificados de
T5.8a/T5.8b/T5.8/T5.8c. **Función de control negativo cumplida por el propio run**: los 3 defectos de
producto y el defecto silencioso de N5 son fallos REALES que este E2E destapó y que la suite verde no veía.

## Tres correcciones AL COORDINADOR (anotadas para no repetirlas)

1. **La instrucción del coordinador sobre el bound iba AL REVÉS.** Se indicó al verifier que el estimador
   de CP2/CP3 queda BAJO y que lo subiera ~45%. Es al contrario: la UI estimó **$9–13** y el coste real
   fue **$3,86**. Seguir esa instrucción habría producido un **FAIL falso por coste**. El verifier no
   obedeció a ciegas — correcto.
2. **El «hallazgo 1» del run anterior era MISDIAGNOSIS**: el `voice_map` de Nora es funcional (200 OK
   probado en `tts/eleven-v3`); las variantes `es` fallaron por correr con *Chloe (placeholder)*.
3. **El techo de $40 se fijó sobre un supuesto FALSO**: `sharedBodyAndCta = (objective === 'hook_test')`
   (`matrix.ts:277`) ⇒ en `conversion` **NO hay dedup** de body/CTA. La matriz literal (12 variantes)
   cuesta **~$46 MEDIDOS** — la proyección de $52,14 erró en la dirección conservadora, pero su
   conclusión (no cabe en $40) se sostiene.

## Intervenciones DECLARADAS del verifier

Sin ellas no hay verde — y por eso no elevan (b) a un PASS de fase:
1. Editar `product.category` → `beauty` en CP1 (×3): acción de usuario prevista por el producto.
2. `INSERT` de la persona `Vera Verify T5.9` en BD con los voiceIds probados.

**NO** mutó a Nora, **NO** «arregló» los `placeholder-*` (habría tapado el defecto que reporta), **NO**
tocó `seed-data.ts` ni código de producto ni `planning.md`.

## Reserva sobre (c)

Ambas voces del seed son English-origin multilingües (Sarah/Rachel) y la cláusula 22.8 pide voces
**nativas**: puede fallar por naturalidad haga lo que haga el verifier. Es una limitación del seed de
desarrollo, no del pipeline.
