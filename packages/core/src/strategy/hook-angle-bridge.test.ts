// EL GUARD DEL PUENTE DE ÁNGULOS (T2.2). Dos cosas distintas, y las dos hacen falta:
//
//  1. **QUE NINGÚN FRAMEWORK QUEDE MUDO** (el fallo silencioso original): para cada uno de los
//     10 frameworks que el contrato del brief admite, la librería REAL sembrada debe poder
//     aportar hooks. Sin esto, 6 de los 10 no casaban con NADA y la mitad «+ hook library» de
//     la Entrega de N4 quedaba muerta sin que nadie se enterara.
//
//  2. **QUE EL DESTINO DE CADA MAPEO ESTÉ FIJADO** (lo que faltaba). El mapa está RATIFICADO por
//     el usuario (2026-07-12; ver la cabecera de `hook-angle-bridge.ts`), así que los 10 destinos
//     son un HECHO, no una preferencia: `founder_story` va a `authority` y punto. La primera
//     versión de este test solo comprobaba (1) —«llega ALGÚN hook»— y por tanto **no se ponía
//     rojo si alguien cambiaba un mapeo**: con `founder_story → curiosity` habría seguido
//     llegando un hook y el test habría pasado tan campante. Un test que no puede cazar el
//     cambio que debe vigilar es decoración (principio 9 de testing).
//
// CÓMO SE FIJA (2) SIN QUE EL TEST «REIMPLEMENTE LA TABLA»: el assert NO compara el mapa contra
// una copia del mapa. Comprueba el EFECTO OBSERVABLE del mapa sobre `composeMatrix` — **la línea
// de librería que ACABA EN LA MATRIZ es una línea sembrada cuyo `angle` es el esperado**. Es la
// salida del código que corre en producción, no una reimplementación de su lógica.
import { describe, expect, it } from 'vitest';
import { makeAngle, makeBrief } from '@ugc/test-utils';
import { AngleSchema } from '../contracts/product-brief';
import type { HookAngle } from '../library/contracts';
import { HOOK_LINE_SEEDS } from '../library/seed-data';
import { composeMatrix } from './matrix';

// Los frameworks los enumera el CONTRATO (no una lista copiada a mano): si T1.1 añade uno, este
// test lo recorre solo — y falla hasta que se decida su destino.
const FRAMEWORKS = AngleSchema.shape.framework.options;

/**
 * EL DESTINO RATIFICADO DE CADA FRAMEWORK (usuario, 2026-07-12). Se escribe aquí a mano, a
 * propósito y «por duplicado» con `BRIEF_FRAMEWORK_TO_HOOK_ANGLE`: ESO es lo que convierte el
 * mapa en un CONTRATO. Cambiar un destino en el código sin cambiarlo aquí pone el gate en ROJO,
 * que es exactamente la conversación que un cambio de mapeo debe forzar.
 */
const RATIFIED_TARGET: Readonly<Record<(typeof FRAMEWORKS)[number], HookAngle>> = {
  // Coincidencias literales (los dos enums usan la misma palabra).
  pain_point: 'pain_point',
  curiosity: 'curiosity',
  social_proof: 'social_proof',
  transformation: 'transformation',
  // Traducciones claras.
  us_vs_them: 'comparison',
  unboxing_demo: 'curiosity',
  offer_urgency: 'urgency',
  myth_busting: 'objection',
  // APROXIMACIONES DELIBERADAS, aceptadas a sabiendas (no descuidos): el hook de librería es solo
  // una sugerencia ADICIONAL — los `hook_examples` del brief, escritos por Sonnet para ESE ángulo,
  // van SIEMPRE primero. El puente no sustituye nada; evita que media librería quede muerta.
  identity: 'social_proof',
  founder_story: 'authority',
};

describe('el puente framework-del-brief → ángulo-de-librería (RATIFICADO 2026-07-12)', () => {
  it.each(FRAMEWORKS)(
    'framework "%s": el hook de librería que entra en la matriz es del ángulo RATIFICADO',
    (framework) => {
      // `makeAngle` da 2 `hook_examples`; se piden 3 → el tercero TIENE que salir de la librería.
      const brief = makeBrief({
        angles: [
          makeAngle({ name: `Ángulo ${framework}`, framework }),
          ...makeBrief().angles.slice(1),
        ],
      });

      for (const language of ['es', 'en']) {
        const plan = composeMatrix({
          brief,
          libraryHooks: HOOK_LINE_SEEDS,
          angleCount: 1,
          hooksPerAngle: 3,
          languages: [language],
          objective: 'conversion',
          tier: 'standard',
        });

        // (1) Nadie queda mudo: 2 hooks del brief + AL MENOS 1 de la librería. Si el puente no
        //     cubriera este framework saldrían 2, y este assert cae.
        expect(plan.variants).toHaveLength(3);
        const fromLibrary = plan.variants.filter((v) => v.hook.source === 'library');
        expect(fromLibrary).toHaveLength(1);

        // (2) EL DESTINO ES EL RATIFICADO. Se lee la línea REAL que el compositor eligió y se
        //     mira SU `angle`. Si alguien cambiara `founder_story → curiosity`, el hook servido
        //     pasaría a ser de ángulo `curiosity` y este assert se pone ROJO.
        // Se resuelve por la CLAVE NATURAL (language, text): el mismo lookup que hará T2.3.
        // Que la línea EXISTA con ese idioma ya prueba §17 (no se traduce, se sirve nativa).
        const seed = HOOK_LINE_SEEDS.find(
          (h) => h.language === language && h.text === fromLibrary[0]?.hook.text,
        );
        expect(seed, 'el hook servido debe ser una línea REAL de la librería').toBeDefined();
        expect(seed?.angle).toBe(RATIFIED_TARGET[framework]);
      }
    },
  );
});
