# T5.13 · Persona con voz usable inalcanzable en CP2 — VERIFICACIÓN

- **Veredicto (ciclo 2, re-verificación 2026-07-25)**: **PASS**
- **Veredicto (ciclo 1)**: FAIL — badges de voz que mentían sobre los datos que se envían.
  **Defecto corregido y re-verificado con mis manos** (§ «Re-verificación · ciclo 2»).
- **Coste real**: **$0** (vs estimado $0). Ninguna API de pago tocada. El análisis corrió contra el
  stack E2E con proveedores FAKE (`glow.example`), que sustituyen al vendor, no al código bajo prueba.
- **SHA verificado**: `ce2e403` + diff de trabajo (7 ficheros, 359 inserciones / 48 borrados)
- **Superficie**: UI real conducida con `agent-browser` (sesión `t513`) contra el stack E2E en
  `localhost:3100`, + SQL de solo lectura para asertar, + suites unitarias para los controles negativos.

---

## La cláusula literal

> partiendo de un brief cuyo `avatar_hint` no casa con ninguna persona de voz real, el usuario llega
> a fijar una persona con `voice_map` válido **sin tocar la BD** (hoy el verifier tuvo que hacer un
> `INSERT` manual).

**Ejecutada de punta a punta, conduciendo la UI como un humano. CERO escrituras a la BD.**

| # | Paso (todo por UI) | Observado | OK |
|---|---|---|---|
| 1 | Login `/login` | Entrada al stack (password `e2e-password`) | ✅ |
| 2 | Crear persona con `voice_map` real en `/personas` → «Nueva persona» | Formulario con **Proveedor · Español / Voice ID · Español** (y EN). Creada `Tomas Verifier T513` (male, 45-54, urban) con `voiceId=EXAVITQu4vr4xnSDxMaL` | ✅ |
| 3 | Persistencia del `voice_map` (SQL de lectura) | `{"es":{"voiceId":"EXAVITQu4vr4xnSDxMaL","provider":"elevenlabs"}}` | ✅ |
| 4 | Análisis `/analyses/new` → CP1 → aprobar → CP2 | `avatar_hint` = «Creadora 30 años, estilo natural, baño luminoso» | ✅ |
| 5 | **Estado de partida = el bug** | CP2 sugiere SOLO `Chloe` y `Nerea`. **Tomas NO se ofrece.** Aquí acababa el producto antes de T5.13 (`01-cp2-tomas-no-sugerida.png`) | ✅ |
| 6 | **La salida**: «▸ Ver toda la librería (9 más)» | Despliega las 9 no sugeridas. **Tomas aparece**, badge `librería` + `voz es`. Sin duplicar a Chloe/Nerea (`02-libreria-desplegada-tomas.png`) | ✅ |
| 7 | Fijarla | `aria-checked=true` en Tomas, `persona-rotate` pasa a `false` | ✅ |
| 8 | La matriz (la compone el SERVIDOR) | **6/6 filas** con `Tomas Verifier T513` en la columna Persona (`03-tomas-fijada-matriz.png`) | ✅ |
| 9 | Confirmar y crear 6 variantes | Lote creado, navegación al run nuevo (`04-lote-creado.png`) | ✅ |
| 10 | **`ad_variant` en la BD** | `batch 01KYD44FWY30GDVVG2VYWJX1HA`, 6 variantes, `persona_names=["Tomas Verifier T513"]`, **`variants_sin_persona: 0`** | ✅ |
| 11 | `personaSelection` | **`matched`** (antes del fix: `no_match`) | ✅ |

**«Sin tocar la BD»: cumplido literalmente.** La persona NACIÓ en el formulario de `/personas`.
Todo SQL que ejecuté fue `SELECT` para asertar, nunca para avanzar el flujo. En ningún punto del
camino hizo falta un `INSERT` — que es exactamente lo que la tarea prometía eliminar.

---

## Controles negativos (reproducidos con mis manos)

### 1. Bypass de core revertido → el test muerde
Revertí `matrix.ts:317` a `matchingPersonas(brief, personas)` (sin la excepción del pool fijado):

```
AssertionError: expected 'no_match' to be 'matched' // Object.is equality
Tests  1 failed | 13 passed (14)
```

**Reproduce VERBATIM lo que reportó el implementer.** Fichero restaurado y suite verde de nuevo (14/14).

### 2. Toggle gateado (`showLibrary = false`) → el test muerde, pero NO por donde dijo el implementer
`Tests 3 failed | 10 passed (13)`, los tres con:
`TestingLibraryElementError: Unable to find an accessible element with the role "radio" and name /mateo/i`

El implementer afirmó que fallaría por «el E2E no encuentra el botón "ver toda la librería"». **Es
inexacto**: el `Button data-slot="toggle-library"` se renderiza bajo `others.length > 0 &&
candidates.length > 0`, condición **independiente de `showLibrary`** — el botón sigue visible y
clicable; lo que desaparece son las tarjetas (`others.map`). El control **sí bites** (3 tests rojos),
pero el mecanismo descrito no es el real. Se reporta por exactitud, no bloquea.

### 3. No-regresión de `rotate`
`matchPersonas` no se toca en el diff. El bypass es un único ternario alimentado SOLO por
`config.personaMode === 'fixed'` (`plan-batch.ts:112`). Los tests preexistentes que lo guardan siguen
intactos y verdes, inmediatamente debajo del nuevo:
- `` `rotate` reparte las candidatas compatibles y DESCARTA a las que no lo son `` → Mateo excluido
- `con la librería llena pero NINGUNA compatible, el plan dice `no_match``

`packages/core/src/strategy/` completo: **69/69 verde** (4 ficheros).

---

## E2E permanente (entregable BLOQUEANTE)

`apps/web/e2e/persona-library-cp2.spec.ts` — **2 passed (22.1s)** contra el stack real.

Auditado, no solo ejecutado:
- **El assert previo existe y muerde** (paso 1 del spec): asevera `toHaveCount(0)` para la persona
  ANTES de desplegar, sincronizando con la aparición del toggle (señal de que la librería ya llegó
  del servidor). Sin él, el test podría pasar por un hint que casara por accidente.
- Cierra en la **BD** (`ad_variant.persona_id`), no en un endpoint que podría mentir.
- La siembra vía `upsertPersonaByName` es **preparación de escenario** (cua.md regla 1); el paso
  verificado —encontrar, fijar, confirmar— se conduce entero por la página. Correcto.

## Auditoría de regla 5 (¿se debilitó algún test?)

- `batch-matrix.spec.ts` y `voice-preview.spec.ts`: **intactos** (`git status` vacío para ambos).
- El assert `marcus toHaveCount(0)` de `batch-matrix.spec.ts` **sigue midiendo algo real**: el
  listado va **colapsado por defecto**, así que «Marcus no se ofrece» sigue siendo el estado
  observable de CP2 al abrirlo. El cambio de producto no lo vacía de sentido; lo reinterpreta a
  «no se ofrece por defecto», que es la garantía que el usuario percibe.
- `plan-batch.test.ts` y `matrix-panel.test.tsx`: solo **añaden** casos. Ningún assert relajado ni borrado.

---

---

# Re-verificación · ciclo 2 (PASS)

El implementer eligió la **opción (3): retirar el badge verde**. El criterio que traza —y que
comparto tras verificarlo— es la asimetría correcta:

- «no hay voz **configurada**» → ausencia de clave en `voice_map`, **inequívoca**, el cliente la
  afirma sin mentir → se queda, con copy afinada a «sin voz **configurada**» (ya no reclama usabilidad).
- «tiene voz **utilizable**» → solo lo sabe fal (422) → **se va**. Quien lo comprueba honestamente
  es el ▶ `VoicePreviewButton` (T4.6): reproducir **suena o falla**, que es comprobación de
  comportamiento, no promesa del cliente.

Descartar las heurísticas de string (1) y (2) es acertado: en cuanto §11 asigne voces reales, o el
usuario teclee un `voiceId` real pero inválido, volverían a mentir.

**Comprobado en el código con mis manos**: no queda ningún `Badge tone="success"` de cobertura
(`grep` = 0); `withVoice` solo alimenta los `VoicePreviewButton`; el único badge de voz es el
`tone="warning"` de ausencia. La copy «llevará su cara **y su voz**» → «llevará su cara».

## Lo que re-verifiqué (ciclo 2)

| Punto | Cómo lo comprobé | Resultado |
|---|---|---|
| **Control negativo del badge, 2 capas** | Re-añadí el badge verde al producto | **Muerde en ambas.** Unit: `× NO afirma que una persona tenga voz utilizable` → `Received: "Mateo…urbanvoz es"`. E2E: falla en `spec:150` `not.toContainText(/voz es/i)`. Restaurado y verde | ✅ |
| **Rama «sin voz» ALCANZABLE con datos reales** (mi hallazgo del ciclo 1) | Control dirigido: anulé la rama (`{false ? (`) y corrí el E2E contra el stack | **Muerde de verdad**: `spec:162` falla con `Received: "Silvia E2E Sin-vozlibrería45-54 · female · caucasian · urban"`. Ya no vive verde-por-no-existir: `Silvia E2E Sin-voz` (`voiceMap: {}`) se pinta en el producto real | ✅ |
| **Fix del `.catch`, en el producto corriendo** | Parcheé `fetch` en la página para devolver 500 en `GET /api/personas` y llegué a CP2 por el flujo real | `role="alert"` **visible** con texto accionable; panel **degradado, no bloqueado** (Chloe y Nerea siguen usables). `05-library-error-visible.png` | ✅ |
| **El peor caso**: 500 **y** cero candidatas | Forcé `candidates=[]` + librería 500 y llegué a CP2 | **El callejón sin salida está cerrado**: antes era una rejilla vacía muda; ahora la alerta explica qué pasó y qué hacer. `06-error-sin-candidatas.png` | ✅ |
| **Auditoría de los asserts (regla 5)** | Diff completo de tests | **Ningún assert debilitado** (detalle abajo) | ✅ |
| No-regresión | `packages/core/src/strategy/` y `apps/web/src` | **69/69** y **275/275 (31 ficheros)** | ✅ |

## Auditoría de los asserts cambiados (regla 5) — cambio de comportamiento, NO debilitamiento

1. **`matrix-panel.test.tsx` es puramente ADITIVO**: no se modificó ni un assert preexistente.
   Además el fixture `MATEO` cambió su `voiceId` de `voice-es-mateo-not-a-secret` (una voz creíble
   que nunca existió) a **`placeholder-es-mateo`** — el dato REAL que provocó el FAIL. El test
   guardián corre ahora sobre el dato que rompe, no sobre uno de juguete: **más fuerte, no más débil**.
2. **La inversión `toContainText(/voz es/) → not.toContainText(/voz es/)`** es el cambio de
   comportamiento legítimo (la afirmación retirada), y **no deja hueco**: viene acompañada de un
   assert POSITIVO nuevo de que el ▶ sigue visible
   (`[data-slot="persona-voice-previews-…"] button`). Sin él, retirar el badge podría haberse
   llevado el affordance por delante en silencio. **Cobertura neta MAYOR que antes.**
3. **`/sin voz/i` → `/sin voz configurada/i`** es un assert **más específico** (exige la palabra que
   acota la promesa). Y el unit añade `expect(mateo).not.toHaveTextContent(/sin voz/i)`: prohíbe
   mentir **por los dos lados**, no solo por el verde.

## Rareza nueva (menor, no bloquea)

En el peor caso (librería 500 **y** cero candidatas) el `Alert` de cabecera sigue diciendo «Elige
cualquiera de tu librería aquí abajo» junto a la rejilla vacía, mientras la alerta de error explica
—correctamente— que la librería no cargó. **Ya no es el callejón mudo del ciclo 1** (el usuario sabe
qué pasó y que debe recargar), pero las dos frases se contradicen a la vista. Cosmético: la copy de
cabecera podría ceder ante `libraryFailed`.

---

## 🚫 DEFECTO BLOQUEANTE DEL CICLO 1 — CORREGIDO (se conserva como memoria del proyecto)

> **RESUELTO en el ciclo 2** (badge verde retirado; ver arriba). Se conserva el análisis porque es
> la memoria de por qué el producto ya no afirma cobertura de voz.

**Este fue el motivo del FAIL.** La cláusula literal no menciona badges, así que consideré
explícitamente dejarlo pasar como observación. No lo hago, por tres razones:

1. Es **superficie NUEVA que introduce este diff**, no deuda heredada.
2. Su justificación declarada, en el comentario del propio implementer, es **prevenir gasto**:
   «este aviso existe para PREVENIR GASTO INÚTIL (el fallo de fondo del run de T5.9 fue descubrir la
   falta de voz al generar, con el dinero ya gastado)».
3. Sobre los datos reales del seed hace **exactamente lo contrario**: marca en verde como «cubiertas»
   justo a las 10 personas cuya voz reventará en generación. Es el modo de fallo de T5.9 con un
   check verde encima.

El badge se calcula por **presencia de clave**, no por validez de la voz:
`matrix-panel.tsx:828` → `languages.filter((lang) => persona.voiceMap[lang] !== undefined)`

Las 10 personas del seed traen `voice_map` **poblado** para `es` y `en` con los `voiceId`
placeholder que **fal rechaza con 422**:

| persona | es | en |
|---|---|---|
| Alex…Rosa (las 10 del seed) | `placeholder-es-*` | `placeholder-en-*` |
| Tomas Verifier T513 (creada por UI) | `EXAVITQu4vr4xnSDxMaL` | `null` |

Verificado en pantalla: las 10 placeholder se pintan con badge **verde `voz es`**. Ninguna muestra
«sin voz».

**Consecuencia**: el badge cuya función declarada es *prevenir gasto inútil* marca como «cubiertas»
justo a las 10 personas cuya voz reventará en generación. El brief del coordinador daba por hecho
que «los `placeholder-*` del seed se marcan como sin voz» — **no es así**, y no puede serlo con la
lógica actual, porque el dato que distingue una voz real de un placeholder no está en `voice_map`.

> **RESUELTO en el ciclo 2**: el spec siembra `Silvia E2E Sin-voz` (`voiceMap: {}`) y la rama queda
> alcanzable contra la BD real; verifiqué que **muerde** anulándola (falla en `spec:162`).
> El texto original del ciclo 1 se conserva abajo.

Sobre la rama «sin voz», con precisión: **existe en el código y renderiza en jsdom** (fixture LUCIA
de `matrix-panel.test.tsx`, que no construí yo). Eso prueba que la rama pinta, **no** que llegue a
dispararse en el producto: con los datos que se envían es **inalcanzable**. Intenté crear por
formulario una persona sin voz para confirmarlo en el producto corriendo y **el alta no llegó a
completarse** (error mío de refs del harness, no del producto), así que **no confirmé esa rama en la
app en marcha**. Además, la rama de aviso completo exige un `voice_map` ENTERAMENTE vacío: `Tomas`
tiene `es` pero `en: null`, con lo que en un lote bilingüe mostraría `voz es` y tampoco avisaría de
la laguna en `en`.

La deuda de sustituir los `voiceId` placeholder por voces reales está declarada como NO de esta tarea
(§11, asignación de voz con preview) — lo que hace este badge **prematuro respecto a sus datos**.

### Qué debe arreglar el implementer (accionable)

El badge tiene que distinguir una voz REAL de un placeholder declarado. Opciones, de menor a mayor
alcance:

1. Tratar `voiceId` que casa `placeholder-*` como «sin voz».
2. Gatear por el marcador `(placeholder)` del nombre (la clave natural que ya usa el seed).
3. **Retirar el badge verde** hasta que aterrice la asignación de voz con preview de §11. Es una
   opción legítima, no una derrota: un badge que no puede decir la verdad sobre los datos actuales
   es peor que no tenerlo — y así lo dice el propio brief de esta verificación.

Lo que NO vale es dejarlo como está: hoy afirma en verde lo contrario de lo que ocurrirá al generar.

## Rarezas (aunque sea PASS)

1. ~~**`personaActions.list()` traga los fallos en silencio**~~ → **CORREGIDO y re-verificado en el
   ciclo 2** (`libraryFailed` + `role="alert"`, comprobado en el producto corriendo con un 500 real).
   Se conserva el texto original abajo como memoria. (`.catch(() => {})`, matrix-panel.tsx:190).
   Si `GET /api/personas` falla **y** no hay candidatas, el panel pinta la copy nueva («Elige
   cualquiera de tu librería aquí abajo») apuntando a una rejilla **vacía**, sin toggle y sin error:
   el callejón sin salida de vuelta, con otro disfraz. No se disparó en mi run; no lo perseguí.
2. **Ruido de harness, no de producto**: bajo `next dev`, los remontajes de Fast Refresh reinician
   `libraryOpen`/selección; y `agent-browser` erraba el click cuando la tarjeta quedaba fuera del
   viewport (`getBoundingClientRect().top` negativo). Con `scrollIntoView({block:'center'})` previo,
   toggle y selección responden al primer click. Nada de esto afecta al veredicto ni al E2E de Playwright.

## Qué comprobé con mis manos vs qué acepté del informe

**Con mis manos**: la cláusula literal completa por UI (11 pasos); la creación de la persona con
`voice_map` por formulario; `ad_variant.persona_id` y `personaSelection` por SQL; los dos controles
negativos (revirtiendo el código yo mismo y restaurándolo); el E2E permanente ejecutado; el estado
`git status` de `batch-matrix`/`voice-preview`; el contenido real del `voice_map` de las 11 personas;
la suite de core completa.

**Aceptado del informe (con lectura del diff, sin ejecución independiente)**: que `GET /api/personas`
preexistía a esta tarea; y la afirmación de que no hay más superficie tocada que la del diffstat
(verificada por `git status`, no por revisión línea a línea de los 7 ficheros).

## Evidencia

- `01-cp2-tomas-no-sugerida.png` — CP2 al abrir: solo Chloe y Nerea; Tomas ausente (el bug)
- `02-libreria-desplegada-tomas.png` — tras «Ver toda la librería»: Tomas alcanzable
- `03-tomas-fijada-matriz.png` — 6/6 filas de la matriz con Tomas
- `04-lote-creado.png` — lote confirmado
- `core-restored.txt` — suite de core verde tras restaurar el control negativo
- `core-strategy-suite.txt` — `packages/core/src/strategy/` 69/69

**Ciclo 2 (re-verificación)**
- `05-library-error-visible.png` — `GET /api/personas` a 500 en el producto corriendo: alerta
  visible y panel degradado pero usable
- `06-error-sin-candidatas.png` — el peor caso (500 + cero candidatas): explicado, ya no mudo
- `reverify-core-strategy.txt` — 69/69
- `reverify-web-unit.txt` — 275/275 (31 ficheros)
