# T5.8c · Componer escenas multi-clip (concatenar antes de recortar, §7.5) — BLUEPRINT

> Diseño durable para que un **implementer fresco** lo consuma en sesión estable.
> Verificado contra el código REAL (no supuestos) el 2026-07-24 por el coordinador.
> **NO lo implementa el coordinador** — es una tarea de ~4 ficheros que cruza core/services/worker
> y, por la regla de contexto fresco + circuit breaker (7/7 stalls en subagentes largos esta sesión),
> debe arrancar en sesión estable con implementer nuevo.

## Qué arregla (el bug de fase, causa raíz de T5.9 FAIL)

`fitSegmentFile` (`fit-segment.ts:200`) lanza `FitError` cuando el clip de vídeo es MÁS CORTO que
su narración por ≥0.5s. En el run real de T5.9 (`01KYA3ZFF5QQ5BQVRWW3Y93QQ0`): body clip 6s <
narración EN 8.68s → hard-fail, N8 no compone (0/6 másters). Es **objective-independent**: a
`conversion` (30s) el gap recurre peor.

**Causa raíz doble:**
1. **El clip nunca se dimensiona lo bastante largo.** veo3.1 i2v tope de clip = 8s (enum `[4,6,8]`);
   una escena body de `conversion` son 16s / maxBodyScenes:2 = **8s/escena**, y la narración real
   supera el bucket (`quantizeDurationToEnum` cuantiza el TEXTO estimado words/2.5, que SUBESTIMA el
   TTS real). Un solo clip NUNCA cubrirá una narración larga.
2. **§7.5 YA trocea la escena en varios clips, pero la composición nunca los concatena.** `planScene`
   (scene-planner) parte una escena larga en `ceil(bodySeconds/maxDuration)` clips (N7d/N7f generan Y
   PAGAN todos), pero `pickClip` (`assemble-composition-spec.ts:249`) hace
   `reduce((a,b)=>a.clipIndex<=b.clipIndex?a:b)` → **usa solo clipIndex 0 y descarta (paga-y-tira)
   el resto**. Money leak + clip corto = el mismo defecto.

**El fix = USAR los clips ya pagados:** concatenar TODOS los clips de una escena (ordenados por
`clipIndex`) ANTES de fittear a la narración. Así el vídeo concatenado ≥ narración → sin FitError, y
ningún clip se paga-sin-usar.

## Topología REAL verificada (dónde entra el concat)

`compose-variant.ts` (executor N8, WORKER) docstring:2-7 + loop:192:
```
assembleCompositionSpec (clips CRUDOS, 1 videoAsset/segmento HOY)
  → fitSegmentFile (POR CLIP, a la narración N7bClipRef.durationSeconds)   ← line 192 loop
  → normalize-once (T5.2)
  → composeVariant (concat ENTRE segmentos + mix + final pass + C2PA + QA)
```
El **concat INTRA-escena** entra en el loop de `compose-variant.ts:192`, **ANTES del `fitSegmentFile`**:
cuando un segmento tiene varios clips → concatenarlos primero → fittear el resultado a la narración.
NO es `assembleCompositionSpec` (ese solo ensambla referencias) — PERO ese fichero también cambia,
porque hoy DESCARTA los clips ≥1 antes de que lleguen al executor.

## Ficheros en juego (los ~4)

1. **`packages/core/src/contracts/composition-spec.ts`** — `CompositionSegment.videoAsset: UlidSchema`
   (UN ULID) → pasa a llevar la **lista ordenada** de clips de la escena. Opciones:
   - (A) `videoAssets: z.array(UlidSchema).min(1)` (orden = orden de clipIndex = orden temporal del
     concat intra-escena). Migra los consumidores. **Recomendada** (el contrato dice la verdad).
   - (B) mantener `videoAsset` (clip 0) + añadir `extraVideoAssets: z.array(...)`. Más feo, evita
     tocar consumidores. Descartar salvo que (A) explote en superficie.
   Documentar el cambio de shape (regla 6 si desvía del contrato T5.3).

2. **`packages/services/src/assemble-composition-spec.ts`** — `pickClip`/`buildSegment` (:235-275):
   dejar de hacer `reduce`→clipIndex 0; devolver **todos** los clips de la escena ordenados por
   `clipIndex` ascendente. `buildSegment` puebla `videoAssets` (lista) en vez de `videoAsset`.

3. **`apps/worker/src/executors/compose-variant.ts`** — loop:192: para cada segmento con >1 clip,
   concatenar los clips (ffmpeg concat demuxer, `-c copy` si son normalize-compatibles; si no, tras
   normalize) en UN vídeo de escena, ANTES de la llamada a `fitSegmentFile`. El fit sigue operando a
   la narración N7bClipRef.durationSeconds de esa escena (ahora vídeo ≥ narración → recorta, no falla).

4. **`packages/core/src/orchestrator/generation-dag.ts`** (SI hace falta) — dep N7d→N7b para
   dimensionar los clips desde la duración REAL del audio N7b (no del texto estimado). VERIFICAR si ya
   existe antes de tocar; puede no ser necesario si el troceo §7.5 ya cubre con el clip-count.

## Invariantes que NO se tocan (PROHIBIDO debilitarlos)

- **`FitError` sigue mordiendo** (`fit-segment.ts:200`, anti-T1.8). El fix hace que el vídeo
  concatenado ≥ narración → el fit RECORTA en vez de fallar; NO se relaja el umbral 0.5s. El control
  negativo (clip genuinamente corto sin clips extra que concatenar) DEBE seguir lanzando FitError.
- **Dedup b-roll/CTA** (content_hash con dedupSalt `bodySceneIndex:clipIndex`): al usar todos los
  clipIndex, el dedup sigue siendo correcto (cada clipIndex es su propia entrada). No inventar salt.
- **Máster VIDEO-LED** (compose-master.ts:233): masterDuration = ffprobe(concat), `-t <dur>`, no
  `-shortest`. El concat intra-escena alarga el vídeo de escena → el fit lo recorta a narración →
  el máster sigue siendo Σ(narraciones). Coherente.

## Verificación (la que ejecutará el verifier, $0 fal)

Una variante con narración de escena body >8s (la que hoy hace FitError) compone máster
concatenando 2+ clips SIN FitError; ningún clip pagado queda sin usar; el control negativo (escena
sin clips extra, clip genuinamente < narración) SIGUE lanzando FitError. Coste **$0 fal** (se prueba
con clips fixture/existentes del run 01KYA3ZFF..., no se regenera).

## Coste

$0 fal (composición determinista sobre clips ya pagados). Cap por estimación del planning.

## Ojo para T5.9 tras cerrar T5.8c (nota para el coordinador)

El fix hace el b-roll MÁS caro: clips más largos / más clips = más segundos a 20¢/s. La proyección
pre-fix a CP3 era ~$15.80 lote completo / ~$33 en el peor caso premium. Con multi-clip concatenado
SUBIRÁ. Al re-proyectar T5.9 a CP3 con objetivo `conversion` (30s): si el lote completo proyecta
≥$40 → REABRIR con el usuario (techo o recorte de matriz) ANTES de gastar. NO arrancar a ciegas.
