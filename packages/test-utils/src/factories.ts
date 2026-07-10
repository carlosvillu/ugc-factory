// Factories de datos de prueba (db-integration.md §9 checklist): construyen
// filas válidas con overrides, para que cuando el schema evolucione se arregle la
// factory y no cincuenta tests. Crece tarea a tarea (makeBrief, makeVariant… con
// sus tablas).
import { newUlid } from '@ugc/core/contracts';
import type { Angle, ProductBrief, RawContent, VisualAnalysis } from '@ugc/core/contracts';
import type {
  NewAsset,
  NewBrandKit,
  NewPipelineRun,
  NewProductBrief,
  NewProject,
  NewStepRun,
  NewUrlAnalysis,
} from '@ugc/db';

export function makeProject(overrides: Partial<NewProject> = {}): NewProject {
  return {
    name: 'Proyecto de prueba',
    ...overrides,
  };
}

/**
 * Fila válida de `pipeline_run` con overrides. Requiere un `projectId` real
 * (FK a project): el test crea el project antes y lo pasa. Los tests del
 * orquestador (T0.7a) insertan estos fixtures con Drizzle raw — la creación de
 * run vía API/servicio es T0.7b, fuera de alcance.
 */
export function makePipelineRun(
  overrides: Partial<NewPipelineRun> & Pick<NewPipelineRun, 'projectId'>,
): NewPipelineRun {
  return {
    id: newUlid(),
    kind: 'full',
    status: 'pending',
    ...overrides,
  };
}

/**
 * Fila válida de `step_run` con overrides. Requiere un `runId` real (FK a
 * pipeline_run). `id` se genera aquí para poder referenciarlo en `dependsOn` de
 * otros steps antes del INSERT (ULIDs disponibles pre-insert, db.md §1).
 */
export function makeStepRun(
  overrides: Partial<NewStepRun> & Pick<NewStepRun, 'runId'>,
): NewStepRun {
  return {
    id: newUlid(),
    nodeKey: 'N0',
    status: 'pending',
    dependsOn: [],
    ...overrides,
  };
}

/**
 * Fila válida de `asset` con overrides (T0.5). `id` se genera aquí (ULID) para que
 * el test/seed pueda referenciarlo (p. ej. como storage_key) antes del INSERT. Los
 * valores por defecto describen un asset trivial; el test real que sube un fichero
 * sobrescribe `bytes`/`checksum` con lo que devuelve `StorageAdapter.put`.
 */
export function makeAsset(overrides: Partial<NewAsset> = {}): NewAsset {
  const id = overrides.id ?? newUlid();
  return {
    id,
    kind: 'other',
    storageKey: `${id}.bin`,
    mime: 'application/octet-stream',
    bytes: 0,
    checksum: '',
    ...overrides,
  };
}

// ── Contratos del análisis (T1.1) ──────────────────────────────────────────
// Factories que devuelven objetos VÁLIDOS según su schema Zod (unit-core.md §1):
// los tests inválidos parten de estos y rompen exactamente una cosa (§2 "fixtures
// inválidos = fixture válido + mutación dirigida"). Devuelven contratos (no filas de
// BD): por eso importan de `@ugc/core/contracts`, no de `@ugc/db`.

/** Un ángulo válido (5 hooks-cardinalidad 2–3 respetada). El compositor de matriz
 *  necesita `angles[]` con `filename_code` estable; aquí solo el contrato base. */
export function makeAngle(overrides: Partial<Angle> = {}): Angle {
  return {
    name: 'POV: tu piel al despertar',
    framework: 'pain_point',
    target_segment: 'Mujeres 25-40 con piel sensible',
    awareness_level: 'problem_aware',
    hook_examples: [
      'POV: llevas años probando cremas que no hacen nada',
      'Y si el problema no era tu piel',
    ],
    key_message: 'Hidratación real que se nota al despertar',
    objection_addressed: null,
    social_proof_used: null,
    cta: 'Pruébalo 30 días sin riesgo',
    suggested_tone: 'authentic',
    suggested_assets: [],
    ...overrides,
  };
}

/**
 * ProductBrief canónico VÁLIDO (Apéndice A), modo `url` por defecto: 5 ángulos
 * (mínimo de la cardinalidad), source_url presente, platform ≠ manual. Para el modo
 * manual usa `makeBrief({ meta: { ...manual, source_url: null, platform: 'manual' } })`.
 */
export function makeBrief(overrides: Partial<ProductBrief> = {}): ProductBrief {
  const base: ProductBrief = {
    meta: {
      source_url: 'https://tienda.example.com/products/serum',
      platform: 'shopify',
      language: 'es',
      extracted_at: '2026-07-10T12:00:00.000Z',
      extraction_confidence: 'high',
      warnings: [],
    },
    product: {
      name: 'Sérum Hidratante 24h',
      brand_name: 'Marca Ejemplo',
      category: 'skincare',
      subcategory: 'hidratación',
      one_liner: 'El sérum que hidrata 24 horas y se nota al despertar',
      description: 'Sérum con ácido hialurónico para piel sensible.',
      features: [
        { feature: 'Ácido hialurónico', evidence: 'con ácido hialurónico de bajo peso molecular' },
      ],
      how_it_works: 'Se aplica por la noche sobre la piel limpia.',
      variants: ['30ml', '50ml'],
    },
    benefits: [
      {
        benefit: 'Hidrata 24 horas',
        linked_feature: 'Ácido hialurónico',
        emotional_outcome: 'Te ves descansada',
        type: 'functional',
      },
    ],
    audience: {
      primary_segment: 'Mujeres 25-40 con piel sensible',
      segments: [
        {
          name: 'Piel sensible',
          demographics: 'Mujeres 25-40, urbanas',
          psychographics: 'Buscan ingredientes seguros y probados',
          awareness_level: 'problem_aware',
          usage_context: 'Rutina de noche',
          avatar_hint: 'Creadora 30 años, estilo natural, baño luminoso',
        },
      ],
      not_for: 'Pieles muy grasas que buscan matificar',
    },
    pain_points: [
      {
        pain: 'La piel tira después de lavarla',
        severity: 'high',
        current_alternative: 'Cremas genéricas que no penetran',
        evidence: null,
      },
    ],
    objections: [
      {
        objection: 'Es caro',
        type: 'price',
        counter: 'Dura 3 meses, sale a menos que un café',
        counter_source: 'inferred',
      },
    ],
    social_proof: {
      rating: 4.7,
      review_count: 1240,
      quotes: [{ quote: 'Mi piel cambió en una semana', author: 'Ana G.' }],
      badges: ['Visto en Vogue'],
      stats: ['+50.000 clientes'],
    },
    brand: {
      tone_of_voice: 'cercana y experta',
      recommended_ad_tone: 'authentic',
      visual_style: {
        palette: ['#F5E9E2', '#3A3A3A'],
        typography: 'serif elegante',
        aesthetic: 'premium minimal',
        photography_style: 'lifestyle luminoso',
      },
      banned_or_risky_claims: ['cura el acné'],
    },
    pricing: {
      price: '34,90 €',
      currency: 'EUR',
      compare_at_price: '44,90 €',
      active_offer: '10% primera compra',
      guarantee: '30 días',
      shipping: 'Gratis desde 30€',
      positioning: 'premium',
    },
    assets: {
      hero_image_url: 'https://cdn.example.com/serum-hero.jpg',
      images: [
        {
          url: 'https://cdn.example.com/serum-hero.jpg',
          kind: 'packshot',
          has_overlay_text: false,
          background: 'clean',
          video_suitability: 'hero',
        },
      ],
      video_urls: [],
    },
    // 5 ángulos = mínimo de la cardinalidad 5–10 (divergencia 3, solo Zod).
    angles: Array.from({ length: 5 }, (_unused, i) =>
      makeAngle({ name: `Ángulo ${String(i + 1)}` }),
    ),
  };
  return { ...base, ...overrides };
}

/**
 * RawContent canónico VÁLIDO, modo `url` por defecto. Para el modo manual:
 * `makeRawContent({ source: 'manual', url: null, platform: 'manual' })`.
 */
export function makeRawContent(overrides: Partial<RawContent> = {}): RawContent {
  const base: RawContent = {
    source: 'url',
    url: 'https://tienda.example.com/products/serum',
    platform: 'shopify',
    markdown: '# Sérum Hidratante 24h\n\nCon ácido hialurónico.',
    images: [{ url: 'https://cdn.example.com/serum-hero.jpg', alt: 'Sérum' }],
    branding: { palette: ['#F5E9E2'], typography: 'serif' },
    product: {
      title: 'Sérum Hidratante 24h',
      price: '34,90 €',
      currency: 'EUR',
      variants: ['30ml'],
    },
    screenshotRef: 'screenshots/serum.png',
  };
  return { ...base, ...overrides };
}

// ── Filas de BD del análisis (T1.2) ─────────────────────────────────────────
// Estas devuelven FILAS de tabla (`New*` de @ugc/db), no contratos: los tests de
// integración de packages/db las insertan con Drizzle. `makeBrief` (arriba)
// devuelve el CONTRATO ProductBrief y se reutiliza como `data` jsonb del row.

/**
 * Fila válida de `url_analysis` con overrides. Requiere un `projectId` real (FK a
 * project, NOT NULL): el test crea el project antes y lo pasa. `id` se genera aquí
 * (ULID) para poder referenciarlo en `product_brief.urlAnalysisId` pre-insert.
 */
export function makeUrlAnalysis(
  overrides: Partial<NewUrlAnalysis> & Pick<NewUrlAnalysis, 'projectId'>,
): NewUrlAnalysis {
  return {
    id: newUlid(),
    source: 'url',
    platform: 'shopify',
    status: 'pending',
    // NOT NULL en §12: jsonb opaco. Contenido crudo mínimo del scraping.
    rawContent: { markdown: '# Producto', images: [] },
    ...overrides,
  };
}

/**
 * Fila válida de `product_brief` con overrides. Requiere un `urlAnalysisId` real
 * (FK a url_analysis, NOT NULL). `data` es el contrato ProductBrief (jsonb opaco):
 * por defecto el canónico de `makeBrief()`.
 */
export function makeProductBrief(
  overrides: Partial<NewProductBrief> & Pick<NewProductBrief, 'urlAnalysisId'>,
): NewProductBrief {
  return {
    id: newUlid(),
    data: makeBrief(),
    language: 'es',
    version: 1,
    editedByUser: false,
    status: 'draft',
    ...overrides,
  };
}

/**
 * Fila válida de `brand_kit` con overrides. `source` por defecto `manual` sin
 * dominio (el modo que convive en N filas por el UNIQUE parcial); los tests del
 * constraint sobrescriben `domain`/`source`. `projectId`/`logoAssetId` opcionales.
 */
export function makeBrandKit(overrides: Partial<NewBrandKit> = {}): NewBrandKit {
  return {
    id: newUlid(),
    source: 'manual',
    domain: null,
    // NOT NULL en §12 (solo project_id/domain/logo_asset_id/typography son `?`).
    palette: ['#F5E9E2', '#3A3A3A'],
    toneOfVoice: 'cercana y experta',
    aesthetic: 'premium minimal',
    extractedAt: new Date('2026-07-10T12:00:00.000Z'),
    ...overrides,
  };
}

/** VisualAnalysis canónico VÁLIDO (salida del paso de visión, P3). */
export function makeVisualAnalysis(overrides: Partial<VisualAnalysis> = {}): VisualAnalysis {
  const base: VisualAnalysis = {
    images: [
      {
        url: 'https://cdn.example.com/serum-hero.jpg',
        kind: 'packshot',
        has_overlay_text: false,
        background: 'clean',
        video_suitability: 'hero',
      },
    ],
    hero_image_url: 'https://cdn.example.com/serum-hero.jpg',
    brand_style: {
      palette: ['#F5E9E2'],
      aesthetic: 'premium minimal',
      photography_style: 'lifestyle',
    },
    rendered_social_proof: { rating: 4.7, review_count: 1240, quotes: ['Mi piel cambió'] },
  };
  return { ...base, ...overrides };
}
