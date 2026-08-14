# Verificación T5c.4 — Obtener el PRIMER vídeo real (premium alcanzable/consciente) ⚠ GASTO

> **RESOLUCIÓN FINAL 2026-08-14 — PASS (vía T5c.7).** Este report documenta el intento del 2026-08-13 que dio **FAIL** por un bug de producto en N7f (CTA i2v). Ese bug era el bloqueante real → se abrió **T5c.7** (fix `finalize-download` kind-aware). Al arreglarlo, la Verificación de T5c.7 (un lote premium de 1 variante) **produjo el PRIMER vídeo real end-to-end** del proyecto: máster `01KZZTFHE0KEWB7KGYNEFJJFKQ` (1080×1920 H.264+AAC 12,5s) reproduciéndose en `/library`, coste real $3,28. **La evidencia del vídeo terminado vive en `docs/verifications/T5c.7/`** (capturas `08`/`09`/`10`, `master.mp4`, `cost-breakdown.txt`). El código de T5c.4 era $0 (decisión de producto «default tier sigue `test`» en PRD §13.1 + el aviso lo hizo T5c.2); lo único pendiente era la Verificación de gasto, cumplida por T5c.7. Lo de abajo es el registro histórico del intento fallido — NO se reescribe (evidencia del camino real).

- **Tarea**: T5c.4 · Obtener el PRIMER vídeo real end-to-end (`planning.md:1118`)
- **Fecha**: 2026-08-13 (intento FAIL) · resuelto 2026-08-14 vía T5c.7
- **Ejecutor**: verifier (contexto fresco) · agent-browser 0.27.x · sesión `t5c.4`
- **Sistema**: commit `9299671` (rama `feat/t5b1b-i-n6-per-scene`) · docker-compose.dev Postgres 16 PERSISTENTE (`:55432`) + `pnpm dev` (web :3000 + worker, fal REAL vía `app_setting.secret.fal`) + seeds (persona=17, model_profile=18, recipe=3). Login re-sembrado por el bucle (con OK del usuario) tras el bloqueo de la ronda anterior.

## Verificación esperada (literal de planning.md)
> **Verificación observable**: elegir `premium` en CP2 -> aprobar CP3 -> arranca el run de generación N6->N7, y al terminar hay **al menos un vídeo real** en la galería (el primer vídeo end-to-end real del proyecto). Evidencia: el asset de vídeo + el coste real medido. Control de gasto: el ledger coincide (+-25%) con la proyección.

## Veredicto
**FAIL** — el flujo se ejecutó completo hasta N7 (todos los clips generados con fal REAL), pero un **bug de producto en N7f (clip de CTA)** dejó ese step en `failed`, lo que **bloquea N8 (compose master) permanentemente**. La variante quedó en `scripted` con `master_asset_id=NULL` y **NO hay vídeo terminado en `/library`** — no se cumple "al menos un vídeo end-to-end real". El coste real ($2.62) SÍ cae dentro de la proyección (cláusula de gasto PASS). Se generaron clips Veo i2v REALES (verificados con ffprobe), pero un clip suelto no es el máster end-to-end que pide la tarea.

## Pasos ejecutados
1. **Pre-flight ($0)**: `check-orphan-workers.mjs --strict` (solo los 2 workers intencionales, 0 huérfanos), pgboss 0 jobs no-terminales, 0 steps queued/running, secretos intactos, fal REAL. `pnpm gate:phases` **9/9 PASS** (el `pnpm gate` bare falla por el footgun Ryuk/Colima; `gate:phases` fija la combinación Docker por fase — no es defecto de código). Probe TTS a fal -> HTTP 200 (hay saldo).
2. **Login humano** (agent-browser) -> dashboard. OK
3. **Intake URL real** (CeraVe moisturizing-cream, es) -> run de análisis `01KZYD4PG6HV45Z53JAZCJDG7W`; N1 succeeded, N2 skipped, **N3=CP1 waiting_approval**. Brief real ("Moisturizing Cream").
4. **CP1**: approve deshabilitado por "Necesitamos una imagen principal" -> promoví una imagen de producto scrapeada (acción humana) -> approve habilitado -> aprobado. Categoría "Cuidado de la piel" (no canónica) sin editar (T5.12: ya no mata N6; además fijo Maya).
5. **CP2 (matrix panel)**: **1 variante** (1 ángulo × `hooksPerAngle=1` × es), objetivo **hook_test** (12s), tier **Premium**, **persona Maya FIJADA** (`personaMode='fixed'`, mi finding: la única generable). UI `variantCount=1`. **Coste UI (COGS): $3.60–$5.20** (high-end 5.20 < 5.25). Mi proyección endpoint-level: ~$2.85–3.75.
6. **Money-gate**: variantCount=1 OK, UI high-end 5.20 < 5.25 OK -> PROCEDER. Confirmé CP2 -> run N5 `01KZYDF8D6V8AQVW6WXR05G6P6`, batch `01KZYDF8CM6Q8EAXCEGZGGKG1A`.
7. **CP3**: 1 `ad_script` real (Maya, es, 3 escenas, narración real). Marqué la casilla (1/1 — evité H3). "Confirmar guiones" -> **CP3 aprobado (MONEY STARTS)** -> navegación a run de generación `01KZYDJ6YF89DFRC652NRJ26CJ` (wiring T5c.1).
8. **Generación N6->N7** (fal REAL, medido por join `cost_entry->step_run->run_id`): N6, N7a, N7b, N7c, N7d, N7e **succeeded**; **N7f (cta i2v) FAILED** (bug). **N8 awaiting_deps** — bloqueado por N7f.
9. **Superficie**: `/library`. La variante NO aparece (status `scripted`, sin máster). Las "3 variantes" de `/library` son datos previos del seed, NO la nuestra.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Elegir premium en CP2, 1 variante | CP2: 1 variante, premium, Maya fijada, hook_test 12s | 04-cp2-premium-1variant-cost.png | OK |
| 2 | Aprobar CP3 -> arranca run N6->N7 | CP3 aprobado -> run generación N6->N7 | 05-generation-canvas-start.png | OK |
| 3 | Clips N7 generados con fal real | N7a/b/c/d/e succeeded; N7d body 6s + N7c avatar 3.72s mp4 REALES | assets-produced.txt, ffprobe | OK |
| 4 | **>=1 vídeo TERMINADO en /library** | **N7f failed -> N8 bloqueado -> variante `scripted`, master NULL, NADA en /library** | 06/07 png, DB | **FALLO** |
| 5 | Ledger +-25% de la proyección | **$2.62** vs $2.7-4.2 (banda +-25% low-end: $2.025-3.375) -> DENTRO | cost-by-endpoint.txt | OK |
| 6 | Abort $5.25 no alcanzado | $2.62 << $5.25; sin retry storm (N7f retry 0/80, permanent) | (monitor) | OK |

## Control negativo
N/A — tarea sin cambios de código (T5c.4 código = $0 por decisión de producto, planning.md:1124); es una verificación de gasto puro, no hay fix ni test nuevo que reintroducir/morder. El fallo REAL de N7f (bug de producto) está tipado en la tabla de resultados y en el finding de abajo.

## Coste real
**$2.62** (262c), medido por `join cost_entry -> step_run -> run_id = 01KZYDJ6...` (NO por delta de baseline: el ledger arrastraba 56c de fal de artefactos viejos del seed — la atribución por run es la cifra correcta). Desglose por endpoint:

| Nodo | Endpoint | Cantidad | Coste |
|---|---|---|---|
| N7a | nano-banana-pro/edit (keyframes) | 2 imgs | 2c |
| N7b | elevenlabs/tts/eleven-v3 | 131 chars | 2c |
| N7c | bytedance/omnihuman/v1.5 (avatar) | 4s (@16c/s) | 58c |
| N7d | veo3.1/image-to-video (body) | 6s (@20c/s) | 120c |
| N7e | ace-step (música) | 12s | 0c |
| N7f | veo3.1/image-to-video (cta) | 4s (@20c/s) | 80c — **cobrado aunque el finalizer falló** |
| **TOTAL** | | | **262c = $2.62** |

**Cláusula de gasto: PASS** — $2.62 dentro de ±25% de la proyección $2.7–4.2 (banda del low-end 2.7: $2.025–3.375). **Abort $5.25 nunca alcanzado.** Calibración: N8 (compose) es FFmpeg local ($0) -> un run EXITOSO habría costado ~el mismo $2.62; la banda queda validada.

## Finding principal (bug de producto para el implementer) — bloquea el end-to-end
**N7f (clip de CTA i2v) falla con `finalizeSingleCallPerSecondGeneration: la generación ... está completed pero sin asset cta_clip (invariante roto)` (permanent).** Diagnóstico por evidencia (NO es un mismatch dentro de una función — ambas ramas del finalizer usan el mismo `assetKind`):
- La generación de N7f (`01KZYDJW35MYXW4YSQJFCBFT2R`) quedó `completed` con un asset kind=**`broll_clip`** (creado 56ms después de `completed`, rama de creación de UNA vía). La llamada que lanzó buscaba kind=**`cta_clip`** en la rama `alreadyFinalized`.
- **DOS finalizadores con `assetKind` DISTINTO sobre la MISMA generación**: (a) el **sweeper** (`sweeper.ts:139`, `resolveKind: (row) => kindByProfile.get(row.modelProfileId) ?? 'image'` — resuelve por model_profile; N7d y N7f comparten `veo3.1/image-to-video` -> ambos a `broll_clip`) y (b) el **executor de N7f** (`generate-broll.ts:158`, `assetKind='cta_clip'`, T5.5a). El que gana la creación pone `broll_clip`; el que llega tarde busca `cta_clip`, no lo halla y lanza.
- Es la **deuda ANUNCIADA** en `generate-broll.ts:16-18` (el sweeper/`output.download` debe hacerse kind-aware; "una generación de VÍDEO recogida por la vía [equivocada] explotaría"). Reproducible: cualquier lote premium con N7d y N7f compartiendo el endpoint i2v puede disparar la carrera.
- **Consecuencia**: N7f `failed` -> N8 (depende de N7f) `awaiting_deps` para siempre -> sin máster -> sin vídeo end-to-end.

## `unverified` CERRADO — fal-ai/veo3.1/image-to-video confirmado en vivo
- **Request** (N7d body y N7f cta, idénticos salvo duración): `{ "prompt": "A cinematic product b-roll shot.", "duration": "6s"|"4s", "image_url": "<keyframe de N7a en fal.media>", "resolution": "720p", "aspect_ratio": "9:16", "generate_audio": false }`.
- **Response**: `{ "video": { "url", "file_name", "file_size", "content_type": "video/mp4" } }` (status OK).
- **Precio 20c/s confirmado 2× independiente**: N7d 6s -> 120c, N7f 4s -> 80c. (El `"unverified":true` del seed `model-profiles.json` ya puede reevaluarse — decisión de planning/implementer.)
- El prompt del b-roll es el neutro por defecto ("A cinematic product b-roll shot."), no diálogo localizado — coherente con la memoria de dedup cross-idioma.

## Vídeos REALES generados (verificados con ffprobe) — no son el máster, pero son reales
- **N7d body clip**: `broll_clip`, H.264, **720×1280 (9:16), 6.000s**, 864KB mp4. ffprobe OK.
- **N7c avatar clip**: `avatar_clip`, H.264 + AAC, 1088×1920, 3.72s, 3.76MB.
- **N7f cta**: la llamada a fal SÍ produjo un mp4 real (557KB, `video/mp4`) — **$0.80 de dinero real compró un vídeo que la pipeline luego descartó** por el bug del finalizer.

## Rarezas (aunque el verdict es FAIL)
- **`max_retries=80` en N7f** (step de 20c/s). Solo `permanent:true` evitó reintentos; un fallo TRANSITORIO ahí podría haber reenviado hasta 80× a 20c/s (deuda H6 de T5.9 en ruta de dinero). Mi monitor (20s, umbral 525c) podría no cazarlo a tiempo. Anotar para planning.
- Console del navegador: solo warnings `[React Flow] parent needs width/height` (dev-only, transitorios por timing del screenshot). Sin errores de código propio.

## Estado final del entorno (para el bucle)
- Run `01KZYDJ6YF89DFRC652NRJ26CJ` **TERMINALMENTE atascado**: N8/N9 `awaiting_deps`, **pgboss 0 jobs no-terminales**, 0 steps queued/running (no gastará más). **NO lo cancelé** (frontera de esta ronda: el entorno es del bucle). Reportado a main.
- Lote GASTADO ($2.62). **NO re-aprobar CP3**. Para reintentar tras arreglar N7f: análisis NUEVO (no reusar este lote).
- `cost_entry`, secretos y personas intactos. Ninguna mutación de BD por mi parte esta ronda (solo SELECTs). Ningún fichero de producto/tests/planning tocado.

## Notas
- T5c.4 NO se cierra: el bug de N7f impide el primer vídeo end-to-end. El arreglo (sweeper kind-aware, o que N7f no colisione con N7d en el finalizer) es del implementer — deuda anunciada en `generate-broll.ts:16-18`, ahora reproducida con dinero real.
