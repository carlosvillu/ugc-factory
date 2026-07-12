// Presentación de los warnings del BriefValidator (T1.9) en CP1 (T1.10b). Módulo PURO (sin
// React): la lógica de "qué se muestra, con qué tono y qué bloquea" es testeable sin DOM, y el
// componente solo la RENDERIZA.
//
// LA DISTINCIÓN QUE HAY QUE ENTENDER (y que se nos puede escapar si no está escrita):
//
//   - `isBlockingWarning` (core, T1.9) responde a "¿el BRIEF es inválido?" → hoy solo
//     `missing_hero_image` (perfil url). Un brief así NI SIQUIERA LLEGA a CP1: N3 falla el step
//     (`ok:false` ⇒ PermanentStepError). Es decir: en CP1 no vas a ver nunca uno.
//   - Lo que SÍ llega a CP1 y BLOQUEA LA APROBACIÓN es otra cosa: `needs_user_decision` — la
//     petición BLOQUEANTE de imágenes del modo manual (§9.2, §7.2 N3). El brief es VÁLIDO (por
//     eso el step no falló y estamos aquí), pero el pipeline no puede seguir sin que el usuario
//     DECIDA: o sube fotos del producto, o deriva la generación del frame inicial a packshot-IA
//     (N7a). T1.9 lo dejó tipado y sin UI a propósito, "porque lo decide T1.10b". Esto es T1.10b.
//
// O sea: "bloqueante para el brief" (core) y "bloqueante para aprobar" (aquí) son dos preguntas
// distintas y NO se pueden fusionar en un solo booleano. Fusionarlas dejaría pasar el checkpoint
// manual sin decisión — exactamente lo que la Verificación exige ver.
//
// `hook_too_long` NO bloquea, y esto NO es un descuido: los hooks auténticos de Sonnet 5 exceden
// el techo de ≤12 palabras con frecuencia (8 casos en briefs reales de T1.9). Si bloqueara,
// CP1 estaría bloqueado en casi cualquier análisis real. Se AVISA (el usuario reescribe el copy
// si quiere, en el mismo editor) y se deja aprobar.
import type { BriefCheckpointDecision, BriefWarning } from '@ugc/core/contracts';

/** Las dos salidas de la petición bloqueante de imágenes (§7.2 N3): subir fotos del producto, o
 *  derivar el frame inicial de i2v a un packshot generado por IA (N7a).
 *
 *  DERIVADO del contrato de core (T1.11), no redeclarado: esta decisión ya no es estado local que
 *  se evapora — VIAJA al servidor en el body del `/approve` (y del `/edit`) y se persiste en
 *  `checkpoint_decision`. Si el contrato añade una salida, esto no compila hasta que la UI la
 *  pinte, que es exactamente lo que queremos. */
export type ImageDecision = BriefCheckpointDecision['images'];

/** La DECISIÓN de CP1 en la forma del contrato genérico (`kind` discrimina el checkpoint). Es lo
 *  que el editor manda al servidor; construirla aquí —y no inline en el componente— mantiene el
 *  componente ignorante del transporte. */
export function toBriefDecision(decision: ImageDecision): BriefCheckpointDecision {
  return { kind: 'brief', images: decision };
}

/** Tono visual del warning (mapea a los tonos del DS: Alert/Badge). */
type WarningTone = 'warning' | 'info';

export interface WarningView {
  code: BriefWarning['code'];
  tone: WarningTone;
  /** Título corto (una línea). */
  title: string;
  /** Copy ACCIONABLE: qué pasó y qué puede hacer el usuario. */
  detail: string;
  /** `true` si este warning EXIGE una decisión del usuario antes de aprobar (hoy solo
   *  `needs_user_decision`). Ver la cabecera: NO es `isBlockingWarning` de core. */
  requiresDecision: boolean;
}

/** ¿Este warning exige una decisión del usuario antes de poder aprobar CP1? */
export function requiresUserDecision(warning: BriefWarning): boolean {
  return warning.code === 'needs_user_decision';
}

/**
 * Traduce un warning tipado a lo que CP1 pinta. El `switch` es EXHAUSTIVO sobre el `code` (la
 * union discriminada de T1.9): si mañana entra un código nuevo, esto NO compila — que es
 * exactamente lo que queremos (un warning nuevo que la UI ignorase en silencio sería peor que
 * un error de compilación).
 */
export function toWarningView(warning: BriefWarning): WarningView {
  switch (warning.code) {
    case 'price_mismatch':
      return {
        code: warning.code,
        tone: 'info',
        title: 'Precio corregido',
        detail:
          `La IA propuso ${warning.synthesized} pero la página dice ${warning.fastPath}. ` +
          'Se ha conservado el precio de la página (dato extraído, no inferido).',
        requiresDecision: false,
      };
    case 'pruned_suggested_asset':
      return {
        code: warning.code,
        tone: 'info',
        title: 'Imagen sugerida descartada',
        detail:
          `El ángulo «${warning.angleName}» sugería una imagen que no existe en el producto ` +
          `(${warning.url}). Se ha eliminado de sus assets sugeridos.`,
        requiresDecision: false,
      };
    case 'hook_too_long':
      return {
        code: warning.code,
        tone: 'warning',
        title: 'Hook demasiado largo',
        detail:
          `«${warning.hook}» (${String(warning.wordCount)} palabras) en el ángulo ` +
          `«${warning.angleName}». Un hook largo no cabe en los primeros 3 s del anuncio: ` +
          'acórtalo aquí si quieres.',
        requiresDecision: false,
      };
    case 'needs_user_decision':
      return {
        code: warning.code,
        tone: 'warning',
        title: 'Necesitamos imágenes del producto',
        // El `message` del warning ya es accionable (lo escribe el validador, T1.9): se muestra
        // TAL CUAL. El wording no es contrato, pero es el canal por el que el servidor explica
        // el caso concreto — reescribirlo aquí duplicaría la verdad.
        detail: warning.message,
        requiresDecision: true,
      };
    case 'missing_hero_image':
      // No debería llegar nunca a CP1 (el step falla antes, ver cabecera). Si llega, se muestra
      // en vez de tragárselo: un warning bloqueante invisible es lo peor de los dos mundos.
      return {
        code: warning.code,
        tone: 'warning',
        title: 'Sin imagen principal usable',
        detail: warning.message,
        requiresDecision: true,
      };
  }
}

/**
 * ¿Puede aprobarse el brief? `false` mientras quede alguna decisión pendiente (un warning que la
 * exige y para el que el usuario aún no ha elegido). Función pura: el componente la consulta,
 * no la reimplementa.
 */
export function canApprove(warnings: BriefWarning[], decision: ImageDecision | null): boolean {
  const pending = warnings.some(requiresUserDecision);
  return !pending || decision !== null;
}
