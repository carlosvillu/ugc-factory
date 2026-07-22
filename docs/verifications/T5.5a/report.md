# Verificación T5.5a — N7f: clip de CTA (product shot animado i2v)

- **Tarea**: T5.5a · N7f: clip de CTA (product shot animado i2v) — cerrar el hueco de la escena `cta` (`planning.md`)
- **Fecha**: 2026-07-22
- **Ejecutor**: verifier (contexto fresco, escéptico) · agent-browser (core skill) · sesión `t5.5a`
- **Sistema**: código del diff en árbol de trabajo sobre commit `c62d83d` (`generate-cta.ts` untracked, sha de contenido `4af4718a…`, sin cambios) · docker compose dev (ugc-postgres-dev, healthy) · migraciones aplicadas (incl. `0024` → enum `asset_kind` += `cta_clip`) · gallery sembrada (`veo3.1/image-to-video` presente, kind `i2v`) · `pnpm dev` (web `/api/health` `{ok:true,db:true}`)

## Verificación esperada (literal de planning.md)
> (a) [$0, gate] `buildVariantGenerationPlan` con un guion que tiene escena `cta` → el plan incluye una generación N7f (con el `imageAssetId` del keyframe N7a derivado); un guion SIN cta → sin N7f.
> (b) [$0, gate] el executor N7f con fal fake → produce y persiste el clip (`asset kind='cta_clip'`/vídeo, `parent_asset_ids`=el keyframe N7a), output N7f poblado.
> (c) [~$0,30, LIVE autorizado] una escena cta real → 1 i2v real (Kling/Wan i2v) produce un clip de vídeo H.264 válido del product shot animado (ffprobe: vídeo, duración >0); coste real en `/spend`. El endpoint acepta el payload (money-path probado de verdad, no solo fake).

## VEREDICTO: **PASS**

Las tres cláusulas pasan. (a) y (b) en el gate ($0). (c) ejecutada LIVE tras la recarga de saldo del usuario (10€ en fal.ai, 2026-07-22): el money-path REAL por el executor N7f produjo 1 i2v real (Veo 3.1) → clip H.264 válido persistido como `cta_clip`, con coste $0,80 reflejado en `/spend`. El control negativo del dedup se probó que muerde (rojo sin el prefijo `cta:`). Ningún defecto pendiente.

## Resultado observado vs esperado

| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| a1 | Guion CON escena `cta` → plan incluye generación N7f | `plan.n7fConfig` presente (`ctaEndpoint`=`veo3.1/image-to-video`, `scriptId` truthy); `imageAssetIds` NO en el plan → los DERIVA el executor de la dep N7a (patrón N7d) | test `build-variant-generation-plan.test.ts` (gate verde); `build-variant-generation-plan.ts:164-171` | OK |
| a2 | "con el `imageAssetId` del keyframe N7a derivado" | Arista `N7f ← [N6, N7a]` cableada en `generation-dag.ts:155-158` → `ctx.deps` lleva N7a en runtime; `deriveKeyframeAssetIds` lo deriva (dep-wins) | `generation-dag.ts:152-158`; `generate-cta.ts:72-73` | OK |
| a3 | Guion SIN cta → sin N7f | `plan.n7fConfig` undefined; control: N7d (mismo endpoint) SÍ presente | test `build-variant-generation-plan.test.ts:244-273` | OK |
| b1 | Executor con fal fake → persiste clip `kind='cta_clip'`/vídeo | 1 asset `kind='cta_clip'`, mime de vídeo, `duration_s=4` (cta 2s → enum 4) | test `n7f-cta.test.ts:206-263` (gate verde, msw fake) | OK |
| b2 | `parent_asset_ids` = el keyframe N7a | `parent_asset_ids` = `[keyframe]` (linaje §12) | test `n7f-cta.test.ts:236` | OK |
| b3 | Output N7f poblado (clave distintiva) | `ctaEndpoint` presente, `brollEndpoint` undefined, `route='i2v'`, `clips.length=1` | test `n7f-cta.test.ts:248-259` | OK |
| b4 | Money-gate: cta sin keyframe / sin escena cta / catálogo → Permanent, no gasta | 4 tests de guard verdes (0 generaciones) | test `n7f-cta.test.ts:313-427` | OK |
| c1 | 1 i2v REAL → clip H.264 válido (ffprobe: vídeo, dur>0) | `generation` `completed` (fal_request_id `019f8973…`); clip H.264, `codec_type=video`, 720×1280 (9:16), `duration=4.0s`. Fichero ffprobeado = el asset persistido (checksum `8d515ab0…` idéntico al de la fila `asset`) | `03-cta-clip-persisted.mp4`, `07-money-path-output-live.txt` | OK |
| c2 | asset `cta_clip` con `parent_asset_ids`=keyframe | asset `kind='cta_clip'`, `mime='video/mp4'`, `duration_s=4`, `parent_asset_ids=[keyframe]`, 407660 bytes | `07-money-path-output-live.txt` (fila `asset`) | OK |
| c3 | coste real en `/spend`; endpoint acepta payload (money-path de verdad) | cost_entry `amount_cents=80`, `quantity=4`, `unit=seconds` persistido; `/spend` (leído como humano): fal.ai $11.52 → **$12.32** (+$0,80), Gasto total $13.67 → **$14.47**. Money-path por el executor real (`makeN7fExecutor`→`runGenerateBroll`→cliente fal real), NO por el fake | `08-spend-despues-live.png`, `01-spend-antes.png` | OK |

## Prueba del control negativo (dedup namespaceado, exige el parent)
El control negativo `n7f-cta.test.ts:265` afirma que body(4s)+cta(4s) sobre el MISMO keyframe → AMBOS assets (`broll_clip` + `cta_clip`) persisten sin `LoserRaceError`. Probado que MUERDE:
- Se quitó el prefijo `cta:` del salt (`generate-cta.ts:174` → `${ctaSceneIndex}:${clipIndex}`).
- Se corrió el fichero: **1 test ROJO** — exactamente el control negativo, con `LoserRaceError: runGenerateBroll: un clip de CTA idéntico se está produciendo en otra petición concurrente` (colisión de content_hash N7f↔N7d reaparece). Los otros 6 tests verdes.
- Se restauró desde backup; sha de contenido idéntico al original: `4af4718a5771dff855586246759cdd4d38caa136`. El árbol queda igual al que se verifica.

Conclusión: el control negativo es real, no decorativo — sin el fix de namespaceado el defecto vuelve.

## Coste real
**$0,80** (1 i2v Veo 3.1 de 4s × $0,20/s, sin audio). Verificado en tres fuentes:
- Output del executor: `costCents: 80`.
- BD `cost_entry`: nueva fila fal `amount_cents=80, quantity=4, unit=seconds`; total fal 141→**142** filas, 1152→**1232** céntimos.
- UI `/spend` (humano): fal.ai $11.52 → **$12.32**; Gasto total $13.67 → **$14.47**.

**Divergencia del estimado (recalibrar)**: planning estimó ~$0,30; real **$0,80** → **>25% de divergencia** (Veo i2v 4s a $0,20/s, sin audio). Coincide con lo que reportó el implementer. Sigue bajo el cap $1 autorizado. Recomendación: subir el bound del planning de (c) a ~$0,80.

## Notas y rarezas
- **Bloqueo previo resuelto**: en la 1ª pasada de verificación (antes de la recarga) fal devolvía `HTTP 403 "User is locked · Exhausted balance"` en `storage/upload/initiate` — prerequisito externo (saldo), no defecto de T5.5a. El usuario recargó 10€ y el probe de auth ligero pasó a `HTTP 200 OK` (`06-fal-auth-probe-post-recarga.txt`); la re-ejecución de (c) gastó y pasó limpio.
- **El money-path se verificó por el EXECUTOR real, NO por `cta-i2v.live.test.ts`**: ese test llama a `makeFalClient` directo, salta `runGenerateBroll` y NO escribe `cost_entry` → no puede satisfacer "coste real en /spend" ni "money-path de verdad". El executor es un SUPERCONJUNTO (mismo endpoint + upload + H.264, MÁS persistencia + cost_entry + /spend). Correr ambos = ~$1,60 > cap $1; por eso solo el executor.
- El script de evidencia `money-path.mts` tenía un typo propio en la query final de cost_entry (`created_at`, la columna real es `occurred_at`) — lanzó DESPUÉS de que el executor persistiera todo (generación/asset/cost). No afecta al veredicto; el coste se verificó por BD directa y por /spend. El clip se copió a la evidencia desde el storage dev (checksum verificado).
- `pnpm gate` verde antes de la verificación: 218 files / 2302 tests passed (incluye (a) y (b)).
- Se deja `pnpm dev` corriendo en background y los contenedores docker up al cierre de la sesión.

## Evidencias
- `01-spend-antes.png` — /spend antes (Gasto total $13.67, fal.ai $11.52)
- `03-cta-clip-persisted.mp4` — el clip de CTA persistido (H.264, 720×1280, 4.0s; checksum `8d515ab0…` = fila asset)
- `06-fal-auth-probe-post-recarga.txt` — probe $0 tras recarga: HTTP 200 OK
- `07-money-path-output-live.txt` — salida del executor real: generación completed, asset cta_clip, output N7f, coste 80c
- `08-spend-despues-live.png` — /spend después: fal.ai $12.32, Gasto total $14.47 (+$0,80)
- `money-path.mts` — el script del executor money-path (copia de evidencia)
- (histórico del bloqueo previo) `02-money-path-output.txt`, `04-spend-despues-sin-cambio.png`, `05-fal-auth-probe.txt`
