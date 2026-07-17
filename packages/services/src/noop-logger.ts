// Logger no-op compartido por los servicios de @ugc/services. El `logger` de las deps es OPCIONAL en
// `runGenerate`/`runGenerateAudio`/`runTtsOnly`/`runGenerateAvatar`; cuando el caller no lo pasa, se
// cae a este NO-OP en vez de dispersar `?.` por el cuerpo. Extraído (T4.7) tras la 3ª copia idéntica.
import type { Logger } from '@ugc/core';

const noop = (): void => {
  /* noop */
};

export const NOOP_LOGGER: Logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  child: () => NOOP_LOGGER,
};
