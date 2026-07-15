// EL COMPARADOR DE `pnpm fal:verify` (T3.4) — LÓGICA PURA, sin red, sin BD.
//
// La Entrega de T3.4: un comando que LEE los metadatos PÚBLICOS de fal (el `llms.txt` por modelo:
// `https://fal.ai/models/<endpoint>/llms.txt`, gratis, NO factura) y contrasta el precio que el
// seed declara contra el publicado, reportando OK / DIVERGENCIA / no-verificable por perfil.
//
// SEPARACIÓN DELIBERADA (skill testing §4 + brief): el FETCH y la escritura en BD viven en el
// script `packages/db/scripts/fal-verify.ts`; AQUÍ vive solo el parseo + la comparación, que son
// puros y deterministas. Así el GATE testea esta lógica con FIXTURES REALES capturados de fal
// (`packages/core/test/fixtures/fal-llms/*.txt`), SIN que la suite golpee la red — y el control
// negativo de la Verificación ("un precio falso en el seed hace que lo detecte") es un test puro.
//
// POR QUÉ EL PARSER MIRA EL `llms.txt` y NO la model page HTML: la model page es una SPA renderizada
// en JS (curl solo trae el shell), pero fal sirve un `llms.txt` ESTÁTICO por modelo con el precio en
// texto plano. Verificado 2026-07-15 sobre 15 endpoints. fal usa DOS formatos en ese fichero:
//   1. estructurado:  `- **Price**: $0.0562 per seconds`
//   2. prosa:         `Your request will cost $0.08 per image` / `charged **$0.20** ... per second`
// El parser reconoce AMBOS y, si no encuentra ninguno, devuelve null → el perfil es `unverifiable`
// (un endpoint 404/renombrado o una página sin precio se REPORTA, no crashea — requisito del brief).
import type { CostUnit, ModelCost, ModelProfileSeed } from './contracts';

/** Un precio ya normalizado leído del `llms.txt` de fal: misma forma que `ModelCost` del seed. */
export interface ParsedFalPrice {
  unit: CostUnit;
  amountCents: number;
  /** El fragmento literal del que se extrajo (para el report — evidencia de QUÉ leyó). */
  raw: string;
}

export type ModelVerifyOutcome = 'ok' | 'divergence' | 'unverifiable';

export interface ModelVerifyResult {
  falEndpoint: string;
  outcome: ModelVerifyOutcome;
  /** El coste que el seed declara (en la unidad del seed). */
  seedCost: ModelCost;
  /** Lo leído de fal, normalizado a la unidad del seed para poder comparar. `null` si no se pudo leer. */
  falCost: ParsedFalPrice | null;
  /** La razón legible del veredicto (nombra los dos números al divergir — evidencia por perfil). */
  detail: string;
}

// ── Normalización de unidad ────────────────────────────────────────────────────
// fal escribe la unidad en PLURAL y con variantes; el seed la guarda en singular canónica.
// Mapear a la MISMA unidad canónica es lo que hace la comparación honesta (no comparar strings):
// $0,35 "per minutes" del seed y "per minute" de fal son la MISMA unidad.
const UNIT_ALIASES: Record<string, CostUnit> = {
  second: 'second',
  seconds: 'second',
  'compute second': 'second',
  'compute seconds': 'second',
  minute: 'minute',
  minutes: 'minute',
  image: 'image',
  images: 'image',
  megapixel: 'megapixel',
  megapixels: 'megapixel',
  video: 'video',
  videos: 'video',
  request: 'video',
};

/** Factores para reconciliar unidades de TIEMPO entre sí (fal a veces cotiza /min y el seed /s). */
const SECONDS_PER: Partial<Record<CostUnit, number>> = { second: 1, minute: 60 };

function canonicalUnit(rawUnit: string): CostUnit | null {
  const key = rawUnit.trim().toLowerCase();
  const alias = UNIT_ALIASES[key];
  if (alias !== undefined) return alias;
  // "1000 characters" / "1k chars" → 1k_chars
  if (/1000\s*characters?/.test(key) || /1k\s*chars?/.test(key)) return '1k_chars';
  return null;
}

/**
 * Extrae `{ unit, amountCents }` del `llms.txt` público de un modelo fal. Devuelve el PRIMER precio
 * base que encuentra (los tiers 4k/con-audio de Veo se modelan con `params` en F4, no aquí).
 * `null` si el texto no contiene un precio reconocible → el perfil será `unverifiable`.
 *
 * `amountCents`: fal cotiza en DÓLARES ($0.0562/s); se multiplica por 100 → céntimos (5,62). Float
 * a propósito (precios sub-céntimo por unidad, ver `ModelCostSchema`).
 */
export function parseFalPrice(llmsTxt: string): ParsedFalPrice | null {
  // fal usa VARIAS redacciones para el precio en el llms.txt. Se recogen TODAS las candidatas y se
  // elige la que aparece ANTES en el texto (el precio HEADLINE/base va primero; los tiers 4k/audio/
  // overage vienen después — se modelan con `params` en F4). Cada candidata lleva su índice.
  const candidates: { index: number; price: ParsedFalPrice }[] = [];

  // Patrón A — `per <unidad>`: cubre `- **Price**: $0.0562 per seconds`, `will cost $0.08 per image`,
  // `charged **$0.20** ... per second`. El `[^$\n]{0,40}?` tolera `**`, «of generated audio», etc.,
  // sin cruzar de línea ni de importe.
  const perRe =
    /\$\s*(\d+(?:\.\d+)?)[^$\n]{0,40}?\bper\b\s+([0-9a-z ]+?)(?:\.|,|;|:|\)|\bfor\b|\bof\b|$)/gim;
  for (let m = perRe.exec(llmsTxt); m !== null; m = perRe.exec(llmsTxt)) {
    const dollars = Number(m[1]);
    const unit = canonicalUnit(m[2] ?? '');
    if (unit === null || !Number.isFinite(dollars)) continue;
    candidates.push({
      index: m.index,
      price: { unit, amountCents: dollars * 100, raw: m[0].replace(/\s+/g, ' ').trim() },
    });
  }

  // Patrón B — `$X for videos up to N seconds` (LatentSync y otros lipsync facturan por VÍDEO/request,
  // no `per <unidad>`). Es un precio por vídeo aunque no lleve la palabra «per».
  const forVideoRe = /\$\s*(\d+(?:\.\d+)?)\s+for\s+(?:a\s+)?videos?\b/gim;
  for (let m = forVideoRe.exec(llmsTxt); m !== null; m = forVideoRe.exec(llmsTxt)) {
    const dollars = Number(m[1]);
    if (!Number.isFinite(dollars)) continue;
    candidates.push({
      index: m.index,
      price: { unit: 'video', amountCents: dollars * 100, raw: m[0].replace(/\s+/g, ' ').trim() },
    });
  }

  // Patrón C — unidad ANTES del importe: `For every second of video ... charged $0.20` (Veo 3.1
  // factura así el precio BASE; los tiers 4k/audio vienen después y los descarta el earliest-index).
  const unitFirstRe =
    /\bfor\s+(?:every|each)\s+(second|minute|image|megapixel)\b[^$\n]{0,60}?charged\s*\**\s*\$\s*(\d+(?:\.\d+)?)/gim;
  for (let m = unitFirstRe.exec(llmsTxt); m !== null; m = unitFirstRe.exec(llmsTxt)) {
    const unit = canonicalUnit(m[1] ?? '');
    const dollars = Number(m[2]);
    if (unit === null || !Number.isFinite(dollars)) continue;
    candidates.push({
      index: m.index,
      price: { unit, amountCents: dollars * 100, raw: m[0].replace(/\s+/g, ' ').trim() },
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.index - b.index);
  return candidates[0]?.price ?? null;
}

/** Reconcilia el precio leído a la unidad del seed. `null` si las unidades son inconciliables. */
function toSeedUnit(fal: ParsedFalPrice, seedUnit: CostUnit): number | null {
  if (fal.unit === seedUnit) return fal.amountCents;
  // Tiempo↔tiempo: convertir vía segundos ($/min = $/s × 60).
  const falSecs = SECONDS_PER[fal.unit];
  const seedSecs = SECONDS_PER[seedUnit];
  if (falSecs !== undefined && seedSecs !== undefined) {
    return (fal.amountCents / falSecs) * seedSecs;
  }
  return null;
}

// Tolerancia relativa de la comparación de precios. El precio de fal y el del seed son el MISMO
// dato (céntimos), así que la horquilla es estrecha: 1% absorbe solo el redondeo del float, no una
// diferencia real de precio. Un precio FALSO inyectado (el control negativo) cae MUY fuera de esto.
const PRICE_TOLERANCE = 0.01;

/**
 * Contrasta UN perfil del seed contra su `llms.txt` de fal. NO lanza: devuelve el veredicto.
 *   - `unverifiable`: no se pudo leer un precio (404, página sin precio, unidad inconciliable).
 *   - `divergence`:   el precio del seed y el de fal difieren más de `PRICE_TOLERANCE`.
 *   - `ok`:           coinciden (dentro de tolerancia).
 *
 * `llmsTxt === null` = el fetch falló (timeout/404): `unverifiable`, no crash (requisito del brief).
 */
export function compareModelProfile(
  profile: Pick<ModelProfileSeed, 'falEndpoint' | 'cost'>,
  llmsTxt: string | null,
): ModelVerifyResult {
  const seedCost = profile.cost;
  if (llmsTxt === null) {
    return {
      falEndpoint: profile.falEndpoint,
      outcome: 'unverifiable',
      seedCost,
      falCost: null,
      detail: 'no se pudo leer el llms.txt de fal (404/timeout/red)',
    };
  }

  const fal = parseFalPrice(llmsTxt);
  if (fal === null) {
    return {
      falEndpoint: profile.falEndpoint,
      outcome: 'unverifiable',
      seedCost,
      falCost: null,
      detail: 'el llms.txt de fal no contiene un precio reconocible',
    };
  }

  const falInSeedUnit = toSeedUnit(fal, seedCost.unit);
  if (falInSeedUnit === null) {
    return {
      falEndpoint: profile.falEndpoint,
      outcome: 'divergence',
      seedCost,
      falCost: fal,
      detail: `unidad incompatible: seed cobra por "${seedCost.unit}", fal por "${fal.unit}" (${fal.raw})`,
    };
  }

  const diff = Math.abs(falInSeedUnit - seedCost.amountCents);
  const tolerance = Math.max(seedCost.amountCents, falInSeedUnit) * PRICE_TOLERANCE;
  if (diff > tolerance) {
    return {
      falEndpoint: profile.falEndpoint,
      outcome: 'divergence',
      seedCost,
      falCost: fal,
      detail:
        `precio distinto: seed ${String(seedCost.amountCents)} c/${seedCost.unit}, ` +
        `fal ${falInSeedUnit.toFixed(4)} c/${seedCost.unit} (${fal.raw})`,
    };
  }

  return {
    falEndpoint: profile.falEndpoint,
    outcome: 'ok',
    seedCost,
    falCost: fal,
    detail: `precio confirmado: ${String(seedCost.amountCents)} c/${seedCost.unit} (${fal.raw})`,
  };
}
