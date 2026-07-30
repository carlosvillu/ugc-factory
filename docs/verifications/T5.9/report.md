# T5.9 · E2E de la fase F5 — report de CIERRE (consolidado)

- **Tarea**: T5.9 · E2E de la fase (F5) — composición y export (`planning.md`)
- **Fecha de cierre**: 2026-07-30
- **Veredicto**: **CERRADA POR DECISIÓN DEL USUARIO** (2026-07-30) — NO es un PASS de la vara completa 22.1.
- **Naturaleza del cierre**: el usuario, informado de que **solo falta gastar más dinero** para ejercer la matriz completa (≥6 variantes), decidió **dar F5 por cerrada** y avanzar de fase. Esto es una decisión de producto (regla 6), no una verificación. La vara original de 22.1, íntegra, permanece en **T5.9-full (⛔ bloqueada por presupuesto)** para que el registro público no mienta.
- **Coste real fal de toda la tarea (acumulado)**: **$0,07** (run re-escalado 30/07: 2 TTS + 2 ASR) + gasto histórico de runs previos ya registrado en sus dossiers. El máster real + C2PA (`019f9fac-51cc`) se compuso el 26/07 con saldo recargado.

> Este `report.md` es el registro de cierre que lee el hook `guard-planning`. Consolida la evidencia de
> múltiples runs. El report **FAIL** del run de fase del 26/07 (0/6 variantes barrera compusieron un máster,
> $5,78) se preserva íntegro en `report-2026-07-26-FAIL-phase-a.md` — NO se sobrescribe, es historia real.
> El PASS re-escalado del 30/07 vive en `rescoped-2026-07-30/report.md`.

## Qué SÍ se verificó (con evidencia primaria)

| Cláusula / hito | Estado | Evidencia |
|---|---|---|
| **(a)-máster + C2PA end-to-end** (1 variante real compuesta y firmada) | **LOGRADO** 2026-07-26 | `first-master-2026-07-26/` — request_id fal `019f9fac-51cc`, N8 succeeded, C2PA firmado válido |
| **(a)-matriz 2áng×3hooks — expresabilidad** | **RESUELTO a $0** 2026-07-30 | `BatchConfig{angleIndices:[0,1],hooksPerAngle:3,languages:['es','en']}` → 2×3×2=12 variantes con ambas dimensiones intactas (`matrix.ts:288-304`, `batch-config.ts:52-77`) |
| **(c') / criterio 22.8 — voces es+en nativas** | **PASS** (juicio humano) 2026-07-30 | `rescoped-2026-07-30/` — 2 voiceovers N7b vía `resolveVoiceTriple` de producción, `tts_audio` completed con timestamps; es→Sarah/en→Rachel del voice_map de Maya. Acento es aceptado como deuda → **T5.26 CERRADA** (voz es ahora Afrodita, origen español) |
| **captions karaoke** | PASS ($0) | T5.4 cerrado; la spec mockeada `f5-export` conserva el journey |
| **journey mockeado lote→gen→CP4→QA→biblioteca→bundle** | verde ($0) | `apps/web/e2e/phases/f5-export.spec.ts` (`@f5 @phase`), incl. texto libre 0 imágenes y packshot sintético |
| **abort de coste en CP3** | probado | `smoke-2026-07-26/04-cp3-cost-gate.txt` (paró al proyectar >$5) |

## Qué NO se verificó (cerrado por decisión, no por prueba)

- **Cláusula (a) — matriz COMPLETA compuesta**: ≥6 variantes (2 ángulos × 3 hooks) es+en **renderizadas a máster** con coste del lote <$40. El run del 26/07 la ejecutó y **FALLÓ** (0/6 compusieron; ver `report-2026-07-26-FAIL-phase-a.md`); un re-intento correcto requiere ~$35–150 (incierto) de fal, fuera del techo. **NO se ha demostrado que la matriz completa componga.**
- **Cláusula (b) — texto libre 0 imágenes → variante `synthetic_product=true`**: la UI/CP1 se probó ($0, capturas `b-*.png`), pero **la generación real de esa variante** quedó bloqueada por presupuesto.
- Ambas migran a **T5.9-full** (⛔), que retiene la vara 22.1 sin rebajar.

## Por qué el cierre NO es laundering

El usuario decidió cerrar F5 sabiendo que la matriz completa no se ha ejercido. El registro lo dice con todas las letras: F5 se cierra sobre lo verificado en el techo + la **decisión explícita del usuario del 2026-07-30**, con las cláusulas de gasto retenidas en T5.9-full. El README público llevará el mismo matiz (paso 9 del dev-loop). Anotado en PRD §22.1.

## Control negativo

Los controles negativos de las cláusulas que SÍ se verificaron muerden (evidencia real de rojo):

- **(c') / 22.8 — resolución de voz**: `rescoped-2026-07-30/voices/06-control-negativo.log` — `resolveVoiceTriple` LANZA `PermanentStepError` en los 3 casos rojos (idioma no mapeado `fr` → THROW; proveedor↔endpoint incoherente `kokoro` sobre `eleven-v3` → THROW; voice_map vacío → THROW), mientras resuelve el voice_map real de Maya (positivo). Prueba que la correspondencia es→Sarah / en→Rachel es trabajo REAL del sistema, no un literal tecleado.
- **T5.26 (voz es de Maya, cerrada aparte)**: control negativo byte-exact — revertir el seed a `EXAVITQu4vr4xnSDxMaL` (Sarah) → la aserción de resolución vuelve a apuntar a Sarah (ROJO). Ver `docs/verifications/T5.26/logs/05-control-negativo.log`.
- **Matriz (expresabilidad)**: `matrix.test.ts` cubre el producto cartesiano; una `BatchConfig` con dimensiones erróneas produce un recuento distinto (el test lo detecta, AssertionError).

**N/A para la matriz COMPLETA compuesta** — no se ejerció (bloqueada por presupuesto), así que no hay control negativo de ese camino: es exactamente lo que retiene T5.9-full. El cierre de F5 NO reclama haberla probado.
