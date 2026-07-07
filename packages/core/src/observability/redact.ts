// Redaction declarativa de secretos en el logger base (observability.md §4).
// Regla operativa: si un secreto puede aparecer en un payload logueado, su path
// se añade AQUÍ antes de escribir el log que lo incluye — en el mismo commit.
//
// Gotcha (fast-redact): el wildcard `*` cubre UN nivel de anidamiento, no
// recursión profunda — '*.apiKey' redacta { fal: { apiKey } } pero no
// { a: { b: { apiKey } } }. Para objetos profundos, path explícito… o mejor,
// no loguees ese objeto entero (§5).
export const REDACT_PATHS = [
  // headers y credenciales de sesión
  'authorization',
  '*.authorization',
  'cookie',
  '*.cookie',
  'set-cookie',
  '*["set-cookie"]',
  // claves de API en objetos de config / payloads
  '*.apiKey',
  '*.api_key',
  '*.token',
  '*.password',
  '*.secret',
  // keys de proveedores por nombre (PRD §19.2: bootstrap por env, cifradas en app_setting)
  'FAL_KEY',
  '*.FAL_KEY',
  'ANTHROPIC_API_KEY',
  '*.ANTHROPIC_API_KEY',
  'FIRECRAWL_API_KEY',
  '*.FIRECRAWL_API_KEY',
  'APP_MASTER_KEY',
  '*.APP_MASTER_KEY',
];
