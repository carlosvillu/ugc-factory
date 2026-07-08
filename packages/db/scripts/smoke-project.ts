// Smoke de la Verificación de T0.3: "crear un project vía un script de smoke y
// leerlo de vuelta". Turnkey: `pnpm db:smoke` (raíz → filtro @ugc/db) tras
// `pnpm db:migrate`. Carga el `.env` raíz igual que el CLI de migración (misma
// flag `--env-file-if-exists` del script), crea un project con el repo tipado y
// lo relee, comprobando que el roundtrip es idéntico (incluida la PK ULID y los
// defaults que aplica la BD). Falla ruidosamente si no coinciden.
import { createDb, createProject, getProject } from '../src/index';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('db:smoke: falta DATABASE_URL (¿copiaste .env.example a .env?)');
    process.exit(1);
  }

  const db = createDb(connectionString);
  const created = await createProject(db, { name: 'Smoke ES' });
  const fetched = await getProject(db, created.id);

  console.log('db:smoke: created', JSON.stringify(created));
  console.log('db:smoke: fetched', JSON.stringify(fetched));

  if (!fetched || JSON.stringify(fetched) !== JSON.stringify(created)) {
    console.error('db:smoke: el roundtrip NO coincide');
    process.exit(1);
  }
  console.log('db:smoke: roundtrip OK (create → get idéntico)');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('db:smoke: falló', err);
  process.exit(1);
});
