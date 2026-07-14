#!/usr/bin/env node
// Regenera la tabla de estado del README raíz a partir de planning.md — la única
// fuente de verdad del progreso. La portada del repo no puede mentir sobre en qué
// punto está el desarrollo, y mantenerla a mano garantiza que un día mentirá.
//
//   pnpm readme:status        reescribe el bloque
//   pnpm readme:status --check  falla si está desfasado (lo usa el gate)
//
// Solo toca lo que hay entre los marcadores STATUS-TABLE. El resto del README
// (motivación, diagramas, quickstart) es prosa: la escribe un humano.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import prettier from 'prettier';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLANNING = join(ROOT, 'planning.md');
const README = join(ROOT, 'README.md');

const BEGIN = '<!-- STATUS-TABLE:BEGIN — generado por `pnpm readme:status`, no editar a mano -->';
const END = '<!-- STATUS-TABLE:END -->';

// Qué entrega cada fase, en una línea. Es la única prosa del bloque generado, y
// vive aquí porque planning.md la escribe para el desarrollador, no para el visitante.
const DELIVERS = {
  F0: 'Orquestador DAG, auth, storage, colas, SSE, canvas, ledger de gasto',
  FD: 'Design system: ~26 primitivas, dark/light, 4 acentos',
  F1: 'URL/texto → ProductBrief editable y aprobable en CP1',
  F1b: 'Deuda de cierre de F1',
  F1c: 'Deuda del primer uso real',
  F2: 'Matriz con coste estimado → guiones aprobados',
  F3: 'Templates facetados → prompts auditables',
  F4: 'Los assets de una variante, generados de verdad en fal.ai',
  F5: 'El anuncio 9:16 completo, con subtítulos, C2PA y QA',
  F6: 'Publicar en TikTok/IG y crear el ad draft',
  F7: 'Métricas por variante + kill/scale + scoring',
  F8: 'Backups, retención, observabilidad, MCP',
};

/** Recorre planning.md agrupando las cabeceras `#### T…` bajo su `## F…`. */
function parsePlanning(md) {
  const phases = [];
  let current = null;

  for (const line of md.split('\n')) {
    const phase = line.match(/^## (F[\dA-Za-z]+) — (.+)$/);
    if (phase) {
      current = { id: phase[1], name: phase[2], done: 0, total: 0 };
      phases.push(current);
      continue;
    }
    // "## Reglas de trabajo" y demás cierran la fase en curso.
    if (line.startsWith('## ')) current = null;

    // Ojo con las mayúsculas: las tareas del design system son `TD.1`, no `T1.1`.
    const task = line.match(/^#### (T[\w.]+) ·/);
    if (task && current) {
      current.total += 1;
      // Una tarea cerrada lleva `[x]` en su propia cabecera.
      if (/\[x\]/.test(line)) current.done += 1;
    }
  }
  return phases.filter((p) => p.total > 0);
}

function statusCell({ done, total }) {
  if (done === total) return '✅ Completa';
  if (done === 0) return '⬜ No empezada';
  return `🔨 ${done}/${total}`;
}

function render(phases) {
  const done = phases.reduce((n, p) => n + p.done, 0);
  const total = phases.reduce((n, p) => n + p.total, 0);
  const pct = Math.round((done / total) * 100);

  const rows = phases.map((p) => {
    const delivers = DELIVERS[p.id] ?? p.name;
    return `| **${p.id}** · ${p.name.split(' (')[0]} | ${delivers} | ${statusCell(p)} |`;
  });

  return [
    BEGIN,
    '',
    `**${done} de ${total} tareas cerradas (${pct} %).**`,
    '',
    '| Fase | Qué entrega | Estado |',
    '| --- | --- | --- |',
    ...rows,
    '',
    END,
  ].join('\n');
}

const phases = parsePlanning(readFileSync(PLANNING, 'utf8'));
if (phases.length === 0) {
  console.error('readme:status — no se encontró ninguna fase en planning.md. ¿Cambió el formato?');
  process.exit(1);
}

const readme = readFileSync(README, 'utf8');
const start = readme.indexOf(BEGIN);
const end = readme.indexOf(END);
if (start === -1 || end === -1) {
  console.error(`readme:status — faltan los marcadores en README.md:\n  ${BEGIN}\n  ${END}`);
  process.exit(1);
}

// Formatea con el Prettier del repo antes de comparar o escribir. Sin esto, el
// script genera tablas sin alinear, `format:check` las rechaza, y el hook de
// pre-commit las reformatea POR DETRÁS del gate — el desfase exacto que este
// script existe para impedir. Una sola autoridad sobre el formato: Prettier.
const raw = readme.slice(0, start) + render(phases) + readme.slice(end + END.length);
const options = await prettier.resolveConfig(README);
const next = await prettier.format(raw, { ...options, filepath: README });

if (process.argv.includes('--check')) {
  if (next !== readme) {
    console.error(
      'readme:status — la tabla de estado del README está DESFASADA respecto a planning.md.\n' +
        'Corre `pnpm readme:status` y commitea el resultado.',
    );
    process.exit(1);
  }
  console.log('readme:status — la tabla del README coincide con planning.md ✓');
} else {
  writeFileSync(README, next);
  const done = phases.reduce((n, p) => n + p.done, 0);
  const total = phases.reduce((n, p) => n + p.total, 0);
  console.log(`readme:status — tabla regenerada: ${done}/${total} tareas.`);
}
