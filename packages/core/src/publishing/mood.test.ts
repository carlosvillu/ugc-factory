// Unit de la derivación de mood (T6.6). Asserta la SALIDA de `deriveMoodTags` (la función que corre en
// producción), NO una reimplementación del mapa de keywords (principio 9 testing, forma (d)/T2.1). El mood es
// una heurística NUESTRA sobre el título — no un dato de TikTok — y estos casos fijan su comportamiento.
import { describe, expect, it } from 'vitest';

import { deriveMoodTags } from './mood';

describe('deriveMoodTags — heurística de mood sobre el título', () => {
  it('deriva «energetic» de «Sped Up»/«Energy»', () => {
    expect(deriveMoodTags('Midnight Energy (Sped Up)')).toContain('energetic');
  });

  it('deriva «calm» de «Acoustic»/«Morning»', () => {
    expect(deriveMoodTags('Calm Acoustic Morning')).toContain('calm');
  });

  it('deriva «hype» de «Trap»/«Beat»/«Drop»', () => {
    const moods = deriveMoodTags('Hype Trap Beat Drop');
    expect(moods).toContain('hype');
  });

  it('deriva «chill» de «Lofi»/«Study»', () => {
    expect(deriveMoodTags('Soft Lofi Chill Study')).toContain('chill');
  });

  it('deriva «cinematic» de «Epic»/«Rise»', () => {
    expect(deriveMoodTags('Epic Cinematic Rise')).toContain('cinematic');
  });

  it('deriva «upbeat» de «Dance»/«Anthem»/«Viral»', () => {
    expect(deriveMoodTags('Viral Dance Anthem')).toContain('upbeat');
  });

  it('un título sin keywords conocidas → moods vacío (la UI no ofrece chips)', () => {
    expect(deriveMoodTags('Untitled Track 4491')).toEqual([]);
  });

  it('es case-insensitive y determinista (orden canónico)', () => {
    const a = deriveMoodTags('CHILL LOFI STUDY BEAT');
    const b = deriveMoodTags('chill lofi study beat');
    expect(a).toEqual(b);
    // «hype» (beat) va antes que «chill» en el orden canónico del mapa.
    expect(a).toEqual(['hype', 'chill']);
  });
});
