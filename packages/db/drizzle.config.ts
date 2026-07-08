// Config de drizzle-kit (db.md §3). El schema apunta a la CARPETA (glob), no a
// ficheros sueltos: añadir un dominio nuevo no toca esta config. El SQL generado
// vive en ./drizzle y se committea — la historia de migraciones es parte del
// repo y se revisa como cualquier código.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/*.ts',
  out: './drizzle',
});
