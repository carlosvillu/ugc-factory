// La mitad SOLO-NODE del módulo `persona` (T2.0). Subpath `@ugc/core/persona/server`.
//
// POR QUÉ ESTÁ SEPARADA DE `@ugc/core/persona` — y no es cosmética: lo de aquí usa **sharp**, un
// binario NATIVO de Node. El barrel hermano (`index.ts`) lo importa el NAVEGADOR (el formulario
// de `/personas` y el `api-client` validan con sus contratos), y meter sharp en ese grafo hace
// que Turbopack intente resolver `child_process` para el browser y **el build muera**. Ocurrió:
// lo cazó `pnpm test:e2e` (el único test que compila la app de verdad para un navegador; unit e
// integración corren en Node y no lo veían). La frontera es esta línea de fichero.
//
// Consumidores legítimos, TODOS procesos Node:
//   · el route handler `POST /api/personas/:id/reference-images` (valida el upload ≥2K);
//   · el seed de `@ugc/db` (`persona-seed.ts`, que genera las imágenes sintéticas).
// Ningún componente de React puede importar de aquí — y si lo intenta, el build se lo dirá.
//
// Mismo patrón que `@ugc/core/analyze` (que también usa sharp y solo lo consume `@ugc/services`).

// El guard ≥2K (§11 identity lock): LEE las dimensiones del fichero con sharp. Un caller no puede
// mentirle diciendo «mide 2048». Lo aplican el endpoint de upload y el seed — el mismo camino.
export { validateReferenceImage } from './validate-reference-image';
// Las 2 personas placeholder del seed + el generador de sus imágenes de referencia sintéticas
// (PNGs ≥2K REALES; decisión del usuario 2026-07-12: él sube sus caras reales por el CRUD).
export { PERSONA_SEEDS, type PersonaSeed } from './seed-data';
export { makeSyntheticReferenceImage } from './reference-image';
