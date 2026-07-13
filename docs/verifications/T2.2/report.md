# T2.2 · Compositor de matriz (N4) + estimador de coste — VERIFICACIÓN

**Veredicto: PASS**

- **Fecha**: 2026-07-13
- **Verificador**: subagente `verifier` (contexto fresco, no implementó nada)
- **Coste real**: **$0** — N4 es determinista (§7.2): sin LLM, sin red, sin BD. (Estimado: $0.)
- **Superficie**: lógica pura (`packages/core/src/strategy/`) → script tsx contra los módulos REALES, sin mocks.

---

## Verificación LITERAL (texto de `planning.md`)

> para un brief real, componer una matriz 2 ángulos × 3 hooks × 1 persona × es+en → **12 variantes** con coste estimado desglosado que **cuadra a mano con las recetas del Apéndice B (±10 %)**.

### Resultado por cláusula

| # | Cláusula | Esperado | Observado | OK |
|---|---|---|---|---|
| 1 | **brief REAL** | no un brief de juguete | `ProductBrief` de **T1.8** generado por Sonnet para `allbirds.com` (`docs/verifications/T1.8/briefs.json` → `results[0].brief`), validado contra `ProductBriefSchema`. 8 ángulos × 3 `hook_examples`, 3 segmentos con `avatar_hint` | OK |
| 2 | **12 variantes** | exactamente 12 | **12** (2 ángulos × 3 hooks × 2 idiomas). 12 `filenameCode` únicos, 2 ángulos, 2 idiomas, 3 hooks por (ángulo, idioma), duración 30 s, persona compatible en las 12, `personaSelection=matched` | OK |
| 3 | **coste desglosado** | `lineItems`, no solo total | **36 partidas** (12 × 3 segmentos; en `conversion` no se comparte nada) + `perVariant` + `standaloneVariant` | OK |
| 4 | **cuadra A MANO con Apéndice B (±10 %)** | desvío <= 10 % | **desvío 0,0000 %** en los 3 tiers | OK |
| 5 | **Σ lineItems == total** | al céntimo | exacto en min y max, 3 tiers | OK |
| 6 | **Σ perVariant == total** | al céntimo | exacto en min y max, 3 tiers | OK |

**Nota de honestidad sobre la cláusula 4**: el desvío es 0,0000 %, no «<=10 %», **y eso no es mérito del escalado**. El preset `conversion` son 30 s (§8.4) = `RECIPE_ANCHOR_SECONDS`, así que el factor es exactamente 1 y el estimador reproduce la receta **por identidad**. La cláusula ±10 %, tal y como está escrita, **no discrimina casi nada**: pasaría igual con una ley de escalado rota (lo demuestro en el control negativo). Se reporta porque el bucle debe saberlo, no para rebajar el PASS: la Verificación literal se ejecutó tal cual y pasa.

### La cuenta A MANO contra el Apéndice B

Apéndice B leído directamente de `PRD.md` (línea ~798), contrastado con `RECIPE_SEEDS` (`packages/core/src/library/seed-data.ts`) — coinciden:

| Tier | COGS 30 s (Apéndice B, PRD) | `RECIPE_SEEDS` (céntimos) |
|---|---|---|
| Test | $0,3–1,7 | `30` / `170` |
| Standard | $1,8–5 | `180` / `500` |
| Premium | $9–13 | `900` / `1300` |

La matriz es `conversion` → **nada se comparte** (§7.2 N5: «1 guion por variante»), luego son **12 anuncios independientes de 30 s** = 12 × la horquilla de 30 s:

| Tier | Cuenta a mano | Estimador (`total`) | Desvío |
|---|---|---|---|
| **test** | 12 × [30, 170]¢ = **[360, 2040]¢** = [$3,60, $20,40] | **[360, 2040]¢** | **0,0000 % / 0,0000 %** |
| **standard** | 12 × [180, 500]¢ = **[2160, 6000]¢** = [$21,60, $60,00] | **[2160, 6000]¢** | **0,0000 % / 0,0000 %** |
| **premium** | 12 × [900, 1300]¢ = **[10800, 15600]¢** = [$108,00, $156,00] | **[10800, 15600]¢** | **0,0000 % / 0,0000 %** |

El ancla se cumple literalmente: a 30 s `standaloneVariant` **es** la horquilla de la receta, sin tocar.

---

## Escenarios más allá de la Verificación literal (donde está la carne)

### La economía Hook×Body×CTA (§16.1) — y el BUG DE DINERO de las 2 personas

| Escenario | Esperado | Observado | OK |
|---|---|---|---|
| `hook_test`, 3 hooks, **1 persona** | **5** generaciones (1 body + 1 cta + 3 hooks), **no 9** | **5** | OK |
| `hook_test`, 3 hooks, **2 personas compatibles** (el bug: la rotación rompía el compartido → **7**, cobrando de MÁS) | **5**, no 7 | **5** | OK |
| `conversion`, 3 hooks | 9 partidas, ninguna compartida | **9**, todas con 1 variante | OK |

**La precondición del test de las 2 personas se comprobó explícitamente** (si no, sería vacuo): `matchPersonas` (T2.0) devolvió **2 candidatas REALES** contra el `avatar_hint` real del brief — Álvaro score=6 `[energia, tranquila, natural, calle, urbana, oficina]`, Marc score=3 `[natural, urbana, cafeteria]`. Con 2 candidatas de verdad, el body **sigue compartiéndose una sola vez**: el bug de dinero está muerto.

### Las otras dos regresiones

| Regresión | Esperado | Observado | OK |
|---|---|---|---|
| Plan con duración fuera del preset (90 s) — antes se cobraba como 30 s (**de MENOS**) | LANZA | LANZA: `el plan declara 90 s pero el preset de "conversion" (§8.4) son 30 s: plan incoherente` | OK |
| `composeMatrix` sin `angleIndices` ni `angleCount` — antes devolvía plan VACÍO en silencio | compone todos los ángulos | **24 variantes**, ángulos `[0..7]` = los 8 del brief | OK |
| Receta de otro tier | LANZA | LANZA: `receta del tier "test" para un lote del tier "standard"` | OK |

**63/63 comprobaciones OK, 0 fallos** (`verify-output.txt`, exit 0).

---

## CONTROL NEGATIVO (principio 9)

**Sabotaje elegido — deliberadamente el más exigente**: distorsionar el escalado **preservando la identidad en el ancla**, en `cost.ts`:

```ts
const factor = (seconds / RECIPE_ANCHOR_SECONDS) ** 2;   // era: seconds / RECIPE_ANCHOR_SECONDS
```

A 30 s el factor sigue siendo 1²=1 (**todo test anclado a 30 s permanece verde**); a 12 s pasa a 0,16 en vez de 0,4 y a 45 s a 2,25 en vez de 1,5. Es el sabotaje que sobrevive a la Verificación literal.

**Resultado — la suite se pone ROJA, y por el motivo correcto:**

```
 × un anuncio de 12 s (hook_test) cuesta 12/30 del de 30 s — §16.1: «a 15 s ≈ la mitad»
 × un anuncio de 45 s (storytelling) cuesta 1,5× el de 30 s — NO lo mismo
 FAIL  src/strategy/cost.test.ts > el escalado por duración: coste lineal en SEGUNDOS de vídeo generado (§16.1)
 Test Files  1 failed | 2 passed (3)
      Tests  2 failed | 49 passed (51)

 AssertionError: expected 43 to be less than or equal to 7.2      (12 s)
 AssertionError: expected 135 to be less than or equal to 27      (45 s)
   ❯ expectWithin10Percent  src/strategy/cost.test.ts:78
```

Lo que se pone rojo es **exactamente el test del coste** (las sondas de escalado), con el assert `expectWithin10Percent` — la tolerancia ±10 % de la Verificación —, no otro test por casualidad.

**El punto ciego del ancla es REAL, y la suite lo cubre.** Doble comprobación, con el sabotaje activo:

- **Mi propio script (63 checks, toda la Verificación literal + la cuenta a mano contra el Apéndice B) sigue en VERDE** (`negative-control-my-script.txt`, exit 0). Prueba de que la Verificación del planning, por sí sola, **no puede cazar una ley de escalado rota**: a 30 s el factor es 1 por construcción.
- **Las sondas LEJOS del ancla de `cost.test.ts` (12 s y 45 s) sí la cazan.** El hueco de cobertura que el brief pedía buscar **NO EXISTE**: el implementer ya escribió las sondas off-anchor.

**Restauración verificada** (los ficheros de `strategy/` son UNTRACKED: `git checkout` no los restaura; se hizo a mano desde copia):

```
SHA-256 antes  = ac803f80…4ab747  cost.ts   |  0500f49d…46732e  presets.ts
SHA-256 después= ac803f80…4ab747  cost.ts   |  0500f49d…46732e  presets.ts   → diff VACÍO
```

---

## Gate

| Momento | Resultado |
|---|---|
| Línea base (antes de tocar nada) | `pnpm gate` **exit 0** · 109 files / 1141 tests (`gate-baseline.txt`) |
| Con el sabotaje | strategy **ROJO**: 2 failed / 49 passed (`negative-control-red.txt`) |
| Tras restaurar | `pnpm gate` **exit 0** · 109 files / 1141 tests (`gate-after-restore.txt`) |

Sin superficie web → sin `test:e2e` (correcto). Se mató `next dev` antes de cada gate (rareza conocida de `sse-contract.test.ts`).

---

## Rarezas (no bloquean el PASS)

1. **La cláusula ±10 % de la Verificación es casi vacua, por construcción.** El preset `conversion` cae justo en el ancla de 30 s, donde el estimador reproduce la receta por identidad (desvío 0,0000 %). Una ley de escalado rota **pasaría igualmente** la Verificación literal (demostrado arriba: mi script se queda verde con el escalado saboteado). No es un defecto del código —el ancla está bien elegida y documentada—, sino de la Verificación como red de seguridad. **La red real la ponen las sondas de 12 s / 45 s de `cost.test.ts`, que sí existen y sí cazan.** Anotado para que el bucle no crea que este PASS certifica el escalado: lo certifica la suite, no la Verificación.

2. **Las variantes en `en` llevan el texto del hook en ESPAÑOL.** El brief real de T1.8 está en `es` y sus `hook_examples` son españoles; `composeMatrix` los copia tal cual a las 6 variantes de `language: 'en'` (`verify-output.txt`, variantes 4–6 y 10–12). **No es un defecto de T2.2**: `planning.md` asigna explícitamente el «**idioma destino nativo (§17)**» a la **Entrega de T2.4** (ScriptWriter/N5), y la variante lleva su `language: 'en'` correcto, que es el contrato que N5 consume. **Aviso para T2.4**: ese `hook.text` es una SEMILLA en el idioma del brief, **no un texto ya traducido** — si el ScriptWriter lo encaja tal cual, el anuncio en inglés saldrá con el gancho en español. (Con `libraryHooks` filtrados por idioma sí saldrían hooks en `en`; con los del brief, no.)

3. `perVariant` en `hook_test` reparte los segmentos compartidos con el método del mayor resto, así que dos variantes del mismo ángulo pueden diferir en 1 céntimo. Es correcto y deliberado (Σ `perVariant` == `total` exacto), pero CP2 (T2.3) debe enseñarlo sin sugerir que un anuncio «cuesta más» que su hermano.

---

## Evidencia

| Fichero | Qué es |
|---|---|
| `verify-t22.ts` | **Mi** script de verificación (independiente del implementer): brief real de T1.8, recetas reales `RECIPE_SEEDS`, 63 asserts |
| `verify-output.txt` | Su salida completa — exit 0, 63/63 OK |
| `gate-baseline.txt` | `pnpm gate` antes de tocar nada — verde, 1141 tests |
| `negative-control-red.txt` | La suite en ROJO con el escalado saboteado (2 failed: sondas de 12 s y 45 s) |
| `negative-control-my-script.txt` | Mi script SIGUE VERDE con el sabotaje → prueba del punto ciego del ancla |
| `gate-after-restore.txt` | `pnpm gate` tras restaurar — verde, 1141 tests |
| `sha-before.txt` / `sha-after.txt` | SHA-256 de `cost.ts` y `presets.ts` antes/después → idénticos |

## Qué NO se tocó

`planning.md`, código de producto y tests: **intactos**. Los dos ficheros modificados para el control negativo se restauraron y se verificó por SHA-256 que quedaron byte a byte idénticos. Lo único que este verificador escribió vive bajo `docs/verifications/T2.2/`.
