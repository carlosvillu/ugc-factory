# TD.6 — Verificación: PASS

**Tarea**: Reglas ESLint de adherencia al Design System en `eslint.config.ts` (§5b, scope `apps/web/**/*.{ts,tsx}`).

**Verificación literal (planning.md)**:
> un fichero de prueba con `bg-blue-500`, `text-[#fff]` e `import { X } from 'lucide-react'` hace fallar `pnpm lint` con mensajes que nombran la regla violada; al retirarlo, `pnpm gate` queda verde.

**SHA base**: HEAD = `952dd9a` (TD.4). Diff en working tree: `eslint.config.ts` (+116, bloque §5b), `foundation-specimens.tsx` (`w-[70px]`→`w-17.5`), `journal.md`. El código que corre es el del diff; probes creados y retirados sin alterar el estado del implementer.

## Resultado por punto

### 1. Verificación literal — el probe hace fallar el lint (evidencia: `lint-probe-literal.txt`)
Probe `apps/web/src/td6-probe.tsx` con `import { X } from 'lucide-react'` y `className="bg-blue-500 text-[#fff]"`.
`pnpm exec eslint` → **exit 1**, mensajes que nombran cada regla:

| Línea | Regla | Mensaje |
|---|---|---|
| 1:1 | `no-restricted-imports` | "Librería de iconos prohibida … §3.7" |
| 5:20 | `no-restricted-syntax` | "Paleta cruda de Tailwind prohibida …" (`bg-blue-500`) |
| 5:20 | `no-restricted-syntax` | "Valor arbitrario prohibido …" (`text-[#fff]`) |

(`import-x/no-unresolved` sobre `lucide-react` también aparece — lib no instalada, ruido esperado.) Las TRES reglas disparan con mensaje nominativo. **OK.**

### 2. Al retirar el probe, `pnpm gate` verde (evidencia: `gate-no-probe.txt`)
`rm` del probe → `pnpm gate` = **exit 0** (lint + typecheck + format:check + knip + test 35/35). Reconfirmado 2ª pasada. **OK.**

### 3. Robustez — falsos positivos / negativos (evidencia: `lint-robustness.txt`)

**Legítimos (NO deben disparar)** — `td6-probe-legit.tsx`: **0 errores**.

| Patrón | Fired? |
|---|---|
| `[--pulse-color:var(--color-warning-border)]` | NO ✓ |
| `focus-visible:[&_[data-slot=checkbox-indicator]]:ring-3` | NO ✓ |
| `size-4.5` | NO ✓ |
| `data-[checked]:bg-accent` | NO ✓ |
| `w-17.5` | NO ✓ |
| `import … from '@base-ui-components/react/checkbox'` | NO ✓ (permitido) |

**Ilegítimos (SÍ deben disparar)** — `td6-probe-bad.tsx`: **todos disparan**.

| Patrón | Fired? |
|---|---|
| `[color:#fff]` | SÍ ✓ (no-restricted-syntax) |
| `transition-[width]` | SÍ ✓ (no-restricted-syntax) |
| `import … from '@fortawesome/free-solid-svg-icons'` | SÍ ✓ (no-restricted-imports) |

Sin falsos positivos ni negativos. **OK.**

## Coste real
$0 (solo lint/typecheck local). Estimado: $0.

## Rarezas
- `text-[#fff]` dispara DOS mensajes (paleta cruda + valor arbitrario) por solape de selectores; correcto, la Verificación solo exige "nombrar la regla violada".
- `import-x/no-unresolved` acompaña a imports de libs de iconos no instaladas; ruido ortogonal a la regla de adherencia.

**Veredicto: PASS.**

_(Report persistido por el bucle principal: el harness bloquea la Write en subagentes para este path; contenido literal emitido por el verifier. Evidencias crudas en `lint-probe-literal.txt`, `gate-no-probe.txt`, `lint-robustness.txt`.)_
