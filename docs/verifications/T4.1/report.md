# Verificación T4.1 — FalClient + upload de inputs con caché

- **Tarea**: T4.1 · FalClient + upload de inputs con caché (`planning.md` l.557)
- **Fecha**: 2026-07-16 (re-verificación tras recarga de saldo fal; sustituye al FAIL previo por saldo agotado)
- **Ejecutor**: verifier (contexto fresco) · agent-browser (CLI global) · sesión `t4.1` · superficie backend (smoke/script + psql) + UI (`/spend`)
- **Sistema**: commit `936211c` (HEAD) + diff sin commitear de T4.1 (untracked + mods, sin cambios de código desde el FAIL) · `docker compose dev` (`ugc-postgres-dev`) + migraciones (incl. 0016) + seeds boot-time (T3.9): `modelProfiles=16`, `fal-ai/flux-2` presente · `pnpm dev` (web :3000 + worker) healthy (`{ok:true,db:true}`)

## Verificación esperada (literal de planning.md)
> generar una imagen barata real (FLUX.2 dev, <$0,05) end-to-end por polling → `generation` completa, coste real en `/spend`, PNG en storage propio; subir el mismo input dos veces reutiliza `fal_url` (un solo upload: `asset.fal_uploaded_at` no cambia en la 2ª pasada, además de los logs).

## Veredicto
**PASS** — las dos cláusulas se ejercitaron contra el sistema real (fal + BD + storage + UI). Una generación FLUX.2 dev real llega a `completed` por polling sobre la `status_url` guardada, el PNG queda en nuestro storage con bytes/checksum/`generation_id` coherentes, el coste real aparece en `/spend` (fal.ai $0.01), y la 2ª subida del mismo input es cache-hit sin re-subir (`fal_uploaded_at` inmutable, un solo `fal_input_upload` + un `fal_input_cache_hit`, exactamente un asset con `fal_url`).

## Comandos exactos
- `pnpm dev` + `curl -s localhost:3000/api/health` → `{"ok":true,"db":true}`
- `pnpm --filter @ugc/web smoke:generate` → `completed`, cost 0¢ (512², ver nota de redondeo)
- re-run propio del verifier a ~1 MP (`docs/verifications/T4.1/rerun-1mp.ts`, `image_size='square_hd'` → 1024²) vía `tsx --env-file-if-exists=../../.env` desde `apps/web` → `completed`, cost 1¢
- `pnpm test:live fal-client.live` → 1 passed (contrato real de fal)
- `agent-browser open http://localhost:3000/spend` (login humano, sesión `t4.1`) → «fal.ai · 2 · images · $0.01»
- Comprobación: `docker exec -i ugc-postgres-dev psql -U ugc -d ugc` sobre `generation`/`asset`/`cost_entry`

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Generación real FLUX.2 dev end-to-end por polling → `generation` `completed` | 2 generaciones `completed` (`01KXN84A…` 512², `01KXN8TB…` 1024²); `duration_s` 3.19 / 4.89 | rerun-1mp-output.txt, smoke-generate-output.txt, dump BD | OK |
| 2 | Polling sobre `status_url` DEVUELTA, no reconstruida | `generation.status_url = https://queue.fal.run/fal-ai/flux-2/requests/<request_id>/status` guardada y usada tal cual; `poll` hace GET a `handle.statusUrl`/`responseUrl` (fal-client.ts l.278/283), evita `queue.status` del SDK | código + dump `generation` | OK |
| 3 | Coste real en `/spend` (provider='fal') | UI `/spend` → «fal.ai · 2 · images · **$0.01**»; `cost_entry` provider='fal' amount_cents=1 (1MP) + 0 (512²); día 2026-07-16 = $0.01 | 01-spend-fal-001.png, dump `cost_entry` | OK |
| 4 | PNG en NUESTRO storage (asset con `generation_id`, bytes reales, no fal.media) | Asset 1024×1024, 1.428.703 bytes, PNG magic `89 50 4E 47`, checksum `f3dd72…` == fila `asset`, `generation_id=01KXN8TB…`; fichero en `$ASSETS_DIR/generations/<gen>/…png` | generated-flux2-1024x1024.png (+ 512²) | OK |
| 5 | Coste = megapíxeles × 1,2¢/MP, céntimo entero | 1024² = 1,0486 MP × 1,2 = 1,258 → `Math.round` → **1¢** (== `cost_entry`) | aritmética + dump | OK |
| 6 | Cache: 2ª subida = cache-hit, `fal_uploaded_at` inmutable, un solo upload real | `upload#1 cacheHit=false`, `upload#2 cacheHit=true`; un `fal_input_upload` (bytes=290648) + un `fal_input_cache_hit`; input asset `fal_uploaded_at=2026-07-16 10:39:07.429+00`; **exactamente 1 asset con `fal_url`** en toda la BD | smoke-generate-output.txt, dump `asset` | OK |
| 7 | model_profile FLUX.2 sembrado con cost coherente | `{unit:megapixel, amountCents:1.2}` | query BD | OK |

## Coste real
- **Cartera real ≈ 3,8¢** (< $0,05, muy por debajo del cap ~$0,45): smoke 512² ~0,31¢ + re-run 1024² ~1,26¢ + live test ~1,26¢.
- **En `/spend`**: fal.ai = **$0.01** (suma de los dos `runGenerate`: 0¢ + 1¢). El live test NO aparece en `/spend` (core-only, no persiste `cost_entry`) — diferencia cartera↔ledger esperada, no un defecto.
- **Estimado planning**: ~$0,15. Real ≈ 3,8¢ → menor (el planning era conservador). Sin recalibración al alza.

## Notas / rarezas (PASS)
- **Redondeo sub-céntimo (rareza, no bug):** `image_size='square'` → 512×512 = 0,262 MP × 1,2 = 0,314¢ → `Math.round` → **0¢**. Invariante de céntimos-enteros del ledger (documentado en `fal-pricing.ts`), no un fallo: fal facturó ~0,3¢ pero el ledger sólo guarda enteros. El verifier re-generó a `square_hd` (1024² → 1¢) para dar a «coste real en /spend» una prueba justa; esa es la fila que valida la cláusula. Cualquier output <~0,42 MP redondea a 0¢.
- **Fila `submitting` colgada (`01KXN41D35JNMQDF1YQBP2W1TF`):** residuo del smoke que FALLÓ en la verificación previa (submit 403 por saldo agotado). Deuda deliberada de T4.3 (reconciliación), NO defecto de T4.1; ambas generaciones de esta pasada llegaron a `completed`. Ya anotado en el journal.
- **`/spend` UI limpio:** consola del navegador sin errores/warnings de código propio.

## Evidencias en este directorio
- `01-spend-fal-001.png` — `/spend` mostrando «fal.ai · 2 · images · $0.01».
- `generated-flux2-1024x1024.png` — PNG del output 1 MP (checksum `f3dd72…` == fila `asset`).
- `generated-flux2-512x512.png` — PNG del output 512² (checksum `50239e…` == fila `asset`).
- `rerun-1mp.ts` + `rerun-1mp-output.txt` — script propio del verifier (1 MP) y su salida.
- `smoke-generate-output.txt` — salida del smoke del implementer (512², logs upload/cache-hit).
- `live-test-output.txt` — `pnpm test:live fal-client.live` (1 passed contra fal real).
- `browser-console.txt` — consola del navegador.
- `_sha.txt`, `_git-status.txt` — sha verificado y estado del árbol.
