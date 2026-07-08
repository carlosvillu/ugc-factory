// API pública de @ugc/test-utils (stack-setup.md §4) — este contrato lo consumen
// todos los references de testing: no renombres estos exports. Crece tarea a
// tarea: startPostgresContainer/createTestDatabase/factories llegan en T0.3,
// seedFixtures en T0.8, live-budget en T1.8, fake-apis con el stack E2E.
// El subpath export "./fixtures/*" se re-añade en T1.4 con el primer fixture
// HTTP grabado: knip veta (con razón) un export map que apunta a una carpeta
// aún vacía, y nadie lo consume antes.
export { expectGolden } from './golden';
export { server, useHttpMocks } from './msw/index';
// Harness de integración con Postgres real (db-integration.md, llega en T0.3).
// El barrel expone SOLO lo que consumen las suites de otros paquetes:
// createTestDatabase + TestDatabase + makeProject (tests de integración de
// @ugc/db). El globalSetup es un subpath export propio
// (`@ugc/test-utils/global-setup`) que los vitest.config.integration.ts
// declaran. Las piezas internas del harness (startPostgresContainer,
// withDatabaseName, TEMPLATE_DB, DrizzleDb) las usan global-setup.ts y
// create-test-database.ts vía imports relativos — no van al barrel.
export { createTestDatabase, type TestDatabase } from './create-test-database';
export { makeProject } from './factories';
