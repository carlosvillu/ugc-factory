# T4.13 — Verificación UNITARIA: race sweeper↔polling en `runGenerate`

**Veredicto: PASS**
**Coste real: $0** (fal mockeado con msw; cero red real; estimado $0).
**Fecha:** 2026-07-19 · **Verifier:** contexto fresco, escéptico.
**Alcance:** SOLO la cláusula unitaria de T4.13 (prueba del camino idempotente + control negativo obligatorio). La cláusula de integración/observable (re-run del E2E de fase LIVE) NO es de esta verificación — es del gate de cierre de T4.11, con gasto real.

**Diff bajo prueba** (uncommitted sobre `0c23408`):
- `packages/services/src/generate.ts` (los dos puntos del fix, camino de polling de `runGenerate`).
- `packages/services/test/integration/generate.test.ts` (2 tests nuevos + helpers).
- `docs/dev-loop/journal.md` (no relevante para el veredicto).

Árbol restaurado al estado del fix al terminar (git status: solo los 3 ficheros modificados + `docs/verifications/T4.13/`).

---

## 1. Tests en verde

`pnpm --filter @ugc/services test` → **42/42 passed** (4 files) — `01-tests-green.txt`, `05-tests-green-restored.txt`.

Los DOS tests nuevos de T4.13, ejecutados por nombre con reporter verbose (`02-t413-named.txt`):

| Test | Resultado |
|---|---|
| (a) el sweeper completa la fila mid-poll -> runGenerate RECUPERA su asset (reused, 0 coste, no lanza) | PASS 19ms |
| (b) fila ya `completed` por el sweeper + fallo POSTERIOR de descarga -> NO se degrada a `failed` | PASS 15ms |

Corren bajo `vitest.config.integration.ts` (Testcontainers Postgres real, storage local real). No son unit-de-mesa: pegan a BD real.

---

## 2. Control negativo — reproducido POR MI (independiente del implementer)

Reverti cada fix en `generate.ts`, corri, observe QUE test se pone rojo y con que mensaje, y restaure verde.

| Fix revertido | Reversion aplicada | Test que se pone ROJO | Mensaje observado | Restaurado |
|---|---|---|---|---|
| **(a)** recover-on-null | `throw new FalResponseError('...finalizada por otra ruta...(invariante roto)')` incondicional sobre `assetId===null` | **(a)** exactamente (test (b) sigue verde) | `FalResponseError: runGenerate: la generacion <ulid> fue finalizada por otra ruta durante el polling (invariante roto)` | verde 7/7 |
| **(b)** catch no-destructivo | `await updateGeneration(db, id, { status:'failed', completedAt })` incondicional en el catch | **(b)** exactamente (test (a) sigue verde) | `AssertionError: expected 'failed' to be 'completed'` (linea 393: `expect(gen?.status).toBe('completed')`) | verde 7/7 |

Evidencia cruda: `03-neg-control-a-revert.txt`, `04-neg-control-b-revert.txt`.

Ambos controles muerden el test **correcto** con el mensaje **correcto**: (a) reproduce el `throw` de invariante roto del bug T4.11; (b) reproduce el clobber `completed->failed`. Ningun test rojo cruzado (cada fix protege su propio test).

---

## 3. El test reproduce la CONDICION REAL (principio 9 / anti-T1.9)

- **La ruta ganadora es `finalizeGeneration` de produccion**, importado de `../../src/finalize-generation` — el MISMO que llama el poll de `runGenerate` y el consumer `output.download` del sweeper (T4.3). No es un mock que escribe un shape divergente.
- **El `assetId===null` no esta fabricado por el test**: lo produce el `SELECT ... FOR UPDATE` real dentro de `finalizeGeneration` (`finalize-generation.ts:145-147`: el perdedor adquiere el lock, RE-CHEQUEA `completed`, sale sin escribir -> `assetId:null`). Senal idempotente genuina de produccion.
- **La ventana de carrera es real y determinista**: el side-effect corre en el handler `http.get(statusUrl)`, que `fal.poll` AWAIT-ea ANTES de que `runGenerate` llegue a su propio `finalizeGeneration`. El ganador escribe asset+cost+completed y commitea antes; el poll del propio `runGenerate` cae en el NO-OP gracioso. El bug original escapo porque la suite fake completaba sincrona SIN esta ventana; este test la fabrica.
- Helpers (`getSpendSummary`, `getAssetByGenerationKind`, `getGenerationByFalRequestId`) son repos reales contra Postgres, no stubs.

---

## 4. No-doble-cobro (verificado)

Test (a) mide `spendAfter - spendBefore` con `getSpendSummary` (agregado SQL REAL sobre `cost_entry`) y asevera **`=== 1`** centimo: el unico `cost_entry` que escribio la ruta ganadora. Si el camino de recuperacion re-cobrara, el delta seria 2 y el test caeria. El camino de recuperacion devuelve `costCents:0` / `reused:true`. Ademas asevera `keyframe?.id === winnerAssetId` (no se re-crea un segundo asset).

---

## Resultado por punto

| Punto | Esperado | Observado | OK |
|---|---|---|---|
| Test recuperacion idempotente pasa | recupera asset, reused:true, costCents:0, no lanza, no re-crea, fila completed | si | OK |
| Test no-degradacion pasa | fila completed NO acaba failed tras fallo posterior | si | OK |
| Control neg. (a): revertir -> ROJO por invariante roto | test (a) rojo, FalResponseError invariante roto | si, mismo test/mensaje | OK |
| Control neg. (b): revertir -> completed acaba failed -> ROJO | test (b) rojo, expected 'failed' to be 'completed' | si, mismo test/mensaje | OK |
| Race real (finalize real, no mock divergente) | ganador = finalizeGeneration produccion; null = recheck FOR UPDATE | si | OK |
| No doble-cobro | delta spend = 1 (ruta ganadora), no 2 | si | OK |

## Rarezas
- Ninguna que bloquee. Nota: la clausula LIVE de integracion de T4.13 (re-run del E2E de fase con gasto real) queda pendiente y es responsabilidad del gate de T4.11 — fuera de este alcance por diseno.
