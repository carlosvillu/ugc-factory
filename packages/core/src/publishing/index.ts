// API pública del módulo `publishing` (T6.6): el Trending Sound Advisor. Subpath `@ugc/core/publishing`.
//
// Es un CLIENTE HTTP (Creative Center) + contratos + una derivación pura (mood). Sin BD, sin cola. Lo
// consumen la API del Advisor (`apps/web`, que lo cablea con la base URL de env y persiste la selección) y la
// UI (que renderiza la lista y el filtro). La regla Spark (que un `native_trending` bloquea Spark) ya vive en
// `@ugc/core/contracts` (`sparkEligibility`, T6.2) — este módulo introduce el LADO del catálogo y la selección.
export {
  SoundMoodSchema,
  TrendingSoundSchema,
  TrendingSoundListSchema,
  SelectNativeSoundSchema,
  SelectNativeSoundResultSchema,
  type SoundMood,
  type TrendingSound,
  type TrendingSoundList,
  type SelectNativeSoundBody,
  type SelectNativeSoundResult,
} from './contracts';
export { deriveMoodTags } from './mood';
export {
  makeCreativeCenterClient,
  type CreativeCenterClient,
  type CreativeCenterDeps,
  type FetchTrendingSoundsArgs,
  type TrendingSoundsResult,
} from './creative-center';
