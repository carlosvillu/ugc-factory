#!/usr/bin/env python3
"""Guardia anti-ficción del bucle de desarrollo (hook PreToolUse sobre Edit|Write).

Bloquea (exit 2) cualquier edición que marque una tarea de planning.md como [x]
cuando su docs/verifications/<TASK-ID>/report.md falta O no acredita un control
negativo — la evidencia precede a la marca (skill testing, references/cua.md paso
4). Determinista a propósito: las instrucciones en prosa son probabilísticas; esto
no.

Dos condiciones sobre el report.md, ambas obligatorias para cerrar:
  1. EXISTE (la garantía original — cero cierres sin evidencia desde que existe).
  2. CONTIENE una sección "## Control negativo" no vacía con prueba de que un
     test se puso ROJO al reintroducir el bug (evidencia FAIL/ROJO/AssertionError),
     o un "N/A — <motivo auditable>" para tareas sin superficie de test.

El punto 2 sube al escalón mecánico el principio 9 de la skill testing ("el arnés
nunca puede ser más cómodo que la realidad"): un test que nadie ha visto fallar no
cierra tarea. La regla lleva ≥10 instancias en el journal PESE a existir en prosa
desde 2026-07-12; por eso pasa a hook (auditoría del journal, 2026-07-23).
"""
import json
import os
import re
import sys


# Sección "## Control negativo" (uno o más #). Captura su cuerpo hasta el próximo
# heading del mismo o menor nivel, o el fin de fichero.
_NEG_CONTROL_RE = re.compile(
    r"^#{2,}\s*Control\s+negativo\s*$(.*?)(?=^#{1,6}\s|\Z)",
    re.M | re.S | re.I,
)
# Evidencia de que un test se puso en rojo al reintroducir el bug.
_RED_EVIDENCE_RE = re.compile(
    r"FAIL|ROJO|failed|✗|×|AssertionError|Expected|toBe|toEqual|assert",
    re.I,
)
# Escape auditable para tareas sin superficie de test (docs, config, tooling).
# Exige un motivo sustantivo tras "N/A —" (≥12 caracteres), no un "N/A" pelado.
_NA_RE = re.compile(r"^\s*N/?A\s*[—:-]\s*\S.{11,}", re.M | re.I)


def _negative_control_ok(report_path: str) -> bool:
    """True si el report acredita un control negativo (rojo real o N/A justificado)."""
    try:
        text = open(report_path, encoding="utf-8").read()
    except OSError:
        return False
    sec = _NEG_CONTROL_RE.search(text)
    if not sec:
        return False
    body = sec.group(1).strip()
    if not body:
        return False
    return bool(_RED_EVIDENCE_RE.search(body) or _NA_RE.search(body))


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0  # sin input parseable no hay nada que vigilar

    tool_input = data.get("tool_input", {}) or {}
    file_path = tool_input.get("file_path", "") or ""

    if os.path.basename(file_path) != "planning.md":
        return 0

    # Texto nuevo que introduce la edición: Edit (new_string), Write (content),
    # MultiEdit (edits[].new_string).
    parts = []
    if tool_input.get("new_string"):
        parts.append(tool_input["new_string"])
    if tool_input.get("content"):
        parts.append(tool_input["content"])
    for e in tool_input.get("edits", []) or []:
        if e.get("new_string"):
            parts.append(e["new_string"])
    new_text = "\n".join(parts)
    if not new_text:
        return 0

    project_dir = os.path.dirname(os.path.abspath(file_path))
    missing = []
    no_neg_control = []
    # Solo headings de tarea (#### T0.1 · ... / #### TD.1 · ...) con [x] literal.
    # Las subtareas "- [x]" no exigen evidencia (se marcan durante el trabajo);
    # las fechas tipo [2026-07-07] no matchean (regex estricta \[x\]).
    for m in re.finditer(r"^####\s+(T\d+\.\d+[ab]?|TD\.\d+)\b.*\[x\]", new_text, re.M):
        task_id = m.group(1)
        report = os.path.join(project_dir, "docs", "verifications", task_id, "report.md")
        if not os.path.isfile(report):
            missing.append(task_id)
        elif not _negative_control_ok(report):
            no_neg_control.append(task_id)

    if missing:
        ids = ", ".join(sorted(set(missing)))
        print(
            f"BLOQUEADO por el arnés: se intenta marcar [x] {ids} sin "
            f"docs/verifications/<ID>/report.md. La evidencia precede a la marca "
            f"(skill testing, references/cua.md). Ejecuta la Verificación con el "
            f"agente verifier, persiste el report y vuelve a intentarlo.",
            file=sys.stderr,
        )
        return 2

    if no_neg_control:
        ids = ", ".join(sorted(set(no_neg_control)))
        print(
            f"BLOQUEADO por el arnés: el report.md de {ids} no acredita un CONTROL "
            f"NEGATIVO. Añade una sección '## Control negativo' con la prueba de que "
            f"un test se puso ROJO al reintroducir el bug (pega la salida FAIL), o, si "
            f"la tarea no añade tests, escribe 'N/A — <motivo auditable>'. Un test que "
            f"nadie ha visto fallar no cierra tarea (skill testing, principio 9).",
            file=sys.stderr,
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
