'use client';

// CP1 — EDITOR DE BRIEF (T1.10b, PRD §9.2). El checkpoint humano de F1: N3 sintetiza el
// ProductBrief, el step pausa en `waiting_approval`, y aquí el usuario lo revisa campo a campo,
// ve de dónde salió cada dato (badges extraído/inferido con su cita), resuelve los warnings y
// aprueba.
//
// LAYOUT — mockup `docs/mockups/brief-editor.html` (variante 3a, VINCULANTE, frontend §4b):
// formulario en TARJETAS a la izquierda (producto / audiencia / beneficios / ángulos y hooks /
// objeciones) + RAIL DE TRAZABILIDAD a la derecha (contadores extraído/inferido/editado, la nota
// de "los inferidos no tienen cita", y las acciones Aprobar / Guardar).
//
// PATRÓN (frontend/forms.md §1 y §4):
//  - react-hook-form + zodResolver con EL schema de core (`ProductBriefSchema`), no una copia:
//    el cliente y el route handler validan con el MISMO objeto ⇒ cero drift por construcción.
//  - `mode: 'onBlur'`.
//  - Los badges extraído/inferido son RENDER DEL PROP ORIGINAL, no form state: `evidence` y
//    `extraction_confidence` los produce N3 y el usuario NO los edita. Meterlos en el form
//    invitaría a mutarlos (y a que un usuario se auto-certificase una cita que no existe).
//  - El formulario edita EL ARTEFACTO; el estado del run NO es suyo: aprobar/editar son POSTs a
//    `/api/steps/:id/{approve,edit}` y la transición real llega por SSE al store del run. Cero
//    optimistic updates (canvas.md §5).
import { useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ProductBriefSchema, type BriefWarning, type ProductBrief } from '@ugc/core/contracts';
import { ApiError, runActions } from '@/lib/api-client';
import { applyEnvelopeToForm } from '@/lib/form-errors';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  canApprove,
  requiresUserDecision,
  toBriefDecision,
  toWarningView,
  type ChosenImageDecision,
  type HeroCandidate,
} from './brief-warnings';

export interface BriefEditorProps {
  /** El step de CP1 (N3 en `waiting_approval`): a él van el approve y el edit. */
  stepId: string;
  /** El ProductBrief que sintetizó la IA (ya validado y corregido por T1.9). */
  brief: ProductBrief;
  /** Los warnings tipados del BriefValidator (T1.9) acumulados con los del sintetizador. */
  warnings: BriefWarning[];
  /** La FILA del brief (`product_brief.id`, la v1 de la IA). Es la fuente de verdad versionada
   *  desde T1.10b; el editor la expone en el DOM para que la Verificación pueda direccionarla
   *  por `GET/PATCH /api/briefs/:id`. Opcional: los tests de componente montan el editor sin
   *  fila de BD detrás. */
  briefId?: string;
}

/** Copy del badge de PROCEDENCIA de un campo (Apéndice A: los extractivos llevan `evidence`;
 *  los inferenciales, confianza). Es la trazabilidad que el mockup pinta en verde y violeta. */
function ProvenanceBadge({ evidence }: { evidence?: string | null }) {
  return evidence != null && evidence !== '' ? (
    <Badge tone="success" data-slot="badge-extracted">
      ✓ extraído
    </Badge>
  ) : (
    <Badge tone="violet" data-slot="badge-inferred">
      inferido
    </Badge>
  );
}

/** La CITA de un campo extraído (`evidence`). Visible —no un tooltip—: la Verificación exige que
 *  el badge extraído «muestre su evidence (cita)» en el editor, y un tooltip no es evidencia
 *  para nadie que no tenga ratón. */
function Evidence({ evidence }: { evidence?: string | null }) {
  if (evidence == null || evidence === '') return null;
  // El margen va DENTRO, no en un div envoltorio del llamante: un campo INFERIDO no tiene cita y
  // este componente devuelve `null`, así que el envoltorio dejaba un div vacío con margen
  // fantasma bajo cada campo sin evidencia (la mitad de ellos, por diseño).
  return (
    <q data-slot="evidence" className="mt-1.5 block text-micro text-text-3 italic">
      {evidence}
    </q>
  );
}

/** Un ÍTEM de una lista editable del brief (un beneficio, un ángulo, una objeción, un punto de
 *  dolor): el recuadro gris del mockup 3a. Es un `<fieldset>` de verdad —no un div— porque cada
 *  ítem agrupa VARIOS controles (el texto y su contraargumento; el hook y su ángulo), y esa
 *  agrupación tiene que existir para un lector de pantalla. El `<legend>` da el nombre accesible;
 *  `srOnlyLegend` distingue los que lo enseñan (el ángulo, que muestra su nombre) de los que solo
 *  lo anuncian. */
function ListItemFieldset({
  legend,
  srOnlyLegend = true,
  ariaLabel,
  children,
}: {
  legend: React.ReactNode;
  srOnlyLegend?: boolean;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      className="rounded-md border border-border bg-surface-2 px-3.5 py-3"
      {...(ariaLabel !== undefined && { 'aria-label': ariaLabel })}
    >
      <legend className={srOnlyLegend ? 'sr-only' : 'mb-2 text-mono font-medium text-text'}>
        {legend}
      </legend>
      {children}
    </fieldset>
  );
}

/** Una tarjeta del formulario (el contenedor gris del mockup 3a). No se usa `Card` del DS: el
 *  mockup pinta una SECCIÓN de formulario con su cabecera mono en mayúsculas, no la Card
 *  genérica del DS (que trae su propio header/body/footer). Mismos tokens. */
function FieldCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-lg border border-border bg-surface p-4.5"
      data-slot="brief-card"
    >
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h3 className="font-mono text-mono font-semibold tracking-wide text-text-3 uppercase">
          {title}
        </h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

/** Una fila etiqueta + campo + badge de procedencia (las dos columnas del mockup 3a). La
 *  etiqueta va a ancho fijo con una utilidad del DS (`w-32`), sin valores arbitrarios. */
function FieldRow({
  htmlFor,
  label,
  badge,
  children,
}: {
  htmlFor: string;
  label: string;
  badge: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4">
      <label htmlFor={htmlFor} className="w-32 shrink-0 text-mono font-medium text-text-2">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {children}
        {badge}
      </div>
    </div>
  );
}

export function BriefEditor({ stepId, brief, warnings, briefId }: BriefEditorProps) {
  const { control, register, handleSubmit, setError, clearErrors, setValue, watch, formState } =
    useForm<ProductBrief>({
      // EL schema de core (no una copia derivada a mano): el mismo objeto con el que re-valida el
      // route handler. Un cambio del contrato rompe la compilación de este form — que es el punto.
      resolver: zodResolver(ProductBriefSchema),
      mode: 'onBlur',
      defaultValues: brief,
    });
  const { errors, isSubmitting } = formState;

  // `useFieldArray` para las listas que crecen/decrecen (forms.md §4): keys estables de RHF.
  const benefits = useFieldArray({ control, name: 'benefits' });
  const angles = useFieldArray({ control, name: 'angles' });
  const objections = useFieldArray({ control, name: 'objections' });

  // La decisión del usuario ante la petición BLOQUEANTE de imágenes (`needs_user_decision`, §7.2
  // N3: sin hero usable). NO es un campo del brief — es una decisión sobre CÓMO seguir el
  // pipeline (subir fotos, promover una imagen scrapeada, o derivar a packshot-IA en N7a), y por
  // eso no vive en el form.
  //
  // El `useState` es solo el estado de la ELECCIÓN mientras el usuario está en el checkpoint: al
  // aprobar (o al guardar) VIAJA al servidor en el body (T1.11) y se persiste en
  // `checkpoint_decision`, en la misma tx que la transición. Hasta T1.11 se evaporaba aquí: el
  // botón se habilitaba y la decisión no salía nunca del cliente — y su consumidor real (N7a,
  // T4.4) no habría tenido nada que leer.
  //
  // El TIPO es una unión discriminada (`ChosenImageDecision`, T1.15): `heroUrl` existe —y es
  // obligatoria— exactamente en la rama `promote_scraped`, que es la única que la necesita. Ni un
  // `heroUrl: string | null` que hubiera que comprobar en cada uso, ni dos `useState` que deben
  // moverse juntos y acaban moviéndose por separado: el estado imposible no se puede escribir.
  const [decision, setDecision] = useState<ChosenImageDecision | null>(null);
  const [busy, setBusy] = useState(false);

  const views = useMemo(() => warnings.map(toWarningView), [warnings]);
  const needsDecision = warnings.some(requiresUserDecision);
  // Las imágenes que el scrape SÍ trajo y que el usuario puede promover a hero (T1.15). En modo
  // manual (sin fotos) están vacías y solo se pintan las otras dos salidas: la UI no ramifica por
  // PERFIL (que nunca llega hasta aquí) sino por lo que HAY — que es el criterio honesto.
  //
  // TODAS, sin filtrar por `video_suitability`, y esto ES la política: quien clasificó estas
  // imágenes fue Haiku (N2), y su veredicto (`broll`, `unusable`) es justo el que dejó al brief sin
  // hero. Filtrar por él aquí volvería a esconder del usuario las imágenes que el modelo descartó
  // —que son LAS ÚNICAS que hay— y le devolvería al callejón sin salida del que T1.15 lo saca. La
  // clasificación se MUESTRA (para que elija con criterio), no se usa para ocultar.
  const candidates = brief.assets.images;
  const approvable = canApprove(warnings, decision);
  // La decisión EN LA FORMA DEL CONTRATO, lista para el body — o `undefined` si el usuario no
  // tenía nada que decidir. Se deriva UNA vez: los dos caminos de salida del checkpoint (aprobar
  // y guardar-y-aprobar) la mandan, y tenerlo escrito dos veces es el par clásico que se
  // desincroniza el día que la decisión gane un campo (justo lo que acaba de pasar en T1.15).
  const decisionPayload = decision === null ? undefined : toBriefDecision(decision);

  /**
   * EL USUARIO ELIGE una de las tres salidas de la petición de imágenes (T1.15). UNA sola función
   * para las tres, porque las tres hacen LO MISMO en los mismos dos sitios — y tenerlas separadas
   * era invitar a que un día una de ellas se olvidara de la mitad:
   *
   *  - la DECISIÓN (`setDecision`) → viaja al servidor y se persiste en `checkpoint_decision`,
   *    para N7a (T4.4). Es lo que el usuario RESUELVE sobre cómo sigue el pipeline.
   *  - el ARTEFACTO (`setValue`) → el `assets.hero_image_url` del brief. Al PROMOVER pasa a ser la
   *    imagen elegida (el brief aprobado tiene hero: es lo que lee el resto del pipeline, y por eso
   *    la promoción sale por `/edit` ⇒ v2, no por el `/approve` sin cambios, que por definición no
   *    toca el artefacto). Con cualquier otra salida vuelve al del brief de la IA — lo que DESHACE
   *    una promoción anterior si el usuario cambia de idea. Sin ese deshacer, promover → arrepen-
   *    tirse → guardar persistía una v2 con el hero que él mismo había descartado (lo caza el test
   *    «cambiar de idea tras promover»), y el rail contaría un campo «editado por ti» que ya no lo
   *    está. Ahora es POR CONSTRUCCIÓN: el mismo `setValue`, sin rama que se pueda olvidar.
   *
   * `setValue` y NO `resetField`: `assets.hero_image_url` no es un input REGISTRADO (el editor no
   * lo pinta como campo; solo lo escribe esta función), y `resetField` sobre un path sin registrar
   * no restaura el valor del form. `shouldDirty: true` con el valor por defecto hace que RHF
   * recalcule y RETIRE la marca dirty (compara contra `defaultValues`).
   */
  function choose(next: ChosenImageDecision) {
    setDecision(next);
    setValue(
      'assets.hero_image_url',
      next.images === 'promote_scraped' ? next.heroUrl : brief.assets.hero_image_url,
      { shouldDirty: true },
    );
  }

  // Trazabilidad (rail del mockup): contadores de campos con cita vs sin ella. Se cuentan sobre
  // el brief ORIGINAL (el de la IA), no sobre los valores editados: el rail responde "¿de dónde
  // salió esto?", y editar un campo no lo convierte en extraído.
  const trace = useMemo(() => countProvenance(brief), [brief]);

  // Campos que el usuario ha TOCADO (dirty): el tercer contador del rail ("Editado por ti").
  const editedCount = countDirty(formState.dirtyFields);

  /** Envuelve una acción de red: marca busy y deja el error del servidor en `root.server` — EL
   *  ÚNICO canal de error de este formulario.
   *
   *  Antes había dos (un `useState` propio + `root.server`) y era peor que redundante: RHF LIMPIA
   *  `root.*` en la siguiente validación, pero un `useState` no, así que el error de un approve
   *  fallido se quedaba PEGADO en pantalla mientras el usuario corregía el formulario. Un solo
   *  canal, con las reglas de limpieza de RHF. */
  async function runAction(action: () => Promise<unknown>) {
    setBusy(true);
    clearErrors('root.server');
    try {
      await action();
    } catch (e) {
      setError('root.server', {
        type: 'server',
        message: e instanceof ApiError ? e.message : 'Error inesperado',
      });
    } finally {
      setBusy(false);
    }
  }

  // GUARDAR Y APROBAR (con edición): manda el brief EDITADO al checkpoint. El servidor crea la
  // versión v2 (`edited_by_user:true`, `approved`), aprueba el step e invalida el sub-grafo
  // aguas abajo (§7.1.c). El brief v1 de la IA se conserva intacto — el linaje es el punto.
  //
  // `applyEnvelopeToForm` reparte el envelope: los errores de CAMPO van a su campo y el resto cae
  // en `root.server` (ver form-errors.ts) — el mismo sitio donde `runAction` deja los suyos.
  //
  // La DECISIÓN viaja también por aquí (T1.11): el usuario del modo manual puede elegir
  // packshot-IA Y ADEMÁS corregir un hook antes de guardar — si la decisión solo montara en
  // `/approve`, ese camino la perdería. Es ORTOGONAL al artefacto: no va dentro del brief.
  const onSubmit = handleSubmit(async (values) => {
    try {
      await runActions.editBrief(stepId, values, decisionPayload);
    } catch (e) {
      if (e instanceof ApiError) {
        applyEnvelopeToForm(e, setError);
        return;
      }
      throw e;
    }
  });

  // APROBAR SIN EDITAR: el brief de la IA se aprueba tal cual. NO crea versión nueva (sería
  // mentir sobre quién escribió el contenido): solo marca el v1 `approved`. La DECISIÓN (si la
  // hubo) SÍ viaja: aprobar sin editar es el camino normal cuando el brief está bien y lo único
  // que falta es decir de dónde salen las imágenes.
  //
  // EXCEPCIÓN (T1.15): si el usuario PROMOVIÓ una imagen a hero, el brief YA NO es el de la IA —
  // `assets.hero_image_url` cambió. Aprobarlo por `/approve` persistiría la decisión pero dejaría
  // el brief aprobado SIN hero: el usuario habría elegido una imagen que ningún consumidor podría
  // leer. Se sale por el mismo camino que cualquier otra edición humana (`/edit` ⇒ v2,
  // `edited_by_user:true`), que es lo que la promoción ES.
  function onApprove() {
    if (decision?.images === 'promote_scraped') {
      void onSubmit();
      return;
    }
    void runAction(() => runActions.approve(stepId, decisionPayload));
  }

  const productName = watch('product.name');

  return (
    <form
      // `handleSubmit` de RHF devuelve una promesa; el atributo espera `void`. Se descarta
      // explícitamente (el error ya lo captura el propio handler y lo pinta en `role="alert"`).
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      data-slot="brief-editor"
      // El step y el brief que este editor tiene delante, OBSERVABLES en el DOM. No es
      // decoración: el brief que CP1 edita es una FILA versionada de `product_brief`, y la
      // Verificación exige comprobar por API (`GET/PATCH /api/briefs/:id`) que la edición
      // standalone crea una versión nueva sobre ESE brief. Sin este ancla, el test tendría que
      // adivinar el id reconstruyendo el stream SSE — frágil y opaco.
      data-step-id={stepId}
      data-brief-id={briefId}
      aria-label="Editor de brief (CP1)"
      className="flex min-h-0 flex-1 items-stretch"
    >
      {/* ── Formulario en tarjetas (columna principal del mockup 3a) ───────────────── */}
      <div className="min-w-0 flex-1 overflow-y-auto bg-bg p-6">
        <div className="mb-1.5 font-mono text-micro font-semibold tracking-widest text-warning">
          ◆ CP1 · BRIEF EDITABLE
        </div>
        <h2 className="mb-4 text-h2 font-semibold text-text" data-slot="brief-title">
          {productName}
        </h2>

        {/* Warnings del validador (T1.9). El de decisión bloqueante va con sus dos salidas. */}
        {views.length > 0 ? (
          <div className="mb-4 flex flex-col gap-2" data-slot="brief-warnings">
            {views.map((w, i) => (
              <div key={`${w.code}-${String(i)}`} data-slot={`warning-${w.code}`}>
                <Alert tone={w.tone}>
                  <span>
                    <strong className="font-semibold">{w.title}.</strong> {w.detail}
                  </span>
                </Alert>
                {/* La PETICIÓN BLOQUEANTE de imágenes (§7.2 N3): el usuario elige. Hasta que
                    elija, «Aprobar» está deshabilitado. TRES salidas desde T1.15 — la tercera
                    (promover una imagen de la página) solo aparece si la página trajo imágenes. */}
                {w.requiresDecision ? (
                  <fieldset
                    className="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2.5"
                    data-slot="image-decision"
                  >
                    <legend className="sr-only">Decisión sobre las imágenes del producto</legend>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-mono text-text-2">
                        Elige cómo seguir para poder aprobar:
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant={decision?.images === 'upload_images' ? 'primary' : 'secondary'}
                        aria-pressed={decision?.images === 'upload_images'}
                        onClick={() => {
                          choose({ images: 'upload_images' });
                        }}
                      >
                        Subir imágenes del producto
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={decision?.images === 'ai_packshot' ? 'primary' : 'secondary'}
                        aria-pressed={decision?.images === 'ai_packshot'}
                        onClick={() => {
                          choose({ images: 'ai_packshot' });
                        }}
                      >
                        Generar packshot con IA
                      </Button>
                    </div>

                    {/* PROMOVER una imagen scrapeada a hero (T1.15). Es la salida que faltaba: en
                        una web de servicio no hay packshot, pero sí hay fotos —y el usuario, que
                        sí sabe cuál sirve, no tenía forma de decirlo. Se muestran TODAS las que
                        el scrape trajo, con la clasificación de N2 a la vista (que se enseña, no
                        se usa para ocultarlas: fue justamente esa clasificación la que dejó al
                        brief sin hero). */}
                    {candidates.length > 0 ? (
                      <div className="mt-3" data-slot="hero-candidates">
                        <p className="mb-2 text-mono text-text-2">
                          …o promueve una de las imágenes de la página a imagen principal:
                        </p>
                        <ul className="flex flex-wrap gap-2.5">
                          {candidates.map((candidate) => (
                            <HeroCandidateOption
                              key={candidate.url}
                              candidate={candidate}
                              selected={
                                decision?.images === 'promote_scraped' &&
                                decision.heroUrl === candidate.url
                              }
                              onSelect={() => {
                                choose({ images: 'promote_scraped', heroUrl: candidate.url });
                              }}
                            />
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </fieldset>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-3.5">
          {/* PRODUCTO — campos extractivos: llevan cita. */}
          <FieldCard title="Producto">
            <div className="flex flex-col gap-3">
              <FieldRow
                htmlFor="brief-product-name"
                label="Nombre"
                // `product.name` es extractivo pero el contrato no le cuelga `evidence` propio:
                // su procedencia es la del bloque (`meta.extraction_confidence`). Se muestra la
                // del meta en vez de inventar una cita que no existe.
                badge={
                  <Badge tone={brief.meta.extraction_confidence === 'high' ? 'success' : 'violet'}>
                    {brief.meta.extraction_confidence === 'high' ? '✓ extraído' : 'inferido'}
                  </Badge>
                }
              >
                <Input
                  id="brief-product-name"
                  error={errors.product?.name !== undefined}
                  {...register('product.name')}
                />
              </FieldRow>

              {/* El cross-check N1==N3 (T1.9) ya corrigió el precio si divergía: si hubo
                  `price_mismatch`, el warning de arriba explica la corrección. */}
              <FieldRow
                htmlFor="brief-price"
                label="Precio"
                badge={<Badge tone="success">✓ N1=N3</Badge>}
              >
                <Input id="brief-price" mono {...register('pricing.price')} />
              </FieldRow>

              <FieldRow
                htmlFor="brief-category"
                label="Categoría"
                badge={<Badge tone="success">✓ extraído</Badge>}
              >
                <Input
                  id="brief-category"
                  error={errors.product?.category !== undefined}
                  {...register('product.category')}
                />
              </FieldRow>

              <FieldRow
                htmlFor="brief-one-liner"
                label="Claim"
                badge={<Badge tone="violet">inferido</Badge>}
              >
                <Input id="brief-one-liner" {...register('product.one_liner')} />
              </FieldRow>
            </div>
          </FieldCard>

          {/* AUDIENCIA — inferencial: sin cita, con confianza. */}
          <FieldCard
            title="Audiencia · nivel de consciencia"
            badge={
              <Badge tone="violet" mono>{`inferido · ${brief.meta.extraction_confidence}`}</Badge>
            }
          >
            <label htmlFor="brief-audience" className="sr-only">
              Segmento principal
            </label>
            <Textarea
              id="brief-audience"
              rows={2}
              error={errors.audience?.primary_segment !== undefined}
              {...register('audience.primary_segment')}
            />
            <p className="mt-2 text-micro text-text-3 italic">
              Inferido del tono de la página y las reseñas; sin evidencia textual directa.
            </p>
          </FieldCard>

          {/* BENEFICIOS — la Verificación edita uno de estos. */}
          <FieldCard title="Beneficios">
            <div className="flex flex-col gap-2.5" data-slot="benefits">
              {benefits.fields.map((field, i) => (
                <ListItemFieldset key={field.id} legend={`Beneficio ${String(i + 1)}`}>
                  <div className="flex items-center gap-2.5">
                    <label htmlFor={`brief-benefit-${String(i)}`} className="sr-only">
                      Beneficio {i + 1}
                    </label>
                    <Input
                      id={`brief-benefit-${String(i)}`}
                      {
                        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- RHF exige `${number}` en sus paths (un String(i) da `${string}` y NO compila)
                        ...register(`benefits.${i}.benefit` as const)
                      }
                    />
                    <Badge tone="violet">inferido</Badge>
                  </div>
                  <p className="mt-1.5 text-micro text-text-3">
                    {brief.benefits[i]?.emotional_outcome}
                  </p>
                </ListItemFieldset>
              ))}
            </div>
          </FieldCard>

          {/* ÁNGULOS Y HOOKS — la Verificación edita un hook aquí. */}
          <FieldCard title="Ángulos y hooks">
            <div className="flex flex-col gap-2.5" data-slot="angles">
              {angles.fields.map((field, i) => {
                const source = brief.angles[i];
                return (
                  <ListItemFieldset
                    key={field.id}
                    legend={source?.name}
                    srOnlyLegend={false}
                    ariaLabel={source?.name ?? `Ángulo ${String(i + 1)}`}
                  >
                    <div className="flex flex-col gap-2">
                      {(source?.hook_examples ?? []).map((_hook, h) => (
                        <div
                          key={`${field.id}-hook-${String(h)}`}
                          className="flex items-center gap-2.5"
                        >
                          {/* La etiqueta VISIBLE es corta ("Hook 1"): en la columna del ángulo,
                              el contexto lo da la tarjeta. Pero el ACCESSIBLE NAME lleva además
                              el ángulo (`aria-label`, que gana sobre el `<label>`): hay 5–10
                              ángulos y TODOS tienen un «Hook 1» — sin el ángulo, un lector de
                              pantalla anunciaría cinco campos idénticos y un test no podría
                              decir cuál es cuál. */}
                          <label
                            htmlFor={`brief-angle-${String(i)}-hook-${String(h)}`}
                            aria-hidden
                            className="w-16 shrink-0 text-micro text-text-3"
                          >
                            Hook {h + 1}
                          </label>
                          <Input
                            id={`brief-angle-${String(i)}-hook-${String(h)}`}
                            aria-label={`Hook ${String(h + 1)} de ${source?.name ?? `ángulo ${String(i + 1)}`}`}
                            {
                              // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- RHF exige `${number}` en sus paths (un String(i) da `${string}` y NO compila)
                              ...register(`angles.${i}.hook_examples.${h}` as const)
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </ListItemFieldset>
                );
              })}
            </div>
          </FieldCard>

          {/* OBJECIONES — mezcla extraído (`on_page`) e inferido (`inferred`): el mockup las
              pinta con su badge de procedencia. */}
          <FieldCard title="Objeciones + contraargumento">
            <div className="flex flex-col gap-2.5" data-slot="objections">
              {objections.fields.map((field, i) => {
                const source = brief.objections[i];
                const onPage = source?.counter_source === 'on_page';
                return (
                  <ListItemFieldset key={field.id} legend={`Objeción ${String(i + 1)}`}>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <label htmlFor={`brief-objection-${String(i)}`} className="sr-only">
                        Objeción {i + 1}
                      </label>
                      <Input
                        id={`brief-objection-${String(i)}`}
                        {
                          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- RHF exige `${number}` en sus paths (un String(i) da `${string}` y NO compila)
                          ...register(`objections.${i}.objection` as const)
                        }
                      />
                      <Badge tone={onPage ? 'success' : 'violet'} mono>
                        {onPage ? 'on_page' : 'inferred'}
                      </Badge>
                    </div>
                    <label htmlFor={`brief-counter-${String(i)}`} className="sr-only">
                      Contraargumento {i + 1}
                    </label>
                    <Textarea
                      id={`brief-counter-${String(i)}`}
                      rows={2}
                      {
                        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- RHF exige `${number}` en sus paths (un String(i) da `${string}` y NO compila)
                        ...register(`objections.${i}.counter` as const)
                      }
                    />
                  </ListItemFieldset>
                );
              })}
            </div>
          </FieldCard>

          {/* PAIN POINTS — extractivos con `evidence`: aquí SÍ hay cita textual que mostrar, y es
              lo que la Verificación mira ("los badges extraído muestran su evidence"). */}
          <FieldCard title="Puntos de dolor">
            <div className="flex flex-col gap-2.5" data-slot="pain-points">
              {brief.pain_points.map((pain, i) => (
                <ListItemFieldset
                  key={`pain-${String(i)}`}
                  legend={`Punto de dolor ${String(i + 1)}`}
                >
                  <div className="flex items-center gap-2.5">
                    <label htmlFor={`brief-pain-${String(i)}`} className="sr-only">
                      Punto de dolor {i + 1}
                    </label>
                    <Input
                      id={`brief-pain-${String(i)}`}
                      {
                        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- RHF exige `${number}` en sus paths (un String(i) da `${string}` y NO compila)
                        ...register(`pain_points.${i}.pain` as const)
                      }
                    />
                    <ProvenanceBadge evidence={pain.evidence} />
                  </div>
                  <Evidence evidence={pain.evidence} />
                </ListItemFieldset>
              ))}
            </div>
          </FieldCard>
        </div>
      </div>

      {/* ── Rail de trazabilidad (columna derecha del mockup 3a) ──────────────────── */}
      <aside
        aria-label="Trazabilidad"
        data-slot="trace-rail"
        className="flex w-72 shrink-0 flex-col border-l border-border bg-surface p-5"
      >
        <h3 className="mb-3.5 text-mono font-semibold text-text-2">Trazabilidad</h3>
        <dl className="mb-5 flex flex-col gap-3">
          <TraceRow label="Extraído" value={trace.extracted} tone="text-success" slot="extracted" />
          <TraceRow label="Inferido" value={trace.inferred} tone="text-violet" slot="inferred" />
          <TraceRow label="Editado por ti" value={editedCount} tone="text-text" slot="edited" />
        </dl>

        <Alert tone="info" className="mb-auto">
          Los campos inferidos no tienen cita. Revísalos antes de aprobar.
        </Alert>

        {/* El ÚNICO canal de error del formulario: lo del servidor (envelope de la API) que no
            pertenece a un campo concreto. Lo escriben `runAction` y `applyEnvelopeToForm`, y lo
            limpia RHF en la siguiente validación. */}
        {errors.root?.server ? (
          <p role="alert" data-slot="brief-error" className="mt-4 text-mono text-danger">
            {errors.root.server.message}
          </p>
        ) : null}

        {needsDecision && decision === null ? (
          <p data-slot="approve-blocked" className="mt-4 text-micro text-text-3">
            Resuelve la petición de imágenes para poder aprobar.
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-2.5">
          {/* APROBAR sin editar: el brief de la IA tal cual (no crea v2). */}
          <Button
            type="button"
            data-slot="approve-brief"
            disabled={!approvable || busy || isSubmitting}
            onClick={onApprove}
            variant="primary"
            className="border-success bg-success text-success-on hover:border-success hover:bg-success focus-visible:border-success"
          >
            Aprobar y continuar
          </Button>
          {/* GUARDAR: manda el brief EDITADO (crea v2, aprueba el step, invalida aguas abajo). */}
          <Button
            type="submit"
            data-slot="save-brief"
            variant="secondary"
            disabled={!approvable || busy || isSubmitting}
          >
            Guardar cambios y continuar
          </Button>
        </div>
      </aside>
    </form>
  );
}

/**
 * Una imagen candidata a hero (T1.15): la miniatura, la clasificación que le puso N2 y el botón
 * que la PROMUEVE. La clasificación se MUESTRA porque es información con la que el usuario decide
 * («banner de fondo», «no usable») — no para filtrar: si filtrásemos por ella no quedaría ni una
 * (fue justamente ese veredicto el que dejó al brief sin hero).
 *
 * El accessible name del botón lleva la URL de la imagen: hay N candidatas y todas tienen el
 * mismo texto, así que sin ella ni un lector de pantalla ni un test podrían decir cuál es cuál —
 * el mismo criterio que los hooks del formulario.
 */
function HeroCandidateOption({
  candidate,
  selected,
  onSelect,
}: {
  candidate: HeroCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li
      className="flex w-40 flex-col gap-1.5 rounded-md border border-border bg-surface p-2"
      data-slot="hero-candidate"
      data-url={candidate.url}
      data-selected={selected}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- imagen REMOTA del scrape (CDN
          arbitrario del producto): `next/image` exige declarar el host en `remotePatterns` en
          build, y aquí el host lo decide la web que el usuario analiza. Misma decisión que las
          referencias de persona (persona-detail.tsx). */}
      <img
        src={candidate.url}
        alt={`Imagen de la página (${candidate.kind})`}
        className="aspect-square w-full rounded-sm bg-surface-3 object-cover"
      />
      <Badge tone="neutral" mono>
        {candidate.kind} · {candidate.video_suitability}
      </Badge>
      <Button
        type="button"
        size="sm"
        variant={selected ? 'primary' : 'secondary'}
        aria-pressed={selected}
        aria-label={`Usar como imagen principal: ${candidate.url}`}
        onClick={onSelect}
      >
        Usar como principal
      </Button>
    </li>
  );
}

function TraceRow({
  label,
  value,
  tone,
  slot,
}: {
  label: string;
  value: number;
  tone: string;
  slot: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-mono text-text-2">{label}</dt>
      <dd className={`font-mono text-mono font-semibold ${tone}`} data-slot={`trace-${slot}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Cuenta campos EXTRAÍDOS (con `evidence` no vacía) vs INFERIDOS del brief. Es el contador del
 * rail: la trazabilidad en un vistazo ("14 extraídos, 6 inferidos"). Solo mira los campos que el
 * contrato marca como extractivos (`features[].evidence`, `pain_points[].evidence`): el resto del
 * brief es inferencial por construcción (Apéndice A), y contarlo campo a campo sería inventarse
 * una taxonomía que el contrato no tiene.
 */
function countProvenance(brief: ProductBrief): { extracted: number; inferred: number } {
  const evidences = [
    ...brief.product.features.map((f) => f.evidence),
    ...brief.pain_points.map((p) => p.evidence),
  ];
  const extracted = evidences.filter((e) => e != null && e !== '').length;
  return { extracted, inferred: evidences.length - extracted };
}

/** Nº de campos que el usuario ha TOCADO, contando hojas del árbol `dirtyFields` de RHF (que es
 *  un objeto/array anidado de booleanos con la misma forma que el brief). */
function countDirty(dirty: unknown): number {
  if (dirty === true) return 1;
  if (Array.isArray(dirty)) return dirty.reduce<number>((acc, v) => acc + countDirty(v), 0);
  if (typeof dirty === 'object' && dirty !== null) {
    return Object.values(dirty).reduce<number>((acc, v) => acc + countDirty(v), 0);
  }
  return 0;
}
