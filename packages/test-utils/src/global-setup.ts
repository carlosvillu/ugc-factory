// globalSetup compartido por TODOS los vitest.config.integration.ts
// (db-integration.md §2). Vitest ejecuta los globalSetup en el proceso principal
// (misma caché de módulos), así que el singleton con refcount de este módulo
// funciona entre proyectos: el primer setup arranca el contenedor, los
// siguientes lo reutilizan, el último teardown lo para. La connection string
// viaja por provide/inject, NUNCA por env (así es imposible que un test apunte
// por accidente a la BD de desarrollo).
// Vitest 4: el globalSetup recibe un `TestProject` (expone `provide()`);
// `GlobalSetupContext` de versiones previas ya no se exporta de `vitest/node`.
import type { TestProject } from 'vitest/node';
import { startPostgresContainer, type PostgresHarness } from './postgres-container';

let harnessPromise: Promise<PostgresHarness> | undefined;
let refs = 0;

export default async function globalSetup({ provide }: TestProject): Promise<() => Promise<void>> {
  harnessPromise ??= startPostgresContainer(); // el primero arranca; el resto reutiliza
  refs += 1;
  const harness = await harnessPromise;
  provide('pgServerUri', harness.serverUri);
  provide('pgTemplateDb', harness.templateDb);
  // El teardown se ejecuta al terminar cada proyecto: el último refcount para el
  // contenedor.
  return async () => {
    refs -= 1;
    if (refs === 0) {
      await harness.stop();
      harnessPromise = undefined;
    }
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    pgServerUri: string;
    pgTemplateDb: string;
  }
}
