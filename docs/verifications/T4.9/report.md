# Verificación T4.9 — N7e: bed musical IA

- **Tarea**: T4.9 · N7e: bed musical IA (`planning.md`)
- **Fecha**: 2026-07-18 (RE-verificación tras recarga de saldo fal; el intento del 2026-07-17 FALLÓ por causa externa, ver abajo)
- **Ejecutor**: verifier (agente escéptico, contexto fresco) · smoke `pnpm --filter @ugc/web smoke:music` (STEPLESS, superficie backend) + descarga por HTTP autenticado real
- **Sistema**: working tree con el diff T4.9 SIN commitear sobre HEAD `089fe47` · docker compose dev (`ugc-postgres-dev`, host :55432) + `seed:gallery` + `pnpm dev` (web :3000 health `{ok:true,db:true}`, worker) · FAL_KEY real de `.env`

## Verificación esperada (literal de planning.md, tras reinterpretación regla-6 2026-07-17)
> bed de 30 s con el mood pedido (**a juicio humano**), coste registrado, asset `kind='music_bed'` persistido con su procedencia bed-IA (`cost_entry` provider='fal' unit='seconds'). La cláusula `audio_source=ai_bed` en la variante se verifica en T4.11 (movida por regla 6: T4.9 es stepless y no toca `ad_variant`; NO se exige aquí).

## Veredicto
**PASS.** Todas las cláusulas objetivas (duración 30s, coste 1c registrado, asset `music_bed` persistido y descargable por el endpoint HTTP autenticado con checksum íntegro, payload instrumental `lyrics="[inst]"`) se observaron contra el sistema real. El path LIVE de ace-step, que NUNCA se había visto en verde en nuestro sistema (0 generaciones music `completed` en BD), se ejercitó por primera vez con éxito: generación `01KXT4G8PR11S0DXZ8ME19BHYH` `completed` en ~8 s.

**Juicio de mood (2026-07-18): OK del usuario** — el usuario escuchó `04-music-bed.wav` y confirmó "me parece muy bueno": el bed instrumental de ~30s suena al mood pedido ("dark cinematic trailer, epic orchestral, tense, dramatic percussion") y es apto para poner bajo el voiceover. Con este OK, veredicto objetivo + humano = **PASS completo**.

## Contexto: el intento previo (2026-07-17) fue FAIL por causa EXTERNA
El saldo de fal estaba agotado (HTTP 403 "Exhausted balance"): los 2 jobs enviados quedaron `IN_QUEUE pos 0` sin despacharse y degradaron a `failed` tras el timeout de poll (evidencia `01-*.txt`, `02-stuck-requests.txt`). NO era un fallo de código. El usuario recargó 10 EUR; un sondeo directo confirmó que `fal-ai/ace-step` vuelve a despachar y completar en <10s. Esta re-verificación lo confirma end-to-end.

## Pasos ejecutados (re-verificación)
1. `pnpm gate` (sin gastar) -> **verde**: 184 test files, 1912 tests, exit 0. (fal FAKE — no ejercita el path real.)
2. Perfil `fal-ai/ace-step` en BD -> `kind='music'`, `cost={unit:second, amountCents:0.02}`, `status='active'`, `verified_at` set. Sin flag `unverified`. **OK objetivo.**
3. Baseline BD **antes**: 0 assets `music_bed`, 0 cost_entry de música, 2 generaciones music `failed` (las del intento externo fallido). Confirma la afirmación anti-T1.8 del implementer: el path LIVE nunca había estado verde.
4. `ffprobe` verifier-side (darwin, `/usr/local/bin/ffprobe`) disponible.
5. Smoke LIVE: `MOOD="dark cinematic trailer, epic orchestral, tense, dramatic percussion"` (mood distintivo elegido POR MI, no el default, para juzgar output-vs-requested honestamente), `DURATION=30`, `MUSIC_ENDPOINT=fal-ai/ace-step`, guard `timeout 150`. -> COMPLETED en ~8 s (`03-smoke-live-output.txt`).
6. Verificación INDEPENDIENTE por psql (no me fío del self-report del smoke, que imprime `OK` incondicional): generation/asset/cost_entry/inputs directos de BD (`05-db-evidence.txt`).
7. Cláusula 4 como HTTP observable REAL (no comparación de ficheros): `GET /api/assets/[id]/download` sin sesión -> **401**; login `POST /api/login` (password bootstrap) -> 200 + cookie; descarga autenticada -> **200 audio/wav 5.755.294 bytes**.
8. Integridad: sha256(descarga vía API) == sha256(fichero en storage) == `asset.checksum` (los tres idénticos). ffprobe del fichero DESCARGADO: WAV pcm_s16le, 1 stream de audio, `duration=29.907s`.
9. Delta BD **después**: 1 generación music `completed` (fresca, id/timestamps nuevos — NO una resurrección de las 2 `failed`), 1 asset `music_bed`. Consistente.

## Resultado observado vs esperado
| # | Cláusula | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| 0 | Gate previo | `pnpm gate` verde | 1912 tests, exit 0 | gate.log | OK |
| 1 | Perfil ace-step | `kind=music`, sin `unverified`, precio real | `kind=music`, cost `{second,0.02}`, verified_at set | 05-db-evidence.txt | OK |
| 2 | **bed de 30s** (ffprobe) | .mp3/.wav ~30s | WAV `duration=29.907s` (delta 0.09s) sobre el fichero descargado | 04-music-bed.wav, 03-smoke-live-output.txt | OK |
| 3 | **coste registrado** | cost_entry fal/seconds, qty=30 entero, amount_cents=1; cost_actual=1 | cost_entry provider=fal, unit=seconds, quantity=30, amount_cents=1; generation.cost_actual=1 | 05-db-evidence.txt | OK |
| 4 | **asset music_bed + descargable** | asset music_bed, `GET /api/assets/[id]/download` (login -> checksum=storage) | asset kind=music_bed, mime audio/wav, 5.7MB, duration_s=30; unauth->401, auth->200; sha256 descarga==storage==DB | 05-db-evidence.txt, 04-music-bed.wav | OK |
| 5 | **instrumental** (payload) | `inputs.lyrics="[inst]"` | inputs jsonb `{tags:<mood>, duration:30, lyrics:"[inst]"}` | 05-db-evidence.txt | OK |
| 6 | procedencia bed-IA | asset ligado a generation con endpoint ace-step | asset.generation_id -> generation con model_profile ace-step, resolved_prompt=mood | 05-db-evidence.txt | OK |
| 7 | **mood pedido** (JUICIO HUMANO) | bed suena al mood | `.wav` persistido; NO lo juzgo yo — es del usuario | 04-music-bed.wav | pendiente usuario |

## Evidencia
- `01-smoke-output.txt`, `01b-smoke-output.txt` — smokes del intento fallido (saldo agotado), conservados.
- `02-stuck-requests.txt` — jobs `IN_QUEUE pos 0` del intento fallido, conservado.
- `03-smoke-live-output.txt` — smoke LIVE exitoso (generation/asset/coste/ffprobe).
- `04-music-bed.wav` — **el bed descargado por el endpoint HTTP autenticado, para el juicio de mood del USUARIO** (WAV 30s, "dark cinematic trailer, epic orchestral").
- `05-db-evidence.txt` — filas crudas de generation + asset + cost_entry.

## Coste real
**$0.01 (1c).** ace-step $0,0002/s x 30s = 0,6c -> redondea a 1c (`amount_cents=1`, `cost_actual=1`, `quantity=30`). Estimado planning ~$0,30; real ~1c. Sub-céntimo por generación. Nada que recalibrar.

## Notas / hallazgos escépticos
- **El path LIVE de ace-step se vio en verde por PRIMERA VEZ en nuestro sistema** con esta verificación (baseline: 0 completed antes; 1 después). El "gate verde 1912 tests" del implementer solo prueba el camino fal-FAKE; esta ejecución cierra el hueco anti-T1.8.
- **La descarga se verificó como observable HTTP real** (login + endpoint autenticado), no como comparación de ficheros: unauth->401, auth->200, y los bytes servidos por la API tienen el checksum exacto de la BD y del storage. Cero divergencia.
- **Instrumental confirmado en el payload** (`lyrics="[inst]"` en inputs jsonb); si el audio efectivamente carece de voz cantada es parte del juicio auditivo del usuario junto con el mood.
- **Deuda de arquitectura (NO defecto de T4.9, ya documentada):** el servicio N7e no está cableado al worker/sweeper (eso es T4.11). El smoke lo invoca DIRECTO. No afecta a las cláusulas de T4.9.
- Las 2 generaciones `failed` del intento externo fallido quedan intactas en BD (terminales); la de éxito es una fila nueva independiente.
