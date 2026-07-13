// EL PUENTE ENTRE DOS VOCABULARIOS DE ÁNGULO — un hallazgo de T2.2, no una decisión de estilo.
//
// EL PROBLEMA. La Entrega de N4 dice «hooks (2–3 por ángulo del brief **+ hook library**)»: los
// hooks de la librería sembrada (T2.1) completan los del brief cuando el usuario pide más. Para
// eso hay que casar el ÁNGULO del brief con el ÁNGULO de la librería… y son DOS ENUMS DISTINTOS,
// escritos en tareas distintas, que solo coinciden en 4 de sus valores:
//
//   `ProductBrief.angles[].framework` (T1.1, Apéndice A) — 10 valores:
//       pain_point · transformation · social_proof · curiosity ·
//       us_vs_them · unboxing_demo · offer_urgency · myth_busting · identity · founder_story
//
//   `hook_line.angle` / `HookAngle` (T2.1, §12) — 8 valores:
//       pain_point · curiosity · social_proof · authority ·
//       transformation · objection · urgency · comparison
//
//   Intersección literal: pain_point · curiosity · social_proof · transformation.
//
// POR QUÉ IMPORTA, y por qué no vale un `===`. Con comparación literal, un brief cuyo ángulo sea
// `founder_story`, `myth_busting`, `identity`, `unboxing_demo`, `offer_urgency` o `us_vs_them`
// —SEIS de los diez frameworks que Sonnet puede escribir— NO casaría con NINGUNA línea de la
// librería, y la mitad «+ hook library» de la Entrega quedaría muerta EN SILENCIO: la matriz
// saldría con menos hooks de los pedidos y nadie lo vería (la única señal sería una matriz más
// corta de lo esperado, que es exactamente el tipo de fallo silencioso que el principio 9 de
// testing persigue).
//
// ✅ ESTADO: **MAPEO RATIFICADO POR EL USUARIO EL 2026-07-12** (T2.2). No es un apaño que se
// coló: se detectó, se paró, se preguntó y se aprobó. Quien lea esto dentro de tres meses debe
// saber que **esto se miró y se decidió**.
//
// EL RAZONAMIENTO DE LA APROBACIÓN, literal, porque es lo que hace que el riesgo sea bajo:
//
//   Los cuatro primeros (`us_vs_them → comparison`, `unboxing_demo → curiosity`,
//   `offer_urgency → urgency`, `myth_busting → objection`) son claros. Los dos que el
//   implementer señaló como discutibles —**`identity → social_proof`** y
//   **`founder_story → authority`**— se aceptan como **APROXIMACIONES DELIBERADAS**, a
//   sabiendas de que no son equivalencias perfectas (una historia de fundador no es
//   exactamente copy de autoridad; la identidad no es exactamente «otros lo usan»).
//
//   POR QUÉ EL RIESGO ES BAJO: **el hook de librería es SOLO una sugerencia ADICIONAL.** El
//   ángulo ya trae sus propios `hook_examples` del brief, escritos por Sonnet PARA ESE ÁNGULO
//   CONCRETO, y esos van SIEMPRE primero (`hooksForAngle` en `matrix.ts`). El puente no
//   sustituye a nada ni degrada nada: solo evita que media librería quede muerta cuando el
//   usuario pide más hooks de los que el brief trae.
//
// EL CAMINO DE SALIDA (por si algún día molesta, NO es deuda urgente): la solución de fondo es
// **ampliar la librería de hooks a los 10 ángulos del brief** — añadir las categorías que hoy
// faltan y sembrar sus hooks (T2.1 es el sitio) — para que los dos enums coincidan y **este
// puente sobre y se borre**. Es la puerta, no una obligación.
//
// LA DECISIÓN (dentro del alcance de T2.2, sin tocar ningún schema): un mapa EXPLÍCITO
// framework-del-brief → ángulo-de-librería, exhaustivo por tipo (el compilador exige una entrada
// por cada framework; añadir uno al contrato del brief NO compila hasta decidir a qué ángulo de
// copy corresponde). Las cuatro coincidencias literales se mapean a sí mismas; las otras seis se
// mapean al ángulo de librería que dice LO MISMO con otro nombre:
//
//   us_vs_them    → comparison  (comparar con la alternativa ES el ángulo)
//   unboxing_demo → curiosity   («mira lo que acabo de descubrir/abrir»: el registro es el mismo)
//   offer_urgency → urgency     (mismo ángulo, distinto nombre)
//   myth_busting  → objection   (desmontar un mito = contraargumentar una objeción)
//   identity      → social_proof (APROXIMACIÓN ACEPTADA: «gente como tú lo usa» se le acerca)
//   founder_story → authority   (APROXIMACIÓN ACEPTADA: el fundador habla como quien SABE)
//
// NO SE TOCA NINGÚN ENUM. Unificar los dos vocabularios sería un cambio de contrato (T1.1 y
// T2.1, ya cerradas). Este mapa es la traducción MÍNIMA que hace que la librería funcione hoy,
// y es el ÚNICO sitio donde cambiarla.
//
// ⚠ CADA UNA DE LAS 10 CORRESPONDENCIAS ESTÁ FIJADA POR TEST (`hook-angle-bridge.test.ts`, con
// un assert explícito framework → ángulo esperado). Están ratificadas: cambiar una sin hablarlo
// pone el gate en ROJO **a propósito**. Si de verdad hay que cambiarla, se cambia aquí Y en el
// test — que es exactamente la conversación que ese rojo fuerza a tener.
import type { Angle } from '../contracts/product-brief';
import type { HookAngle } from '../library/contracts';

type BriefFramework = Angle['framework'];

/** Framework del brief → ángulo de la librería de copy. Exhaustivo: el `Record` obliga al
 *  compilador a exigir una entrada por cada framework nuevo del contrato del brief. */
export const BRIEF_FRAMEWORK_TO_HOOK_ANGLE: Readonly<Record<BriefFramework, HookAngle>> = {
  // Los cuatro que ya coinciden literalmente.
  pain_point: 'pain_point',
  curiosity: 'curiosity',
  social_proof: 'social_proof',
  transformation: 'transformation',
  // Los seis que dicen lo mismo con otro nombre (ver la cabecera).
  us_vs_them: 'comparison',
  unboxing_demo: 'curiosity',
  offer_urgency: 'urgency',
  myth_busting: 'objection',
  identity: 'social_proof',
  founder_story: 'authority',
};
