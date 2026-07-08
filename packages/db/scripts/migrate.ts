// CLI de migración: lo que `pnpm db:migrate` (raíz → filtro @ugc/db) invoca y lo
// que ejercita la Verificación de T0.3 ("`pnpm db:migrate` sobre BD vacía crea
// las tablas"). Carga el `.env` raíz vía la flag `--env-file-if-exists` del
// script (mismo `.env` que docker-compose.dev.yml), lee DATABASE_URL y delega en
// el runner con lock de @ugc/db. Falla ruidosamente sin DATABASE_URL: migrar a
// una cadena vacía es peor que no migrar.
import { runMigrations } from '../src/migrate';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('db:migrate: falta DATABASE_URL (¿copiaste .env.example a .env?)');
    process.exit(1);
  }
  await runMigrations(connectionString);
  console.log('db:migrate: migraciones aplicadas');
}

main().catch((err: unknown) => {
  console.error('db:migrate: falló', err);
  process.exit(1);
});
