'use client';

// CP2 — MATRIZ Y CONFIRMACIÓN DE GASTO (T2.3, PRD §7.2 N4). El checkpoint donde el usuario elige
// QUÉ lote se genera y AUTORIZA lo que va a costar. N4 compone una matriz propuesta, el step pausa
// en `waiting_approval`, y aquí el usuario ajusta la config, ve el coste al vuelo y confirma.
//
// LAYOUT — mockup `docs/mockups/batch-matrix.dc.html` (VINCULANTE, frontend §4b): columna de
// configuración a la izquierda (objetivo · ángulos · persona · tier + idiomas), RAIL DE COSTE a la
// derecha (total en grande, aviso de gasto elevado, desglose por segmento, botón de confirmar) y la
// MATRIZ PLANIFICADA debajo (una fila por variante, con su `filename_code`).
//
// ⛔ DEL MOCKUP SE TOMA EL LAYOUT. LA LÓGICA, NO — y esto no es una preferencia de estilo:
//
//   · Su `<script>` trae un modelo de coste INVENTADO (precios de clip hardcodeados, presets de
//     12/28/48 s, un `compute()` que hace la aritmética en el cliente y un `buildVariants()` que
//     concatena el `filename_code` a mano). El backend REAL dice otra cosa: los presets son
//     12/30/45 s (`strategy/presets.ts`), el coste sale de `estimateBatchCost` sobre la tabla
//     `recipe` (Apéndice B, recalibrable en T3.4) y el `filename_code` lo produce `composeMatrix`.
//   · **NINGÚN NÚMERO DE DINERO SE CALCULA AQUÍ** (decisión vinculante de T2.3 + la regla «todo vía
//     API REST» de la skill): cada cambio del panel pide `POST /api/batches/estimate`, que compone
//     y estima con la MISMA función que usará la confirmación. Una UI verde contra números
//     inventados y divergente de lo que el sistema cobra es el anti-patrón que este proyecto ya ha
//     sufrido cinco veces (principio 9 de la skill testing).
//
// DOS CONTRADICCIONES DEL MOCKUP, RECONCILIADAS CONTRA EL CONTRATO:
//
//   1. El mockup deja elegir HOOK A HOOK (un checkbox por hook). `ComposeMatrixInput` no lo
//      soporta: acepta `angleIndices` + `hooksPerAngle` (el compositor TOMA los `hook_examples` del
//      ángulo y los completa con la librería). Manda el contrato — y la Entrega de T2.3 dice
//      exactamente eso: «selección de ángulos (cards con hooks del brief)». Los hooks se MUESTRAN
//      en la card; lo que se elige es el ángulo y CUÁNTOS hooks entran por ángulo.
//   2. El mockup mezcla «objetivo» con «modo hook-testing». En el contrato NO son dos cosas:
//      `ad_batch.objective` es el enum `hook_test|conversion|story` (`AdObjectiveSchema`) y el modo
//      hook-testing se DERIVA de él (`matrix.ts`: `sharedBodyAndCta = objective === 'hook_test'`).
//      O sea: las tres cards del mockup SÍ son los tres objetivos reales. No hay toggle aparte.
import { useEffect, useState } from 'react';
import type { BatchConfig, BatchEstimate, ProductBrief } from '@ugc/core/contracts';
import type { Persona } from '@ugc/core/persona';
import { ApiError, batchActions, personaActions, runActions } from '@/lib/api-client';
import { formatCostRange } from '@/lib/money';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { MetricsTable, type MetricsTableColumn } from '@/components/ui/metrics-table';
import { Select } from '@/components/ui/select';

export interface MatrixPanelProps {
  /** El step de CP2 (N4 en `waiting_approval`): a él va la aprobación con la decisión, y de él
   *  saca el SERVIDOR el brief con el que estima y crea. El panel NO maneja un `briefId`: si lo
   *  tuviera, tendría que mandarlo — y de qué brief se compone el lote no lo elige el cliente. */
  stepId: string;
  brief: ProductBrief;
  /** La config que N4 propuso: el punto de partida del panel. */
  config: BatchConfig;
}

/** Los tres objetivos de `AdObjectiveSchema` con su copy. Los SEGUNDOS los pone el servidor (salen
 *  de `DURATION_PRESETS`, §8.4) y llegan en el plan estimado: aquí no se escribe ninguna duración
 *  —el mockup escribía 12/28/48 y el sistema usa 12/30/45—, solo la horquilla de §8.4 que es texto
 *  del PRD, no un número que el código deba conocer. */
const OBJECTIVES = [
  {
    value: 'hook_test' as const,
    label: 'Hook testing',
    range: '8–15 s',
    desc: 'Body y CTA compartidos por ángulo (se pagan una vez)',
  },
  {
    value: 'conversion' as const,
    label: 'Conversión',
    range: '21–34 s',
    desc: 'Guion completo por variante',
  },
  {
    value: 'story' as const,
    label: 'Storytelling',
    range: '35–60 s',
    desc: 'Hook → problema → objeciones → CTA',
  },
];

/** Los tres tiers de `RecipeTierSchema`. SIN precios hardcodeados (el mockup los traía: «$0.3–1.7 /
 *  var.»): el precio real está en la tabla `recipe` y llega en la estimación — escribirlo aquí sería
 *  una segunda verdad que T3.4 (que recalibra las recetas) dejaría obsoleta en silencio. */
const TIERS = [
  { value: 'test' as const, label: 'Test', desc: 'Hook-testing masivo y borradores' },
  { value: 'standard' as const, label: 'Standard', desc: 'Producción por defecto' },
  { value: 'premium' as const, label: 'Premium', desc: 'Piezas hero' },
];

/** Los idiomas que la librería sembrada cubre (§17: «el seed inicial cubre es + en»). */
const LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
];

/** Umbral de «gasto elevado» en céntimos: el aviso ámbar del mockup. NO es un límite (el usuario
 *  manda), es una fricción deliberada — CP2 existe para que confirmar un lote caro sea un acto
 *  consciente. El presupuesto mensual REAL (§16, `app_setting`) es otra cosa y vive en /spend. */
const HIGH_SPEND_CENTS = 2000;

/** Las columnas de la matriz planificada. El ORDEN es contractual: el E2E localiza el idioma y el
 *  `filename_code` por posición (`td:nth-child(...)`), así que reordenarlas rompe la Verificación
 *  de T2.3 — que es exactamente lo que debe pasar si alguien cambia lo que el usuario está mirando
 *  al confirmar un gasto. `mono` en las columnas de dato-máquina (idioma, duración, código, coste). */
const MATRIX_COLUMNS: MetricsTableColumn[] = [
  { key: 'angle', label: 'Ángulo', width: '1.4fr' },
  { key: 'hook', label: 'Hook', width: '2.6fr' },
  { key: 'persona', label: 'Persona', width: '1fr' },
  { key: 'language', label: 'Idi.', width: '0.5fr', mono: true },
  { key: 'duration', label: 'Dur.', width: '0.5fr', mono: true },
  { key: 'filenameCode', label: 'filename_code', width: '2.4fr', mono: true },
  { key: 'cost', label: 'Coste', width: '1fr', mono: true, align: 'right' },
];

export function MatrixPanel({ stepId, brief, config: initialConfig }: MatrixPanelProps) {
  const [config, setConfig] = useState<BatchConfig>(initialConfig);
  // EL RESULTADO SE GUARDA JUNTO A LA CONFIG QUE LO PRODUJO, y no en tres `useState` sueltos
  // (`estimate` + `estimating` + `error`). Dos razones, y la segunda es la que importa:
  //
  //  1. «Estoy recalculando» es un dato DERIVADO —`result.config !== config`—, no un estado que
  //     alguien tenga que acordarse de subir y bajar. Un `setEstimating(true)` síncrono dentro del
  //     effect además dispara renders en cascada (el linter lo veta con razón).
  //  2. **Un coste no puede sobrevivir a la config que lo generó.** Con estados sueltos, el
  //     intervalo entre «el usuario cambia el tier» y «llega el estimado nuevo» pinta el coste
  //     VIEJO junto a la config NUEVA — y el botón de confirmar sigue activo. El usuario podría
  //     autorizar un lote Premium viendo el precio del Test. Atándolos, ese estado es
  //     inexpresable: si la config no es la del resultado, no hay número que enseñar.
  const [result, setResult] = useState<{
    config: BatchConfig;
    estimate: BatchEstimate | null;
    error: string | null;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** El error de CONFIRMAR (no el de estimar): lo escribe un event handler, así que es estado
   *  propio y no se deriva de nada. Se limpia al reintentar. */
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Persona[]>([]);

  const fresh = result !== null && result.config === config;
  const estimate = fresh ? result.estimate : null;
  const error = (fresh ? result.error : null) ?? confirmError;
  const estimating = !fresh;

  // Las personas SUGERIDAS por el `avatar_hint` del segmento (T2.0, §11). Se piden al SERVIDOR
  // (`/api/personas/candidates`), que aplica la regla pura `matchPersonas`: filtrar la librería
  // entera en el navegador sería reimplementar la regla — dos verdades sobre quién es compatible.
  const avatarHint = brief.audience.segments[0]?.avatar_hint ?? '';
  useEffect(() => {
    if (avatarHint === '') return;
    let cancelled = false;
    personaActions
      .candidates(avatarHint)
      .then((res) => {
        if (!cancelled) setCandidates(res.candidates.map((c) => c.persona));
      })
      .catch(() => {
        // Sin candidatas el panel sigue siendo usable: el lote se compone con personas en rotación
        // (o sin ninguna, y el plan lo DICE — `personaSelection`). Degradar, no bloquear.
      });
    return () => {
      cancelled = true;
    };
  }, [avatarHint]);

  // EL COSTE, AL VUELO, DESDE EL SERVIDOR. Es una sincronización con un sistema externo (el
  // precio vive en la tabla `recipe`, no en el cliente), que es el caso 2 de `components.md` §4 —
  // el único en el que un Effect es la herramienta correcta. Lo que NO se hace es escribir estado
  // síncrono al entrar: el resultado se guarda ATADO a su config y «recalculando» se deriva.
  useEffect(() => {
    let cancelled = false;
    batchActions
      .estimate(stepId, config)
      .then((estimate) => {
        if (!cancelled) setResult({ config, estimate, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Una config imposible (ángulos sin hooks en el idioma pedido) llega como 400 con el
        // motivo de core. Se PINTA: es información accionable, no un fallo del sistema. Y el
        // estimado va a `null` — enseñar el coste anterior junto a un error sería ofrecer
        // confirmar un lote que ya no es el que está configurado.
        setResult({
          config,
          estimate: null,
          error: e instanceof ApiError ? e.message : 'No se pudo estimar el coste del lote',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [stepId, config]);

  /** Cambia la config (y con ella, el coste: el effect de arriba lo re-pide). */
  function update(patch: Partial<BatchConfig>) {
    setConfirmError(null);
    setConfig((prev) => ({ ...prev, ...patch }));
  }

  function toggleAngle(index: number) {
    const selected = config.angleIndices.includes(index)
      ? config.angleIndices.filter((i) => i !== index)
      : [...config.angleIndices, index].sort((a, b) => a - b);
    // NUNCA se queda sin ángulos: `BatchConfigSchema` exige ≥1 y `composeMatrix` lanzaría. La UI
    // no ofrece un estado que el contrato prohíbe (des-seleccionar el último no hace nada).
    if (selected.length === 0) return;
    update({ angleIndices: selected });
  }

  function toggleLanguage(code: string) {
    const selected = config.languages.includes(code)
      ? config.languages.filter((l) => l !== code)
      : [...config.languages, code];
    if (selected.length === 0) return; // ≥1 idioma, por el mismo motivo
    update({ languages: selected });
  }

  /** Fijar una persona, o dejar que roten (§11). `personaId` viaja SOLO con `fixed` — el contrato
   *  lo exige (`BatchConfigSchema.refine`), así que la UI no puede construir el estado inválido. */
  function selectPersona(id: string | null) {
    if (id === null) {
      setConfig((prev) => {
        const { personaId: _dropped, ...rest } = prev;
        return { ...rest, personaMode: 'rotate' };
      });
      return;
    }
    setConfig((prev) => ({ ...prev, personaMode: 'fixed', personaId: id }));
  }

  /**
   * CONFIRMAR EL GASTO: aprueba el checkpoint con la DECISIÓN (`kind: 'matrix'` + la config). El
   * servidor recompone la matriz y crea el `ad_batch` + sus `ad_variant` en `planned`, todo en la
   * misma transacción que la transición del step. La UI no manda la matriz ni el coste: mandar el
   * plan sería dejar al cliente escribir las filas que se van a facturar.
   *
   * Sin optimistic update (canvas.md §5): el estado nuevo del step llega por SSE y el canvas se
   * repinta solo. Lo que sí se pinta al instante es el resultado del POST (el lote creado).
   */
  async function onConfirm() {
    setConfirming(true);
    setConfirmError(null);
    try {
      await runActions.approve(stepId, { kind: 'matrix', config });
      // El step deja `waiting_approval` (por SSE) ⇒ este panel se desmonta solo y la vista cockpit
      // vuelve. No hay estado «confirmado» que mantener aquí.
    } catch (e) {
      setConfirmError(e instanceof ApiError ? e.message : 'No se pudo crear el lote');
      setConfirming(false);
    }
  }

  const plan = estimate?.plan ?? null;
  const total = estimate?.estimate.total ?? null;
  const variantCount = plan?.variants.length ?? 0;
  const highSpend = total !== null && total.maxCents > HIGH_SPEND_CENTS;
  const canConfirm = estimate !== null && !estimating && !confirming;

  return (
    <div
      data-slot="matrix-panel"
      data-step-id={stepId}
      aria-label="Matriz y confirmación de gasto (CP2)"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-bg"
    >
      {/* NI `min-h-0` NI `flex-1` EN LA FILA, y esto es un BUG DE VERDAD que el E2E cazó como lo
          caza un usuario («el <td> intercepta el click»):

          · Con `flex-1` + `items-stretch`, la fila se estiraba al alto del contenedor scrollable, el
            rail crecía por debajo de su contenido y su botón de confirmar —anclado con `mt-auto`—
            acababa SOLAPADO por la sección de la matriz.
          · Con `min-h-0`, la fila podía ENCOGERSE POR DEBAJO de su contenido: la columna de
            configuración se desbordaba hacia abajo y la matriz —hermana posterior— se pintaba
            ENCIMA. Los controles seguían ahí, visibles… y no se podían clicar. Es el modo de fallo
            más traicionero de flexbox: se ve bien y no funciona.

          La fila mide LO QUE MIDE SU CONTENIDO (`shrink-0`), el scroll es del contenedor de fuera, y
          el rail se queda `sticky` arriba (el layout del mockup) para que el coste y el botón sigan
          a la vista mientras se lee la matriz. */}
      <div className="flex shrink-0 items-start">
        {/* ── Columna de configuración ─────────────────────────────────────────── */}
        <div className="min-w-0 flex-1 p-6">
          <div className="mb-1.5 font-mono text-micro font-semibold tracking-widest text-warning">
            ◆ CP2 · MATRIZ Y CONFIRMACIÓN DE GASTO
          </div>
          <h2 className="mb-1 text-h2 font-semibold text-text" data-slot="matrix-title">
            {brief.product.name}
          </h2>
          <p className="mb-6 max-w-2xl text-mono text-text-3">
            Brief aprobado en CP1. Configura la matriz de variantes y autoriza el gasto de
            generarla. Al confirmar se crean las <code className="font-mono">ad_variant</code> en
            estado <code className="font-mono">planned</code> y el pipeline sigue hacia el
            ScriptWriter.
          </p>

          {/* OBJETIVO — los TRES de `AdObjectiveSchema`. El modo hook-testing NO es un toggle
              aparte: se DERIVA del objetivo (matrix.ts). */}
          <Section title="Objetivo · preset de duración">
            <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Objetivo">
              {OBJECTIVES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={config.objective === o.value}
                  data-slot={`objective-${o.value}`}
                  onClick={() => {
                    update({ objective: o.value });
                  }}
                  className={cardButtonClass(config.objective === o.value)}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-mono font-semibold">{o.label}</span>
                    <span className="font-mono text-micro text-text-3">{o.range}</span>
                  </span>
                  <span className="mt-1 block text-micro text-text-3">{o.desc}</span>
                </button>
              ))}
            </div>
            {plan !== null ? (
              <p className="mt-2 text-micro text-text-3" data-slot="duration-target">
                Duración objetivo:{' '}
                <span className="font-mono text-text-2">
                  {plan.durationTargetSeconds} s por variante
                </span>
                {plan.sharedBodyAndCta ? ' · body y CTA compartidos por ángulo' : null}
              </p>
            ) : null}
          </Section>

          {/* ÁNGULOS — cards con los hooks del brief (Entrega literal de T2.3). Se elige el ÁNGULO
              y CUÁNTOS hooks entran; los hooks concretos los toma el compositor (contrato T2.2). */}
          <Section
            title="Ángulos del brief · elige cuáles entran"
            aside={
              <label className="flex items-center gap-2 text-micro text-text-3">
                <span>Hooks por ángulo</span>
                <Select
                  aria-label="Hooks por ángulo"
                  data-slot="hooks-per-angle"
                  value={String(config.hooksPerAngle)}
                  onChange={(e) => {
                    update({ hooksPerAngle: Number(e.target.value) });
                  }}
                  className="h-8 w-20"
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </label>
            }
          >
            <div className="flex flex-col gap-2.5" data-slot="angles">
              {brief.angles.map((angle, index) => {
                const selected = config.angleIndices.includes(index);
                return (
                  <div
                    key={`${angle.name}-${String(index)}`}
                    data-slot="angle-card"
                    data-selected={selected}
                    className={`rounded-lg border bg-surface p-3.5 transition-colors ${
                      selected ? 'border-accent-border' : 'border-border'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => {
                          toggleAngle(index);
                        }}
                        label={angle.name}
                        data-slot={`angle-${String(index)}`}
                      />
                      <Badge tone="neutral" mono className="ml-auto shrink-0">
                        {angle.framework}
                      </Badge>
                    </div>
                    <p className="mt-2 text-micro text-text-3">
                      segmento <span className="text-text-2">{angle.target_segment}</span>
                    </p>
                    {/* Los hooks del brief: se VEN (es lo que el usuario está eligiendo al elegir
                        el ángulo), pero no se togglean uno a uno — ver la cabecera. */}
                    <ul className="mt-2 flex flex-wrap gap-1.5" data-slot="angle-hooks">
                      {angle.hook_examples.map((hook) => (
                        <li
                          key={hook}
                          className="rounded-full border border-border-2 bg-surface-2 px-2.5 py-1 text-micro text-text-2"
                        >
                          {hook}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* PERSONA — sugeridas por `avatar_hint` (T2.0). */}
          <Section title="Persona · sugerida por avatar_hint">
            <Alert tone={candidates.length > 0 ? 'success' : 'info'} className="mb-3">
              {candidates.length > 0
                ? `${String(candidates.length)} persona(s) compatible(s) con el segmento «${avatarHint}».`
                : `Ninguna persona de la librería casa con el segmento «${avatarHint}». El lote se compondrá sin persona fijada.`}
            </Alert>
            <div
              className="grid grid-cols-2 gap-2.5"
              role="radiogroup"
              aria-label="Persona del lote"
              data-slot="personas"
            >
              <button
                type="button"
                role="radio"
                aria-checked={config.personaMode !== 'fixed'}
                data-slot="persona-rotate"
                onClick={() => {
                  selectPersona(null);
                }}
                className={cardButtonClass(config.personaMode !== 'fixed')}
              >
                <span className="text-mono font-semibold">Dejar que rote (A/B)</span>
                <span className="mt-1 block text-micro text-text-3">
                  Las candidatas se reparten entre las variantes (§11)
                </span>
              </button>
              {candidates.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={config.personaMode === 'fixed' && config.personaId === p.id}
                  data-slot={`persona-${p.id}`}
                  onClick={() => {
                    selectPersona(p.id);
                  }}
                  className={cardButtonClass(
                    config.personaMode === 'fixed' && config.personaId === p.id,
                  )}
                >
                  <span className="text-mono font-semibold">{p.name}</span>
                  <span className="mt-1 block text-micro text-text-3">
                    {p.ageRange} · {p.gender} · {p.ethnicity} · {p.style}
                  </span>
                </button>
              ))}
            </div>
          </Section>

          {/* TIER + IDIOMAS */}
          <div className="grid grid-cols-2 gap-6">
            <Section title="Tier · receta de generación">
              <label className="sr-only" htmlFor="tier-select">
                Tier
              </label>
              <Select
                id="tier-select"
                aria-label="Tier"
                data-slot="tier"
                value={config.tier}
                onChange={(e) => {
                  update({ tier: e.target.value as BatchConfig['tier'] });
                }}
              >
                {TIERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} — {t.desc}
                  </option>
                ))}
              </Select>
              {/* El coste POR VARIANTE del tier elegido sale del ESTIMADOR (la receta real), no de
                  una constante: es la horquilla de una variante aislada a la duración del lote. */}
              {estimate !== null ? (
                <p className="mt-2 text-micro text-text-3" data-slot="tier-cost">
                  Variante aislada:{' '}
                  <span className="font-mono text-text-2">
                    {formatCostRange(estimate.estimate.standaloneVariant)}
                  </span>
                </p>
              ) : null}
            </Section>

            <Section title="Idiomas">
              <div className="flex flex-col gap-2" data-slot="languages">
                {LANGUAGES.map((l) => (
                  <Checkbox
                    key={l.code}
                    checked={config.languages.includes(l.code)}
                    onCheckedChange={() => {
                      toggleLanguage(l.code);
                    }}
                    label={l.label}
                    data-slot={`language-${l.code}`}
                  />
                ))}
              </div>
              <p className="mt-2 text-micro text-text-4">
                Cada idioma se genera nativo (no traducido) y multiplica las variantes.
              </p>
            </Section>
          </div>
        </div>

        {/* ── Rail de coste ────────────────────────────────────────────────────── */}
        {/* `sticky top-0`: el mockup lo fija, y no por gusto — el coste y el botón de confirmar son
            LO QUE EL USUARIO DECIDE, y tienen que estar a la vista mientras revisa la matriz de
            abajo. Sin `sticky`, scrollear para leer las variantes esconde el número que se está
            autorizando. */}
        <aside
          aria-label="Coste del lote"
          data-slot="cost-rail"
          className="sticky top-0 flex w-84 shrink-0 flex-col border-l border-border bg-surface p-5"
        >
          <h3 className="mb-3.5 font-mono text-micro font-semibold tracking-widest text-text-3 uppercase">
            Coste estimado del lote
          </h3>

          {/* EL NÚMERO EN GRANDE. `role="status"` + nombre accesible: es feedback asíncrono (llega
              del servidor) y la API de test lo localiza por su nombre, no por su texto. */}
          <output
            role="status"
            aria-label="coste estimado"
            data-slot="total-cost"
            className={`font-mono text-h1 font-semibold tracking-tight ${
              highSpend ? 'text-warning' : 'text-text'
            }`}
          >
            {total !== null ? formatCostRange(total) : '—'}
          </output>
          <p className="mt-1.5 text-micro text-text-3" data-slot="variant-count">
            <span className="font-mono text-text-2">{variantCount}</span> variantes ·{' '}
            {estimating ? 'recalculando…' : `tier ${config.tier}`}
          </p>

          {highSpend ? (
            <Alert tone="warning" className="mt-3" data-slot="high-spend">
              Gasto elevado. Revisa el tier o reduce ángulos/hooks antes de confirmar.
            </Alert>
          ) : null}

          {error !== null ? (
            <p role="alert" data-slot="matrix-error" className="mt-3 text-mono text-danger">
              {error}
            </p>
          ) : null}

          {/* DESGLOSE POR SEGMENTO. Viene YA CALCULADO del estimador (`bySegment`): el navegador no
              suma céntimos (decisión vinculante de T2.3). Cada partida es UNA generación que se va
              a pagar, así que en hook-testing el body de tres variantes del mismo ángulo cuenta
              como UNA — la economía de §16.1, visible. */}
          {estimate !== null ? (
            <dl className="mt-5 flex flex-col gap-2.5" data-slot="cost-breakdown">
              {(['hook', 'body', 'cta'] as const).map((segment) => {
                // El contrato garantiza los TRES segmentos (`Record<AdSegment, …>`): no hay rama de
                // «segmento ausente» que cubrir, y fingirla sería código muerto.
                const roll = estimate.estimate.bySegment[segment];
                return (
                  <div key={segment} className="flex items-baseline justify-between gap-3">
                    <dt className="text-mono text-text">
                      {SEGMENT_LABEL[segment]}{' '}
                      <span className="font-mono text-micro text-text-3">
                        {roll.generations} generación(es)
                      </span>
                    </dt>
                    {/* La HORQUILLA entera, igual que el total: un punto máximo debajo de un rango
                        haría comparar peras con manzanas justo donde se autoriza el gasto. */}
                    <dd
                      className="font-mono text-mono font-semibold text-text"
                      data-slot={`cost-${segment}`}
                    >
                      {formatCostRange(roll.cost)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : null}

          {plan?.sharedBodyAndCta === true ? (
            <Alert tone="info" className="mt-3.5" data-slot="shared-savings">
              Hook-testing: el body y el CTA se cobran <strong>una sola vez</strong> por
              ángulo/idioma, no por variante.
            </Alert>
          ) : null}

          {/* `mt-5` y NO `mt-auto`: el rail ya no se estira al alto del contenedor (ver arriba), así
              que empujar el botón «al fondo» lo empujaría fuera de su propia caja. */}
          <div className="mt-5">
            <Button
              type="button"
              data-slot="confirm-batch"
              disabled={!canConfirm}
              onClick={() => void onConfirm()}
              variant="primary"
              className="w-full border-success bg-success text-success-on hover:border-success hover:bg-success focus-visible:border-success"
            >
              {confirming
                ? 'Creando el lote…'
                : `Confirmar y crear ${String(variantCount)} variantes`}
            </Button>
            <p className="mt-2 text-center text-micro text-text-4">
              Confirmar autoriza el gasto y crea las variantes. No se genera nada hasta este paso.
            </p>
          </div>
        </aside>
      </div>

      {/* ── Matriz planificada ─────────────────────────────────────────────────── */}
      {/* `shrink-0` por el mismo motivo que la fila de arriba: en un contenedor flex-column, un hijo
          que puede encogerse acaba solapado con (o solapando a) sus hermanos. Aquí mide lo que mide
          su tabla, y el que scrollea es el panel. */}
      <section
        aria-label="Matriz planificada"
        data-slot="planned-matrix"
        className="shrink-0 border-t border-border bg-bg-subtle p-6"
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="font-mono text-micro font-semibold tracking-widest text-text-3 uppercase">
            Matriz planificada · {variantCount} variantes
          </h3>
          <span className="text-micro text-text-4">
            filename_code legible y trazable en Ads Manager (§8.3)
          </span>
        </div>

        {/* SE ESTRECHA SOBRE `estimate`, NO SOBRE `plan`. Son lo mismo (`plan` se DERIVA de
            `estimate`, arriba), pero derivarlo con `?? null` perdía el vínculo PARA EL TIPO: dentro
            del bloque, TS ya no sabía que el estimado existe, y esa duda se tapaba con un
            `?? {minCents: 0, maxCents: 0}` que pintaba **$0.00 cuando no encontraba el coste de una
            variante**. En la pantalla donde se autoriza el gasto, «no sé lo que cuesta» NO puede
            renderizarse como «es gratis»: es el mismo patrón (colapsar un fallo en un valor que
            significa otra cosa) que ya matamos en el `?? null` del repo y en el `reduce` que sumaba
            solo el techo. Con el narrowing sobre `estimate`, el `perVariant` está garantizado por
            el tipo y no hace falta ningún default que mienta. */}
        {estimate === null ? (
          <p className="rounded-lg border border-dashed border-border-2 p-6 text-center text-mono text-text-3">
            {estimating ? 'Componiendo la matriz…' : 'No hay matriz que enseñar con esta config.'}
          </p>
        ) : (
          // PRIMITIVA DEL DS, sin tabla a mano (mismo criterio que `runs-table.tsx` y
          // `spend-panel.tsx`): `MetricsTable` YA es esta geometría (contenedor `rounded-lg
          // border`, cabecera mono/micro/uppercase, hairlines entre filas) y acepta `ReactNode` por
          // celda, así que el formato de cada columna se conserva tal cual (el `filename_code` en
          // `text-accent`, el idioma en mono uppercase…). Replicarla a mano era una segunda copia
          // de la misma geometría que se desincronizaría del DS a la primera que alguien lo tocara.
          <MetricsTable
            columns={MATRIX_COLUMNS}
            rows={estimate.plan.variants.map((v) => ({
              angle: v.angleName,
              hook: v.hook.text,
              persona: v.personaName ?? '—',
              language: <span className="uppercase">{v.language}</span>,
              duration: `${String(v.durationTargetSeconds)}s`,
              filenameCode: <span className="text-accent">{v.filenameCode}</span>,
              // El coste POR VARIANTE también viene del estimador (`perVariant`): aquí no se
              // divide ni se suma nada — en hook-testing el reparto del body compartido ya está
              // hecho, y hacerlo en el cliente sería inventarse otra aritmética del dinero.
              cost: <VariantCost cost={estimate.estimate.perVariant[v.filenameCode]} />,
            }))}
          />
        )}
      </section>
    </div>
  );
}

/**
 * El coste imputado a UNA variante. Si el estimador no trae su `filenameCode`, se pinta «—», NUNCA
 * `$0.00`.
 *
 * Hoy no es alcanzable —`estimateBatchCost` inicializa `perVariant` con TODAS las variantes del
 * plan, así que la clave existe siempre—, pero esa es una invariante DEL ESTIMADOR, no del panel, y
 * el panel no puede comprobarla: `perVariant` es un `Record<string, …>`, así que para el tipo la
 * clave puede faltar. La pregunta no es «¿puede pasar?» sino «¿qué enseñamos si pasa?». Un `$0.00`
 * inventado en la pantalla donde se autoriza el gasto es la peor respuesta posible: dice «gratis»
 * cuando lo que ocurre es «no lo sé». Un «—» dice exactamente lo que pasa, y el total de arriba
 * —que sale del estimador, no de sumar estas celdas— sigue siendo la cifra que manda.
 */
function VariantCost({ cost }: { cost: { minCents: number; maxCents: number } | undefined }) {
  if (cost === undefined) {
    return (
      <span className="text-text-4" title="el estimador no devolvió el coste de esta variante">
        —
      </span>
    );
  }
  return <span className="text-text-3">{formatCostRange(cost)}</span>;
}

const SEGMENT_LABEL: Record<'hook' | 'body' | 'cta', string> = {
  hook: 'Hook',
  body: 'Body',
  cta: 'CTA',
};

/** El estilo de una card seleccionable (objetivo, persona). Es la MISMA piel en los dos sitios;
 *  extraerla evita que diverjan al retocar una. */
function cardButtonClass(selected: boolean): string {
  return [
    'rounded-lg border p-3 text-left transition-colors',
    selected
      ? 'border-accent-border bg-accent-soft text-accent'
      : 'border-border bg-surface text-text hover:border-border-strong',
  ].join(' ');
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="font-mono text-micro font-semibold tracking-widest text-text-3 uppercase">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
