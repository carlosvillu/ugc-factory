// DERIVACIÓN DE MOOD (T6.6, «sugerencias por mood»). ⚠ ES UNA HEURÍSTICA NUESTRA, NO UN DATO DE TIKTOK.
//
// La lista de Popular Music de Creative Center NO expone ningún campo de mood/género/tema (verificado
// 2026-07-31 contra la doc del payload: los campos son song_id/clip_id/title/author/cover/link/duration/
// rank/rank_diff/if_cml/country_code — ninguno de mood). Por eso el mood NO puede salir del fixture: fabricar
// un `mood` a mano en el fixture y leerlo de vuelta sería EXACTAMENTE el doble que «emite lo que conviene al
// test» (principio 9 testing). El mood se DERIVA aquí, del TÍTULO del sonido, con un mapa de palabras clave
// que es AUTORÍA NUESTRA y se documenta como tal. Su test unitario asserta la SALIDA de esta función (no
// reimplementa el mapa), y la UI ofrece los buckets como sugerencia, no como verdad de la plataforma.
import type { SoundMood } from './contracts';

/** El mapa mood → palabras clave (en minúsculas) que lo disparan en el título. Heurística nuestra: los
 *  trending sounds suelen llevar el mood en el título («Sped Up», «Chill», «Hype», «Cinematic»…). Un título
 *  puede casar varios buckets; ninguno casa → moods vacío (la UI lo muestra sin chips). */
const MOOD_KEYWORDS: Record<SoundMood, readonly string[]> = {
  energetic: ['energy', 'energetic', 'power', 'pump', 'sped up', 'fast'],
  calm: ['calm', 'acoustic', 'soft', 'slow', 'gentle', 'peaceful', 'morning'],
  hype: ['hype', 'trap', 'beat', 'drop', 'bass', 'banger'],
  chill: ['chill', 'lofi', 'lo-fi', 'study', 'relax', 'mellow'],
  cinematic: ['cinematic', 'epic', 'rise', 'score', 'orchestral', 'trailer'],
  upbeat: ['dance', 'anthem', 'party', 'happy', 'viral', 'pop', 'summer'],
};

/**
 * DERIVA los mood tags de un sonido a partir de su título (heurística nuestra, no de TikTok). Determinista y
 * PURA: minúsculas del título → todo bucket cuyo alguna keyword aparezca como substring. Preserva el orden
 * canónico de `MOOD_KEYWORDS` (determinismo aguas abajo). Devuelve `[]` si el título no casa nada.
 */
export function deriveMoodTags(title: string): SoundMood[] {
  const haystack = title.toLowerCase();
  const moods: SoundMood[] = [];
  for (const mood of Object.keys(MOOD_KEYWORDS) as SoundMood[]) {
    if (MOOD_KEYWORDS[mood].some((kw) => haystack.includes(kw))) {
      moods.push(mood);
    }
  }
  return moods;
}
