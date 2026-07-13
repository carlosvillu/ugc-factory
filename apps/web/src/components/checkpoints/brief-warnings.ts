// Presentación de los warnings del BriefValidator (T1.9) en CP1 (T1.10b). Módulo PURO (sin
// React): la lógica de "qué se muestra, con qué tono y qué bloquea" es testeable sin DOM, y el
// componente solo la RENDERIZA.
//
// QUÉ BLOQUEA LA APROBACIÓN — y ya no hay dos preguntas, sino UNA (T1.15):
//
// Hasta T1.15 esta cabecera distinguía "bloqueante para el BRIEF" (`isBlockingWarning`, core: el
// brief es inválido y el step MUERE antes de llegar aquí) de "bloqueante para APROBAR" (aquí:
// `needs_user_decision`, el brief es válido pero el pipeline no sigue sin que el usuario decida).
// El primero se ha ELIMINADO: la falta de hero image en perfil `url` mataba el run con la
// síntesis ya pagada (stayforlong.com) en vez de preguntarle al usuario, que es lo que el perfil
// `manual` ya hacía bien. Hoy NINGÚN warning invalida el brief; todos llegan a CP1, y el único
// que BLOQUEA LA APROBACIÓN es `needs_user_decision` — hasta que el usuario elige.
//
// `hook_too_long` NO bloquea, y esto NO es un descuido: los hooks auténticos de Sonnet 5 exceden
// el techo de ≤12 palabras con frecuencia (8 casos en briefs reales de T1.9). Si bloqueara,
// CP1 estaría bloqueado en casi cualquier análisis real. Se AVISA (el usuario reescribe el copy
// si quiere, en el mismo editor) y se deja aprobar.
import type { BriefCheckpointDecision, BriefWarning, ProductBrief } from '@ugc/core/contracts';

/** Las TRES salidas de la petición bloqueante de imágenes (§7.2 N3, T1.15): subir fotos del
 *  producto, PROMOVER a hero una de las imágenes que el scrape sí trajo, o derivar el frame
 *  inicial de i2v a un packshot generado por IA (N7a).
 *
 *  DERIVADO del contrato de core (T1.11), no redeclarado: esta decisión no es estado local que se
 *  evapora — VIAJA al servidor en el body del `/approve` (y del `/edit`) y se persiste en
 *  `checkpoint_decision`. Si el contrato añade una salida, esto no compila hasta que la UI la
 *  pinte, que es exactamente lo que queremos (y es lo que pasó al añadir `promote_scraped`).
 *
 *  NO se exporta: fuera de este módulo lo que circula es la ELECCIÓN ENTERA (`ChosenImageDecision`,
 *  abajo), nunca el enum suelto — que es precisamente lo que permitía tener un `promote_scraped`
 *  sin su imagen. */
type ImageDecision = BriefCheckpointDecision['images'];

/** Una imagen del brief que el usuario puede PROMOVER a hero (T1.15). Son las que N2 clasificó y
 *  el sintetizador dejó en `assets.images[]`: en una web de servicio no hay packshot, pero sí hay
 *  fotos —y el usuario, que sí sabe cuál sirve, no tenía forma de decirlo. */
export type HeroCandidate = ProductBrief['assets']['images'][number];

/**
 * LO QUE EL USUARIO HA ELEGIDO en CP1, tal como lo guarda el editor mientras está en el
 * checkpoint. Es una UNIÓN DISCRIMINADA por `images`, y esa forma es el punto: `heroUrl` existe
 * —y es obligatoria— EXACTAMENTE en la rama que la necesita.
 *
 * POR QUÉ ASÍ Y NO `{images, heroUrl: string | null}`: el invariante «promover exige URL» lo impone
 * el contrato de core con un refine (una decisión de promover que no dice QUÉ imagen es una
 * decisión que N7a no podría ejecutar, y el servidor la rechaza con 400). Si el tipo de aquí
 * admitiera `promote_scraped` sin url, el invariante quedaría repartido entre DOS funciones que
 * tienen que estar de acuerdo —la que CONSTRUYE el payload y la que decide si se puede aprobar— y
 * bastaría un llamante futuro que se saltase la segunda para meter el 400 en producción. Es el
 * patrón de los dos canales que este proyecto ya se ha comido varias veces. Aquí lo hace imposible
 * el TIPO: si no hay url, no hay `ChosenImageDecision` que construir.
 */
export type ChosenImageDecision =
  | { images: Exclude<ImageDecision, 'promote_scraped'> }
  | { images: 'promote_scraped'; heroUrl: string };

/** La DECISIÓN de CP1 en la forma del contrato genérico (`kind` discrimina el checkpoint). Es lo
 *  que el editor manda al servidor; construirla aquí —y no inline en el componente— mantiene el
 *  componente ignorante del transporte.
 *
 *  Recibe la elección ENTERA (no dos params sueltos): así no hay ningún `?? ''` que fabricar
 *  cuando falta la url — el tipo garantiza que está. */
export function toBriefDecision(chosen: ChosenImageDecision): BriefCheckpointDecision {
  return chosen.images === 'promote_scraped'
    ? { kind: 'brief', images: chosen.images, hero_image_url: chosen.heroUrl }
    : { kind: 'brief', images: chosen.images };
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
   *  `needs_user_decision`). */
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
        title: 'Necesitamos una imagen principal del producto',
        // El `message` del warning ya es accionable (lo escribe el validador, T1.9): se muestra
        // TAL CUAL. El wording no es contrato, pero es el canal por el que el servidor explica
        // el caso concreto —si la página trajo imágenes o no, las salidas son otras— y
        // reescribirlo aquí duplicaría la verdad.
        detail: warning.message,
        requiresDecision: true,
      };
  }
}

/**
 * ¿Puede aprobarse el brief? `false` mientras quede alguna decisión pendiente (un warning que la
 * exige y para el que el usuario aún no ha elegido). Función pura: el componente la consulta,
 * no la reimplementa.
 *
 * Un solo criterio: ¿hay elección? Y NO tiene que comprobar además que una promoción traiga su
 * imagen —que era el segundo canal de la versión anterior de T1.15—: un `ChosenImageDecision`
 * `promote_scraped` SIEMPRE la trae, porque el tipo no permite construirlo sin ella. El
 * invariante vive en UN sitio (el tipo), no en el acuerdo entre esta función y `toBriefDecision`.
 */
export function canApprove(
  warnings: BriefWarning[],
  decision: ChosenImageDecision | null,
): boolean {
  return !warnings.some(requiresUserDecision) || decision !== null;
}
