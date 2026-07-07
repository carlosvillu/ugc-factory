// API pública de @ugc/test-utils (stack-setup.md §4) — este contrato lo consumen
// todos los references de testing: no renombres estos exports. Crece tarea a
// tarea: startPostgresContainer/createTestDatabase/factories llegan en T0.3,
// seedFixtures en T0.8, live-budget en T1.8, fake-apis con el stack E2E.
// El subpath export "./fixtures/*" se re-añade en T1.4 con el primer fixture
// HTTP grabado: knip veta (con razón) un export map que apunta a una carpeta
// aún vacía, y nadie lo consume antes.
export { expectGolden } from './golden';
export { server, useHttpMocks } from './msw/index';
