# SMOKE-TEST de generación real F5 — 2026-07-26 (NO es T5.9, NO produce PASS)

> Esto es un **smoke-test de 1 variante con gasto real de fal autorizado ≤ $6**. NO cierra T5.9
> (cubre 1 variante `es`, no las ≥6 de la cláusula (a) ni el cross-idioma de la (c)). T5.9 sigue SIN marcar.

- **Sistema**: HEAD `62c1d85` (rama `docs/f5-cost-reprojection`), árbol limpio salvo esta carpeta de evidencia.
  docker `ugc-postgres-dev` :55432 + `pnpm dev` (web :3000 + worker) + first-boot seed (model_profile=18,
  secrets fal/anthropic/firecrawl cifrados desde `.env`, personas=11 incl. **Maya generable**).
- **Ejecutor**: verifier · agent-browser 0.27.x · sesión `t5.9smoke`. UI conducida como humano
  (login, intake, CP1, CP2, CP3, confirmación de guiones). Sin atajos por API en el flujo verificado.
- **Coste real total de este smoke**: **$3,01** — fal **$2,76** · anthropic $0,25 · firecrawl $0,00.
  Techo $6 **intacto**. Abort duro a 550¢ armado (watch en vivo cada 15s); nunca se disparó.
  **Contrastado con `/spend` en la UI** (`10-spend-page.png`): «Gasto total **$3,01**», «fal.ai **$2,76**»,
  día 2026-07-26 $3,01 — coincide exactamente con el ledger por psql (la mitad observable del primario).

## Veredicto del smoke

| Objetivo | Resultado |
|---|---|
| **PRIMARIO — medir coste real por endpoint post-T5.8c** | ✅ **LOGRADO**. Tabla `cost_entry ⨝ generation` por nodo con duración facturada y `fal_request_id` real (abajo y en `cost-entries.txt`). |
| **SECUNDARIO — componer un máster real + C2PA end-to-end** | ❌ **NO LOGRADO**. N8 (composición) quedó bloqueado `awaiting_deps`: **1 de los 2 clips de b-roll (N7d) falló con 403 permanente** en su submit. Sin ese clip N8 no es elegible ⇒ 0 másters ⇒ C2PA no verificable (no hay artefacto que firmar). |
| **Gate de gasto en CP3 (≤$5)** | ✅ **PASÓ y aprobó**. Proyección determinista **$4,08** (< $5,00). Ver `04-cp3-cost-gate.txt`, escrito ANTES de aprobar. |

**Saldo de fal**: DISPONIBLE (no como el run del 2026-07-26 previo, que murió en 403 global). El probe
$0 previo al gasto (voice-preview de Maya) devolvió 200; voz, avatar, música, keyframes, CTA y **1 clip
de b-roll** se generaron y facturaron. El 403 fue en UN submit concreto, no global (probe posterior = 200).

## Coste real por endpoint (medido, join `cost_entry ⨝ generation ⨝ step_run`)

Run de generación `01KYFG1CTF31HSV8EATF966VPR` (batch `01KYFFHQ6RQ…`, variant `01KYFFHQ6XCH…`, persona Maya, es, premium):

| Nodo | Endpoint | Facturado | ¢ | `fal_request_id` | Estado |
|---|---|---|---|---|---|
| N7a keyframes | `fal-ai/flux-2` | 2 imágenes | **2** | `019f9f00-b704…`, `019f9f00-c673…` | completed |
| N7b voz | `fal-ai/elevenlabs/tts/eleven-v3` | 4 clips (249 chars) | **3** | 4× `019f9f0…` | completed |
| N7c avatar | `fal-ai/bytedance/omnihuman/v1.5` | 4,36 s → 4 s | **70** | `019f9f01-1f9f…` | completed |
| N7d b-roll (clip 1/2) | `fal-ai/veo3.1/image-to-video` | 6 s | **120** | `019f9f01-201a…` | completed |
| N7d b-roll (clip 2/2) | `fal-ai/veo3.1/image-to-video` | — | **0** | (ninguno) | **failed 403** |
| N7e música | `fal-ai/ace-step` | 30 s | **1** | `019f9f00-b706…` | completed |
| N7f CTA | `fal-ai/veo3.1/image-to-video` | 4 s | **80** | `019f9f01-217c…` | completed |
| | | | **276 = $2,76** | | |

Clips reales verificados con `ffprobe` (`09-clips-ffprobe.txt`): avatar h264+aac 1248×1664 4,36 s;
b-roll h264 720×1280 6 s; CTA h264 720×1280 4 s. **Media 9:16 bien formada** — la generación fal
funciona end-to-end; solo la composición no pudo cerrarse.

## Proyección CP3 vs coste real (el entregable que convierte "recargar ~$X" en cifra medida)

Proyección determinista en CP3 (segundos del guion, algoritmo `planScene`+`quantizeDurationToEnum`
PER-ESCENA, verificado en código): **$4,08**. Componentes proyectados vs reales:

| Nodo | Proyectado | Real | Nota |
|---|---|---|---|
| N7a keyframes | ~7¢ | 2¢ | flux-2 (NO nano-banana; `shots` no se proyecta, hardcodea flux-2) |
| N7b voz | ~3,5¢ | 3¢ | ✓ |
| N7c avatar | 76,8¢ (hook 4,8 s) | 70¢ (audio real 4,36 s) | ✓ (ASR más corto que guion) |
| N7d b-roll | 240¢ (2×6 s) | 120¢ (1 clip; el 2º 403) | 1 solo clip generado |
| N7e música | 0,4¢ | 1¢ | ✓ |
| N7f CTA | 80¢ (4 s) | 80¢ (4 s) | ✓ exacto |
| **TOTAL** | **$4,08** | **$2,76** | el gap = el clip de b-roll que 403’d |

**Corrección por el clip caído**: si los 2 clips de b-roll se hubieran generado, el coste real sería
**276 + 120 = 396¢ = $3,96**, contra la proyección **$4,08** ⇒ **desviación < 3%**. **La proyección de
CP3 fue precisa.** El $2,76 medido es bajo SOLO por el clip 403’d, no por un modelo de coste erróneo.

**Cifra medida por variante premium (es, 4 escenas, ~19 s): ≈ $3,96** (avatar 70 + b-roll 240 + CTA 80
+ keyframes/voz/música ~6). Las duraciones ASR reales (3,1–4,7 s por escena) cayeron por debajo del
guion, así que ningún clip cruzó el bucket 6→8 ni se partió — el peor caso ($5–6,5) no se materializó.

## Presupuesto restante (lo que la cifra medida implica para la decisión del bucle)

- Gastado en este smoke: **$2,76 fal** ($3,01 con anthropic). Del techo $6, quedan **$3,24 fal**.
- Una variante premium completa cuesta **≈ $3,96** medido. **$3,24 restantes < $3,96** ⇒ **con lo que
  queda del techo NO alcanza para obtener el máster** que el objetivo secundario buscaba: haría falta
  recargar.
- Además, el 403 sugiere que la cuenta tenía **menos saldo apto-para-vídeo del que $6 implicaban**: se
  quedó sin poder cubrir el 2º clip de vídeo (~$1,20) tras ~$2 gastados, aunque el importe exacto de
  saldo restante es desconocido (el producto no lo guarda — Hallazgo B). Para completar 1 variante hero
  end-to-end (máster + C2PA) hace falta recargar y re-disparar.

## HALLAZGO A — 403 permanente en 1 de 2 clips de b-roll deja la variante uncomposable sin recuperación

Secuencia (mismo endpoint `veo3.1/image-to-video`, misma fal-key):
- 15:17:58 — b-roll clip 1 → **COMPLETED** (120¢, 6 s)
- 15:17:59 — CTA → **COMPLETED** (80¢, 4 s)
- 15:18:52 (~54 s después) — b-roll clip 2 → **403 Forbidden** en submit (sin `request_id`), clasificado
  `PermanentStepError` (T5.16), **failed terminal SIN retry** (`retry_count=0`).

Un probe de voz posterior devolvió **200** ⇒ el saldo NO está globalmente agotado (el TTS, de céntimos,
sigue pasando). Hechos, no conclusión.

**Causa del 403: UNDETERMINED.** No tengo evidencia para atribuirla. Lo único que el producto capturó es:
`step_run.error = "403: Forbidden"` (código + reason phrase), `generation.fal_status_payload` **vacío**
en la fila fallida, y el mismo texto en el log del worker. Un 403 de fal puede ser saldo, rate-limit,
acceso por-modelo o moderación — todos encajan con lo observado, y el producto no distingue cuál.

## HALLAZGO B (defecto de producto, adyacente al dinero) — el error de fal descarta el body que lo diagnosticaría

El mensaje que el producto emite al operador le pide **discriminar**: «recarga saldo si es "balance"/403,
revisa la fal-key si es credencial/401, corrige el input si es validación/422». Pero
`toProviderError` (`packages/core/src/generation/fal-client.ts:483-491`) construye el `FalProviderError`
**solo con `err.status` y `err.message`** — y el propio comentario dice que el SDK lanza
`ApiError { status, body }`. **El `body` (que en el run previo, vía curl directo, contenía
`{"detail":"User is locked. Reason: Exhausted balance."}`) NO se lee ni se persiste.** Resultado: la
única pista que separa balance / credencial / input se tira justo antes del `throw`. Por eso este smoke
NO puede decir por qué fue el 403: no es un límite de mi observación, es que el producto no lo guarda.
Fix accionable: capturar `err.body` en `toProviderError` y persistirlo en `step_run.error` /
`fal_status_payload`.

**Impacto de producto (no cosmético)**: b-roll es **secuencial fail-fast** (`generate-broll.ts:141`);
si un clip intermedio cae con error permanente, N7d va a `failed`, N8 nunca es elegible
(`awaiting_deps` eterno) y la variante queda en `scripted` sin máster ni forma de completarse salvo
re-disparar todo el run (re-pagando los clips ya generados). Con saldo JUSTO es un modo de fallo real:
gastas $2,76 y no obtienes ni un máster.

**Nota positiva (H6 mitigado)**: el 403 se hizo terminal en **1 submit** (`retry_count=0`), sin el bucle
de 80 reintentos del run previo. T5.16 sostiene: un 403 no se re-factura. Sin embargo `N7_MAX_RETRIES=80`
(`executor.ts:105`) sigue vivo para errores **transitorios** (5xx/timeout) sobre nodos de vídeo — no se
ejercitó aquí, pero sigue siendo exposición al dinero si un 5xx transitorio golpea un clip.

## Verificado a $0/bajo coste, con mis manos

- **T5.12 CONFIRMADO en flujo real**: `product.category = "Cuidado de la piel"` (NO canónica) dejada SIN
  editar a propósito → **N6 succeeded**. El defecto sigue cerrado en el camino real.
- **T5.13 CONFIRMADO**: «▸ Ver toda la librería (9 más)» expuso las 11 personas; **Maya FIJADA** en CP2
  (no era la sugerida por avatar_hint).
- **Maya generable de verdad**: 3 imágenes de referencia + voces reales (es `EXAVITQu4vr4xnSDxMaL`,
  en `Rachel`). Voz, avatar y keyframes generaron sin el 500 de "persona sin avatar" del run previo.
- **CP3 gate de gasto**: proyección determinista escrita ANTES de aprobar (`04-cp3-cost-gate.txt`);
  1/1 variante aprobada (contado en UI, single-variant, sin exposición al H3 de 0-aprobadas).

## Higiene y limpieza

- Pre-gasto: 0 jobs `step.execute` huérfanos, 0 steps queued/running, sin worker concurrente
  (`pg_stat_activity` solo pgboss + yo). Baseline de coste = 0 filas (DB fresca).
- Post-run: run de generación cancelado vía `POST /api/runs/:id/cancel` (`{"ok":true,"cancelled":3}`);
  **0 steps no-terminales, 0 jobs armados, fal sin cambios tras cancelar** (no leaked spend). Browser cerrado.

## Rarezas

- **`cost_entry.quantity` no cuadra con `amount_cents` en N7c**: la fila del avatar trae `quantity=4`,
  `unit=seconds`, `amount_cents=70`, pero `generation.duration_s=4,362`. `4,362 × 16¢/s = 69,8 → 70¢`
  es correcto; el `quantity=4` (entero truncado) NO. Un reconciliador que hiciera `quantity × tarifa`
  computaría 64¢, no 70¢. Relevante para la conciliación de coste de **T7.6** (cua.md: esta evidencia la
  alimenta). No bloqueante para este smoke, pero anotado.
- El estimador de CP2 sigue **alto**: la UI mostró «est. $38,40» para 12 variantes; el medido por
  variante es $3,96 ⇒ 12 × $3,96 = ~$47,5, pero el estimador y el real divergen por variante
  (patrón ya conocido de runs previos).

## Consola del navegador

Solo warnings de React Flow ("parent container needs width/height") — third-party, dev-only, benignos
(`browser-console.txt`). Ningún error de código propio.

## Evidencia

- `00-fal-balance-probe.txt` — probe $0 pre-gasto (voice-preview Maya es → 200)
- `01-dashboard.png`, `02-cp1-brief.png`, `03-cp2-config-maya-1variant-premium.png`
- `04-cp3-cost-gate.txt` — **gate de gasto, escrito ANTES de aprobar** (proyección $4,08)
- `05-cp3-scripts-panel.png`, `06-cp3-approved-1of1.png`
- `07-post-run-balance-probe.txt` — voz 200 tras el run (saldo NO globalmente agotado)
- `08-canvas-n7d-failed-n8-blocked.png` — canvas: N7d failed, N8 awaiting_deps
- `09-clips-ffprobe.txt` — los 3 clips reales (avatar/b-roll/CTA), media 9:16 válida
- `10-spend-page.png` — `/spend` en la UI: total $3,01, fal $2,76 (contraste con el ledger)
- `cost-entries.txt` — dump SQL del join por nodo con duración y `fal_request_id`
- `cost-join.sql` — la query reutilizable · `cp3-script-scenes.txt` — escenas del guion
- `run-ids.txt` — ids de análisis/batch/variant/generación
