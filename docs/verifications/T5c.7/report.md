# Verificación T5c.7 — El sweeper NO es kind-aware: N7f (CTA i2v) explota → NO hay vídeo end-to-end 🐛 BUG DE DINERO

- **Tarea**: T5c.7 · fix kind-aware de `finalize-download.ts` (N7d `broll_clip` vs N7f `cta_clip`) (`planning.md:1146`)
- **Fecha**: 2026-08-14
- **Ejecutor**: verifier (contexto fresco) · agent-browser 0.27.x · sesión `t5c.7`
- **Sistema**: fix UNCOMMITTED sobre `ba73d47` (rama `feat/t5b1b-i-n6-per-scene`) · docker-compose.dev Postgres 16 PERSISTENTE (`:55432`) + `pnpm dev` (web :3000 + worker) · **fal REAL** (`FAL_BASE_URL` unset → seam inerte → `queue.fal.run`; `secret.fal` presente en `app_setting`) · seeds (personas=17, model_profiles=18). Fix preservado en `fix.patch` + `base-sha.txt` antes de tocar nada.

## Verificación esperada (literal de planning.md)
> Un lote premium de 1 variante llega a `/library` con **un vídeo real terminado** (N7f→N8→N9 completos, master_asset_id no NULL). Control: N7d y N7f producen assets con kinds DISTINTOS (`broll_clip` vs `cta_clip`) pese a compartir endpoint. Control negativo: revertir el fix kind-aware → N7f vuelve a explotar con el invariante roto.

## Pasos ejecutados
1. **Pre-flight ($0)**: `check-orphan-workers.mjs --strict` → exit 0 (0 huérfanos, 0 workers ajenos). Fila envenenada de T5c.4 ya re-kindada por el bucle (gen N7f del run atascado `01KZYDJ6…` ahora `cta_clip`, documentado en journal). Persona Maya = `01KYQBAKS2XHWTCGRXXJDG50NH` (única generable: voiceIds reales; las otras 10 `(placeholder)`).
2. **Gates $0**: typecheck `@ugc/core`+`@ugc/services` verde; core unit 1332/1332; **integración `finalize-download.test.ts` 16/16 verde** (incl. casos T5c.7: N7d→broll_clip, N7f→cta_clip, redelivery no-op, stepRunId null→throw, node_key desconocido→throw, dedup FAST-HIT + fila envenenada).
3. **Control negativo** (ANTES de gastar, ver sección dedicada): revertí la línea discriminante → 4 rojos con `expected 'broll_clip' to be 'cta_clip'`; restauré (md5 idéntico).
4. **Money run (fal REAL)**: login humano → intake URL CeraVe (es) → run análisis `01KZZSR51AJARNR1740GB3CC4B` (N1-N4) → **CP1 aprobado** (sin gating de imagen este run) → **CP2**: tier Premium, 1 variante (1 ángulo × 1 hook × es), objetivo hook_test, **persona Maya FIJADA**. UI COGS `$3.60–$5.20` (high-end < abort $5.25) → **money-gate PASS, PROCEDER**. Batch `01KZZT2RFWXF982RVB3K4MM1FF` (premium).
5. **CP3** (`01KZZT2RGG8NDN8R8J8XE630MW`): 1 guion real (Maya, es, 3 escenas hook/body/cta). Casilla "Aprobar esta variante" (1/1) → "Confirmar guiones" → **MONEY STARTS** → navegación a run generación `01KZZT65C77PB5BNP6AHA0QE60` (wiring T5c.1).
6. **Generación N6→N9** (monitor de coste + retry, abort duro 525c): N6, N7a-N7f **todos succeeded** — **N7f (CTA i2v) NO explotó** (el nodo que reventaba con dinero real en T5c.4). N7c (avatar omnihuman) fue el más lento (~4 min, reconciliado por el sweeper dentro del deadline, 0 reintentos). **N8 (compose) succeeded** (antes quedaba `awaiting_deps` para siempre) → **N9 (CP4/QA) waiting_approval**.
7. **CP4**: QA score 88, todos los checks pass salvo `duration:fail` (12.467s vs 12.0s nominal — overshoot de 0.467s, no vídeo roto; `av_duration_diff:pass`). **Aprobar** (acción humana, override del flag de duración) → variante `scripted`→**`approved`**.
8. **`/library`**: la variante aparece ("Más de 17.000 personas… · es · 12s · ✓"); play → `video.currentTime=3.33s`, `paused:false`, `readyState:4`, `src=/api/assets/01KZZTFHE0KEWB7KGYNEFJJFKQ/download` → **vídeo REAL reproducible**.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Lote premium 1 variante llega a `/library` | Variante `approved` visible y reproducible en `/library` | 09-library-video.png, 10-library-video-playing.png | OK |
| 2 | Vídeo real terminado (N7f→N8→N9 completos) | N7f/N8/N9 todos succeeded; máster mp4 1080×1920, H.264+AAC, 12.467s, 12.6MB | master-ffprobe.txt, master.mp4 | OK |
| 3 | master_asset_id NO NULL | `01KZZTFHE0KEWB7KGYNEFJJFKQ` (kind `final_video`) | DB, ffprobe | OK |
| 4 | **N7d `broll_clip` != N7f `cta_clip`** (kinds distintos, mismo endpoint) | N7d=`broll_clip`, N7f=`cta_clip` | query de control (abajo) | OK |
| 5 | Coste <= $5.25 (abort) | **$3.28** total ($3.02 fal) | cost-breakdown.txt, generation-monitor.txt | OK |
| 6 | Control negativo: revertir → N7f explota | 4 tests rojos con `'broll_clip' to be 'cta_clip'` | control-negativo-RED.txt | OK |

**Query de control de kinds** (scopeada al run nuevo `01KZZT65C77PB5BNP6AHA0QE60`):
```
node_key | kind
---------+------------
N7d      | broll_clip
N7f      | cta_clip
```
(Kinds DISTINTOS pese a que N7d y N7f comparten `fal-ai/veo3.1/image-to-video`.)

## Control negativo
**ROJO reproducido.** Revertí la única línea discriminante de `finalize-download.ts` (`videoAssetKind==='broll_clip' ? await resolveBrollVideoAssetKind(...) : videoAssetKind` → `const assetKind = videoAssetKind;`, es decir el bug: i2v→`broll_clip` incondicional) y corrí la integración: **4 tests FAILED** (`test/integration/finalize-download.test.ts`, 12 passed | 4 failed):
```
FAIL N7f (CTA) → crea asset cta_clip, NO broll_clip (el nodo que rompió con dinero real)
  AssertionError: expected 'broll_clip' to be 'cta_clip'  // Expected: "cta_clip"  Received: "broll_clip"
FAIL N7f REDELIVERY (rama alreadyFinalized): NO-OP gracioso, NO «invariante roto»
  AssertionError: expected 'broll_clip' to be 'cta_clip'
FAIL stepRunId === null en ruta de vídeo b-roll → PermanentStepError RUIDOSO
  AssertionError: promise resolved "{ …(2) }" instead of rejecting  (assetId, costCents:160)
FAIL node_key desconocido (p.ej. N7c) → PermanentStepError (no fallback silencioso)
  AssertionError: promise resolved "{ …(2) }" instead of rejecting  (assetId, costCents:160)
```
Fix restaurado → **16/16 verde** (`control-negativo-GREEN-restored.txt`); md5 del fichero idéntico al original (`f05ccc3a…`), `git diff --stat` = `fix.patch` byte a byte. Evidencia cruda: `control-negativo-RED.txt`.

### Detalle: el bug reproducido con dinero real en T5c.4 (baseline)
En T5c.4 (mismo flujo, sin el fix) N7f explotaba con `finalizeSingleCallPerSecondGeneration: completed pero sin asset cta_clip (invariante roto)` → N8 `awaiting_deps` para siempre → variante `scripted`, master NULL, nada en `/library` (`docs/verifications/T5c.4/report.md`). Con el fix, este run llega hasta el máster.

## Coste real
**$3.28** (328c) medido por join `cost_entry → step_run → run_id` sobre los 3 runs del lote nuevo (análisis + guiones + generación), NO por delta de baseline. Desglose:

| Run | Nodo | Proveedor | Coste |
|---|---|---|---|
| análisis `01KZZSR5…` | N1-N4 | anthropic + firecrawl | 23c + 0c |
| guiones `01KZZT2R…GG…` | N5 | anthropic | 3c |
| generación `01KZZT65…` | N7a keyframes | fal | 2c |
| | N7b TTS | fal | 2c |
| | N7c avatar (omnihuman) | fal | 98c |
| | N7d body i2v (veo3.1, 6s@20c/s) | fal | 120c |
| | N7e música (ace-step) | fal | 0c |
| | N7f cta i2v (veo3.1, 4s@20c/s) | fal | 80c |
| **TOTAL** | | | **328c = $3.28** |

- **Abort $5.25 nunca alcanzado** (pico 328c; sin retry storm, `max_retry=0` en todos los N7).
- **Banda de proyección** (fal-only, planning): $2.6–4.2. **fal real = $3.02** → dentro (sin desviación >25%). Total incl. Anthropic/Firecrawl = $3.28, también dentro.
- **Dedup 0 hits** (fresh, como predijo el brief): el N7f nuevo tiene content_hash `b0408b61…` != el del run atascado `0f157e47…` → re-pagó completo (N7d 120c + N7f 80c). El reintento NO reusó el run de T5c.4.

## Veredicto
**PASS** — un lote premium de 1 variante (persona Maya fija, hook_test) llega a `/library` con un vídeo real terminado y reproducible: N7f (CTA i2v) finaliza como `cta_clip` (antes explotaba), N8 compone el máster (1080×1920 H.264+AAC 12.467s), N9/CP4 aprobado, `master_asset_id` no NULL, y la query de control confirma N7d=`broll_clip` != N7f=`cta_clip` pese a compartir el endpoint veo3.1/image-to-video. Coste real $3.28 < abort $5.25, dentro de banda. El control negativo muerde (4 rojos con el invariante roto) y el fix lo cura (16/16 verde).

### Notas / rarezas (aunque el veredicto es PASS)
- **Ruta EJERCITADA = FRESH (reconcile/finalize), NO reuse/dedup.** El análisis nuevo produjo content_hashes nuevos → 0 dedup hits → N7d/N7f re-pagaron completo. La **ruta de reuse §9.6** (parte 2 de la Entrega — que el dedup con `cta_clip` reuse la N7f completada y NO re-herede el bug) NO fue ejercitada por dinero real; queda cubierta por los tests de integración verdes (`resolveProductionDedup` FAST-HIT + fila envenenada, `finalize-download.test.ts:490,515`). Recomendación al bucle: aceptable (la ruta viva de dinero es la fresca; el reuse es determinista y testeado), pero conviene anotarlo.
- **HALLAZGO (no bloquea T5c.7, PRE-EXISTENTE): `/` (dashboard) devuelve 500.** `/api/dashboard` lanza `zod_contract_drift` (ZodError "ULID inválido") porque `activeBatches[].batchId`/`projectId` fallan el regex ULID: hay **3 `ad_batch` fixtures de 2026-07-31 con IDs hex** (`d115044…`, `7a241b8…`, `ec70df3…`, status `planned`) que la query de dashboard incluye y el schema de respuesta rechaza → homepage rota. Es **contaminación de datos de la dev DB**, NO regresión del fix T5c.7 (el fix no toca dashboard). No bloqueó el flujo: la intake vive en `/analyses/new` (ruta separada, carga bien) y `/library` también. **Para el bucle**: limpiar esos 3 fixtures hex de la dev DB, o endurecer el schema/tolerancia de `/api/dashboard`. Evidencia: `dev-stack.log` (líneas GET / 500 + zod_contract_drift).
- **QA `duration:fail` en CP4**: máster 12.467s vs 12.0s nominal (overshoot 0.467s del troceo de escenas en hook_test). Todos los demás checks pass, score 88. Se aprobó por override humano (CP4 es checkpoint de juicio). No es vídeo roto — reproducible confirmado en `/library`.
- **N7c avatar 98c** este run (vs 58c en T5c.4): el clip de avatar salió más largo/caro; dentro de banda igualmente.
- Console del navegador limpia (solo `[React Flow] parent needs width/height` dev-only de dependencia, muere en prod).
- **`[verificar]` heredado**: el flip `unverified:false` de `fal-ai/veo3.1/image-to-video` queda respaldado por 2o run de gasto real (N7d 120c + N7f 80c @20c/s confirmados de nuevo).
