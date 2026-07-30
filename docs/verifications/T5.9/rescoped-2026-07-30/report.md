# Verificación T5.9 (re-escalada) — E2E de fase F5, run de gasto real 2026-07-30

- **Tarea**: T5.9 · E2E de la fase — SPLIT en el techo de gasto (criterios 22.1 parcial, 22.2, 22.8) (`planning.md`)
- **Fecha**: 2026-07-30
- **Ejecutor**: verifier (contexto fresco) · stepless contra el stack dev real · sesión `t5.9-rescoped`
- **Sistema**: commit `ec30789` (árbol limpio salvo esta carpeta de evidencia) · docker compose dev (`ugc-postgres-dev`, port 55432) + `pnpm dev` (web+worker, health `{ok:true,db:true}`) + seeds reales (18 model_profile, 11 persona, 3 recipe)
- **Autorización de gasto**: $3,00 fal HARD (usuario). Techo global fal $7,62.
- **Nota de fichero para el hook**: el `report.md` que `guard-planning` lee para T5.9 es `docs/verifications/T5.9/report.md` (de runs previos). ESTE report vive en `docs/verifications/T5.9/rescoped-2026-07-30/report.md` (evidencia del run re-escalado); el coordinador decide cómo consolidarlos al cerrar.

## Verificación esperada (literal de planning.md — vara RE-ESCALADA)
> (a') **1 variante real end-to-end** (es, premium, URL real) compuesta a máster con C2PA firmado vía el FLUJO NORMAL (CP3->N6->N7->N8->CP4->N9->export bundle); (b) **texto libre 0 imágenes** -> 1 variante con `synthetic_product=true`; (c') **voces es+en nativas** juzgadas sobre el audio N7b de ambos idiomas (el lote es genera es; se pide 1 voiceover en aparte para en, ~1¢). El juicio humano de la voz y del sujeto de la variante es del usuario.
>
> (c)/22.8 — LA ÚNICA CLÁUSULA NUNCA SATISFECHA: el usuario juzga la naturalidad sobre el **audio de N7b AISLADO** (voiceover por escena, asset `completed` con timestamps), NO sobre variante compuesta (decisión del usuario 2026-07-30).

## Resumen del veredicto por cláusula
| Cláusula | Veredicto | Coste fal |
|---|---|---|
| **(c') / 22.8** voces es+en nativas | **PASS — pendiente de juicio humano** (2 audios listos) | $0,07 |
| **(a')** 1 variante end-to-end | **ABORTADA por presupuesto (pre-CP3)** — no ejecutada, $0 gastado | $0,00 |
| **(b)** texto libre 0 imágenes | **BLOQUEADA por presupuesto** — lote aparte, no ejecutada (por mandato) | $0,00 |

## Cláusula (c') / criterio 22.8 — PASS pendiente de juicio humano

**Objetivo**: capturar los dos voiceovers de N7b (es + en) como assets de audio aislados, `completed`, con word timestamps, para que el usuario juzgue su naturalidad. Se ejecutó por el **camino de N7b aislado** (stepless `runGenerateAudio`), autorizado por el mandato ("busca la ruta que genere SOLO N7b") y por planning (juicio sobre "el **audio de N7b AISLADO**", decisión del usuario 2026-07-30).

**Cómo se probó la resolución de voz (lo que discrimina 22.8)**: el voiceId NO se hardcodeó. Se leyó `Maya.voice_map` de la BD dev y se pasó por el **resolver de producción** `resolveVoiceTriple(recipe premium, Maya.voice_map, idioma)` (`packages/core/src/generation/resolve-variant-recipe.ts:70`), el mismo que usa `build-variant-generation-plan.ts:116`. Salida observada:
- `es -> {ttsEndpoint: fal-ai/elevenlabs/tts/eleven-v3, provider: elevenlabs, voice: EXAVITQu4vr4xnSDxMaL}` (Sarah, de `voice_map.es`)
- `en -> {ttsEndpoint: fal-ai/elevenlabs/tts/eleven-v3, provider: elevenlabs, voice: Rachel}` (de `voice_map.en`)

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Voz es resuelta del voice_map de Maya (no hardcode) | resolveVoiceTriple -> Sarah `EXAVITQu4vr4xnSDxMaL` | 01-n7b-run.log, 04-asset-generation-state.txt | OK |
| 2 | Voz en resuelta del voice_map de Maya | resolveVoiceTriple -> `Rachel` | 01-n7b-run.log, 04-... | OK |
| 3 | Asset audio `completed` con word timestamps (es) | gen `01KYSPQWD85C9S3KDPW2ABKNWT` completed; asset `01KYSPRD3C0WZ483EAHRE55R1J` tts_audio, word_timestamps NOT NULL, 15.319s, 43 palabras | 04-..., 05-word-timestamps-sample.txt | OK |
| 4 | Asset audio `completed` con word timestamps (en) | gen `01KYSPRD41J6WZNFYJ6VCFMSVC` completed; asset `01KYSPRWD5W77H7AADD5QFHKX7` tts_audio, word_timestamps NOT NULL, 17.419s, 45 palabras | 04-..., 05-... | OK |
| 5 | Generación FRESCA, no dedup (probaría nada) | `reused=false` en ambos | 01-n7b-run.log | OK |
| 6 | Audio servido por la app = lo que el usuario juzga | descargados via `/api/assets/<id>/download` (login real), HTTP 200, bytes idénticos a la columna `bytes` (246222 es / 279659 en); ffprobe = mp3 44.1kHz mono, 15.4s/17.5s | 02-ffprobe.txt, maya-es.mp3, maya-en.mp3 | OK |
| 7 | Coste registrado en el ledger (no solo logs) | `cost_entry`: es TTS 2¢+ASR 1¢, en TTS 3¢+ASR 1¢; total ledger fal 36¢->43¢ (Δ7¢) | 03-cost-entries.txt | OK |

**Los 2 audios listos para el juicio humano del USUARIO**:
- `docs/verifications/T5.9/rescoped-2026-07-30/voices/maya-es.mp3` (Sarah, español)
- `docs/verifications/T5.9/rescoped-2026-07-30/voices/maya-en.mp3` (Rachel, inglés)

**AVISO para el juicio de naturalidad (contexto obligatorio)**: el voice_map de Maya en el seed dev usa DOS voces de origen inglés multilingüe (Sarah y Rachel de ElevenLabs; `run-context.txt` lo anota). Si el usuario oye ACENTO en el clip español, es una **limitación del seed dev** (Maya no tiene una voz de origen español en su `voice_map`), NO un defecto de resolución: el resolver hizo exactamente lo que el voice_map le dijo (probado por el control negativo abajo). El juicio "¿suena nativa?" mide la voz del seed, no el pipeline.

## Cláusula (a') — ABORTADA por presupuesto (pre-CP3)

El mandato condiciona (a') a que "quede presupuesto suficiente Y CP3 proyecte <= lo que reste de $3". La primera conjunción falla aritméticamente antes de gastar nada, así que el money-guard dispara UN gate antes (a $0 en vez de tras el scrape de ~$1 Anthropic). Esto NO es rebajar la vara: el propio mandato dice "Si $3 no alcanza para (a'), el veredicto es ... y está BIEN — es un cierre honesto de $3".

**Proyección del SISTEMA (fuente primaria, $0)** — la banda que la UI CP2/CP3 lee del recipe premium:
```
recipe premium: est_cost_30s_min_cents=900  est_cost_30s_max_cents=1300  ->  $9,00-$13,00 / variante de 30s
```
$9,00 (suelo del sistema) >> **$2,93** de fal que restan tras (c'). Corroboración:
- planning (estimación realista con el ruteo correcto, avatar=solo hook): **$2,9-3,7/variante** -> ya > $2,93.
- smoke 2026-07-26 (medido): $2,76 real PERO solo generó 1 de 2 clips de b-roll; con ambos habría sido **$3,96**.

Por cualquiera de las tres cuentas, 1 variante premium NO cabe en $2,93. Además `url_analysis` está VACÍA -> (a') exigiría un scrape Firecrawl + análisis Anthropic (~$1) fresco solo para llegar a un CP3 que abortaría. No se gastó. (El comportamiento de abort de CP3 ya está probado con captura en `smoke-2026-07-26/04-cp3-cost-gate.txt`, que paró al proyectar >$5 — re-comprarlo sería tirar dinero, igual que el máster+C2PA ya probado el 2026-07-26.)

## Cláusula (b) — BLOQUEADA por presupuesto (no ejecutada por mandato)

Lote aparte (~$3 adicionales, fuera de los $3 autorizados). El mandato lo excluye explícitamente de este run. Queda documentada como bloqueada-por-presupuesto junto a T5.9-full.

## Control negativo
El resolver de voz DISCRIMINA — no pasa cualquier cosa. `resolveVoiceTriple` resuelve el voice_map real de Maya (positivo) pero LANZA `PermanentStepError` en los 3 casos rojos (`06-control-negativo.log`):
```
[Maya es] NO THROW (resolved ...voice: EXAVITQu4vr4xnSDxMaL)          <- positivo OK
[Maya en] NO THROW (resolved ...voice: Rachel)                        <- positivo OK
[Maya fr (unmapped)] THROW PermanentStepError: ...no tiene voz en el voice_map para el idioma 'fr'
[kokoro voice on eleven-v3 endpoint (es)] THROW PermanentStepError: ...triple de voz incoherente — proveedor 'kokoro' con endpoint 'fal-ai/elevenlabs/tts/eleven-v3'...
[empty voice_map (es)] THROW PermanentStepError: ...la Persona no tiene voz en el voice_map para el idioma 'es'
```
Esto prueba que la resolución es->Sarah / en->Rachel es trabajo REAL del sistema (lee el voice_map, valida coherencia provider<->endpoint), no un literal que el verifier tecleó — el patrón hardcode que el mandato exige que falle.

Además, la ruta live probó el gate de key ANTES de gastar (`resolveFalKeyOrPermanent`): la FAL_KEY estaba sembrada en `app_setting.secret.fal` y **NO hubo ningún 403** (ni key ausente, ni Exhausted balance, ni locked) — el modo de fallo anticipado no se materializó. El `eleven-v3` + `language_code` (riesgo pre-marcado: `generate-voice.ts:105` inyecta `language_code` con un comentario que lo justifica para *turbo*) **funcionó sin 422** para eleven-v3 con Maya en ambos idiomas.

## Rarezas / hallazgos (aunque (c') sea PASS)
- **Kind del asset: `tts_audio`, NO `voiceover`.** El brief del mandato dice que el asset es kind `voiceover`; el código (`generate-audio.ts:426,694`) crea kind **`tts_audio`**. Los audios entregados son `tts_audio`, `completed`, con timestamps — cumplen la sustancia de (c'); solo el nombre del brief estaba equivocado.
- **Narración verifier-supplied (no derivada de N5).** No existe NINGUNA fila `ad_script` en la BD dev (`ad_script` = 0 filas), y su FK obliga a `ad_variant`->lote/persona, cadena frágil de fabricar a mano. Se usó narración de skincare comparable es/en escrita por el verifier. Planning autoriza el juicio sobre "el audio de N7b AISLADO", así que esto NO es una rebaja de la vara — pero se anota que la naturalidad se juzga sobre texto verifier, no sobre un guion que el pipeline derivó.
- La BD dev estaba re-sembrada desde cero (0 runs/batches/scripts; model_profiles con IDs frescos `01KYQB…`): los guiones del run del 2026-07-26 ya no existen, de ahí que no hubiese script reutilizable.

## Coste real
- **fal: $0,07** (7¢) de los $3,00 autorizados. Desglose por endpoint (del ledger `cost_entry`, no de logs): TTS eleven-v3 es 2¢ + en 3¢ = 5¢; ASR speech-to-text es 1¢ + en 1¢ = 2¢. Total ledger fal 36¢->43¢ (Δ **7¢**).
- **Anthropic: $0,00.** (No se hizo intake/análisis: (a') abortó pre-CP3.)
- **Firecrawl: $0,00.**
- **Techo fal $7,62 -> ~$7,55 restantes.**
- vs estimado de la vara re-escalada (~$3-5): muy por debajo porque (a') y (b) no se ejecutaron (abort/bloqueo por presupuesto, como el mandato preveía). (c') sola costó 7¢.

## Veredicto
**(c') / 22.8 -> PASS pendiente de juicio humano** — los 2 voiceovers (es Sarah / en Rachel) están generados, `completed`, con word timestamps, resueltos por el resolver de producción desde el voice_map de Maya, servidos por la app y listos en `voices/maya-es.mp3` y `voices/maya-en.mp3` para que el USUARIO juzgue naturalidad (recordando la limitación de voces del seed dev). **(a') -> ABORTADA por presupuesto** (proyección del sistema $9-13/variante >> $2,93 restantes; no se gastó $0). **(b) -> BLOQUEADA por presupuesto** (lote aparte, no ejecutada por mandato). Cierre honesto de $3: gastados $0,07, sin ningún 403.
