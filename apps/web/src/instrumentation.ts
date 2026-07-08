// Hook oficial de Next para código de arranque (register() corre UNA vez al
// bootear el server, antes de servir requests). Aquí se cablea el runner de
// migraciones con lock (§18.2, Entrega T0.3: "script db:migrate con lock en el
// arranque de web"): si dos instancias arrancan a la vez, el advisory lock de
// @ugc/db deja que solo una migre y la otra espere.
//
// El módulo es side-effect-free a nivel top-level: solo `register()` hace algo,
// y solo en el runtime nodejs con DATABASE_URL presente. Así, importarlo desde
// el build o desde vitest no dispara migraciones — el acoplamiento a los tests
// que el brief exige evitar.

export async function register(): Promise<void> {
  // Guard de runtime: instrumentation también se evalúa en el runtime `edge`,
  // donde `pg` no existe. Migrar es trabajo del runtime nodejs.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Sin cadena no se migra (mismo criterio que el ping degrada en vez de
    // tumbar): en dev sin BD levantada, el server aún arranca. El fallo se verá
    // en /api/health (db:false), no en un crash de boot.
    return;
  }

  // Import dinámico: mantiene @ugc/db (y su pg) fuera del grafo del runtime edge
  // y del coste de import cuando el guard corta antes.
  const { runMigrations } = await import('@ugc/db');
  const { getRootLogger } = await import('@/server/logger');
  const log = getRootLogger().child({ phase: 'startup' });
  // Observable: sin este par de líneas el cableado de arranque es silencioso y un
  // fallo de wiring (instrumentation que no dispara) no se vería hasta que una
  // tabla ausente muerde mucho más tarde. La Verificación NO ejercita este
  // camino (es review-covered, no CUA): el log es la señal de que corrió.
  log.info({}, 'running startup migrations');
  await runMigrations(connectionString);
  log.info({}, 'startup migrations applied');
}
