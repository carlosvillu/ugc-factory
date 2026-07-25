# T5.13 · Persona con voz usable inalcanzable en CP2 — report

- **Tarea**: T5.13 (`planning.md`, fase F5)
- **Fecha**: 2026-07-25 (2 ciclos de verifier)
- **Veredicto**: **PASS**
- **Coste real**: **$0** (estimado $0). Ninguna API de pago tocada; stack E2E con proveedores fake.
- **Evidencia**: `VERIFY.md` + 6 capturas y 4 outputs (`01-cp2-tomas-no-sugerida.png`,
  `02-libreria-desplegada-tomas.png`, `03-tomas-fijada-matriz.png`, `04-lote-creado.png`,
  `core-restored.txt`, `core-strategy-suite.txt`, …)

> El `report.md` lo materializa el coordinador: un guard del harness impide que un subagente escriba
> ficheros `report*`. El contenido y los veredictos son del verifier (agente `a79f632e6fbe6188c`), sin
> modificación.

## Resultado por cláusula

| Cláusula | Esperado | Observado | Estado |
|---|---|---|---|
| Fijar una persona con `voice_map` válido **sin tocar la BD** | cero `INSERT` | persona `Tomas Verifier T513` **nacida en el formulario** de `/personas`; el hint sugería solo Chloe/Nerea; «Ver toda la librería (9 más)» la alcanza; fijada. **Cero `INSERT`** | **PASS** |
| La persona fijada llega al plan | `ad_variant.persona_id` poblado | 6/6 variantes con su id; `variants_sin_persona: 0` | **PASS** |
| `personaSelection` | `matched` (antes `no_match`) | **`matched`** | **PASS** |
| No-regresión de `rotate` | sigue filtrando por `matchPersonas` | `matchPersonas` intacto; el bypass se alimenta SOLO de `personaMode==='fixed'`. `core/strategy` **69/69** | **PASS** |
| Playwright permanente (regla 10) | pasa + el assert previo muerde | **2 passed (22,1s)**; el `toHaveCount(0)` previo existe y sincroniza con el toggle | **PASS** |
| Badges de voz dicen la verdad | no mentir sobre cobertura | ciclo 1: **MENTÍAN** → ciclo 2: **badge verde RETIRADO**; queda solo «sin voz configurada» (afirmable) | **PASS** |
| Fallo de carga visible | no dejar callejón sin salida | `role="alert"` visible y accionable; panel **degradado, no bloqueado** | **PASS** |

## Qué se construyó

**Corrección del diagnóstico del coordinador** (verificada por él en `HEAD`): el brief decía «solo UI, el
backend ya existe». **Falso**: `matrix.ts:301` era `const candidates = matchingPersonas(brief, personas)`
**sin excepción para el pool fijado**, y `:385` lo volvía `'no_match'` ⇒ una persona que no casa con el
`avatar_hint` se descartaba IGUAL y las variantes salían **sin cara**. Con solo el «ver todas», el producto
habría dejado clicar una persona que el compositor tiraba **en silencio**.

1. **`matrix.ts` / `plan-batch.ts`**: `personaExplicitlyFixed` — la elección EXPLÍCITA del usuario manda
   sobre la recomendación. `matchPersonas` NO se toca y sigue gobernando `rotate` y `/api/personas/candidates`.
2. **`api-client.ts`**: `personaActions.list()` (el endpoint `GET /api/personas` ya existía).
3. **`matrix-panel.tsx`**: toggle «Ver toda la librería (N más)», colapsado por defecto y **auto-desplegado
   cuando no hay candidatas** (el caso encallado); `PersonaChoice` extraído; copy del callejón sin salida
   sustituida por la salida real.
4. **`apps/web/e2e/persona-library-cp2.spec.ts`** (nuevo, `@f5 @checkpoint`).

## El FAIL del ciclo 1 y su resolución: los badges de voz mentían

`matrix-panel.tsx:828` calculaba la cobertura por **presencia de clave**
(`voiceMap[lang] !== undefined`), y **las 10 personas del seed tienen `voice_map` poblado** con los
`voiceId` `placeholder-*` que fal rechaza con 422 (verificado contra la BD: `count = 10`). Se pintaban con
badge **verde** justo las que iban a reventar. Grave, no cosmético: el badge se justificaba como
«prevenir gasto inútil» y hacía **lo contrario** — el modo de fallo de T5.9 con un check verde encima.

**Resolución: retirar el badge verde**, con un argumento mejor que las heurísticas ofrecidas por el
coordinador: **la versión honesta ya existe**. `VoicePreviewButton` (T4.6) se pinta bajo la misma
condición, pero al pulsarlo **suena o falla** — es una comprobación de COMPORTAMIENTO; el badge era un
proxy más barato de lo mismo, invertido. El criterio: «no hay voz **configurada**» lo controla el cliente
(ausencia de clave) ⇒ afirmable, se queda; «tiene voz **utilizable**» solo lo sabe fal ⇒ se va.
Se descartaron las salidas de detectar `placeholder-` por prefijo o por nombre: son heurísticas de string
sobre el seed de desarrollo que **volverían a mentir** en cuanto §11 asigne voces reales o el usuario
teclee un `voiceId` real pero inválido.

## Control negativo

Todos ejecutados por el **verifier** (no aceptados del informe), y restaurados después:

1. **Badge mentiroso re-añadido** → muerde en **dos capas**:
   ```
   × NO afirma que una persona tenga voz utilizable
   Received: "Mateo…urbanvoz es"      ← con voiceId: placeholder-es-mateo (el dato REAL del FAIL)
   ```
   y en E2E (`spec:150`).
2. **Rama «sin voz» anulada** (`{false ? (`) → muerde:
   ```
   spec:162 — Received: "Silvia E2E Sin-vozlibrería45-54 · female · caucasian · urban"
   ```
   Ya no vive *verde-por-no-existir*.
3. **Core** (`personaExplicitlyFixed` revertido): `AssertionError: expected 'no_match' to be 'matched'`.
4. **Toggle** (control corregido tras la observación del verifier; el del implementer movía dos palancas y
   describía una): con una sola (`showLibrary=false`, botón intacto) el spec muere **en la lógica de
   revelado**, que es donde debe:
   ```
   Error: expect(locator).toBeVisible() failed
   Locator: getByRole('radio', { name: /Bruno E2E Fuera-de-hint/i })  → element(s) not found
   ```

## Auditoría de los 3 asserts cambiados (regla 5): cobertura NETA MAYOR

1. `matrix-panel.test.tsx` es **puramente aditivo** — ni un assert preexistente modificado. Y el fixture
   `MATEO` pasó de `voice-es-mateo-not-a-secret` a **`placeholder-es-mateo`**: el test guardián corre ahora
   sobre el **dato REAL que provocó el FAIL**. Más fuerte, no más débil.
2. La inversión `toContainText(/voz es/)` → `not.toContainText(...)` **no deja hueco**: viene con un assert
   positivo nuevo de que el ▶ sigue visible. Sin él, retirar el badge podría haberse llevado el affordance
   en silencio.
3. `/sin voz/i` → `/sin voz configurada/i` es **más específico**, y el unit añade
   `not.toHaveTextContent(/sin voz/i)` sobre Mateo: prohíbe mentir **por los dos lados**.

`batch-matrix.spec.ts` y `voice-preview.spec.ts`: **intactos**, 8/8 verdes con el trío de CP2.

## Rarezas anotadas (no bloquean)

1. **Cosmética**: en el peor caso (endpoint 500 + cero candidatas), el `Alert` de cabecera sigue diciendo
   «Elige cualquiera de tu librería aquí abajo» junto a la rejilla vacía, mientras la alerta de error
   explica que la librería no cargó. Ya NO es el callejón mudo del ciclo 1, pero las dos frases se
   contradicen a la vista. La copy de cabecera podría ceder ante `libraryFailed`.
2. `Alert tone="danger"` se evitó a propósito para el error de carga: `--danger`/`--danger-soft` es uno de
   los 4 pares en cuarentena de contraste y no se le añaden consumidores. Se usó el patrón `matrix-error`
   ya presente en el fichero.
3. Deuda de DS: no existe primitiva `Disclosure`/`Collapsible`; este toggle sería su segundo consumidor.
4. Deuda PRE-EXISTENTE fuera del diff: `matrix-panel.tsx:443-449` pinta las pills de `hook_examples` a mano
   con clases que coinciden 1:1 con `<Badge tone="neutral">`.
5. Deuda ligada declarada, **NO de esta tarea**: sustituir los `voiceId` placeholder del seed por voces
   reales es trabajo de la asignación con preview de §11.
