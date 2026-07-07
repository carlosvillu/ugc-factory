# UGC Factory

Plataforma personal (mono-usuario, self-hosted) de generación de anuncios UGC con IA: URL/texto → ProductBrief → matriz de variantes → guiones → generación fal.ai → composición FFmpeg → publicación TikTok/IG → métricas. El desarrollo lo ejecuta un **bucle autónomo de agentes** gobernado por la skill `dev-loop`.

## Mapa de documentos (fuentes de verdad)

| Documento | Qué es |
|---|---|
| `PRD.md` | El producto completo (v1, aprobado 2026-07-06). §9.0 orquestador, §12 modelo de datos, Apéndice E API |
| `planning.md` | **La fuente de verdad del estado del desarrollo**: fases F0–F8 → tareas con `Depende de` + Verificación observable. Las reglas de trabajo del final son vinculantes |
| `.claude/skills/{testing,backend,frontend}` | CÓMO se desarrolla y testea. Cada SKILL.md tiene una tabla de decisión → reference a leer ANTES de escribir código |
| `research/` | Informes que respaldan el PRD (solo consulta, no editar) |
| `docs/verifications/<TASK-ID>/` | Evidencia de cierre de cada tarea (report.md + capturas/outputs) |
| `docs/dev-loop/journal.md` | Diario del bucle: qué se cerró/bloqueó, cuándo, coste, rarezas |

**Jerarquía cuando algo contradiga algo**: PRD/planning > skills propias (testing/backend/frontend) > skills externas > costumbre. Si una pieza no encaja en las skills propias, o está mal planteada o la skill necesita actualización deliberada — nunca las dos cosas en silencio.

## El bucle de desarrollo

El trabajo avanza tarea a tarea de `planning.md` vía la skill **`dev-loop`** (invócala con `/dev-loop` o cuando el usuario pida "sigue/continúa con el desarrollo"). No improvises un proceso alternativo: el protocolo (selección de tarea, subagentes implementer/verifier, gates, cierre) vive ahí. Para preguntas sobre el arnés mismo (cómo funciona, comandos, por qué se paró, onboarding), la skill **`dev-help`** es el punto de entrada.

### Reglas de oro (resumen; el detalle en la skill)

1. **Una tarea por ciclo, contexto fresco.** Cada tarea la implementa un subagente `implementer` nuevo con un brief acotado. Nunca "adelantar" trabajo de otras tareas en el mismo ciclo.
2. **La evidencia precede a la marca.** Ninguna tarea se marca `[x]` sin `docs/verifications/<ID>/report.md` con veredicto PASS (un hook lo bloquea a nivel de harness). La Verificación se ejecuta LITERAL, sin rebajarla.
3. **Quien implementa no se evalúa a sí mismo.** El gate de cierre lo ejecuta el subagente `verifier` (escéptico, con contexto fresco); el implementer jamás toca `planning.md` ni `docs/verifications/`.
4. **`pnpm test` verde antes del gate; gate local completo antes de commit.** Sin CI remota (decisión 2026-07-07), el gate local espejo de `ci-ok` es EL gate: `pnpm gate` (lint + typecheck + format:check + knip + test; + test:e2e si hubo superficie web).
5. **Prohibido debilitar tests para ponerse en verde.** Borrar/relajar un test existente solo con justificación explícita en el journal y en el mensaje de commit. Un test flaky se arregla o se borra con causa raíz, no se reintenta.
6. **Coste consciente.** Cap por tarea = estimado del planning ×3 (mín. $1). Superarlo = parada de gasto. Todo coste real va al report y al journal (regla de trabajo 5 del planning).
7. **Cambios de alcance** (el PRD necesita ajuste): menores → editar PRD+planning en la misma sesión y anotarlo (regla 6); mayores → parar y preguntar al usuario.

### Paradas del bucle (informar al usuario y detenerse)

- Prerequisito externo ⚠ en la siguiente tarea (API keys, apps de developer, VPS, presupuesto real).
- Fin de fase: tras cerrar el E2E de fase, presentar resumen y esperar OK.
- Verificación que exige juicio humano explícito ("revisión humana", "a juicio humano"): hacer lo automatizable, dejar la evidencia preparada y pedir el juicio.
- Circuit breaker: 2 FAIL consecutivos del verifier en la misma tarea, o 2 tareas seguidas bloqueadas.
- Decisión de gasto por encima del cap.

## Arranque de sesión (bootstrap)

Antes de tocar nada: (1) `git log --oneline -5`, (2) estado de `planning.md` (próxima tarea elegible por el grafo `Depende de`), (3) tail de `docs/dev-loop/journal.md`. Con eso se retoma el trabajo sin depender del contexto de sesiones anteriores.

## Convenciones transversales

- Código, identificadores y mensajes de commit en inglés; docs del proyecto, UI y comunicación en español.
- Commits solo en verde (gate local), como mínimo uno por tarea cerrada: `T<ID>: <resumen imperativo>`. Nunca `git push` (no hay remote; cuando exista, activar CI + branch protection será una tarea explícita).
- Stack y scripts canónicos: los define la skill backend (`references/tooling.md` §8) + testing (`stack-setup.md` §6). `pnpm gate` es el único script propiedad del arnés.
- Los `[verificar]` del PRD se cierran en la tarea que los nombra y se anotan en PRD y planning (regla de trabajo 3).
