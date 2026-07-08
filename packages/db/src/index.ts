// API pública de @ugc/db. En T0.2 exporta solo el ping de conexión a Postgres
// (health.ts), consumido por web y worker para el healthcheck. Drizzle, schema,
// migraciones y repos llegan en T0.3 — no se anticipan (planning).
export { pingDb } from './health';
