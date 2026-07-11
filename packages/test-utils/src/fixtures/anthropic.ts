// Fixtures de AUTORÍA de la API de Anthropic Messages para el VisualAnalyzer (T1.7). Espejan
// la forma REAL de una respuesta de `messages.parse` (POST /v1/messages): un `content` con un
// bloque de texto cuyo texto ES el JSON del structured output P3, más un bloque `usage`. NO
// son grabaciones — cero red real en la suite (skill testing): un análisis real gasta dinero.
//
// El structured output se serializa como el TEXTO del bloque `text` (el SDK lo parsea con el
// zodOutputFormat → parsed_output). El schema P3 (visual-analyzer.ts) es: images[] (kind /
// has_overlay_text / background / video_suitability, SIN url), brand_style, rendered_social_proof.

/** Respuesta feliz: 3 imágenes clasificadas (una 'hero'), paleta VLM, social proof.
 *  Es lo que Haiku devolvería sobre un screenshot + 3 imágenes de producto. */
export const ANTHROPIC_P3_HAPPY_OUTPUT = {
  images: [
    { kind: 'packshot', has_overlay_text: false, background: 'clean', video_suitability: 'hero' },
    { kind: 'lifestyle', has_overlay_text: false, background: 'busy', video_suitability: 'broll' },
    {
      kind: 'chart_or_text',
      has_overlay_text: true,
      background: 'busy',
      video_suitability: 'unusable',
    },
  ],
  brand_style: {
    palette: ['#0EA5A4', '#F8FAFC', '#F59E0B'],
    aesthetic: 'minimalista clínico con acentos cálidos',
    photography_style: 'packshot sobre fondo limpio',
  },
  rendered_social_proof: {
    rating: 4.8,
    review_count: 2130,
    quotes: ['Mi piel cambió en dos semanas', 'Vale cada euro'],
  },
} as const;

/** Respuesta con social proof y brand_style nulos (una landing sin prueba social visible y
 *  sin screenshot para leer el tono). Solo clasifica una imagen. */
export const ANTHROPIC_P3_NO_SOCIAL_OUTPUT = {
  images: [
    { kind: 'packshot', has_overlay_text: false, background: 'clean', video_suitability: 'hero' },
  ],
  brand_style: null,
  rendered_social_proof: null,
} as const;

/** Construye un cuerpo de respuesta Messages API válido a partir de un output P3. El `text`
 *  del bloque es el JSON serializado (lo que `messages.parse` parsea a parsed_output). `usage`
 *  con tokens realistas de una llamada de visión Haiku (miles de input por la imagen). */
export function anthropicMessageResponse(
  output: unknown,
  usage: Partial<{
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  }> = {},
): Record<string, unknown> {
  return {
    id: 'msg_test_0001',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: [{ type: 'text', text: JSON.stringify(output) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: usage.input_tokens ?? 1500,
      output_tokens: usage.output_tokens ?? 220,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    },
  };
}

/** Respuesta de REFUSAL (stop_reason='refusal', content vacío): el SDK deja parsed_output=null
 *  (no hay bloque de texto que parsear). Observable #5: el VisualAnalyzer lo maneja tipado
 *  (status='refused'), no crashea. Lleva usage (se pagaron los tokens de input). */
export function anthropicRefusalResponse(): Record<string, unknown> {
  return {
    id: 'msg_test_refusal',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: [],
    stop_reason: 'refusal',
    stop_sequence: null,
    usage: {
      input_tokens: 1400,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

/** Respuesta con un bloque de texto que NO es JSON válido según el schema P3 (texto libre):
 *  `messages.parse` LANZA al intentar parsear. Observable #5 (rama parse_error): el
 *  VisualAnalyzer captura la excepción y devuelve status='parse_error', no crash. */
export function anthropicMalformedResponse(): Record<string, unknown> {
  return {
    id: 'msg_test_malformed',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5',
    content: [{ type: 'text', text: 'no puedo devolver JSON aquí, lo siento' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 1400,
      output_tokens: 30,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

// ── Fixtures del BriefSynthesizer (T1.8, P4) ────────────────────────────────────────────────
// El structured output de la síntesis es el ProductBrief COMPLETO (contrato T1.1). El fixture
// feliz se construye con `makeBrief()` (misma factory que usan los tests de contrato: un solo
// sitio donde vive un brief válido). Aquí solo viven los ENVOLTORIOS de respuesta Messages API y
// las variantes INVÁLIDAS a propósito, que son las que prueban la red de seguridad Zod.

/** Cuerpo de respuesta Messages API para la síntesis. `model` = claude-sonnet-5 (T1.8). Los
 *  `usage` por defecto son realistas de una síntesis: input grande (markdown + system cacheado),
 *  output de unos miles de tokens (el brief). */
export function anthropicBriefResponse(
  brief: unknown,
  usage: Partial<{
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  }> = {},
): Record<string, unknown> {
  return {
    id: 'msg_test_brief_0001',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text: JSON.stringify(brief) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: usage.input_tokens ?? 9000,
      output_tokens: usage.output_tokens ?? 3200,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    },
  };
}

/** Refusal del sintetizador: `stop_reason='refusal'`, content vacío ⇒ parsed_output=null. El
 *  synthesizer lo maneja TIPADO (status='refused') y el coste SÍ se registra (se pagó el input). */
export function anthropicBriefRefusalResponse(): Record<string, unknown> {
  return {
    id: 'msg_test_brief_refusal',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [],
    stop_reason: 'refusal',
    stop_sequence: null,
    usage: {
      input_tokens: 8800,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}
