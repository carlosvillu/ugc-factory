# Verificación T3.7 — Seed inicial de templates (lote 1: ~50) · RE-VERIFICACIÓN tras fix

- **Tarea**: T3.7 · Seed inicial de templates (lote 1: ~50) (`planning.md` l.529-532)
- **Fecha**: 2026-07-15
- **Ejecutor**: verifier (subagente, contexto fresco) · sin agent-browser (contenido + validador estático + selector puro, sin superficie web)
- **Sistema**: working tree sobre commit `feb5cc7` (T3.6). Diff de T3.7 SIN commitear: `prompt-templates.json` (56 templates, 18 backstops NEUTRALIZADOS), `seed-validator.test.ts` (count 2-3 → ≥45), `select-template.test.ts` (+guard "honestidad de los backstops"). Verificación estática; no requiere compose/pnpm dev.
- **Coste real**: **$0** — sin APIs de pago, sin red, sin LLM. Estimado planning $0 → sin desviación.

## Verificación esperada (literal de planning.md)
> validador en verde; 5 templates elegidos al azar **por el verifier** cumplen los 14 puntos de la anatomía §10.3 (checklist manual); la búsqueda facetada devuelve candidatos para cada ángulo del brief de prueba.

## VEREDICTO: **PASS**

El fix resuelve el defecto del FAIL anterior. Los 18 backstops (verticals.length>1) tienen ahora body NEUTRO (staging/casting genéricos, SIN frase de compliance, SIN nombre de vertical en body/slug/title/freeTags). El punto 14 §10.3 se satisface por inyección del compilador N6 según brief.category, no por texto hardcodeado. Las 3 cláusulas pasan por comprobación independiente del verifier; los 3 combos que el viejo FAIL marcó como defecto ya no producen ganador con compliance ajena.

## Cláusula 1 — validador + gate en verde (OK)
- pnpm --filter @ugc/core test → 981 passed / 59 files (clause1-core-test.txt)
- DOCKER_HOST=… pnpm gate → verde, exit 0; 1636 tests / 147 files, sin flake Testcontainers a la 1ª (clause1-gate.txt)
- Conteo real = 56; slugs 56/56 únicos; barrido de slots §10.4 sobre los 56 pasa.
- El diff de seed-validator.test.ts SOLO relaja el rango de conteo (2-3 → ≥45, legítimo: el seed creció de 3 moldes a lote 1). El barrido de slots canónicos §10.4 sigue intacto. Clause 1 no debilitada.

## Cláusula 2 — 5 templates NUEVOS al azar, checklist de los 14 puntos §10.3
Regla REPRODUCIBLE e INDEPENDIENTE (distinta de la vez anterior, que usó índices alfabéticos): hash FNV-1a de cada slug, orden ascendente, 5 primeros. Ninguno coincide con los 5 del FAIL previo. Reparto: 3 backstops + 2 single-vertical (≥2 backstops garantizados).

| # | slug | verticals | tipo |
|---|---|---|---|
| 1 | unboxing-demo | ALL-9 | BACKSTOP |
| 2 | app-screen-demo-saas-time-saving | saas | single |
| 3 | unboxing-saas-authority | saas | single (mold) |
| 4 | expectation-vs-reality-surprise | ALL-9 | BACKSTOP |
| 5 | car-vlog-confession | ALL-9 | BACKSTOP |

Leído el body entero de los 5. Los 14 puntos §10.3, cita o AUSENTE:

| # | Punto | 3 backstops | app-screen-saas | unboxing-saas-auth |
|---|---|---|---|---|
| 1 | estilo+anti-estilo | "UGC smartphone video style… no cinematic grading, no beauty filters" OK | OK | OK |
| 2 | casting honesto (nunca customer) | "honest first-person creator (never labelled 'customer')" OK | "honest educator/demonstrator (never 'customer')" OK | OK |
| 3 | 2-3 anclas | "a table, a box / front door, delivery box, hallway / car seat, phone mount, sunglasses" OK | "desk, coffee mug, a phone stand" OK | "laptop, coffee mug, a notebook" OK |
| 4 | beats temporizados | "(0-3s)…(3-11s)…(11-19s)…(19-23s)" OK | OK | "(0-3s)…(3-12s)…(12-20s)…(20-24s)" OK |
| 5 | cámara con reglas | "fixed phone at arm's length, one reframe, no gimbal moves" OK | OK | "phone on a stack of books, one reframe, no dolly" OK |
| 6 | iluminación motivada | "motivated by the window, uneven and un-color-graded" OK | OK | "motivated by the desk lamp and window, uneven" OK |
| 7 | imperfecciones | "visible pores, autofocus breathing, imperfect framing, no retouch" OK | OK | "autofocus breathing, imperfect framing, no retouch" OK |
| 8 | diálogo entrecomillado | "{hook.line}" OK | OK | OK |
| 9 | momento producto+fidelidad | "{product.name} stays true to shape, its label legible, no morphing" OK | OK | "the {product.name} interface stays true, no morphed text, no fake logos" OK |
| 10 | fidelity guards | "keep the product geometry and colour stable… no invented text or logos, no identity drift" OK | OK | "keep UI text legible and stable, no identity drift" OK |
| 11 | audio implícito | "Audio: implied room tone, no music bed" OK | OK | "implied room tone, keyboard clicks, no music" OK |
| 12 | final beat + CTA | "Final beat: natural close to camera, {cta.line}" OK | OK | OK |
| 13 | formato 9:16+duración | "Format: 9:16, {duration}s, {platform}, {aspect}" OK | OK | OK |
| 14 | guard pack del vertical | AUSENTE del body — POR DISEÑO (backstop ALL-9: inyecta el compilador por brief.category) OK | "Compliance guard pack (saas): no fabricated metrics or fake dashboards, no invented customer counts, real UI only, disclose partnership" OK | AUSENTE (mold T3.2 single-vertical; compiler inyecta saas) OK |

CLAVE backstops: los 3 NO nombran vertical concreta en slug/title/freeTags/body ni llevan frase de compliance hardcodeada. El único match de "beauty" en sus bodies es el anti-cue "no beauty filters" (en TODOS los templates), no una vertical. Escaneo estricto sobre los 18 backstops: 0 nombran vertical concreta en ningún campo. Fix completo. Los 5 cumplen los 14.

## Cláusula 3 — cobertura RELEVANTE por ángulo
Contra el selector REAL selectTemplate vía tsx. Comprobación INDEPENDIENTE del verifier (no me fío solo del test de 486 combos del implementer): 7 queries vertical×plataforma×ángulo, format UNSET (clause3-coverage-output.txt):

| query | ganador | backstop | declara vertical | compliance en body |
|---|---|---|---|---|
| beauty/tiktok/curiosity | lifestyle-broll-curiosity | sí | sí | ninguna OK |
| finance/instagram/authority | founder-explainer-authority | sí | sí | ninguna OK |
| pets/reels/social_proof | demo-social-proof | sí | sí | ninguna OK |
| fitness/tiktok/transformation | before-after-transformation | sí | sí | ninguna OK |
| food/instagram/visual_proof | demo-visual-proof | sí | sí | ninguna OK |
| saas/tiktok/time_saving | app-screen-demo-time-saving | sí | sí | ninguna OK |
| fashion/reels/surprise | expectation-vs-reality-surprise | sí | sí | ninguna OK |

0 ganadores con compliance ajena. El defecto anterior (89% de combos con backstop finance-shaped arrastrando "(finance)" al prompt) está resuelto: el ganador sigue siendo un backstop ALL-9 (natural con format sin fijar) pero su body es neutro → no contamina; la compliance correcta la inyecta N6 por brief.category.

Los 3 combos FORMAT-SET del viejo FAIL (clause-census-output.txt):
- before-after/transformation/fitness → no_candidates (antes: before-after-beauty-transformation finance-shaped)
- mirror-selfie/curiosity/beauty → no_candidates (antes: lifestyle-broll-food-curiosity)
- grwm/social_proof/fashion → no_candidates (antes: demo-finance-social-proof)
Ninguno devuelve ya ganador con compliance ajena. Al neutralizarse los backstops (formats:[]) y restringir format los single-verticals, estos combos quedan sin candidato → no_candidates, que N6 trata como error accionable (T3.5). Laguna de cobertura esperable en lote-1 de ~50 (amplía a ~150 en T8.6), NO defecto de compliance. La cláusula literal ("candidatos para cada ÁNGULO") se cumple: todo ángulo resuelve en la matriz format-unset.

## JUICIO sobre el guard test permanente (select-template.test.ts)
Buena red permanente, aserta lo esencial, con huecos (deuda, no defecto — mi comprobación independiente confirma bodies limpios hoy):
- Sólido contra la regresión exacta del FAIL: nombre de vertical en slug/title/freeTags/body + frase "Compliance guard pack (…)" en backstop → lo caza (l.111 y l.148).
- Hueco 1: el test de cobertura (l.130) asevera que el ganador incluye la vertical pedida (l.143); un backstop ALL-9 lo satisface trivialmente para CUALQUIER vertical. La garantía real recae solo en l.148.
- Hueco 2: la detección de compliance usa el patrón exacto /Compliance guard pack \(/. La frase original ofensiva "not financial advice framing" pasaría ese regex sin ser cazada.
- Hueco 3: la lista usa \bfinance\b (no matchea "financial"), \bhome\b (falso positivo en "at home"). No caza un body semánticamente vertical-shaped sin la palabra exacta (el viejo founder-body "screen-share, cursor visible, real UI" era saas-shaped sin "saas").
Resumen: sólido contra regresiones por nombre exacto; ciego a compliance reformulada y a body semánticamente vertical-shaped.

## Single-vertical legítimos (OK)
Censo (clause-census-output.txt): de 38 single-vertical, 35 llevan "Compliance guard pack (<vertical>)" y la vertical del body coincide con la declarada en los 35 — 0 mismatches. 3 son moldes T3.2 sin frase (compiler inyecta). Aritmética: 38 single (35+3) + 18 backstops = 56. Un template de UNA vertical nombrando SU propia compliance es correcto, no el defecto.

## Rarezas (aunque PASS)
- 3 combos format-set concretos dan no_candidates — laguna de cobertura del lote-1, no defecto.
- guardPackKeys:[] en los 56: campo estructurado nunca poblado; el punto 14 se resuelve por inyección del compilador, no por template.guardPackKeys. Consistente; documentar la intención sería deuda menor.
- El guard test tiene los 3 huecos anotados (deuda, no defecto).

## Coste real
$0. Estimado $0. Sin desviación.

## Evidencia
- clause1-core-test.txt — 981 tests de core en verde
- clause1-gate.txt — gate global en verde (1636 tests); exit 0 confirmado aparte
- clause3-coverage-output.txt — cobertura relevante independiente (7 queries)
- clause-census-output.txt — censo single-vertical (0 mismatches) + 3 combos format-set del viejo FAIL
- verifier-coverage.mjs, verifier-census.mjs — scripts del verifier (reproducibles)
