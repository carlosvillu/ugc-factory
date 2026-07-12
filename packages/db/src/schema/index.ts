// Barrel del schema (db.md §1): re-exporta todos los dominios para que
// `drizzle(pool, { schema })` reciba el conjunto completo sin listas manuales, y
// para que `drizzle.config.ts` (glob sobre esta carpeta) y el harness de tests
// (`@ugc/db/schema`) importen de un solo sitio. `schema/relations.ts` se
// re-exportará aquí cuando lleguen las relational queries (db.md §7).
export * from './project';
export * from './ops';
export * from './pipeline';
export * from './generation';
export * from './gallery';
export * from './batch';
