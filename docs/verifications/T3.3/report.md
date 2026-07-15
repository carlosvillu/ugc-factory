# T3.3 · Guard packs (redacción propia) — VERIFICACIÓN

**Veredicto: PASS**
**Fecha:** 2026-07-15 · Verifier con contexto fresco · **SHA verificado:** c9a1942
**Coste real:** $0 (solo git clone previo + cómputo local; el lookup es unit puro sin BD ni APIs de pago).

---

## Verificación LITERAL (planning.md T3.3)

> el lookup para brief vertical beauty + plataforma tiktok devuelve exactamente {general, fidelity, vertical.beauty, platform.tiktok}; ninguna línea del seed coincide textualmente con las librerías de Cliprise: clonar los repos públicos (`cliprise/awesome-ai-ugc-video-prompts`, `cliprise/awesome-ai-video-ads-prompts`) y contrastar por n-gramas/grep, con el output del contraste en la evidencia.

Dos mitades, ambas load-bearing. Ambas PASS.

---

## Mitad 1 — Lookup §9.5: beauty+tiktok → EXACTAMENTE 4 packs

Ejercitado `resolveGuardPacks` (de `@ugc/core/gallery`) sobre el **seed REAL validado**
(`validateGallerySeed(RAW_GALLERY_SEED).seed.guardPacks`, la misma frontera que `pnpm seed:gallery`),
NO un fixture inline. Seed real: **10 packs** -> {general:1, fidelity:1, platform:2, vertical:6}.

| Contexto | Esperado | Observado | OK |
|---|---|---|---|
| {category:'beauty', platform:'tiktok'} | EXACTAMENTE {general, fidelity, vertical.beauty, platform.tiktok} | ["guard.fidelity","guard.general","guard.platform.tiktok","guard.vertical.beauty"] — igualdad de conjunto exacta = true | OK |
| {} | solo general+fidelity | ["guard.fidelity","guard.general"] | OK |
| {category:'aerospace', platform:'tiktok'} | sin vertical | [fidelity, general, platform.tiktok] | OK |
| {category:'beauty', platform:'myspace'} | sin platform | [fidelity, general, vertical.beauty] | OK |

**Ni una más, ni una menos.** No hay 5º pack always-on: la línea de compliance §15.4 vive DENTRO de
`guard.general` (8 líneas), no como pack aparte -> always = {general, fidelity} = 2.

**Test unit (`guard-lookup.test.ts`):** leído. Asserta igualdad EXACTA de conjunto con `toEqual`
(líneas 40-44), NO "contiene". Corre sobre el seed real validado (líneas 15-23), no un fixture.
8 tests verdes. Salida de mi exercise independiente (`scratchpad/lookup-check.ts`):

```
total packs sembrados: 10
scopes: {"general":1,"fidelity":1,"platform":2,"vertical":6}
beauty+tiktok => ["guard.fidelity","guard.general","guard.platform.tiktok","guard.vertical.beauty"]
EXACT SET EQUAL (4, ni uno mas ni menos): true
{} => ["guard.fidelity","guard.general"]
aerospace+tiktok => ["guard.fidelity","guard.general","guard.platform.tiktok"]
beauty+myspace => ["guard.fidelity","guard.general","guard.vertical.beauty"]
```

---

## Mitad 2 — Contraste anti-Cliprise: 0 coincidencias >=6 palabras, REPRODUCIBLE

Re-corrido con MI PROPIO script (`verifier-contrast.mjs`), no el del implementer. Ingiere TODOS los
ficheros de texto de ambos repos (README + CHANGELOG + .github/), no solo README+CHANGELOG. Extrae
las 37 líneas REALMENTE sembradas parseando el JSON final (todas las lines[] de los 10 packs).

Repos verificados reales: origin cliprise/awesome-ai-ugc-video-prompts (HEAD 1b470b8) y
cliprise/awesome-ai-video-ads-prompts (HEAD 0906baf). Corpus: 15981 palabras (5 ficheros).

| N (palabras) | Coincidencias |
|---|---|
| 8 | 0 |
| 7 | 0 |
| 6 | 0  (umbral de la Verificación) |
| 5 | 0 |
| 4 | 2 (mismo fragmento "what the product does", ambos en guard.general) |

**0 coincidencias a N>=5**, incluido el N=6 exigido. Único solape (N=4) = frase de dominio genérica
"what the product does". Contexto verificado: en Cliprise post-normalización aparece como
"...product moment what the product does or shows proof moment..."; en el seed como
"...the presenter narrates what the product does, not what they experienced...". Genérico, no copia.

### Reproducir
```
node docs/verifications/T3.3/verifier-contrast.mjs <DIR_CON_LOS_DOS_REPOS_CLONADOS> \
  packages/core/gallery-seed/guard-packs.json
# git clone --depth 1 https://github.com/cliprise/awesome-ai-ugc-video-prompts
# git clone --depth 1 https://github.com/cliprise/awesome-ai-video-ads-prompts
```
Salida completa: contrast-verifier-output.txt

---

## Gate (pre-condición)

`pnpm gate` exit 0 sobre SHA c9a1942 (working tree de packages/core == diff staged): lint + typecheck
+ format:check + knip + readme:status + 1524 tests (138 files) verdes.

## Resultado por punto

| Punto | Esperado | Observado | OK |
|---|---|---|---|
| Lookup beauty+tiktok | los 4 exactos | los 4 exactos, igualdad de conjunto | OK |
| Sobre seed real (no fixture) | valida RAW_GALLERY_SEED | validateGallerySeed(...).seed.guardPacks | OK |
| Test asserta "ni una más" | igualdad exacta | toEqual exacto + negativos | OK |
| 0 coincidencias textuales >=6 vs Cliprise | 0 | 0 (N=6,7,8) | OK |
| Contraste sobre líneas realmente sembradas | 37 del JSON final | sí, parseadas del JSON | OK |
| Output del contraste en evidencia | reproducible | verifier-contrast.mjs + .txt | OK |

## Rarezas
- `pnpm --filter @ugc/core test -- guard-lookup` NO acota (Vitest ignora el patrón y corre 876 tests).
  Sin impacto: corrí el fichero explícito con vitest run src/gallery/guard-lookup.test.ts (8 tests).
  No es defecto de producto.
- docs/handoffs/ y journal.md sin stagear son ajenos a T3.3 (ignorados por brief).

## Evidencia
- docs/verifications/T3.3/report.md (este)
- docs/verifications/T3.3/verifier-contrast.mjs (contraste independiente, reproducible)
- docs/verifications/T3.3/contrast-verifier-output.txt (salida cruda del contraste)
