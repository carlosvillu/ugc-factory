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

  // Fail-fast (T0.4, PRD §19.2): APP_MASTER_KEY es la ÚNICA credencial de cifrado
  // en env y firma las sesiones. Sin ella la auth no puede operar — reventar el
  // arranque CLARO es mejor que servir requests con auth silenciosamente rota.
  // Se comprueba SIEMPRE (aunque no haya BD): es config de proceso, no de datos.
  if (!process.env.APP_MASTER_KEY) {
    throw new Error(
      'APP_MASTER_KEY no está definida: es la única credencial de cifrado (PRD §19.2). ' +
        'Defínela en .env antes de arrancar web.',
    );
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Sin cadena no se migra (mismo criterio que el ping degrada en vez de
    // tumbar): en dev sin BD levantada, el server aún arranca. El fallo se verá
    // en /api/health (db:false), no en un crash de boot.
    return;
  }

  // Import dinámico: mantiene @ugc/db (y su pg) fuera del grafo del runtime edge
  // y del coste de import cuando el guard corta antes.
  // Los cuatro módulos son independientes entre sí: se cargan en paralelo para no
  // serializar la resolución en el arranque.
  const [
    { runMigrations, seedPasswordHashIfAbsent, seedMonthlyBudgetIfAbsent, seedSecretIfAbsent },
    { getRootLogger },
    { getDb },
    { hashPassword, getSecretsKey },
    { encryptSecret },
  ] = await Promise.all([
    import('@ugc/db'),
    import('@/server/logger'),
    import('@/server/db'),
    import('@/server/session'),
    import('@ugc/core/secrets'),
  ]);
  const log = getRootLogger().child({ phase: 'startup' });
  // Observable: sin este par de líneas el cableado de arranque es silencioso y un
  // fallo de wiring (instrumentation que no dispara) no se vería hasta que una
  // tabla ausente muerde mucho más tarde. La Verificación NO ejercita este
  // camino (es review-covered, no CUA): el log es la señal de que corrió.
  log.info({}, 'running startup migrations');
  await runMigrations(connectionString);
  log.info({}, 'startup migrations applied');

  // Seeding first-boot del hash de password (T0.4): scrypt del password de
  // bootstrap sembrado en `app_setting` SOLO si la clave no existe (idempotente,
  // JAMÁS sobrescribe). Cambiar el password no es re-seeding desde env: el hash
  // queda congelado en el PRIMER arranque contra la BD existente.
  const bootstrapPassword = process.env.AUTH_BOOTSTRAP_PASSWORD;
  if (bootstrapPassword) {
    // Reusa el pool singleton de web (getDb) en vez de abrir una segunda pool solo
    // para sembrar: es el mismo pool que servirá los requests, así que no queda
    // ninguna conexión huérfana que cerrar tras el arranque.
    const seeded = await seedPasswordHashIfAbsent(getDb(), hashPassword(bootstrapPassword));
    log.info(
      { seeded },
      seeded ? 'auth.password_hash sembrado (first boot)' : 'auth.password_hash ya existía',
    );
  } else {
    log.warn(
      {},
      'AUTH_BOOTSTRAP_PASSWORD ausente: no se sembró password (login fallará hasta sembrarlo)',
    );
  }

  // Seed first-boot del presupuesto mensual (T0.12): `BUDGET_MONTHLY_LIMIT_CENTS`
  // (céntimos enteros) siembra un `budget` scope=monthly SOLO si no existe ya uno
  // (idempotente, JAMÁS sobrescribe — mismo criterio que el hash de password). Es
  // el ÚNICO camino para fijar un presupuesto en F0 (el panel de settings es T7.7):
  // así el verifier pone un límite POR DEBAJO del gasto y `/spend` dispara la alerta
  // over-limit. Ausente ⇒ ningún presupuesto ⇒ /spend sin alerta (gasto sin límite).
  const budgetRaw = process.env.BUDGET_MONTHLY_LIMIT_CENTS;
  if (budgetRaw !== undefined) {
    const limitCents = Number(budgetRaw);
    if (Number.isInteger(limitCents) && limitCents >= 0) {
      const b = await seedMonthlyBudgetIfAbsent(getDb(), limitCents);
      log.info({ limitCents: b.limitCents }, 'budget mensual sembrado o ya existente (first boot)');
    } else {
      log.warn(
        { budgetRaw },
        'BUDGET_MONTHLY_LIMIT_CENTS inválido (no es un entero >= 0): no se sembró presupuesto',
      );
    }
  }

  // Seeding first-boot de las API keys de proveedor desde env (T0.14, §19.2). Las env
  // vars son bootstrap OPCIONAL: si `<PROVIDER>_KEY` está presente Y la BD aún no tiene
  // la key de ese proveedor, se SIEMBRA CIFRADA (AES-256-GCM, clave derivada de
  // APP_MASTER_KEY). Idempotente: seedSecretIfAbsent JAMÁS sobrescribe una key ya
  // presente en BD — tras el primer arranque la fuente de verdad es `app_setting`, y
  // borrar la env NO rompe nada (la key sigue en la BD, editable desde /settings).
  // Solo `fal` es obligatorio a efectos de la Verificación (env FAL_KEY); anthropic y
  // firecrawl leen su env si está presente pero no es requisito (T1.7/T1.4).
  const providerEnvKeys: { provider: string; env: string | undefined }[] = [
    { provider: 'fal', env: process.env.FAL_KEY },
    { provider: 'anthropic', env: process.env.ANTHROPIC_API_KEY },
    { provider: 'firecrawl', env: process.env.FIRECRAWL_API_KEY },
  ];
  // Seeds independientes (inserts ON CONFLICT DO NOTHING sobre el pool client) → en paralelo.
  await Promise.all(
    providerEnvKeys.map(async ({ provider, env }) => {
      if (!env) return; // sin env no hay bootstrap para ese proveedor (silencioso: es opcional)
      const seeded = await seedSecretIfAbsent(
        getDb(),
        provider,
        encryptSecret(env, getSecretsKey()),
      );
      log.info(
        { provider, seeded },
        seeded
          ? `secret.${provider} sembrado cifrado desde env (first boot)`
          : `secret.${provider} ya existía en BD (env ignorada; la BD es la fuente)`,
      );
    }),
  );
}
