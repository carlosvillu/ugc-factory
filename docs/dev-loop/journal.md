# Journal del dev-loop — UGC Factory

> Memoria del bucle entre sesiones. Append cronológico; una entrada por evento (tarea cerrada, bloqueo, parada, decisión de arnés). Escribe para el agente que retomará el trabajo sin tu contexto. Formato en `.claude/skills/dev-loop/SKILL.md`.

## 2026-07-07 · Arnés de desarrollo creado
- Sesión de diseño: investigación del estado del arte (deep-research, 13 hallazgos verificados) + inventario de capacidades de Claude Code.
- Piezas: CLAUDE.md · skill `dev-loop` · agentes `implementer`/`verifier` · hook `guard-planning` (bloquea `[x]` sin evidencia, testeado con 5 casos) · settings con allowlist y `defaultMode: acceptEdits` · este journal.
- Decisiones del usuario: bucle continuo con paradas · git local SIN CI remota por ahora (gate = `pnpm gate` local espejo de `ci-ok`; `ci.yml` se crea igualmente en T0.1, inerte hasta que exista remote) · cap de gasto por tarea = estimado ×3 (mín. $1).
- Deuda del arnés: cuando exista remote de GitHub → activar CI + branch protection (tarea explícita); reevaluar si `pnpm gate` sigue siendo el gate de merge.
- Próximo paso: piloto T0.1 con el bucle completo.
