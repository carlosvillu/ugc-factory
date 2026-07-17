# Verificación T4.6 — Preview de voz en CP2/CP3

- **Tarea**: T4.6 · Preview de voz en CP2/CP3 (`planning.md:597-602`)
- **Fecha**: 2026-07-17
- **Ejecutor**: verifier (agente escéptico) · agent-browser 0.27.0 · sesión `t4.6`
- **Sistema**: commit `5be9cf4` + working tree con el diff SIN commitear de T4.6 (21 mod + 10 nuevos). Docker compose dev (Postgres 16), migración `0019_special_wolfpack.sql` aplicada (columna `generation.voice_preview` + índice único parcial `generation_voice_preview_content_hash_key`), `pnpm dev` (web + worker), seeds de arranque (personas=5, model_profiles=16 incl. kokoro/turbo). **fal REAL** (no FAL_BASE_URL). Secretos `secret.fal`/`secret.anthropic` presentes en `app_setting`.

## Verificación esperada (literal de planning.md)
> botón ▶ junto a cada Persona reproduce su voz en el idioma de la variante; reproducirla 5 veces no añade coste (caché comprobada en `/spend`).

## Preparación de escenario (atajos permitidos, cua.md regla 1)
- **Personas sembradas tienen `voice_map` con `voiceId` placeholder** (`placeholder-es`, provider elevenlabs) que romperían la llamada real a ElevenLabs. Edité (SQL, prep) el `voice_map` de la persona «Lucía (placeholder)» (`01KXGV0HS4BT8SJGV8HCMAKAV4`) a **voces REALES** confirmadas en T4.5: `es → {provider:elevenlabs, voiceId:Rachel}`, `en → {provider:kokoro, voiceId:af_heart}`. Así la ruta de resolución `voice_map → provider → endpoint` se ejercita de verdad (una voz inválida habría fallado la generación, prueba autovalidante).
- Run conducido por la UI vía intake **texto libre** (evita scrape externo Firecrawl; N3 síntesis Anthropic real). El envío del form (RHF) requirió un `input` event nativo para que RHF registrara el valor — esto es prep del escenario para llegar a CP2, NO la superficie verificada.
- CP1 desbloqueado con «Generar packshot con IA» (sin coste fal en la ejecución) + «Aprobar y continuar».

## Pasos ejecutados (journey LIVE)
1. Login (headless) → `/analyses/new` texto libre → run `01KXQMJ9Y1S556WGCXSBMA1EKW`. N1 succeeded, N2 skipped, **N3 pausa en CP1** (brief «Sérum Facial Hidratante»). `02-cp1-brief.png`.
2. **agent-browser headless NO renderiza el canvas React Flow** (contenedor 0×0 → nodos apilados en origen, panel no monta → «0/0 Pasos»). Backend SSE probado OK (fetch del snapshot con los 4 steps). **Solución: sesión `--headed`** (ventana real da dimensiones al contenedor). Canvas renderiza (Progreso 2/4, CP1 editable). Documentado como limitación de la herramienta en headless, no defecto del producto (T2.6 ya condujo este canvas).
3. Aprobar CP1 → N4 compone matriz → **CP2**: «MATRIZ PLANIFICADA · 6 VARIANTES», 3 personas candidatas (avatar_hint «Mujer 28-30 años…»). Lucía candidata con ▶ **es** (única con voice_map). `03-cp2-matrix.png`, `04-cp2-voice-button.png`.
4. **Cláusula 1 · CP2**: `scrollintoview @e34` + **click real de agent-browser** en ▶ es → dispara reproducción: request `GET /api/assets/…6H5JKR/download` (Media) **200**. (La 1ª generación se había disparado antes; la reproducción por click sirvió el asset cacheado.) `05-cp2-voice-playing.png`.
5. **Cláusula 2**: baseline (vp_gen=1, fal_entries=22) → **5 POST directos** idénticos (`persona=Lucía, language=es`) → los 5 `200 cached=true` mismo `assetId` → conteos SIN cambio. `/spend` fal plano en $0.08. `06-spend-after.png`, `counts-after-replays.txt`.
6. Fijar Lucía (radio) en CP2 → «Confirmar y crear 6 variantes» → nuevo run `01KXQNW5X6DMDJ5MAT3F21JJPF`, N5 (ScriptWriter, Anthropic real) → **CP3** (`waiting_approval`). 6 variant-cards, cada una con ▶ `data-persona-id=01KXGV…AKAV4` (NO null, contrato `personaId` propagado) y `data-language=es`. `07-cp3-scripts.png`.
7. **Cláusula 1 · CP3**: `scrollintoview` + **click real** en ▶ de la 1ª variant-card → `POST …/voice-preview` **200** + `GET /api/assets/…6H5JKR/download` **200** (MISMO asset que CP2 → **cache-hit cross-surface**). Conteos SIN cambio. `08-cp3-voice-played.png`.
8. **Supplementario (robustez de resolución, no exigido literalmente — idioma de variante es `es`)**: POST directo `{language:'en'}` → generación **kokoro** (`fal-ai/kokoro`, NO elevenlabs) completada, sample «Hi there, this is how this voice sounds…» (inglés), `audio/wav` 24kHz. Prueba que la resolución no está hardcodeada a un proveedor. `voice-en-kokoro.wav`.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1a | ▶ junto a Persona reproduce su voz en el idioma de la variante — **CP2** | Click real ▶ es → audio servido 200; asset TTS real (ElevenLabs Turbo `fal-ai/elevenlabs/tts/turbo-v2.5`, sample «Hola, así suena esta voz…» ES, MP3 128kbps 2.74s) | `05-cp2-voice-playing.png`, `voice-es-elevenlabs.mp3`, `db-voice-preview-gens.txt` | ✅ |
| 1b | ▶ reproduce su voz en el idioma de la variante — **CP3** | Click real ▶ variant-card (persona-id=Lucía NO null, lang=es) → POST 200 + audio 200, mismo asset (cache-hit) | `07-cp3-scripts.png`, `08-cp3-voice-played.png` | ✅ |
| 1c | Resolución voice_map→provider→endpoint correcta (no hardcodeada) | es→elevenlabs turbo, en→kokoro; samples en su idioma (ES/EN); mimes correctos (mpeg/wav) | `voice-es-elevenlabs.mp3`, `voice-en-kokoro.wav` | ✅ |
| 2 | Reproducir 5 veces NO añade coste (caché en `/spend`) | 5 POST idénticos → 5× `cached=true`, 0 filas nuevas `generation(voice_preview)` (1→1) y `cost_entry(fal)` (22→22); `/spend` fal plano **$0.08** todo el journey (baseline→final); chars +96 = SOLO las 2 generaciones únicas, 0 de las réplicas | `counts-after-replays.txt`, `00/06/09-spend-*.png` | ✅ |

## Coste real
- **fal (T4.6): $0.00** en el ledger. 2 generaciones reales (es ElevenLabs Turbo 43 chars; en Kokoro 53 chars). Cálculo: Turbo 5¢/1k·43 = 0.215¢ → **0¢**; Kokoro 2¢/1k·53 = 0.106¢ → **0¢** (redondeo sub-céntimo). El total fal de `/spend` no se movió: **$0.08 → $0.08** (387→483 chars). Provider-side ElevenLabs cobró una fracción de céntimo por el sample de pago (bajo granularidad del ledger). **Muy por debajo del cap $0.60.** Estimado $0.20.
- **Anthropic (prep de escenario, no T4.6): +$0.17** (síntesis brief N3 + matriz N4 + guiones N5). Total `/spend` $1.92→$2.09.

## Veredicto
**PASS** — Ambas cláusulas verificadas contra el sistema real. (1) El ▶ dispara reproducción de audio TTS real de la voz asignada a la Persona en el idioma de la variante, en **CP2 y CP3** (clicks reales de agent-browser tras `scrollintoview`); resolución voice_map→provider→endpoint correcta y no hardcodeada (es→ElevenLabs Turbo/MP3-ES, en→Kokoro/WAV-EN). (2) Reproducir 5 veces (POST directo idéntico) NO añade coste: 0 filas nuevas de `generation`/`cost_entry` de fal, `/spend` fal plano en $0.08 — la caché scoped (índice único parcial por `content_hash`) hace hit sin tocar fal ni el ledger. Cache-hit cross-surface CP2↔CP3 (mismo content_hash → mismo asset). Consola limpia (0 page errors). Coste fal $0.00 << cap $0.60.

### Notas / rarezas (aunque PASS)
- **Discriminador de la cláusula 2 = conteo de FILAS, no dólares.** El sample de pago (43 chars ElevenLabs Turbo) se cobra **0 céntimos** por redondeo sub-céntimo, así que el TOTAL en dólares de `/spend` sería plano tanto en un hit como en un miss. La caché se probó por el **delta de filas** `generation(voice_preview=true)` y `cost_entry(provider='fal')` medido en Postgres (fuente cruda, no logs del código), y corroborado por la columna de **chars** de `/spend` (+96 = exactamente las 2 generaciones únicas, 0 de las 6 reproducciones extra). La cláusula pide «caché comprobada en /spend»: /spend confirma fal plano en $0.08 y chars sin movimiento por réplicas — cumplido, con la salvedad de que el dólar por sí solo no discrimina.
- **agent-browser headless no renderiza React Flow** (contenedor 0×0). Se resolvió con sesión `--headed`. Limitación de la herramienta, no del producto; el warning «parent container needs a width and a height» es de la dependencia React Flow en dev.
- **Clicks sintéticos de agent-browser fallaban en el panel largo de CP2** hasta hacer `scrollintoview` (el ▶ estaba bajo el fold). Tras scroll, el click real de agent-browser dispara el flujo correctamente. La 1ª generación de la muestra es (paso 4) se disparó vía `.click()` nativo antes de diagnosticar el scroll; TODAS las verificaciones posteriores del ▶ (CP2 tras scroll, CP3) usan clicks reales de agent-browser.
- **Juicio auditivo humano NO exigido** por la Verificación (a diferencia de T4.5): el crux objetivo es «audio TTS real de la voz/idioma correctos, servido y reproducible» — verificado (endpoint correcto por proveedor, sample en el idioma correcto, bytes de audio válidos ID3/RIFF, mime correcto). Audios guardados (`voice-es-elevenlabs.mp3`, `voice-en-kokoro.wav`) por si se desea confirmación auditiva humana, pero no bloquea el cierre.
- **Gate**: el bucle ya reportó `pnpm gate` VERDE (1853 tests). Mi re-ejecución concurrente con `pnpm dev` vivo dio 1 FAIL espurio (`sse-contract.test.ts`: «Another next dev server is already running… PID 31275» = mi propio dev en :3000). Colisión de puerto autoinfligida, no regresión (`gate.txt`).
- **Personas placeholder**: la persona verificada tiene `voice_map` real editado en prep; las otras candidatas (Nora/Sofia Verifier F2) tienen `voice_map` vacío → correctamente NO pintan ▶ (comportamiento esperado: solo idiomas con voz asignada).
