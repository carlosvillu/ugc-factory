# Verificación T1.8 — BriefSynthesizer (N3) · CICLO 3 (re-verificación)

- **Tarea**: T1.8 · BriefSynthesizer (N3) (`planning.md`)
- **Fecha**: 2026-07-11
- **Ejecutor**: verifier (contexto fresco) · agent-browser · sesión `t1.8c3`
- **Sistema**: working tree de T1.8 sobre `a197fbb` · docker `ugc-postgres-dev` (Postgres 16) + `pnpm dev` (web:3001 + worker, migraciones aplicadas) + secretos T0.14 + API REAL de Anthropic (Sonnet 5)
- **Coste real de esta re-verificación**: **$0,35** (Anthropic: 2 síntesis reales, 35 cts en `cost_entry`; `count_tokens` = $0; Firecrawl = **$0**, no se re-scrapeó)
- **Ciclos anteriores**: FAIL #1 (`report-fail-1.md`), FAIL #2 (`report-fail-2.md`)

---

## VEREDICTO CICLO 3: **FAIL**

**El fix del ciclo 3 funciona y funciona bien**: `trimVisualAnalysis()` es real y mide lo que dice
(el bloque VISUAL pasa de **11.184 → 1.316 tok**, −88 %), el recorte del markdown a 20k chars
funciona, el recorte a 5 ángulos funciona, el hero **sobrevive** al recorte y `assets` no se rompe,
el reintento está implementado con exactitud quirúrgica, y las 6 cláusulas no-monetarias PASAN.

**Y aun así el coste sigue por encima del bound duro, en LAS DOS URLs reales, en LOS DOS regímenes.**
Medido con `visualAnalysis` REALISTA (que es lo que el ciclo 2 no midió y por eso subestimó):

| brief | régimen | `cost_entry`.amount_cents | bound `<$0,15` |
|---|---|---|---|
| **URL_1 allbirds** (visual 27 imgs) | **FRÍA** | **19 cts** | **✗ 1,3× el bound** |
| **URL_2 ugmonk** (visual 117 imgs) | **CALIENTE** (`cache_read`=15.480) | **16 cts** | **✗ 1,04× el bound** |

Mejora enorme respecto al ciclo 2 (25 → 19 y **37 → 16**), pero **el bound se sigue incumpliendo**, y
la nota 1 del planning dice explícitamente que **`<$0,15/brief` SE MANTIENE y es DURO en el camino
normal**. Ninguno de los dos briefs está en la rama de reintento (0 reintentos): ambos son camino
normal. **Falla la misma cláusula, con menos margen.**

**El peso del veredicto lo lleva la llamada FRÍA (19 cts), no la caliente.** Es el número robusto:
la escritura de caché (+5,8 cts) por sí sola se come el presupuesto de output que queda bajo el
bound, y **la fría es el régimen NORMAL en producción** — la caché ephemeral de Anthropic dura ~5
min, y dos análisis reales rara vez caen dentro de esa ventana: casi toda llamada de N3 en
producción PAGA la escritura. El número CALIENTE (16 cts) va **4 % por encima** del bound: es un
margen fino, y mi `rendered_social_proof` sintético (rating + quotes) pudo empujar al modelo hacia
un ángulo social_proof y engordar algo la salida. **No apoyo el veredicto en ese 4 %: lo apoyo en
los 19 cts de la fría**, que fallan con margen y son independientes de ese detalle.

### Por qué el implementer midió 12,7–13,7 y yo mido 16–19

Dos cosas se le escaparon, y las dos las nombra la propia nota 1 del planning:

1. **La llamada FRÍA.** La escritura de la caché del system (15.480 tok × $3,75/M) son **+5,8 cts**
   que solo aparecen en la 1ª llamada de la ventana. El brief de allbirds en frío = 19 cts. **La
   primera síntesis de una sesión es camino normal**, no un caso degenerado.
2. **El coste ya no lo domina el input: lo domina el OUTPUT.** Tras el recorte, el input cabe
   holgado; lo que ya no cabe es el brief mismo.

Aritmética exacta, medida con `count_tokens` (endpoint GRATUITO) sobre la página real de ugmonk
(`count-tokens-c3.txt`):

```
system prompt                                    15.483 tok
user message ciclo 3 (md 20k + visual podado)    10.071 tok   (visual: 1.316 · md: 8.564)
                                                 -------------
input FRIO     (system a 1,25x cache_write) = $0,0883  <- quedan 4.115 tok de output bajo $0,15
input CALIENTE (system a 0,1x  cache_read)  = $0,0349  <- quedan 7.667 tok de output bajo $0,15
```

Y el brief real, ya con 5 ángulos y sin inflar, emite **6.884 tok** (allbirds) y **8.076 tok**
(ugmonk) de output. **A $15/MTok eso son 10,3 y 12,1 cts SOLO de salida.** El presupuesto de output
bajo el bound es 4.115 tok en frío: **el brief más austero que este sistema sabe escribir pesa 1,7×
ese presupuesto.** No es una página gorda ni un input mal acotado: **es el tamaño del ProductBrief.**

**La palanca que queda es el OUTPUT, y ya no hay margen fácil**: los ángulos ya están en 5 (el mínimo
que la Verificación permite). Lo que pesa ahora es el resto del contrato (features, benefits,
pain_points, objections con contraargumentos, quotes, audience, assets, evidence). Recortarlo es
tocar el contrato de T1.1, no un parámetro.

---

## Gate previo

`pnpm gate` **VERDE**: lint + typecheck + format:check + knip + test → **81 ficheros, 809 tests, 0
fallos**. El tier `live` es opt-in (`RUN_LIVE`), así que el gate no gasta.

---

## Metodología (por qué esta medición SÍ es honesta y la del ciclo 2 era un suelo)

El propio report del ciclo 2 avisó: sus 25/37 cts se midieron con **`visualAnalysis: null`**. Pero
**el fix dominante de este ciclo, `trimVisualAnalysis()`, NO HACE NADA cuando el visual es null**:
repetir aquella medición habría vuelto a medir un camino irrealmente barato y habría dado un PASS
falso al recorte que más importa.

Por eso el driver del ciclo 3 (`verify-brief-c3.ts`, escrito por el verifier) mide con un
**VisualAnalysis REALISTA**, construido a mano (coste $0) con el perfil que N2/T1.7 produce sobre
esas páginas:

- **URLs de CDN REALES** extraídas de los markdowns guardados (87–143 chars cada una: el peso real
  que se factura). Un fixture con URLs cortas habría reconstruido el camino barato.
- **117 imágenes** (ugmonk) / **27** (allbirds), mezcla realista hero/broll/unusable, más paleta,
  estética y social proof renderizado.
- **Validación cruzada**: mi bloque VISUAL sin podar pesa **11.184 tok**; el implementer midió
  **10.996** sobre el visual real. Mi construcción reproduce el peso de producción (−1,7 %).

Y **NO se re-scrapea**: se cargan los `markdown-url1.md` / `markdown-url2.md` del ciclo 2 → la
comparación contra los 25/37 cts es limpia (sin deriva de página) y Firecrawl cuesta $0.

**No se usaron los tests del implementer** (mismas objeciones que el ciclo 2: sus fixtures no
scrapean, no escriben `cost_entry`, y su assert de coste mide un input de 467 tokens).

---

## Resultado por observable (las 7 de la Verificación)

| # | Observable (literal) | Esperado | Observado | OK |
|---|---|---|---|---|
| 1 | 2 URLs reales + 1 texto libre → briefs | briefs producidos | **2/2 `synthesized`** sobre las URLs reales, 0 `parse_error`, 0 reintentos. (Texto libre y adversarial: **no re-ejecutados este ciclo** — ver §Alcance) | ✓ (parcial) |
| 2 | Los briefs **validan contra Zod** | válidos | Los 2 pasan `ProductBriefSchema.safeParse()` (`status=synthesized` lo implica: el safeParse es el gate) | ✓ |
| 3 | `evidence` con citas **literales en el markdown** | citas reales | **9 citas no nulas, 9 literales, 0 inventadas** (3 en allbirds + 6 en ugmonk), verificadas contra los markdowns reales (`quality-check-c3.txt`) | ✓ |
| 4 | **5–10 ángulos distintos** | 5–10, no clones | **5 y 5**. Frameworks **todos distintos** en ambos (5/5 y 5/5), 4 niveles de awareness distintos, 3–4 segmentos, **15 hooks TODOS únicos** por brief | ✓ |
| 5 | **Coste <$0,15/brief en `/spend`** | <15 cts/brief | `/spend` renderiza y muestra el gasto ($1,18 Anthropic / 254.749 tok, `01-spend-c3.png`). Pero el coste **por brief**, leído en `cost_entry`, es **19 cts (fría) y 16 cts (caliente)** | **✗** |
| 6 | 2ª llamada: `cache_read_input_tokens > 0` | >0 | **`cache_read = 15.480`** en la 2ª llamada (la 1ª escribió `cache_write = 15.480`) | ✓ |
| 7 | Página adversarial **no corrompe el brief** | sin dato envenenado | **PASS heredado del ciclo 2** (resistencia total contra la API real). **NO re-ejecutado ni re-medido este ciclo** — ver §Alcance. Verificado a $0: `ANTI_INJECTION_BLOCK` (561 chars) es **verbatim del Apéndice A del PRD** (comparación carácter a carácter) | ✓ (heredado) |

**6 de 7 PASAN. La que falla (O5) es la misma cláusula dura de dinero de los dos ciclos anteriores.**

---

## Daño colateral del recorte visual: **NO lo hay** (comprobado)

Era el riesgo grave de `trimVisualAnalysis()`: si el recorte se llevara el hero por delante, el brief
referenciaría imágenes inexistentes y `assets` quedaría roto.

- **`hero_image_url` sobrevive al recorte** en los dos casos (`count-tokens-c3.txt`: `hero está en las
  podadas? true`). El orden hero > broll > (unusable descartadas) funciona.
- **`assets.images` del brief**: 6 (allbirds) y 12 (ugmonk) — no vacío, **con al menos un `hero`** en
  ambos.
- **`suggested_assets ⊆ assets.images`**: 5/5 y 9/9 URLs presentes. Coherencia interna intacta.
- Efecto secundario BUENO: el brief ya no ECOA 117 URLs en `assets` (ciclo 2: 18 imágenes en el
  brief de ugmonk, 3.595 chars de salida). Ahora 12, acotado por construcción.

---

## El REINTENTO (ajuste de alcance aprobado, nota 4) — **CORRECTO**, verificado a coste $0

Verificado contra el **servicio real** (`runSynthesizeBrief`, el que escribe `cost_entry`) con un
servidor HTTP local haciendo de Anthropic (`retry-check-c3.ts` / `retry-check-c3.txt`). Sin gasto.

| escenario | llamadas | resultado | veredicto |
|---|---|---|---|
| **A) `parse_error` → `parse_error`** | **2** | `status=parse_error`; `usage` SUMA los dos intentos (2000 in / 200 out) | ✓ reintenta |
| **B) `api_error` (400)** | **1** | `status=api_error`, **NO reintenta** | ✓ **correcto**: un 400 es determinista; reintentarlo sería quemar dinero |
| **C) `parse_error` → OK** | **2** | `status=synthesized`, **brief recuperado**; `usage` suma ambos | ✓ absorbe la deriva |

**El coste SUMA los dos intentos en la BD**, no solo en memoria: el `cost_entry` del proyecto de
prueba registra `quantity = 2200` tokens por brief (2 × 1.100), no 1.100. **`/spend` ve las dos
llamadas.** Es exactamente lo que la nota 4 exige.

**Pero ojo con la aritmética del reintento sobre datos reales**: si un brief normal cuesta 16–19 cts,
**su rama de reintento cuesta ~32–38 cts** — por encima incluso del bound BLANDO de ≤$0,30 que la
nota 4 aprueba (su estimación de ~$0,26 se derivó de los 13 cts del implementer, que eran calientes
y sin la caché fría). El bound blando **también** queda incumplido en la primera síntesis de una
sesión.

---

## Coste

### Por brief (de `cost_entry`, la BD — no de logs del propio código)

| brief | in | cache_write | cache_read | out | $ calculado | **cts en BD** | ciclo 2 |
|---|---|---|---|---|---|---|---|
| URL_1 allbirds (**FRÍA**, visual 27) | 10.025 | 15.480 | 0 | 6.884 | $0,1914 | **19** | 25 |
| URL_2 ugmonk (**CALIENTE**, visual 117) | 10.071 | 0 | 15.480 | 8.076 | $0,1560 | **16** | 37 |

Descomposición del brief CALIENTE (el más barato posible del sistema hoy):

```
input no cacheado (md 20k + visual podado):  10.071 tok x $3/M     = $0,0302   <- 19% del coste
cache_read (system, ya cacheado):            15.480 tok x $0,30/M  = $0,0046   <-  3%
output (el brief, 5 angulos, sin inflar):     8.076 tok x $15/M    = $0,1211   <- 78% del coste
                                                             TOTAL = $0,1560
```

**El input ya está resuelto (22 % del coste). El que rompe el bound ahora es el OUTPUT: el 78 %.**

### De esta re-verificación

| Concepto | Importe |
|---|---|
| Anthropic — 2 síntesis reales (Sonnet 5) | **$0,35** |
| Anthropic — `count_tokens` (endpoint gratuito, 8 llamadas) | $0 |
| Firecrawl — **no se re-scrapeó** (markdowns del ciclo 2) | **$0** |
| Retry-check (servidor local fake) | $0 |
| **TOTAL** | **$0,35** |

Dentro de la guía de $0,30–0,40. **No se gastó en re-ejecutar texto libre ni adversarial**: en cuanto
las dos URLs reales rompieron el bound, la cláusula de coste ya estaba decidida (fail-fast) y seguir
gastando habría sido derroche. **Acumulado de T1.8: ~$5,15** (estimado: $0,60).

---

## Alcance de este ciclo (lo que NO se re-ejecutó, y por qué)

La cláusula de coste cayó con las 2 URLs reales, que son **exactamente** las que la Verificación
manda medir. Re-sintetizar el texto libre y el adversarial habría costado ~$0,20 más sin cambiar el
veredicto:

- **Texto libre** (O1): pasó en el ciclo 2 (9 cts, 7 ángulos, brief completo). El cambio de este
  ciclo (recorte de input) solo puede **abaratarlo**, y no toca su camino (`visualAnalysis: null`,
  markdown de 467 tok < 20k → no se trunca).
- **Adversarial** (O7): pasó en el ciclo 2 con **resistencia total**. NO se re-ejecuta porque la
  cláusula de coste ya decidió el veredicto (fail-fast sobre una tarea 8× por encima de su
  estimación). **Aviso de honestidad**: NO puedo afirmar que el system prompt sea byte-idéntico al
  del ciclo 2 — el prompt está sin commitear y **el system CRECIÓ de 15.154 a 15.480 tok** entre
  ciclos. Lo que SÍ está verificado a $0 es que `ANTI_INJECTION_BLOCK` sigue siendo **verbatim del
  Apéndice A del PRD** (561 chars, comparación exacta). **Si el usuario quiere O7 re-medido de
  verdad, son ~$0,10** — pero no cambiaría el FAIL.

Ambos se marcan como **heredados**, no como re-verificados. Si el usuario quiere el ciclo completo
re-medido, son ~$0,20.

---

## Causa raíz del FAIL (accionable para el implementer / decisión de alcance)

**El bound de $0,15 ya no lo rompe el input: lo rompe EL BRIEF.** El output mínimo observado
(6.884–8.076 tok con 5 ángulos, sin relleno) cuesta **10–12 cts**, y el presupuesto de output bajo el
bound es de **4.115 tok en frío / 7.667 en caliente**. **El contrato de T1.1, escrito honestamente,
no cabe en $0,15 con Sonnet 5 en una llamada fría.**

Las palancas que quedan, todas con coste:

1. **Bajar el coste del output (única palanca técnica que queda)**:
   - **Adelgazar el CONTRATO** (menos campos, `evidence` solo en los campos clave, descripciones más
     cortas). Toca T1.1 — cambio de alcance.
   - **Modelo más barato para la síntesis** (Haiku 4.5: $1/$5 → el mismo brief costaría ~4–6 cts y
     cumpliría el bound con holgura). Contradice el PRD §9.2, que fija Sonnet 5. Cambio de alcance.
   - **Precio de introducción**: la tabla `anthropic-pricing.ts` factura Sonnet 5 a precio de lista
     ($3/$15) a propósito; el intro ($2/$10 hasta 2026-08-31) daría ~11 cts (caliente) / ~13 cts
     (frío) — cumpliría el bound. Pero es un precio temporal y facturar por él sería infra-reportar.
2. **Amortizar la caché fría**: si N3 corriera siempre en caliente el brief más barato baja a 16 cts
   — **sigue por encima**. No rescata el bound ni en el mejor caso.
3. **Revisar el bound (decisión del USUARIO, no del verifier)**: dos ciclos consecutivos de fixes
   agresivos han llevado el coste de 37 → 16 cts y **el criterio O1 del PRD sigue sin cumplirse**. Un
   ProductBrief completo de una landing real, con Sonnet 5, vale **~$0,16–0,19**. Si el criterio se
   queda en $0,15, hay que cambiar el modelo o el contrato; si el modelo y el contrato se quedan, hay
   que mover el criterio a ~$0,20.

**Circuit breaker**: este es el **3er FAIL consecutivo** de T1.8, y los tres por la misma cláusula.
La causa ya no es un bug: es una **tensión de diseño entre el criterio O1 ($0,15), el modelo (Sonnet
5) y el tamaño del contrato (T1.1)**. Recomiendo **parar y llevárselo al usuario** en vez de un 4º
ciclo de recortes — el margen técnico que quedaba se ha consumido y lo siguiente ya es tocar
contrato, modelo o criterio.

---

## Rarezas / notas

- **El prompt se contradice consigo mismo sobre los ángulos**: §4 (línea 122) dice «Genera entre 5 y
  10 ángulos DISTINTOS» y §6.3 dice «Escribe 5 ángulos; 6 como máximo». No rompe ninguna cláusula
  (los briefs salen con 5 y el Zod de T1.1 acepta 5–10), pero son instrucciones contradictorias en el
  mismo system prompt cacheado. Conviene resolverlo.
- **`meta.warnings` de ugmonk detectó una discrepancia de precio real**: «El precio estructurado
  ($99.00) difiere del precio mostrado en la página para esta variante ($69)». Es exactamente el
  caso que **T1.9** valida (precio N1 == N3). Buena señal para la siguiente tarea.
- **`extraction_confidence = low` en allbirds** con `meta.warnings` explicando que el markdown que
  Firecrawl trajo **es la homepage, no la ficha de producto**. Mismo comportamiento que el ciclo 2:
  el brief es honesto sobre su propia pobreza. **Deuda de T1.4/T1.5, no de T1.8**, pero afecta a la
  calidad del brief de esa URL.
- **El nº de `evidence` bajó** (39 citas en los 4 briefs del ciclo 2 → 9 en los 2 de este). Es
  coherente con briefs más austeros, y las que hay son **100 % literales**. No incumple la cláusula
  (que exige literalidad, no cantidad), pero es una pérdida de trazabilidad a tener presente.
- **`MAX_TOKENS = 16.000` ya no está al borde**: el output máximo observado es 8.076 tok (50 % del
  techo). La fragilidad que denuncié en el ciclo 2 está resuelta.
- **La deuda de DX del puerto sigue viva**: el 3000 lo ocupa un proceso ajeno, Next arranca en 3001 y
  el RSC de `/spend` apunta a `INTERNAL_API_URL ?? http://localhost:3000` → 500 silencioso. Se
  arranca con `INTERNAL_API_URL=http://localhost:3001`. **No es un bug de T1.8** (ya anotado).
- **`/spend` muestra agregados por proveedor/día, no coste por brief.** La cláusula «coste
  <$0,15/brief en `/spend`» no es literalmente leíble en la UI: el per-brief sale de `cost_entry`. Se
  hicieron ambas cosas. (Anotado para T7.7.)
- Consola del navegador en `/spend`: **limpia** (solo HMR/React DevTools).

---

## Historial de la tarea

| ciclo | veredicto | causa |
|---|---|---|
| 1 | FAIL | `output_config` de Anthropic → 400 determinista: **cero briefs** (`report-fail-1.md`) |
| 2 | FAIL | Briefs correctos, pero **25–37 cts/brief** (input sin acotar), medidos con `visualAnalysis: null` (`report-fail-2.md`) |
| **3** | **FAIL** | Recortes efectivos (37→16 cts) pero **16–19 cts/brief con visual realista**: el bound sigue roto, y ahora **lo rompe el OUTPUT (78 % del coste)**, no el input |

---

## Evidencia

- `verify-brief-c3.ts` — driver del verifier del ciclo 3 (servicio real, markdowns reales del ciclo 2, **VisualAnalysis realista**, escribe `cost_entry`)
- `verify-run-c3-stage1.txt` — salida cruda de la corrida de pago (2 síntesis)
- `briefs-c3-stage1.json` — los 2 briefs completos + `usage` por llamada
- `visual-c3.json` — los VisualAnalysis realistas construidos (27 y 117 imágenes, URLs de CDN reales)
- `count-tokens-c3.ts` / `count-tokens-c3.txt` — **la aritmética del bound** medida con `count_tokens` ($0)
- `retry-check-c3.ts` / `retry-check-c3.txt` — el reintento verificado a $0 contra el servicio real
- `quality-check-c3.txt` — ángulos, frameworks, awareness, hooks, **evidence literal (9/9)**, hero preservado, `suggested_assets ⊆ assets.images`
- `cost-baseline-c3.txt`, `cost-entries-c3.txt`, `cost-after-c3.txt` — `cost_entry` (la BD), antes y después
- `01-spend-c3.png`, `spend-page-c3.txt` — `/spend` renderizado en el navegador
- `browser-console-c3.txt` — consola limpia
- `dev-server-c3.log` — arranque del sistema (web:3001 + worker, migraciones, secretos)
- `markdown-url1.md`, `markdown-url2.md` — los pajares reales (del ciclo 2, sin re-scrapear)
- `report-fail-1.md`, `report-fail-2.md` — los reports de los FAIL anteriores (memoria del proyecto)
