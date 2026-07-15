// El estado de un template (§10.2) → tono del Badge del DS + etiqueta en español. En un solo
// sitio porque lo comparten la tarjeta y la ficha; el tono es semántico (published = success,
// draft = neutral, review = warning, deprecated = danger) con los tonos del Badge del DS.
import type { PromptStatus } from '@ugc/core/gallery';

/** El tono del Badge del DS para un estado. */
export function statusBadgeTone(
  status: PromptStatus,
): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'published':
      return 'success';
    case 'review':
      return 'warning';
    case 'deprecated':
      return 'danger';
    case 'draft':
    default:
      return 'neutral';
  }
}

/** La etiqueta en español del estado (la UI es en español; los valores en BD son en inglés). */
export function statusLabel(status: PromptStatus): string {
  switch (status) {
    case 'published':
      return 'published';
    case 'review':
      return 'review';
    case 'deprecated':
      return 'deprecated';
    case 'draft':
    default:
      return 'draft';
  }
}
