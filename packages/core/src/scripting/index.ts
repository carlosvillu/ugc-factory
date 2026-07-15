// API pública del módulo `scripting` (T2.4, PRD §9.4 / §7.2 N5): el ScriptWriter (N5) y su timing
// determinista. Subpath `@ugc/core/scripting`.
//
// El módulo hace RED (una llamada a Sonnet 5 por GRUPO de variantes) + CPU (armar el prompt,
// parsear, calcular el timing y los subtítulos). La persistencia y el `cost_entry` viven en
// `@ugc/services` (`write-scripts.ts`) — la misma frontera que N3 (T1.8).
export {
  makeScriptWriter,
  groupVariantsForScripting,
  buildScriptUserMessage,
  assembleScript,
  hookBijectionProblem,
  budgetViolation,
  placeholderValuesFor,
  SCRIPT_WRITER_MODEL,
  VARIATION_INSTRUCTIONS,
  type ScriptWriter,
  type ScriptWriterDeps,
  type ScriptWriterResult,
  type ScriptWriterStatus,
  type ScriptGroup,
  type ScriptDraft,
  type WriteScriptsInput,
} from './script-writer';
// El TIMING DURO (§7.2 N5: `word_count ÷ 2,5`). Puro, determinista, $0 — y NUNCA se le pide al
// LLM: el modelo escribe texto, los segundos los contamos nosotros.
export {
  computeSceneTiming,
  subtitlesFromScenes,
  wordBudgetFor,
  estSecondsOf,
  fullTextOf,
  totalWords,
  wordsInSegment,
  MIN_SCENE_SECONDS,
  type DraftScene,
} from './timing';
