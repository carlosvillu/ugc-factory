# Verificación T5.26 — La voz `es` de Maya en el seed pasa de origen INGLÉS a origen ESPAÑOL

- **Tarea**: T5.26 · La voz `es` de Maya en el seed es una voz de origen INGLÉS (acento en variantes español) (`planning.md`)
- **Fecha**: 2026-07-30
- **Ejecutor**: verifier (contexto fresco) · verificación backend/datos (sin superficie UI) · scripts stepless contra la BD scratch re-sembrada
- **Sistema**: commit `54893ea` · árbol con el diff SIN commitear (`packages/core/src/persona/seed-data.ts` + `docs/dev-loop/journal.md`; el diff bajo prueba es solo `seed-data.ts`) · Postgres 16 `ugc-postgres-dev` (port 55432) · **BD scratch `ugc_t526` re-sembrada DE CERO** (`pnpm db:migrate` + `pnpm seed` + `pnpm seed:gallery`, `ASSETS_DIR=/tmp/ugc-assets-t526`) — la BD `ugc` dev NO se tocó
- **Autorización de gasto**: cap T5.26 $1 · techo global fal ~$7,46 · abort duro del script a $0,10

## Verificación esperada (literal de planning.md)
> el voiceover N7b en español de Maya suena nativo (juicio humano); el `voice_map` apunta a una voz de origen español.

## Gate previo
`pnpm gate` VERDE desde la raíz (exit 0), con la env correcta de Colima (`DOCKER_HOST=unix://…/.colima/default/docker.sock` + `TESTCONTAINERS_RYUK_DISABLED=true`): lint + typecheck + format:check + knip + readme:status:check + check:contrast + e2e:wired + `pnpm test` (integración 97 files / 676 tests) + `pnpm test:e2e:phases` (4 passed). Log: `logs/00-gate.log`. **Nota de entorno (no es defecto de producto)**: dos primeras corridas del gate murieron por wiring de Testcontainers bajo Colima (`Could not find a working container runtime strategy` con `DOCKER_HOST` vacío; `mkdir docker.sock: operation not supported` al bind-montar el socket de Ryuk). La combinación correcta —socket exportado + Ryuk desactivado— pone verde la suite de integración (probada aparte, 97/97) y el gate completo.

## Pasos ejecutados
1. **Diff bajo prueba** → `git diff` confirma que solo cambia `voice_map.es` de Maya: `EXAVITQu4vr4xnSDxMaL` (Sarah, label `ElevenLabs · Sarah`) → `6Pd8chnUWvPJasJAi15C` (Afrodita, label `ElevenLabs · Afrodita`); `en` (Rachel) intacto. `git diff --stat`: solo `seed-data.ts` (código) + `journal.md` (no del implementer).
2. **Grep del ID viejo** (`EXAVITQu4vr4xnSDxMaL`) fuera de `docs/verifications` → sobrevive SOLO en fixtures GENÉRICOS de resolución (`voice-resolution.test.ts`, `cp3-seed-persona.test.ts:392`) que NO dependen del seed de Maya, y en `journal.md`/`planning.md` como registro histórico. Ninguna referencia de Maya al voiceId viejo quedó viva. Confirmado por el journal (línea 3279).
3. **Aserción de fuente** (cláusula 1 pt 1) → `PERSONA_SEEDS` Maya: `voiceMap.es.voiceId === '6Pd8chnUWvPJasJAi15C'`, `label === 'ElevenLabs · Afrodita'`, `en.voiceId === 'Rachel'`. SOURCE ASSERT OK (`logs/04-source-assert.txt`).
4. **Re-seed DE CERO** (cláusula 1 pt 2) → BD scratch `ugc_t526` migrada + sembrada por el runner del proyecto (`pnpm seed`, `onConflict:'update'` default), NO INSERT manual. `SELECT voice_map FROM persona WHERE name='Maya'` → `es→6Pd8chnUWvPJasJAi15C` (Afrodita), `en→Rachel` (`logs/03-db-voice-map.txt`).
5. **Resolución por el camino de PRODUCCIÓN** (cláusula 1 pt 3) → `resolveVoiceTriple(recipe premium, Maya.voice_map leído de la BD scratch, 'es')` → `voice: 6Pd8chnUWvPJasJAi15C` (NO hardcode; leído del voice_map de la BD re-sembrada). ASSERT OK (`logs/06-n7b-run.log`). Script adaptado del precedente `docs/verifications/T5.9/rescoped-2026-07-30/voices/n7b-voices.ts`: `docs/verifications/T5.26/n7b-afrodita.ts`.
6. **Regen end-to-end** (cláusula 2, gasto real $0,03) → higiene pre-gasto `node scripts/check-orphan-workers.mjs --strict` exit 0 (sin workers vivos); `runGenerateAudio` (`fal-ai/elevenlabs/tts/eleven-v3`, `language_code=es`) leyendo la Afrodita fijada en el seed re-sembrado → generación `completed`, asset `tts_audio` con word_timestamps, fal la acepta (cero 422), `reused=false`. La fal key se sembró cifrada en la BD scratch como hace el boot (`seedSecretIfAbsent`+`encryptSecret`).
7. **Control negativo** ($0) → revertir el voice_map a Sarah y correr la MISMA aserción del PASS → muerde (Sarah ≠ Afrodita → ROJO); `isSeedBatchCapable` discrimina (Afrodita→true, placeholder→false; Maya única batch-capable). Script `docs/verifications/T5.26/control-negativo.ts`, salida `logs/05-control-negativo.log`.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Seed (código): Maya `voice_map.es.voiceId === '6Pd8chnUWvPJasJAi15C'`, label `ElevenLabs · Afrodita`; `en` sigue Rachel | SOURCE ASSERT OK exactamente esos valores | logs/04-source-assert.txt | ✅ |
| 2 | BD re-sembrada de cero: `SELECT voice_map` de Maya → `es→6Pd8…` | `es→6Pd8chnUWvPJasJAi15C` (Afrodita), `en→Rachel` en `ugc_t526` tras `pnpm seed` | logs/03-db-voice-map.txt | ✅ |
| 3 | `resolveVoiceTriple(premium, Maya.voice_map, 'es')` → `voice: 6Pd8…` (no hardcode, del voice_map de la BD) | `es -> {ttsEndpoint: fal-ai/elevenlabs/tts/eleven-v3, provider: elevenlabs, voice: 6Pd8chnUWvPJasJAi15C}` | logs/06-n7b-run.log | ✅ |
| 4 | Voz de **origen español** (sustancia de la cláusula 1) | Afrodita `6Pd8chnUWvPJasJAi15C` = ElevenLabs origen España peninsular (shortlist), NO Sarah origen inglés | shortlist/README.md, seed-data.ts:344 | ✅ |
| 5 | N7b es **suena nativo (juicio humano)** | Usuario eligió Afrodita en A/B ciego de 3 candidatas España + Sarah (2026-07-30) como la más nativa/coherente con Maya | shortlist/README.md | ✅ |
| 6 | (E2E, cláusula 2) Afrodita FIJADA EN EL SEED → `tts_audio` `completed` con timestamps, fal la acepta, fresco | gen `01KYSW3M8PRD8NKT4H0B0TG4D8` completed; asset `01KYSW3ZMRYWPVAJRSXWTNRS3W` tts_audio audio/mpeg 15.539s, word_timestamps NOT NULL (85 palabras, «Llevo» 0.119→0.5s); `reused=false`; 0 422 | logs/06,08, maya-es-afrodita-seed.mp3 | ✅ |
| 7 | Coste registrado en el ledger (no solo logs) | `cost_entry`: fal 2¢ (TTS) + 1¢ (ASR) = 3¢ | logs/08-db-evidence.txt | ✅ |

## Control negativo
`✓ ASSERTION BITES → FAIL: Expected voice '6Pd8chnUWvPJasJAi15C' (Afrodita) but resolved 'EXAVITQu4vr4xnSDxMaL' (Sarah). ROJO.` — al revertir `voice_map.es` a Sarah y pasar por la MISMA `resolveVoiceTriple` + la MISMA aserción del PASS, la aserción MUERDE (la resolución vuelve a apuntar a Sarah, no a Afrodita). El diff NO añade tests, así que este script (`control-negativo.ts`) ES la aserción bajo prueba: su salida roja es lo que prueba que la comprobación no es vacua. Salida completa en `logs/05-control-negativo.log`.

Detalle por caso:

### Caso A — la correspondencia con el voice_map discrimina
- Reverted (Sarah): `resolved es voice = 'EXAVITQu4vr4xnSDxMaL'` → **FAIL / Expected '6Pd8…' pero '…MaL'. ROJO.** (la aserción muerde).
- Control positivo (seed real): resuelve `es -> '6Pd8chnUWvPJasJAi15C'` (Afrodita) → OK.

### Caso B — `isSeedBatchCapable` sigue seleccionando a Maya
- `isSeedBatchCapable(Maya real, es=Afrodita '6Pd8…') = true` (Afrodita NO empieza por `placeholder-`).
- `isSeedBatchCapable(Maya con es='placeholder-es') = false` (el predicado muerde con placeholder).
- Personas batch-capable del seed: `[Maya]` (exactamente una) → Maya sigue siendo la única batch-capable.

## Coste real
**$0,03** (fal): 1 voiceover N7b `es` vía `runGenerateAudio` — TTS 2¢ + ASR 1¢, registrados en `cost_entry` de la BD scratch. Muy por debajo del cap T5.26 ($1) y del abort duro del script ($0,10). El shortlist previo del bucle (3 candidatas) costó $0,09 aparte (no imputable a este run de verificación). vs estimado planning (~1–2¢ o $0): dentro de rango.

## Veredicto
**PASS** — el `voice_map.es` de Maya apunta a una voz de origen español (Afrodita `6Pd8chnUWvPJasJAi15C`) probado en código, en la BD re-sembrada de cero y por el resolver de producción; y el juicio humano de naturalidad ya lo emitió el usuario (eligió Afrodita en un A/B ciego el 2026-07-30). El E2E de gasto ($0,03) confirma que la Afrodita FIJADA EN EL SEED produce un `tts_audio` `completed` con timestamps y que fal la acepta desde el seed (no solo desde el shortlist ad-hoc).

Notas / rarezas (aunque PASS):
- **Naturalidad = juicio humano ya emitido, no re-emitido por el verifier.** La cláusula "suena nativo" se cierra sobre el A/B ciego del usuario (registro in-tree `shortlist/README.md`, escrito por el bucle; los MP3 del A/B se enviaron al usuario y deliberadamente NO se commitean al repo público). El MP3 seed-derivado de este run (`maya-es-afrodita-seed.mp3`, generado desde la Afrodita del seed) respalda esa correspondencia; no es un segundo juicio.
- **La narración de prueba la escribió el verifier** (0 filas `ad_script` en la BD scratch), como en T5.9 — es texto español con fonemas discriminantes (s/z, r), suficiente para el TTS de correspondencia, no un guion de lote real.
- Wiring de Testcontainers/Colima documentado arriba: artefacto de entorno, no defecto del cambio.
- Las 2 referencias vivas a `EXAVITQu4vr4xnSDxMaL` (voice-resolution.test.ts, cp3-seed-persona.test.ts:392) son fixtures genéricos de resolución independientes del seed de Maya; correctamente NO se tocaron (confirmado por el journal:3279).
