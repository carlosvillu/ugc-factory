// FIXTURE del CATÁLOGO de TikTok Creative Center · Popular Music (T6.6, §14 / §13.3, PRD:626). Es el corpus
// que sirve el Trending Sound Advisor en tests (unit/integration vía msw) y en E2E (vía el fake HTTP server).
//
// ⚠ PROCEDENCIA — LÉELO (principio 9 de la skill testing, incidente T1.9 / T2.7): este fixture NO es una
// grabación de la fuente viva. La lista de Popular Music de Creative Center se sirve CLIENT-SIDE detrás de un
// muro de login (verificado 2026-07-31: la página `ads.tiktok.com/.../inspiration/popular/music` responde el
// shell SPA con `__MODERN_ROUTER_DATA__.creativeCenter/trends/page: null`; el endpoint interno
// `creative_radar_api/v1/popular_trend/sound/list` da 404 sin sesión). Desde el sandbox NO es alcanzable.
//
// Por eso el fixture REPRODUCE LA FORMA DOCUMENTADA de la respuesta (§9 external-apis.md: la excepción de
// TikTok/Meta — fixtures construidos desde docs, marcados con `_meta.source`). La forma —y CRÍTICAMENTE el
// campo del flag comercial `if_cml`— sale de la documentación de terceros de la API de Creative Center
// (SociaVault, `docs.sociavault.com/api-reference/tiktok/music-popular`, consultada 2026-07-31), NO de un
// booleano inventado a mano. El día que T6.1 conecte una cuenta real, se regraba contra la fuente viva y se
// cierra la marca NOT VERIFIED (misma vía que los fixtures de fal/Firecrawl).
//
// EL FLAG COMERCIAL SALE DEL DATO, NO DE LA CONVENIENCIA DEL TEST: cada sonido trae `if_cml` (el campo REAL
// «whether the song is approved for commercial/business use»); el parser del cliente lo mapea a
// `commercial`. Un fixture que fijara `commercial: true/false` a mano en vez de `if_cml` sería el doble que
// «emite lo que conviene al test» — por eso el corpus lleva el campo crudo y el filtro comercial se DERIVA.

/** El `_meta` que marca la procedencia (external-apis.md §9). `source: 'third-party-docs'` es HONESTO: NO es
 *  la doc oficial de TikTok ni una grabación de la fuente viva, sino la doc de un scraper de terceros que
 *  documenta el payload de Creative Center. `verified: false` hasta que T6.1 regrabe contra la fuente real. */
export const CREATIVE_CENTER_FIXTURE_META = {
  source: 'third-party-docs',
  url: 'https://docs.sociavault.com/api-reference/tiktok/music-popular',
  captured_at: '2026-07-31',
  verified_against_live: false,
  note: 'Reproduce el shape documentado de Creative Center Popular Music. El flag comercial sale del campo real `if_cml`. NO verificado contra la fuente viva (login-walled desde el sandbox).',
} as const;

/** Un track CRUDO tal cual lo documenta la API de Creative Center · Popular Music. Se tipa laxo (todo
 *  desconocido es red externa); el parser del cliente valida y proyecta al contrato interno. `if_cml` es el
 *  flag comercial REAL. NO hay campo `mood`/`genre` en la lista — el mood es un derivado NUESTRO (ver
 *  `deriveMoodTags` en core), no un dato de TikTok. */
export interface CreativeCenterRawSound {
  song_id: string;
  clip_id: string;
  title: string;
  author: string;
  cover: string;
  link: string;
  /** Duración del clip en segundos. */
  duration: number;
  /** Posición en el chart (1 = más popular). */
  rank: number;
  /** Cambio de posición desde el periodo anterior (null si nuevo/sin dato). */
  rank_diff: number | null;
  /** EL FLAG COMERCIAL REAL: «whether the song is approved for commercial/business use» (docs). true = en la
   *  Commercial Music Library (usable en ads/Spark); false = trending general, solo orgánico no-promocionado. */
  if_cml: boolean;
  country_code: string;
}

/** La envolvente de la respuesta de la lista (`{ data: { sounds: [...] } }`, forma documentada). */
export interface CreativeCenterRawResponse {
  data: {
    sounds: CreativeCenterRawSound[];
  };
}

/**
 * EL CATÁLOGO. Mezcla DELIBERADA de CML y no-CML para que el filtro comercial tenga ambos lados que separar
 * (si todos fueran `if_cml:true`, el filtro no probaría nada — el otro lado del control negativo). Títulos
 * variados para que `deriveMoodTags` (heurística NUESTRA sobre el título) produzca buckets distintos.
 *
 * Los `if_cml` NO están puestos «para que el test pase»: representan la realidad del catálogo — la mayoría
 * de los trending sounds virales NO están en la CML (por eso el deseo D11 choca con las reglas de ads, §14),
 * y solo un subconjunto (típicamente los emitidos por artistas/labels con licencia comercial) sí lo están.
 */
export const CREATIVE_CENTER_POPULAR_MUSIC: CreativeCenterRawResponse = {
  data: {
    sounds: [
      {
        song_id: 'cc-sound-0001',
        clip_id: 'cc-clip-0001',
        title: 'Midnight Energy (Sped Up)',
        author: 'NEONWAVE',
        cover: 'https://p16-sign.tiktokcdn.example/cc/cover-0001-720x720.jpeg',
        link: 'https://www.tiktok.com/music/midnight-energy-cc-sound-0001',
        duration: 15,
        rank: 1,
        rank_diff: 0,
        if_cml: false,
        country_code: 'US',
      },
      {
        song_id: 'cc-sound-0002',
        clip_id: 'cc-clip-0002',
        title: 'Calm Acoustic Morning',
        author: 'Willow Grove',
        cover: 'https://p16-sign.tiktokcdn.example/cc/cover-0002-720x720.jpeg',
        link: 'https://www.tiktok.com/music/calm-acoustic-morning-cc-sound-0002',
        duration: 30,
        rank: 2,
        rank_diff: 5,
        if_cml: true,
        country_code: 'US',
      },
      {
        song_id: 'cc-sound-0003',
        clip_id: 'cc-clip-0003',
        title: 'Hype Trap Beat Drop',
        author: 'DJ Volt',
        cover: 'https://p16-sign.tiktokcdn.example/cc/cover-0003-720x720.jpeg',
        link: 'https://www.tiktok.com/music/hype-trap-beat-drop-cc-sound-0003',
        duration: 12,
        rank: 3,
        rank_diff: -1,
        if_cml: false,
        country_code: 'US',
      },
      {
        song_id: 'cc-sound-0004',
        clip_id: 'cc-clip-0004',
        title: 'Soft Lofi Chill Study',
        author: 'Mellow Tapes',
        cover: 'https://p16-sign.tiktokcdn.example/cc/cover-0004-720x720.jpeg',
        link: 'https://www.tiktok.com/music/soft-lofi-chill-study-cc-sound-0004',
        duration: 30,
        rank: 4,
        rank_diff: 2,
        if_cml: true,
        country_code: 'US',
      },
      {
        song_id: 'cc-sound-0005',
        clip_id: 'cc-clip-0005',
        title: 'Epic Cinematic Rise',
        author: 'Score Lab',
        cover: 'https://p16-sign.tiktokcdn.example/cc/cover-0005-720x720.jpeg',
        link: 'https://www.tiktok.com/music/epic-cinematic-rise-cc-sound-0005',
        duration: 20,
        rank: 5,
        rank_diff: null,
        if_cml: true,
        country_code: 'US',
      },
      {
        song_id: 'cc-sound-0006',
        clip_id: 'cc-clip-0006',
        title: 'Viral Dance Anthem',
        author: 'Popstar XO',
        cover: 'https://p16-sign.tiktokcdn.example/cc/cover-0006-720x720.jpeg',
        link: 'https://www.tiktok.com/music/viral-dance-anthem-cc-sound-0006',
        duration: 18,
        rank: 6,
        rank_diff: 3,
        if_cml: false,
        country_code: 'US',
      },
    ],
  },
};
