// `submitGenerationForWebhook` (T4.2, §9.6): el camino de submit VÍA WEBHOOK, SIN polling. Es el
// gemelo de `runGenerate` (T4.1) para sus pasos 1-4 (resolver perfil → content_hash → persistir
// `submitting` → submit → persistir `submitted` con request_id/urls), pero DIVERGE justo ahí: NO
// pollea. La completion la conduce el webhook de fal (`POST /api/webhooks/fal` → `output.download`),
// no un poll inline.
//
// POR QUÉ EXISTE (frontera de T4.2): `runGenerate` pollea hasta completion — el camino "sin polling"
// es NUEVO. fal asigna el `request_id` AL SUBMIT; el webhook lo trae, y el handler releela la
// generación por ese id. Así que ALGUIEN tiene que dejar una fila `submitted` KEYED por el
// request_id REAL de fal antes de que llegue el webhook — eso es esta función. Sin ella, la
// Verificación no es ejecutable (no habría fila que el webhook encuentre).
//
// Lo consume el smoke `smoke-generate-webhook.ts` (la Verificación del verifier vía cloudflared) y,
// en T4.11, el executor del nodo de generación (que además tendrá `step_run_id`).
import {
  computeContentHash,
  makeFalClient,
  FalResponseError,
  type FalClientDeps,
  type GenerationInputs,
} from '@ugc/core/generation';
import {
  createGeneration,
  getModelProfile,
  updateGeneration,
  type DbClient,
  type Generation,
} from '@ugc/db';

export interface SubmitGenerationDeps {
  db: DbClient;
  /** La API key de fal EN CLARO (el caller la lee de env/secretos). */
  falKey: string;
  /** La URL PÚBLICA del webhook (`https://<túnel>/api/webhooks/fal`): fal firmará sus POST a ella. */
  webhookUrl: string;
  /** `fetch` inyectable (msw en tests); default global. Lo usa el SDK de fal. */
  fetch?: typeof globalThis.fetch;
  /** Overrides del FalClient (timeouts, concurrencia). */
  falOptions?: Pick<FalClientDeps, 'concurrency' | 'timeoutMs' | 'maxRetries'>;
}

export interface SubmitGenerationInput {
  modelProfileId: string;
  resolvedPrompt: string;
  inputs?: GenerationInputs;
  /** El step que originó el gasto (T4.11). OPCIONAL — en el camino stepless de la Verificación va NULL. */
  stepRunId?: string;
  variantId?: string;
}

/**
 * Encola una generación en fal CON `webhookUrl` y deja la fila `generation` en `submitted` con el
 * `request_id`/`status_url`/`response_url` que fal devuelve. NO pollea: el webhook conducirá la
 * completion. Devuelve la fila `submitted`. LANZA si fal falla en el submit (la fila queda
 * `submitting` reconciliable, mismo contrato que `runGenerate`).
 */
export async function submitGenerationForWebhook(
  deps: SubmitGenerationDeps,
  input: SubmitGenerationInput,
): Promise<Generation> {
  const { db } = deps;
  const inputs = input.inputs ?? {};

  // 1) Resolver el model_profile (NOT NULL): sin modelo no hay generación.
  const profile = await getModelProfile(db, input.modelProfileId);
  if (profile === undefined) {
    throw new FalResponseError(
      `submitGenerationForWebhook: model_profile ${input.modelProfileId} no existe`,
    );
  }

  // 2) content_hash de dedupe (§9.6), idéntico al de `runGenerate`.
  const contentHash = computeContentHash({
    resolvedPrompt: input.resolvedPrompt,
    modelProfileId: input.modelProfileId,
    inputs,
  });

  // 3) Persistir la INTENCIÓN en `submitting` ANTES del submit (§9.6): un crash entre medias deja
  //    una fila reconciliable, no un job facturándose en fal sin rastro nuestro.
  const created = await createGeneration(db, {
    modelProfileId: input.modelProfileId,
    stepRunId: input.stepRunId,
    variantId: input.variantId,
    resolvedPrompt: input.resolvedPrompt,
    inputs,
    contentHash,
    status: 'submitting',
    startedAt: new Date(),
  });

  const fal = makeFalClient({
    credentials: deps.falKey,
    ...(deps.fetch !== undefined ? { fetch: deps.fetch } : {}),
    ...deps.falOptions,
  });

  // 4) SUBMIT CON webhookUrl. fal notificará la completion a esa URL (firmada ED25519) en vez de que
  //    nosotros pollemos. Las URLs devueltas se persisten TAL CUAL (nunca reconstruidas) — T4.3 las
  //    usa para reconciliar si el webhook nunca llega.
  const submitted = await fal.submit(
    profile.falEndpoint,
    { prompt: input.resolvedPrompt, ...inputs },
    { webhookUrl: deps.webhookUrl },
  );
  return updateGeneration(db, created.id, {
    status: 'submitted',
    falRequestId: submitted.requestId,
    statusUrl: submitted.statusUrl,
    responseUrl: submitted.responseUrl,
    falStatusPayload: submitted.raw,
  });
}
