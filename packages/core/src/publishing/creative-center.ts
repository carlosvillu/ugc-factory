// CLIENTE HTTP de TikTok Creative Center · Popular Music (T6.6, §14 / §13.3, PRD:626). Lee el catálogo de
// trending sounds con su flag de disponibilidad comercial (CML). Vive en `packages/core/src/publishing`
// como el cliente de Firecrawl vive en `ingest/` (backend/architecture.md §puertos: los clientes HTTP de
// proveedores viven en core — la frontera prohibida es BD/cola, NO la red).
//
// MOLDE FIRECRAWL (T1.4): factory `makeCreativeCenterClient({ fetch?, baseUrl? })`; base URL CONSTANTE
// overridable por dep (el E2E la apunta al fake); `fetch` resuelto PEREZOSAMENTE por llamada (msw reemplaza
// `globalThis.fetch` DESPUÉS de construir el cliente); NUNCA lanza por un fallo de red — degrada a lista
// vacía + `warnings` (el Advisor muestra «no se pudieron cargar sonidos», no revienta la página).
//
// EL FLAG COMERCIAL SALE DEL DATO (principio 9 testing): el parser lee `if_cml` (el campo REAL de Creative
// Center «approved for commercial/business use») y lo proyecta a `commercial`. NO se fija a mano. El mood se
// DERIVA del título (heurística nuestra, `deriveMoodTags`) — la lista NO trae mood.
import type { BatchDestination } from '../contracts/batch-plan';
import { makeFetchWithTimeout, classifyFetchError } from '../ingest/http';
import type { TrendingSound } from './contracts';
import { deriveMoodTags } from './mood';

/** Base de la API de Creative Center (Popular Music). Interno: se sobreescribe por dep `baseUrl` en tests
 *  (el fake HTTP server del E2E; msw intercepta a nivel de red en unit/integration). El path del endpoint de
 *  la lista se concatena a esta base. */
const CREATIVE_CENTER_BASE_URL = 'https://ads.tiktok.com/creative_radar_api/v1';

/** Timeout duro por request (ms). Una lectura colgada dejaría el Advisor sin señal; 20s es holgado para una
 *  lista JSON. */
const DEFAULT_TIMEOUT_MS = 20_000;

/** Periodo por defecto de la ventana de trending (días). Creative Center admite 7/30/130; 7 = «lo de esta
 *  semana», el default útil para un advisor. */
const DEFAULT_PERIOD_DAYS = 7;

/** País por defecto del chart. Mono-usuario: el mercado del usuario. Se puede parametrizar en el futuro. */
const DEFAULT_COUNTRY = 'US';

// El destino que gobierna el filtro comercial del Advisor (§14 pt 2) ES el destino del lote: `paid`/`both`
// (incluyen promoción/Spark) ⇒ solo CML; `organic` ⇒ todos con su flag. Se reutiliza `BatchDestination` de
// core (no un duplicado local) — es el mismo concepto.

/** Deps del cliente. `fetch` con default global perezoso (msw). `baseUrl` overridable (el E2E la apunta al
 *  fake). */
export interface CreativeCenterDeps {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

/** Argumentos de una lectura del catálogo. `destination` decide el filtro comercial (§14 pt 2). */
export interface FetchTrendingSoundsArgs {
  destination: BatchDestination;
  periodDays?: number;
  countryCode?: string;
}

/** Resultado de una lectura: los sonidos proyectados + si se aplicó el filtro comercial + warnings (nunca
 *  lanza: un fallo de red = lista vacía + warning). `sourceOk` distingue «la FUENTE falló» (red/HTTP/JSON →
 *  lista vacía forzada) de «la fuente respondió bien pero no había sonidos / se filtraron todos». La UI lo
 *  necesita para no confundir una caída de Creative Center con un filtro vacío: en producción, SIN una sesión
 *  de TikTok (T6.1), la fuente real da 404 → `sourceOk=false`, y el Advisor avisa en vez de fingir «no hay
 *  sonidos». Un skip de item suelto NO baja `sourceOk` (la fuente respondió; solo se saltó un track a medias). */
export interface TrendingSoundsResult {
  sounds: TrendingSound[];
  commercialOnly: boolean;
  sourceOk: boolean;
  warnings: string[];
}

// ── Shape (parcial) de la respuesta de Creative Center (docs.sociavault.com, forma documentada) ───────────
// Solo se tipa lo que se consume; todo opcional/desconocido porque es red externa. `if_cml` es el flag
// comercial REAL. NO hay campo de mood/género en la lista (se deriva del título aparte).
interface RawSound {
  song_id?: unknown;
  title?: unknown;
  author?: unknown;
  cover?: unknown;
  link?: unknown;
  duration?: unknown;
  rank?: unknown;
  if_cml?: unknown;
}
interface RawResponse {
  data?: { sounds?: RawSound[] };
}

/** ¿El destino restringe a la Commercial Music Library? (§14 pt 2). Solo `organic` muestra todos. */
function isCommercialOnly(destination: BatchDestination): boolean {
  return destination !== 'organic';
}

/** Proyecta un track CRUDO al contrato `TrendingSound`, DERIVANDO `commercial` de `if_cml` y `moods` del
 *  título. Devuelve `null` si al track le falta un campo esencial O si el track NO satisface las garantías del
 *  contrato de salida `TrendingSoundSchema` (durationSeconds/rank `int().positive()`, coverUrl/link
 *  `string().min(1)`) — un track a medias se DESCARTA aquí, en vez de que su ZodError reviente la lista entera
 *  aguas abajo (route.ts hace `TrendingSoundListSchema.parse`). Este reafirmar-la-forma-antes-de-emitir es la
 *  razón de ser del cliente (evita el 500 opaco del anti-patrón T1.8). Cuidado con el redondeo: `duration:0.3`
 *  pasaría un guard `> 0` pero `Math.round(0.3)===0` violaría `positive()` → se comprueba DESPUÉS de redondear. */
function projectSound(raw: RawSound): TrendingSound | null {
  const id = typeof raw.song_id === 'string' ? raw.song_id : null;
  const title = typeof raw.title === 'string' ? raw.title : null;
  const author = typeof raw.author === 'string' ? raw.author : null;
  const duration = typeof raw.duration === 'number' ? raw.duration : null;
  const rank = typeof raw.rank === 'number' ? raw.rank : null;
  if (id === null || title === null || author === null || duration === null || rank === null) {
    return null;
  }
  // Redondea ANTES de comprobar la positividad: `TrendingSoundSchema` exige `int().positive()`, y `0.3` (guard
  // `> 0`) se redondearía a 0, un entero NO positivo que el contrato de salida rechaza.
  const durationSeconds = Math.round(duration);
  const rank_ = Math.round(rank);
  if (durationSeconds <= 0 || rank_ <= 0) return null;
  // `coverUrl`/`link` son `string().min(1)` en el contrato: un valor ausente/no-string NO se degrada a `''`
  // (que el contrato rechazaría → 500 aguas abajo); el track se descarta como cualquier otro track a medias.
  const coverUrl = typeof raw.cover === 'string' ? raw.cover : null;
  const link = typeof raw.link === 'string' ? raw.link : null;
  if (coverUrl === null || coverUrl.length === 0 || link === null || link.length === 0) {
    return null;
  }
  return {
    id,
    title,
    author,
    coverUrl,
    link,
    durationSeconds,
    rank: rank_,
    // EL FLAG COMERCIAL DEL DATO REAL: `if_cml` (no un booleano de conveniencia). Ausente/no-booleano ⇒
    // false (conservador: sin prueba de licencia comercial, se trata como no-CML → solo orgánico).
    commercial: raw.if_cml === true,
    moods: deriveMoodTags(title),
  };
}

export function makeCreativeCenterClient(deps: CreativeCenterDeps = {}) {
  // Resuelto EN CADA llamada (no en construcción): msw reemplaza `globalThis.fetch` DESPUÉS de construir el
  // cliente en los tests (mismo razonamiento que Firecrawl T1.4). `baseUrl` overridable para el fake del E2E.
  const fetchWithTimeout = makeFetchWithTimeout(deps, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const baseUrl = deps.baseUrl ?? CREATIVE_CENTER_BASE_URL;

  /**
   * Lee la lista de Popular Music con el filtro comercial según destino (§14 pt 2). NUNCA lanza: un fallo de
   * red/HTTP/JSON degrada a `{ sounds: [], commercialOnly, warnings }` — el Advisor muestra el estado de
   * error, no una página rota. Cuando `commercialOnly`, se envía `commercialMusic=true` a la fuente Y se
   * re-filtra por `commercial` en cliente (defensa en profundidad: no confiamos en que la fuente respete el
   * filtro; el flag de cada item es la verdad).
   */
  async function fetchTrendingSounds(args: FetchTrendingSoundsArgs): Promise<TrendingSoundsResult> {
    const warnings: string[] = [];
    const commercialOnly = isCommercialOnly(args.destination);
    const params = new URLSearchParams({
      period: String(args.periodDays ?? DEFAULT_PERIOD_DAYS),
      rank_type: 'popular',
      country_code: args.countryCode ?? DEFAULT_COUNTRY,
      // El filtro de la FUENTE (§14 pt 2): pide solo CML cuando el destino incluye paid/Spark.
      commercialMusic: String(commercialOnly),
    });

    let res: Response;
    try {
      res = await fetchWithTimeout(`${baseUrl}/popular_trend/sound/list?${params.toString()}`, {
        headers: { accept: 'application/json' },
      });
    } catch (err) {
      warnings.push(`creative_center_failed_${classifyFetchError(err)}`);
      return { sounds: [], commercialOnly, sourceOk: false, warnings };
    }
    if (!res.ok) {
      warnings.push(`creative_center_status_${String(res.status)}`);
      return { sounds: [], commercialOnly, sourceOk: false, warnings };
    }
    let body: RawResponse;
    try {
      body = (await res.json()) as RawResponse;
    } catch {
      warnings.push('creative_center_body_not_json');
      return { sounds: [], commercialOnly, sourceOk: false, warnings };
    }

    // VALIDA LA FORMA RUNTIME antes de iterar. `body` es un CAST sin verificación: si `data.sounds` no es un
    // array (objeto/número/ausente), `for (const raw of ...)` lanzaría un TypeError que escaparía a `fetch...`
    // (no hay try/catch alrededor del loop) → violaría el contrato «NUNCA lanza». Y un 2xx con forma inesperada
    // (sin `data.sounds`) NO es «no hay sonidos para el filtro»: es la FUENTE respondiendo mal → `sourceOk:false`
    // (la conflación exacta que `sourceOk` existe para evitar). Ambos casos = fallo de fuente, como 404/500/no-JSON.
    const rawSounds = body.data?.sounds;
    if (!Array.isArray(rawSounds)) {
      warnings.push('creative_center_body_shape_unexpected');
      return { sounds: [], commercialOnly, sourceOk: false, warnings };
    }
    const projected: TrendingSound[] = [];
    for (const raw of rawSounds) {
      const sound = projectSound(raw);
      if (sound === null) {
        warnings.push('creative_center_sound_skipped');
        continue;
      }
      projected.push(sound);
    }

    // DEFENSA EN PROFUNDIDAD del filtro comercial (§14 pt 2): re-filtra por el flag de cada item, no solo por
    // el parámetro de la fuente. El flag `commercial` (de `if_cml`) es la verdad; si la fuente devolviera un
    // no-CML pese al `commercialMusic=true`, aquí no pasa a un destino paid.
    const sounds = commercialOnly ? projected.filter((s) => s.commercial) : projected;
    // La fuente respondió (2xx + JSON): `sourceOk=true` aunque la lista quede vacía tras el filtro comercial —
    // eso es un vacío legítimo, no una caída.
    return { sounds, commercialOnly, sourceOk: true, warnings };
  }

  return { fetchTrendingSounds };
}

export type CreativeCenterClient = ReturnType<typeof makeCreativeCenterClient>;
