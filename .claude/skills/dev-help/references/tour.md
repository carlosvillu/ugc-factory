# Tour completo del arnés de desarrollo autónomo — UGC Factory

> Documento de referencia de la skill `dev-help`. Escrito el 2026-07-07, la sesión en que se construyó el arnés y se ejecutó el piloto (T0.1). Si algo de aquí contradice a `.claude/skills/dev-loop/SKILL.md`, a los agentes o al hook, **ganan ellos** (son el código del arnés; esto es su manual).

## 1. Qué es y por qué existe

El arnés es el sistema que permite desarrollar UGC Factory (el producto definido en `PRD.md`) de forma **autónoma pero auditable**: Claude ejecuta las tareas de `planning.md` una a una — implementa, testea, se auto-revisa, verifica contra el sistema real y deja evidencia — y solo se detiene donde una persona aporta valor real (decisiones de gasto, prerequisitos externos, juicio humano, fin de fase).

No es un invento ad-hoc: se diseñó tras una investigación verificada del estado del arte (2026) de bucles de desarrollo con agentes. Los hallazgos que lo moldearon:

| Hallazgo (fuente) | Cómo lo codifica el arnés |
|---|---|
| Los agentes **sobre-aprueban su propio trabajo** (Anthropic engineering) | Quien implementa (implementer) NUNCA verifica; lo hace un agente separado (verifier) con mandato escéptico explícito |
| La compactación de contexto **no basta** en proyectos largos; hace falta estado durable en ficheros | El estado vive en `planning.md` + `docs/dev-loop/journal.md` + git log; cualquier sesión nueva retoma leyendo esos tres |
| **Una tarea por sesión de agente** fue la contramedida crítica contra "intentar todo a la vez" | Cada tarea la implementa un agente NUEVO con contexto fresco y brief acotado |
| La verificación e2e **real** (conducir la app como usuario) mejora dramáticamente vs "compila" | El gate de cierre es la Verificación literal del planning contra el sistema levantado (protocolo CUA de la skill testing) |
| Las instrucciones en prosa son **probabilísticas**; los "no debe pasar nunca" exigen mecanismos deterministas | El hook `guard-planning` bloquea a nivel de harness marcar tareas sin evidencia — no depende de que el modelo "se acuerde" |
| Los bucles degeneran sin **circuit breakers** (loops sin progreso, mismo error repetido) | 2 FAILs consecutivos del verifier en la misma tarea → parada; 2 tareas seguidas bloqueadas → parada |

## 2. Mapa de piezas (qué es cada fichero)

```
CLAUDE.md                          ← orientación que carga toda sesión: mapa, jerarquía, reglas de oro, paradas
.claude/
├─ skills/
│  ├─ dev-loop/SKILL.md            ← EL PROTOCOLO del bucle (la pieza central)
│  ├─ dev-help/                    ← esta guía
│  ├─ testing/  backend/  frontend/ ← las skills de CÓMO desarrollar (previas al arnés; el bucle las orquesta)
│  └─ (externas: pnpm, zod, postgres-drizzle, agent-browser, vercel-*, …)
├─ agents/
│  ├─ implementer.md               ← el que construye una tarea
│  └─ verifier.md                  ← el que la verifica y emite PASS/FAIL
├─ hooks/guard-planning.sh         ← guardia determinista: sin evidencia no hay [x]
└─ settings.json                   ← permisos (allowlist para no interrumpir el bucle) + registro del hook
docs/
├─ dev-loop/journal.md             ← diario del bucle: memoria entre sesiones
└─ verifications/<TASK-ID>/        ← evidencia de cada tarea cerrada (report.md + capturas/outputs)
planning.md                        ← fuente de verdad del estado: fases F0–F8 + FD (design system), tareas, deps, [x]
PRD.md                             ← el producto (qué se construye)
```

Y en el `package.json` raíz, **`pnpm gate`** = lint + typecheck + format:check + knip + test (unit+integración). Es el gate de merge local mientras no haya CI remota (decisión del 2026-07-07); `.github/workflows/ci.yml` existe pero está inerte hasta que haya remote en GitHub.

**Jerarquía cuando algo contradiga algo**: PRD/planning > skills propias (testing/backend/frontend) > skills externas. El arnés (dev-loop) orquesta; las skills propias definen el CÓMO técnico.

## 3. El ciclo de vida de una tarea (el bucle)

Cada tarea de `planning.md` pasa por 8 pasos (detalle canónico en `dev-loop/SKILL.md`):

1. **SELECT** — el bucle elige la siguiente tarea por el grafo `Depende de` (la numeración es orientativa). Antes de empezar comprueba si toca parar (⚠, gasto, juicio humano).
2. **BRIEF** — compone un encargo acotado: texto literal de la tarea + qué references de las skills leer (según sus tablas de decisión) + contexto vivo del journal. No se le pega el PRD entero al agente: lee lo que su tarea exige.
3. **IMPLEMENT** — un agente `implementer` NUEVO (contexto fresco) construye código + tests de esa tarea y entrega un informe estructurado. Tiene prohibido: tocar `planning.md` o `docs/verifications/`, debilitar tests, hacer commits, salirse del alcance.
4. **GATE** — el bucle re-ejecuta `pnpm gate` ÉL MISMO (no se fía del "me salió verde" del agente — en el piloto esto cazó un bug real de entorno). Rojo → de vuelta al implementer.
5. **REVIEW** — dos pases obligatorios sobre el diff (solo si la tarea produjo código; se saltan en tareas de solo-docs/skill), ANTES de VERIFY porque ambos mutan código y lo que VERIFY bendice debe ser lo que se commitea: (5a) `code-review` con esfuerzo proporcional al riesgo (low para diffs mecánicos, medium por defecto, high en orquestador/dinero/seguridad) — caza bugs; hallazgos de correctness/robustez → al implementer si están en alcance, deuda solo si fuera de alcance o diminutos; se re-gatea tras el fix. (5b) `simplify` — solo calidad (reuso/simplificación/eficiencia), auto-aplica cleanups; re-gate obligatorio inspeccionando su diff (no se acepta a ciegas: puede fundir un mecanismo load-bearing en un bug). Cada comando una vez, sin bucle entre ambos.
6. **VERIFY** — un agente `verifier` (fresco, escéptico) ejecuta la **Verificación literal** del planning contra el sistema levantado: con UI usa `agent-browser` como un humano; solo-backend usa curl/scripts/psql observables. Persiste evidencia en `docs/verifications/<ID>/` y emite PASS/FAIL. Máximo 2 FAIL seguidos → el bucle para e informa.
7. **CLOSE** — solo con PASS: marca `[x]` en planning (el hook exige que el report exista), anota el journal, cierra deudas `[verificar]` en PRD si tocaba, y commitea (`T<ID>: resumen`). Nunca hay push (no hay remote).
8. **STOP-CHECK** — ¿parada natural? Si no, siguiente tarea.

### Paradas del bucle (cuándo se detiene y te busca)

- **⚠ prerequisito externo** en la siguiente tarea (API keys, apps de developer TikTok/Meta, VPS…): son tuyos.
- **Fin de fase**: tras cerrar el E2E de fase (T1.10b, T2.6, T4.11, T5.9…), resumen y espera tu OK.
- **Juicio humano** en la Verificación ("a juicio humano", "revisión humana"): prepara lo automatizable y te pide el veredicto.
- **Gasto**: si la verificación puede superar el cap (estimado del planning ×3, mínimo $1) o usará APIs de pago sin estimación.
- **Circuit breaker**: 2 FAILs seguidos en la misma tarea, 2 tareas seguidas sin cerrarse, o el mismo error dos veces sin progreso.
- **Cambio de alcance mayor** (el PRD necesita un ajuste de producto): los menores se editan y anotan solos (regla 6 del planning); los mayores son tuyos.

## 4. Comandos que acepta el arnés

| Comando | Qué hace |
|---|---|
| `/dev-loop` | Bucle continuo hasta parada natural (el modo por defecto) |
| `/dev-loop task` | Exactamente UNA tarea (la siguiente elegible) y para |
| `/dev-loop task T0.5` | Esa tarea concreta (si sus dependencias están cerradas) |
| `/dev-loop phase` | Encadena hasta cerrar el E2E de la fase actual, incluido |
| `/dev-loop status` | Solo informa: estado, próxima tarea, bloqueos. No ejecuta nada |
| `/dev-help [pregunta]` | Esta guía |
| Lenguaje natural | "sigue/continúa con el desarrollo" ≡ `/dev-loop` · "¿cómo va?" ≡ status |

Internos (los usa el bucle, no hace falta que los invoques): la skill `code-review` en el paso 5, `agent-browser` en las verificaciones con UI, y las skills testing/backend/frontend como fuente de CÓMO desarrollar.

## 5. Los subagentes en detalle

**`implementer`** (`.claude/agents/implementer.md`) — recibe el brief de UNA tarea; lee los references vinculantes antes de codificar; los tests nacen con el código; entrega con las suites del paquete en verde y un informe (qué construyó, ficheros, tests, decisiones no obvias, dudas). Si una duda cambia el alcance, NO la resuelve: la reporta y para en punto estable. El bucle puede "continuarlo" (mantiene su contexto) para pasarle fallos del gate o hallazgos de la review.

**`verifier`** (`.claude/agents/verifier.md`) — mandato escéptico: "tu éxito se mide por fallos legítimos encontrados, no por PASS emitidos". Prohibido modificar código de producto (solo escribe evidencia); prohibido rebajar la Verificación (si pide 20 runs concurrentes, son 20); prohibido "convencerse de que un problema no es para tanto" — todo problema va al report y bloquea el PASS. Sigue el protocolo de `testing/references/cua.md` (sistema entero levantado, waits por condición, evidencia antes del veredicto).

**Por qué separados**: sesgo de auto-aprobación documentado (§1). Además cada uno arranca con contexto fresco — el implementer no arrastra deriva de tareas anteriores, y el verifier no hereda las suposiciones del implementer.

Nota operativa: los agentes definidos a mitad de sesión no se registran hasta reiniciar Claude Code. Si `/dev-loop` no los encuentra, el fallback es usar `general-purpose` con la definición del agente inlineada en el prompt (así se ejecutó el piloto).

## 6. Guardrails deterministas (lo que NO depende de que el modelo se porte bien)

- **`guard-planning.sh`** (hook PreToolUse sobre Edit/Write): si una edición añade `[x]` al heading de una tarea (`#### T<ID> … [x]`) y no existe `docs/verifications/<ID>/report.md`, el hook **bloquea la edición** con mensaje. Las subtareas (`- [x]`) no exigen evidencia; las fechas `[2026-…]` no disparan falsos positivos (regex estricta). Probado en ambos sentidos.
- **Permisos** (`settings.json`): allowlist de comandos de desarrollo (pnpm, npx, git local, docker, curl, psql…) para que el bucle no se pare en prompts; `git push` **denegado** (no hay remote; cuando lo haya, quitar el deny será parte de la tarea de CI); lectura de `.env*.local` (claves reales) **denegada**.
- **`pnpm gate` re-ejecutado por el bucle**: el veredicto de calidad no es del agente que implementó.
- **Guards ruidosos en scripts prematuros**: `pnpm test:live` falla con mensaje hasta T1.8 (cuando llegue el techo de gasto `LIVE_BUDGET_USD`) y `pnpm test:e2e` hasta T0.4 (cuando exista Playwright) — antes eran silencios peligrosos (uno podía gastar dinero sin límite, el otro daba verde sin ejecutar nada).

## 7. Evidencia: la regla central

**"La evidencia precede a la marca."** Ninguna tarea está hecha porque lo diga un agente ni porque compile: está hecha cuando su Verificación (el campo literal de `planning.md`) se ejecutó contra el sistema real y quedó rastro auditable en `docs/verifications/<TASK-ID>/`:

- `report.md` con la plantilla de `testing/references/cua.md`: verificación esperada (cita literal), pasos ejecutados, tabla esperado/observado/evidencia, coste real, veredicto.
- Ficheros crudos: screenshots numerados (si hay UI), outputs de terminal (`| tee`), logs.
- Los FAIL también se documentan (`report-fail-N.md`): valen tanto como los PASS.
- Todo se commitea: es la memoria del proyecto y la base de la conciliación de costes (T7.6).

Ejemplo real: `docs/verifications/T0.1/` (build.txt, dev.log, health.json, worker-ready.json, broken-compile.txt, restored-compile.txt, report.md).

## 8. Presupuesto y costes

- La suite de tests **jamás** gasta dinero (mocks msw + fixtures; regla de la skill testing).
- Las verificaciones desde F1 sí pueden gastar (Firecrawl, Anthropic, fal). Cap por tarea = **estimado del planning ×3, mínimo $1**. Si va a superarse → parada de gasto y decisión tuya.
- Todo coste real va al report y al journal; si difiere >25 % del estimado, se recalibra en la misma tarea (regla 5 del planning).

## 9. Cómo intervenir tú

- **Ver dónde está todo**: `/dev-loop status` o `/dev-help`.
- **Avanzar con control fino**: `/dev-loop task` (de una en una) hasta que cojas confianza; luego `/dev-loop`.
- **Resolver un ⚠**: los prerequisitos externos (crear apps de developer, montar el VPS, poner API keys) son tuyos; el planning los marca con ⚠. Cuando lo resuelvas, díselo al bucle y continúa.
- **Si el bucle paró por circuit breaker**: el journal y el último report del verifier explican la causa; decide tú (arreglar a mano, re-plantear la tarea, o pedirle al bucle que reintente con contexto nuevo).
- **Cuestionar una decisión del arnés**: el arnés evoluciona deliberadamente — pide el cambio y quedará editado en la skill/agente correspondiente con nota en el journal (nunca deriva silenciosa).
- **Interrumpir**: puedes cortar en cualquier momento; el estado durable (planning + journal + git) garantiza que la siguiente sesión retoma sin pérdida. No dejes a medias un CLOSE (si ves planning marcado sin commit, el journal lo aclara).
- **Añadir GitHub/CI más adelante**: pídelo como tarea explícita — activar remote, branch protection con `ci-ok`, y retirar el deny de `git push`. El `ci.yml` ya está listo.

## 10. Historia y decisiones fundacionales (2026-07-07)

- **Decisiones tuyas** (vinculantes): bucle continuo con paradas · git LOCAL sin CI remota por ahora (gate = `pnpm gate`) · cap de gasto ×3 · el arnés se validó con el piloto T0.1 el mismo día.
- **Piloto T0.1** (monorepo + tooling + logging + healthcheck): el ciclo completo funcionó y demostró su valor — el GATE re-ejecutado cazó un fallo de entorno real (máquina con shells Rosetta x64 + node arm64 vía nvm; fix: `supportedArchitectures` en pnpm), y la REVIEW (6 ángulos) encontró 4 bugs de correctness confirmados (crash del worker en prod con `LOG_PRETTY=1`, `/api/health` 500 permanente con `LOG_LEVEL` inválido, percent-encoding en golden files, race del flush de pino en shutdown) más los dos falsos verdes de §6. Coste $0. PASS del verifier a la primera tras los fixes.
- **Desfases de skills detectados y corregidos** en la misma sesión (regla 6): `tooling.md` (eslint-config-next ≥16 es flat nativo, sin FlatCompat; react-hooks ≥7) y `stack-setup.md` (`expectGolden` con `fileURLToPath`).
- **Particularidades de esta máquina**: Apple Silicon con terminal bajo Rosetta y nvm mixto (22-arm64 default, 24-x64 en `.nvmrc`); el gate es verde en ambos mundos gracias a `supportedArchitectures`. Docker Desktop debe estar arrancado desde T0.2.

## 11. FAQ rápido

- **¿Por qué tardó tanto la primera vez?** Costes de una sola vez: investigación + construcción del arnés + T0.1 (la tarea más grande del planning) + review a máxima potencia. El régimen normal es más corto y la review escala con el riesgo del diff.
- **¿El bucle puede "hacer trampa" y marcar cosas sin verificar?** El hook lo bloquea a nivel de harness, y quien emite el PASS nunca es quien implementó.
- **¿Puede gastar dinero sin que me entere?** No: la suite no gasta por diseño, `test:live` está desarmado hasta que exista el techo de gasto, y las verificaciones con coste tienen cap y paran para preguntarte si lo superan. Todo dólar queda anotado.
- **¿Qué pasa si cierro la sesión a mitad de una tarea?** Nada grave: el trabajo no committeado queda en el árbol y el journal explica el estado; la siguiente sesión hace bootstrap (git status + planning + journal) y entiende dónde estaba.
- **¿Dónde veo lo que se ha hecho?** `git log --oneline`, `planning.md` (marcas con fecha y puntero a evidencia), `docs/dev-loop/journal.md` (la narrativa) y `docs/verifications/` (las pruebas).
- **¿Próxima tarea?** Mira el Estado global de `planning.md`; a fecha de este documento: TD.1 (tokens + showcase de la fase FD — design system; decisión 2026-07-07: FD entera antes de continuar F0). Después, T0.2 (Docker Compose + Postgres, requiere Docker arrancado). Primera parada ⚠ prevista: T0.13 (VPS).
