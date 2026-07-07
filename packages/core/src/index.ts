// API raíz de @ugc/core: lo transversal mínimo (architecture.md §3).
// Los módulos del pipeline se exponen como subpath exports según nacen.
export type { Logger } from './ports';
export * from './contracts/index';
