# Verificación T3.4 — Model profiles seed + verificación de catálogo

- **Tarea**: T3.4 · Model profiles seed + verificación de catálogo (`planning.md`, fase F3)
- **Fecha**: 2026-07-15
- **Ejecutor**: verifier (contexto fresco) · sin agent-browser (tarea 100% backend/script) · psql + curl + tsx
- **Sistema**: staged sobre commit `1c70fc1` · docker compose dev (Postgres 16, `ugc-postgres-dev`) + migración 0015 + `pnpm seed:gallery` (prompt_template=3 guard_pack=10 model_profile=15). Diff bajo revisión intacto tras la verificación (`git diff` del seed vacío).

## Verificación esperada (literal de planning.md)
> `pnpm fal:verify` corre contra fal.ai real y reporta OK o divergencia por perfil; introducir un precio falso en el seed hace que lo detecte; las recetas quedan recalculadas si hubo cambios.

## Restricción de gasto — confirmada ANTES de correr
- Lectura de código (`packages/db/scripts/fal-verify.ts`): el único I/O de red es `fetch(https://fal.ai/models/<endpoint>/llms.txt)` — fichero de metadatos estático y público. `grep` confirma que NO hay `queue.fal.run`, `fal.subscribe`, `fal.run` ni ningún endpoint de generación en el script ni en el comparador. `FAL_KEY` viaja solo en el header `Authorization` por si una lectura lo pidiera; leer el llms.txt no factura.
- El parseo/comparación (`compareModelProfile`) es lógica pura sin red — el gate la testea con fixtures, no golpea fal.
- **Coste esperado y observado: $0** (lectura de páginas públicas). Evidencia negativa de no-gasto: `cost_entry` sin cambios (26 antes/después), sin jobs `pgboss.job` nuevos ni en estado activo (solo 41 `step.execute` `completed` pre-existentes).

## Pasos ejecutados
1. Leí `fal-verify.ts` + `fal-catalog-verify.ts` + grep → confirmado no-gasto (solo `fetch` del llms.txt público).
2. Contrasté 3 fixtures contra `curl` en vivo (kokoro, omnihuman, veo3.1) → bytes idénticos a los publicados hoy → fixtures REALES, no fabricados.
3. Verifiqué la cadena fuente-de-verdad: `RAW_GALLERY_SEED.modelProfiles` importa `model-profiles.json` directamente (`raw-seed.ts`) — el seed que edito ES el input de `fal:verify`.
4. Levanté docker + 0015 + `pnpm seed:gallery` (15 model_profiles). Puse `verified_at = NULL` en las 15 filas para probar que MI run las escribe.
5. RUN 1 (limpio): `pnpm fal:verify` contra fal real → 15 OK · 0 divergencias · 0 no verificables (incluidos los 7 perfiles SIN fixture, verificados solo en vivo). → 01-fal-verify-clean.txt.
6. Evidencia BD post-run: 15/15 `verified_at` escritos por mi run (02-verified-at-after.txt), `cost_entry` intacto, sin jobs nuevos.
7. Control negativo (lo hice yo): inyecté `amountCents: 77` en omnihuman (real fal = 16) en `model-profiles.json`. RUN 2 → DIV para omnihuman nombrando AMBOS números (`seed 77 c/second, fal 16.0000 c/second`), 14 OK. → 03-fal-verify-false-price.txt. Muerde sobre `compareModelProfile`, la MISMA función de producción.
8. Restauré desde copia pristine → `git diff` del seed vacío → RUN 3 → 15 OK de nuevo. → 04-fal-verify-restored.txt.
9. Test unit `fal-catalog-verify.test.ts`: el control negativo asserta sobre `compareModelProfile` real con fixtures leídos de disco (bytes reales de fal). 40 tests OK junto a `cost.test.ts` (T2.2). → 05-t22-and-negcontrol-tests.txt.
10. Recipes: revisado el diff de `seed-data.ts` — endpoints recableados a `falEndpoint` reales donde confirmados; b-roll no resuelto (Wan/Kling-v3/Seedance) queda como etiqueta con `[endpoint pendiente F4]`; horquillas 30–170/180–500/900–1300 SIN cambio, justificado (COGS-30s del Apéndice B, un rango; derivas de precio dentro).
11. Invariante T2.2 (estimador ±10% vs Apéndice B): `cost.test.ts` verde sobre las recipes recableadas. Gate completo: 1547 tests / 139 files verde. → 06-gate.txt.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | `fal:verify` corre contra fal real, reporta OK/div por perfil | 15 perfiles, reporte por perfil leyendo el llms.txt público, 15/15 OK (7 sin fixture verificados en vivo) | 01-fal-verify-clean.txt | OK |
| 2 | No factura | $0: cost_entry intacto (26), sin jobs nuevos; código solo `fetch` público | 02-verified-at-after.txt + lectura de código | OK |
| 3 | Precio falso inyectado → lo detecta, nombrando los dos números | omnihuman seed=77 vs fal=16 → DIV "seed 77 c/second, fal 16.0000 c/second"; restaurado → 15 OK | 03/04-fal-verify-*.txt | OK |
| 4 | Control negativo muerde sobre la función real con fixtures reales | `compareModelProfile` (prod) sobre fixtures de bytes reales de fal (curl-confirmados) | 05-t22-and-negcontrol-tests.txt + curl vs fixtures | OK |
| 5 | Recetas recalculadas si hubo cambios | Endpoints recableados a reales; horquillas sin cambio con justificación (Apéndice B); T2.2 ±10% verde | seed-data.ts diff, 06-gate.txt | OK |
| 6 | `verified_at` marcado por el comando | 15/15 escritos por mi run (nulled antes, set después) | 02-verified-at-after.txt | OK |

## Coste real
$0 (vs estimado $0). `fal:verify` lee solo metadatos públicos (`llms.txt`); no submete generación. Confirmado por código y por ausencia de `cost_entry`/jobs nuevos.

## Veredicto
PASS — Las tres mitades de la Verificación se cumplen contra el sistema real: `fal:verify` reporta 15/15 OK por perfil contra fal.ai (incluidos los 7 sin fixture), el control negativo que inyecté detecta el precio falso nombrando ambos números sobre la función de producción con fixtures reales, y las recipes están recableadas a endpoints reales con las horquillas justificadamente sin cambio (invariante T2.2 verde). Coste $0 confirmado.

Rarezas / notas:
- Solo 8 de 15 perfiles tienen fixture capturado para el gate; los otros 7 (kling-v2-standard, seedream v4.5, nano-banana-pro, elevenlabs turbo/eleven-v3/speech-to-text, sync-lipsync v2 y v2/pro) se verifican SOLO en el run en vivo. En este run todos dieron OK, pero un cambio de precio de fal en esos 7 no lo cazaría el gate — solo el `fal:verify` manual. Deuda razonable (el gate no debe golpear la red), anotada.
- Deudas `[verificar]` de §13.1 l.600 resueltas por el implementer (OmniHuman $0,14→$0,16/s; ace-step ~$0,005→$0,0002/s; latentsync $0,20/vídeo; sync-lipsync $3/$5/min; Veo 3.1 base $0,20/s) — deben anotarse en PRD+planning por el cierre del bucle (regla 6), no las toca el implementer ni el verifier.
- B-roll sin endpoint resuelto (Wan 2.6, Kling v3, Seedance 2.0 — 404 en fal el 2026-07-15) queda como etiqueta `[endpoint pendiente F4]`: deuda de F4 declarada, correcta (no se inventa endpoint).
