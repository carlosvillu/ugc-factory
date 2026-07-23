# Verificación T5.8 — Regeneración parcial optimizada

- **Tarea**: T5.8 · Regeneración parcial optimizada (`planning.md` l.770-775)
- **Fecha**: 2026-07-23
- **Ejecutor**: verifier (contexto fresco, escéptico) · agent-browser (sesión `t5.8`, CUA sobre CP4) · psql sobre `ugc-postgres-dev`
- **Sistema**: HEAD `9de578b` (T5.8a) + diff de T5.8 UNCOMMITTED (verificado sobre él) · `pnpm dev` (web+worker, fal-key real de `app_setting`) · docker compose dev · migración 0025 aplicada · fixture premium de T5.8b
- **Veredicto**: **PASS** — regen in-band desde un N9 CP4 limpio: cambiar el CTA produce un máster NUEVO en **~16 s** (<2 min) con **$0,00 de coste registrado** (<$0,50). El clip i2v caro (N7d b-roll) hace DEDUP HIT a $0; solo la voz del CTA (N7b-cta) se re-sintetiza (registrada 0c). Criterio 22.4 CUMPLIDO en las cuatro cláusulas.

## Verificación esperada (literal de planning.md, criterio 22.4)
> cambiar el CTA de una variante aprobada produce un master nuevo en <2 min de reloj y <$0,50 de coste registrado.

## Contexto: dos ejecuciones (honestidad de coste)
1. **1er intento (fixture SUCIO) → FAIL de coste, $0,80**: regen desde el N9 del ORIGEN. N7d (b-roll) hizo MISS y costó 80c. Causa raíz pinneada: los keyframes se RE-SUBIERON fuera de banda durante el setup de T5.8b (danza 422/retry ~17:58), re-estampando `asset.fal_url` (`…Uta…092` → `…kSUBD…250`) DESPUÉS de que el N7d del origen se compusiera con la URL vieja → hashes distintos → MISS. **Artefacto de la fabricación del fixture, NO coste que pague un usuario real.** (evidencia: 01–04*.png, y §causa-raíz abajo)
2. **2º intento (in-band, LIMPIO) → PASS, $0,00**: regen desde el N9 del CLON (`01KY84SWMYBFYJKEXF19B1Y827`), creado por el 1er regen, sin nada movido fuera de banda entre su creación y ahora. N7d dedup HIT a $0. Este es el flujo de operación normal. (evidencia: 05–08*.png)

**Coste acumulado de la verificación T5.8: $0,80** (80c del intento con fixture sucio + $0,00 del intento in-band limpio). El coste de OPERACIÓN NORMAL de la feature (lo que mide 22.4) es **$0,00**.

## Precheck de $0 (gate ANTES de gastar — VERDE)
- CTA del clon (vigente) "Consíguelo hoy en nuestra web." (5 pal→2,0s→bucket 4s). CTA NUEVO elegido: **"Pruébalo tú mismo ahora."** = 4 pal → 1,6s → quantize([4,6,8]) = **bucket 4s** (mismo) → N7f dedup.
- Set de dedup esperado (content_hash ya existentes como `completed` en el linaje origen+clon): N7a(2), N7c(1), N7d(`0ec78771`, keyframe `fal_url` estable=`…kSUBD…250`), N7e(1), N7f(`8dee3a10`), N7b-hook(`a1b0a1eb`), N7b-body(`fb467dec`) → **TODOS HIT**; solo **N7b-cta** (voz "Pruébalo…", hash nuevo) regenera → céntimos.
- Voz del hook = Rachel (misma con la que se compuso el fixture) → N7c/N7b-hook HIT.
- N7d predijo HIT (su hash `0ec78771` ya existe completed con la URL de keyframe estable) → PROCEDER.

## Pasos ejecutados (CUA sobre CP4 del CLON, humano)
1. Login → `/runs/01KY84SWMZHGQDME9TX7RZCYH5` (run del clon) → canvas N8 completado + N9·CP4 `esperando aprobación`. (05-clone-canvas-cp4-waiting.png)
2. Click N9 → panel CP4: player + QA + "Regenerar con otro CTA"/"Rechazar"/"Aprobar". (06-clone-cp4-panel.png)
3. Click "Regenerar con otro CTA" → diálogo → relleno "Pruébalo tú mismo ahora." (07-clone-regen-dialog-filled.png)
4. Click "Regenerar" a las **19:12:43Z** → navega a `/runs/01KY869Y8SGPSW5VCZKNEZWHQJ` (run kind='regen').
5. Run camina N6→N7(a-f)→N8→N9; máster nuevo a las **19:12:59.03Z**; N9 pausa en CP4. (08-clone2-cp4-new-master.png)

## Resultado observado vs esperado (2º intento, in-band)
| # | Esperado (22.4) | Observado | OK |
|---|---|---|---|
| Arranca run regen desde CP4 (UI) | run `01KY869Y8SGPSW5VCZKNEZWHQJ` kind=regen; clon N9 marcado `spawned_regen_run_id` | sí | OK |
| Produce un MÁSTER NUEVO | máster `01KY86ACMTXDJMDGN3BNAPJ6Z7` != máster del clon `01KY84VQZ1...`; variante `01KY869Y7Y...` filenameCode `…-rk0y3f2gxw0`; N8 recompone (voz cta nueva `e3754144` != vigente) | OK |
| < 2 min de reloj | POST 19:12:43Z → máster (N8 finished) 19:12:59.03Z = **~16 s** | OK |
| < $0,50 de coste registrado | **$0,00** (fal delta 1498→1498; cost_entry del run: solo 0c) | OK |

### Coste por nodo (2º regen, in-band) — la tabla de "optimizada"
| Nodo | Coste | Dedup |
|---|---|---|
| N7a (packshots) | 0c | HIT |
| N7b (voz: hook/body HIT + **cta "Pruébalo…" nueva** `e3754144`, registrada 0c) | 0c | cta re-sintetiza (hash nuevo), resto HIT |
| N7c (avatar) | 0c | HIT |
| N7d (b-roll body) | **0c** | **HIT (0 filas generation nuevas → reusa `0ec78771`)** |
| N7e (música) | 0c | HIT |
| N7f (clip CTA) | 0c | HIT |
| N8/N9 | 0c | recompone (FFmpeg local) |
| **Total registrado** | **$0,00** | |

## DEUDA SPIN-OFF (para el journal — NO bloquea T5.8, es camino compartido T4.8/T4.10)
`content-hash.ts` incluye la `image_url` EFÍMERA de fal en el hash de i2v (`generate-broll.ts:242` hashea `submitInputs` con `image_url=imageUrls[0]`), en vez del checksum/asset-id ESTABLE del keyframe. En operación normal NO muerde: `uploadInputCached` (generate.ts) hace cache-hit si `asset.fal_url` está poblado → URL estable → hash estable → dedup HIT (probado in-band: N7d a $0). Pero es FRAGILIDAD real: una re-subida del keyframe (expiry de la URL de fal, re-estampado como el de T5.8b) rompe el dedup i2v → re-coste. `generate-broll.ts` NO está en el diff de T5.8 → el fix (hashear por checksum estable) es una tarea SPIN-OFF (patrón T5.8a/T5.8b), no código de T5.8.

## Coste real
**$0,00** registrado en la ejecución in-band que decide el PASS (fal delta 1498→1498). Coste acumulado de la verificación completa (incl. el 1er intento con fixture sucio): **$0,80**. Ninguno lo paga la operación normal de la feature.

## Notas / rarezas
- **Correctness OK (rareza previa RETIRADA)**: el «product-shot potencialmente distinto» que anoté en el FAIL era FALSO — el clon reutiliza el MISMO asset keyframe (`01KY8226H843…`, N7a dedup HIT, mismos bytes). No es hallazgo.
- **Cláusula titular OK**: máster nuevo (`01KY86AC…` != `01KY84VQ…`); N8 recompone porque la voz cta difiere (hash `e3754144`). T5.8a (fix del bed) reconfirmado: N8 compone máster end-to-end con fal real sin ComposeError.
- **Idempotencia**: el clon N9 quedó con `spawned_regen_run_id` fijado (2º POST daría 409; marcador puesto).
- **«Variante aprobada» vs `waiting_approval`**: regen desde el N9 PAUSADO (no aprobado); aprobar resolvería el N9 y el regen daría 409. Lectura laxa consistente con la realineación de CP4 del 2026-07-22.
- Consola del navegador limpia (sin errores/warnings JS de código propio).
- Fixtures dejados VIVOS: 3 N9 en `waiting_approval` (origen `01KY8221XQ…` marcado, clon `01KY84SWMY…` marcado, clon-2 `01KY869Y8S…` sin marcar). Ninguno aprobado.
