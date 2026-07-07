# Journal del dev-loop — UGC Factory

> Memoria del bucle entre sesiones. Append cronológico; una entrada por evento (tarea cerrada, bloqueo, parada, decisión de arnés). Escribe para el agente que retomará el trabajo sin tu contexto. Formato en `.claude/skills/dev-loop/SKILL.md`.

## 2026-07-07 · Arnés de desarrollo creado
- Sesión de diseño: investigación del estado del arte (deep-research, 13 hallazgos verificados) + inventario de capacidades de Claude Code.
- Piezas: CLAUDE.md · skill `dev-loop` · agentes `implementer`/`verifier` · hook `guard-planning` (bloquea `[x]` sin evidencia, testeado con 5 casos) · settings con allowlist y `defaultMode: acceptEdits` · este journal.
- Decisiones del usuario: bucle continuo con paradas · git local SIN CI remota por ahora (gate = `pnpm gate` local espejo de `ci-ok`; `ci.yml` se crea igualmente en T0.1, inerte hasta que exista remote) · cap de gasto por tarea = estimado ×3 (mín. $1).
- Deuda del arnés: cuando exista remote de GitHub → activar CI + branch protection (tarea explícita); reevaluar si `pnpm gate` sigue siendo el gate de merge.
- Próximo paso: piloto T0.1 con el bucle completo.

## 2026-07-07 · ⏳ T0.1 iniciada (piloto del arnés)
- Primera ejecución real del ciclo dev-loop completo. Sin dependencias previas; coste esperado $0.

## 2026-07-07 · T0.1 cerrada — PASS
- Coste: $0 · Ciclos verifier: 1 (PASS a la primera tras review) · Tests: 27 en 6 suites · Evidencia: docs/verifications/T0.1/
- Ciclo completo del arnés ejercitado: implement → gate (cazó binding nativo x64/arm64: Rosetta+nvm mixto; fix = supportedArchitectures en pnpm-workspace.yaml) → review 6 ángulos (4 bugs correctness confirmados: LOG_PRETTY crasheaba worker prod, LOG_LEVEL inválido tumbaba /api/health, golden.ts percent-encoding+catch tragón, exit(0) racea flush de pino; + test:live sin budget guard y test:e2e falso verde, desarmados con guards ruidosos hasta T1.8/T0.4) → verify → close.
- Máquina: shells bajo Rosetta (uname x86_64) con nvm mixto (22-arm64 default, 24-x64 en .nvmrc). El gate ya es verde en ambos mundos.
- Arnés: agentes implementer/verifier aún no registrados en la sesión que los creó (requieren reinicio) — fallback general-purpose con definición inlineada funcionó; desde la próxima sesión se usan directos.
- Skills actualizadas deliberadamente: tooling.md §2 (eslint-config-next ≥16 flat nativo, sin FlatCompat; react-hooks ≥7) y stack-setup.md §4.5 (expectGolden con fileURLToPath, nunca .pathname). La skill externa pnpm no documenta supportedArchitectures (hueco conocido).
- Deuda anotada: tsup no typechequea (la rotura del worker la caza pnpm typecheck del gate — comportamiento estándar); pnpm -r --parallel typecheck aborta al primer fallo (evidencia de fallos múltiples exige --filter aislado).
