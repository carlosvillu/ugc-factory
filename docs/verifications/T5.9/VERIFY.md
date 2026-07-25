# T5.9 · E2E de la fase F5 — VERIFY (run 2026-07-25)

> El run del 2026-07-23 (veredicto BLOCKED por estado del árbol, $0) se conserva íntegro en
> `VERIFY-2026-07-23-blocked.md`. Este documento es el run del 2026-07-25, post-T5.8c.

- **Tarea**: T5.9 · E2E de la fase F5 (`planning.md:786-793`), criterios 22.1 / 22.2 / 22.8
- **Veredicto**: **FAIL** (de fase) + **PARADA POR PREREQUISITO EXTERNO** en la cláusula (a)
- **Coste real**: **$4,62** (fal $3,86 + Anthropic $0,76 + Firecrawl $0,00) — techo $40, sin agotar
- **HEAD**: `883ae66` (post-T5.8c `0c8a8e4`). Stack `pnpm dev` + Postgres `ugc-postgres-dev`.
- **Reloj**: la cláusula (a) NO llegó a completar un lote, así que **no hay medida de «<45 min»**.

> El `report.md` lo materializa el coordinador. Este documento es del verifier.

## Veredicto por cláusula

| Cláusula | Resultado | Fundamento |
|---|---|---|
| (a) URL real → ≥6 variantes 15–30s es+en, captions, C2PA, <$40, <45 min | **NO EJECUTADA → FAIL de fase** | Cadena de 3 defectos + saldo de Anthropic agotado a mitad de N5 (5/12 guiones). No se aprobó CP3: $0 de fal. |
| (b) texto libre 0 imágenes → packshot-IA en CP1 → variante `synthetic_product=true` | **CUMPLIDA** (con 1 intervención declarada) | Variante `01KYCMTTKYA5JMF3DZ29ETF0XX` **approved**, N7a ×2 con `synthetic_product=t`, máster 16,636s verificado con mi ffprobe. |
| (c) voces es/en nativas ↔ `voice_map` (revisión humana 1 variante/idioma) | **PENDIENTE-JUICIO-HUMANO**, y con reserva | Solo existe clip **es**. No hay clip **en** porque (a) no llegó a generar. Además ambas voces son English-origin multilingües (ver abajo). |

## Lo que SÍ quedó verificado con mis manos

**T5.8c funciona en el flujo normal — el bloqueador de fase anterior está retirado.**
El run de la cláusula (b) compuso su máster sin `FitError`: `N8=succeeded`, y `cost_entry`
muestra **N7d con 2 entries** (la escena de body se troceó en 2 clips y N8 los concatenó).
Medido por mí, no leído de un informe:

```
ffprobe master.mp4 -> duration=16.636000  1080x1920  h264/aac  30fps  15.346.212 bytes
```

QA de N8 (`qaReport`): score 100, `passed=true`, y `fps/codec/duration/filesize/loudness/
resolution/av_duration_diff/captions_safe_zone` todos `pass`; `loudnessLufs=-14.4`;
**`captionViolations=0`**.

**Duración dentro de ventana**: los guiones de `conversion` NO se desbordan. Σ`scene.seconds`
medido = **18,8 s** (b, dos veces) y **16,0–22,0 s** en los 5 guiones de (a) — los 5, dentro de
15–30. El temor a que `conversion` pasara de 30s no se materializó.

**Calibración del estimador de coste** (el número más útil de este run):

| | UI CP2 estimaba | Real medido (`cost_entry`) |
|---|---|---|
| 1 variante conversion/premium | $9,00 – $13,00 | **$3,86** (43% del extremo bajo) |

Desglose real de esa variante: N7d b-roll 240¢ · N7f cta 80¢ · N7c avatar 59¢ · N7b voz 4¢ ·
N7a keyframes 2¢ · N7e música 1¢ = **386¢**.

**El estimador va ALTO, no bajo** — al contrario de lo que asumía el brief de esta verificación
(«súbelo mentalmente ~45%»). Por eso NO declaré (a) inejecutable desde el estimador: habría sido
un FAIL falso. `/spend` corrobora el total del día: **$4,62**.

## Por qué (a) es FAIL: tres defectos encadenados + una parada externa

### 1. `product.category` no canónica → N6 `PermanentStepError` (`probes/n6-vertical-mismatch.txt`)
N3 emite la categoría como TEXTO LIBRE; los templates usan una taxonomía CERRADA de 9 slugs en
inglés y el match es exacto. Observado en **3 de 4** análisis: `"Cuidado bucal"`,
`"Cosmética facial"`, `"Cuidado de la piel"` → ninguna casa. **La MISMA URL de CeraVe dio
`"beauty"` el 2026-07-24 y `"Cuidado de la piel"` el 2026-07-25**: es una lotería por análisis.
El lote muere en N6 tras CP1+CP2+CP3 y tras pagar N1–N5. Asimetría que lo delata como defecto:
ante el mismo desajuste los guard packs degradan («no falla», `guard-lookup.ts:28`) y los
templates revientan. Remedio existe (editar la categoría en CP1) pero es invisible: input libre
sin validar, sin select ni ayuda con los 9 valores válidos.

### 2. 10 de 11 personas del seed tienen voiceIds que fal RECHAZA (`probes/voice-probe.txt`)
**Corrijo el «hallazgo 1» del report anterior: era una MISDIAGNOSIS.** No es que el `voice_map`
de Nora «mezcle formatos». Probado contra fal real en el endpoint que usa el run
(`tts/eleven-v3`):

```
placeholder-es-chloe  -> 422 {"msg":"Invalid voice ID provided.","type":"feature_not_supported"}
EXAVITQu4vr4xnSDxMaL  -> 200 OK        Rachel -> 200 OK
```

El `voice_map` de Nora es FUNCIONAL en ambos idiomas. Las 3 variantes `es` del run anterior
fallaron porque corrieron con **Chloe (placeholder)**, no con Nora (su `step_run.config` decía
`"voice":"placeholder-es-chloe"`): el lote rotó personas (`personaMode` por defecto = `'rotate'`,
`plan-batch.ts:46`). Nada valida el `voiceId` antes de gastar, y el error que llega es un
`fal respondió 422` opaco.

### 3. `avatar_hint` solo ofrece personas rotas y NO es editable (`probes/INTERVENCIONES.txt`)
El brief de CeraVe generó `avatar_hint = "Persona de unos 30 años, tono cercano..."`.
`matchPersonas` (score>0) ofreció en CP2 **únicamente a Alex (placeholder) y Nerea
(placeholder)** — las dos con voces que fal rechaza. Nora no puntúa contra ese hint, y
`avatar_hint` **no existe en `brief-editor.tsx`**: no es editable en CP1.
**No hay ningún camino dentro del producto para llegar a una persona con voz funcional.**

### 4. PARADA EXTERNA: saldo de Anthropic agotado (`probes/n5-partial-batch.txt`)
N5 escribió **5 de 12** guiones. 7 fallaron con HTTP 400. Verificado por mí con un probe directo
a `api.anthropic.com` (no solo leído del log):

```
status 400 {"type":"invalid_request_error",
 "message":"Your credit balance is too low to access the Anthropic API..."}
```

Esto es un **prerequisito externo**: sin saldo no hay 12 guiones y (a) no se puede ejecutar.
**No aprobé ese CP3** — habría gastado fal sobre un lote que no cumple la matriz de la cláusula.

### Defecto adicional destapado por la parada (independiente del saldo)
N5 terminó con `output_refs.status = "api_error"` y 5 scriptRefs para 12 variantes, pero:
`step_run.status = **waiting_approval**`, `step_run.error = **NULL**`, la UI afirma «N5 escribió
**un guion por variante**» (falso), pinta 5 botones «Aprobar esta variante» y deja
**«Confirmar guiones» HABILITADO**. Un usuario puede aprobar un lote silenciosamente truncado y
lanzar gasto real de fal creyendo que paga 12. Severidad alta: silencioso y en la antesala del gasto.

## Hallazgo de coste que invalida la proyección aprobada

`sharedBodyAndCta = (objective === 'hook_test')` (`matrix.ts:277`). En **`conversion` NO hay
dedup de body/CTA**: cada variante paga los suyos. La proyección de ~$26 que el usuario aprobó
para 6 variantes asumía dedup de b-roll. Con coste **medido** ($3,86/variante):

| Matriz | Coste proyectado desde lo medido | vs techo $40 |
|---|---|---|
| 6 variantes | ~$23,2 (+ lo gastado) | cabe |
| **12 variantes (la matriz LITERAL 2×3×es+en)** | **~$46,3** | **NO cabe** |

La cláusula pide «2 ángulos × 3 hooks» en «es+en», y la UI multiplica el idioma sobre TODA la
matriz (no hay selección de idioma por ángulo): la matriz literal son 12, y a coste real **no
entra en $40**. El techo se fijó sobre una proyección que suponía un dedup que el código no hace.
**Es una decisión de producto pendiente del usuario**, no algo que yo deba resolver rebajando la vara.

## Intervenciones del verifier (declaradas — leer antes de creerse ningún verde)

1. **Editar `product.category` → `"beauty"` en CP1** (3 veces). Acción de usuario prevista por el
   producto (input editable). Sin ella, N6 mata el lote.
2. **`INSERT` de una persona en BD**: `Vera Verify T5.9` (`01KYCVERIFYT59PERSONA00001`) con los
   dos voiceIds probados (200 OK), para que existiera una candidata con voz funcional para el
   `avatar_hint` de CeraVe. Precedente del propio proyecto: `Nora Verify T58b Premium` (T5.8b).
   **NO** muté el `voice_map` de Nora, **NO** «arreglé» los `placeholder-*` (sería tapar el
   defecto que reporto) y **NO** toqué `seed-data.ts`.

La cláusula (b) se apoya en la intervención 1. La (a) habría necesitado además la 2.
**Un usuario real, hoy, con esa URL, no puede terminar un lote sin ambas.** Por eso el veredicto
de fase es FAIL aunque los números medidos salgan bien.

## Cláusula (c) — material preparado para el juicio humano

| Variante | Idioma | voiceId usado | `voice_map` de su Persona | Máster |
|---|---|---|---|---|
| `01KYCMTTKYA5JMF3DZ29ETF0XX` | es | `EXAVITQu4vr4xnSDxMaL` (Sarah) | Nora: es→`EXAVITQu4vr4xnSDxMaL`, en→`Rachel` | `/tmp/ugc-assets-dev/masters/01KYCMTTKYA5JMF3DZ29ETF0XX/master.mp4` (16,636s) |
| — | en | — | — | **no existe**: (a) no generó |

**No puedo cerrarla, y además aviso de un riesgo**: ambas voces del `voice_map` son
**English-origin multilingües** (Sarah, Rachel). La cláusula pide voces **nativas**. Aunque
correspondan al `voice_map`, es probable que el clip `es` se lea con acento y que el juicio
humano falle 22.8 por naturalidad — independientemente de la calidad de mi evidencia.

## Control negativo

No añado tests (verificación de fase). Los controles negativos que MORDIERON de verdad en este run,
todos con evidencia cruda persistida:

- **`placeholder-es-chloe` → 422** contra fal real en `tts/eleven-v3`, mientras
  `EXAVITQu4vr4xnSDxMaL` y `Rachel` → 200 en el MISMO endpoint. Aísla la causa del fallo `es`
  del run anterior y refuta el «hallazgo 1» previo (`probes/voice-probe.txt`).
- **N6 `PermanentStepError`** con `vertical=Cuidado bucal`: el lote de mi 1er intento de (b) murió
  de verdad, y N7a–N9 quedaron `awaiting_deps` para siempre (`probes/n6-vertical-mismatch.txt`).
- **Probe directo a `api.anthropic.com` → 400 credit balance**: confirma que la parada es externa
  y no una mala lectura de un log del propio código.
- El control negativo del comportamiento de F5 a coste 0 sigue vivo en `f5-export.spec.ts`
  (`@f5 @phase`) y en los de T5.8a/T5.8b/T5.8c, verdes en el gate.

## Gate previo

`pnpm gate` → **2424 passed / 2 skipped (2426)**, 231/232 ficheros. El único fallo es
`sse-contract.test.ts`, que aborta con «Another next dev server is already running» (PID 67169 =
mi propio `pnpm dev`, necesario para conducir la UI): artefacto de entorno ya conocido en el
journal, 0 tests de lógica rojos (`probes/gate.txt`).

## Qué debe pasar para poder cerrar F5 (accionable)

1. **Usuario**: recargar saldo de Anthropic (bloqueante para (a)) y decidir el techo de gasto para
   la matriz literal de 12 (~$46 medidos) o aceptar 6 variantes como cumplimiento del «≥6».
2. **Implementer**: (i) N6 no debe morir por una categoría no canónica —degradar como los guard
   packs, o validar/normalizar `product.category` en CP1 contra los 9 slugs; (ii) validar el
   `voiceId` antes de gastar y dar error accionable, y revisar los 10 seeds con `placeholder-*`;
   (iii) permitir llegar a una persona con voz usable (editar `avatar_hint`, o listar toda la
   librería en CP2); (iv) N5 con `api_error`/guiones incompletos debe quedar `failed` o bloquear
   «Confirmar guiones» en vez de ofrecer un lote truncado como aprobable.

## Evidencia

- `probes/voice-probe.txt`, `probes/root-cause-es-422.txt` — refutación del hallazgo 1
- `probes/n6-vertical-mismatch.txt` — el defecto de vertical (3 observaciones)
- `probes/n5-partial-batch.txt` — parada externa + lote truncado aprobable
- `probes/clause-b-result.txt` — cláusula (b) medida, coste por nodo
- `probes/cp2-estimate-conversion-premium.txt` — estimado ANTES de gastar (calibración)
- `probes/INTERVENCIONES.txt` — las 2 intervenciones, declaradas
- `probes/gate.txt` — gate previo
- Capturas: `b-01`…`b-09` (cláusula b), `a-01`, `a-02` (cláusula a + /spend)
- `run-context.txt` — ids de lote/run y checkpoints de coste para reanudar sin re-gastar
- `VERIFY-2026-07-23-blocked.md` — el run BLOCKED previo, íntegro
