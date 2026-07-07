import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Los paquetes internos exportan TS fuente (JIT): Next los transpila
  // (architecture.md §7). @ugc/db se añadirá cuando web lo consuma (T0.3+).
  transpilePackages: ['@ugc/core'],
  // pino resuelve pino-pretty y sus workers (thread-stream) en runtime:
  // fuera del bundle del server o el transport no encuentra sus ficheros.
  serverExternalPackages: ['pino', 'pino-pretty'],
};

export default nextConfig;
