// La máquina de estados de un `step_run` (§7.1) como LÓGICA PURA: sin BD, sin
// cola, sin efectos. `transition()` (transition.ts) la consulta bajo el lock de
// fila y decide; los EFECTOS (UPDATE, encolado, NOTIFY) los orquesta allí vía
// puertos. Aislar la tabla aquí la hace exhaustivamente testeable sin Postgres.
//
// Frontera de core (SKILL.md backend, principio 1): este fichero NUNCA importa
// drizzle ni pg-boss. Habla estados y eventos, nada de filas.

/**
 * Estados de un step (§7.1, enum COMPLETO de `step_run.status`). `submitting` es
 * un estado del enum reservado al trabajo externo de F3+ (db.md §6): existe en
 * el tipo pero ninguna transición de §7.1 lo nombra todavía, así que la tabla no
 * lo referencia (T0.7a no lo ejercita).
 */
export type StepStatus =
  | 'awaiting_deps'
  | 'pending'
  | 'queued'
  | 'submitting'
  | 'running'
  | 'waiting_approval'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'skipped'
  | 'cancelled'
  | 'expired'
  | 'superseded';

/**
 * Eventos que disparan una transición (§7.1). El nombre describe QUÉ pasó, no a
 * qué estado se va: un mismo evento (`approve`, `edit`) puede llevar a estados
 * distintos según reglas, y el destino lo fija la tabla, no el llamante.
 */
export type StepEvent =
  // depends_on satisfecho: awaiting_deps → pending (resolución de deps, §7.1.a).
  | 'deps_satisfied'
  // pending → queued: el step está listo, se encola.
  | 'enqueue'
  // queued → running: el consumer lo tomó y empezó a ejecutar.
  | 'start'
  // running → succeeded: ejecución correcta (sin checkpoint).
  | 'succeed'
  // running → failed: ejecución fallida.
  | 'fail'
  // failed → queued: reintento (el llamante decide si retry_count<max; la tabla
  // solo dice que la transición es legal). Agotado ⇒ NO se dispara retry: la
  // fila se queda en `failed` terminal.
  | 'retry'
  // running → expired: timeout_at superado (EFECTO cron = T0.9; la transición es
  // legal ahora).
  | 'expire'
  // running → waiting_approval: se alcanzó un checkpoint.
  | 'reach_checkpoint'
  // waiting_approval → succeeded: aprobado (§7.1.b).
  | 'approve'
  // waiting_approval → succeeded + invalidación de sub-grafo (EFECTO T0.8; aquí
  // SOLO la transición a succeeded, la invalidación es no-op documentado en
  // transition.ts). §7.1.b.
  | 'approve_edited'
  // waiting_approval → rejected: rechazado (§7.1.b).
  | 'reject'
  // → skipped: un step que no se ejecuta (rama no elegida). Evento de USUARIO
  // (POST /api/steps/:id/skip → checkpoint-ops.skipStep): SOLO legal ANTES de
  // arrancar (awaiting_deps/pending). NUNCA desde `running`: saltar un step en
  // vuelo abandonaría trabajo ya pagado a mitad (p. ej. una generación fal.ai en
  // curso, F4). Para el auto-skip de un nodo que se descubre inaplicable está
  // `skip_inapplicable`, que es OTRO evento a propósito.
  | 'skip'
  // running → skipped: el nodo, YA en ejecución, se autodetermina INAPLICABLE y
  // termina sin trabajo (PRD §7.1: "skipped (nodo no aplicable, p. ej. N2 sin
  // imágenes)"; §7.2 ficha de N2: "si no hay ninguna → skipped"). Es el caso
  // canónico del PRD y NO es el `skip` de usuario: aquí lo decide el propio nodo
  // tras mirar sus entradas (N2 lee el RawContent de N1 y no encuentra imágenes
  // que analizar). Se separa de `skip` DELIBERADAMENTE para no legalizar el
  // `skip` de usuario desde `running` (ver el comentario de `skip`). Ambos
  // aterrizan en `skipped`, así que la resolución aguas abajo es idéntica: un
  // nodo saltado satisface la dep de sus dependientes (T0.8) y el run continúa.
  | 'skip_inapplicable'
  // → cancelled: el run se cancela.
  | 'cancel'
  // → superseded: una versión nueva (con supersedes_id) reemplaza a esta
  // (EFECTO invalidación = T0.8; aquí solo la transición legal). §7.1.c.
  | 'supersede';

/**
 * Tabla de transiciones VÁLIDAS de §7.1, exhaustiva: `{ [estado]: { [evento]:
 * estado_destino } }`. Un par (estado, evento) ausente = transición ILEGAL.
 * `nextStatus()` es la única lectura de esta tabla; el resto del código nunca la
 * inspecciona directamente.
 *
 * Estados terminales (succeeded, failed agotado, rejected, skipped, cancelled,
 * expired, superseded) no tienen fila de salida salvo `cancel`/`supersede`
 * cuando el grafo lo exige. `cancel` y `supersede` se admiten desde cualquier
 * estado NO terminal: un run se cancela en cualquier punto, y la invalidación
 * (T0.8) puede superseder un step en vuelo.
 */
const TRANSITIONS: Partial<Record<StepStatus, Partial<Record<StepEvent, StepStatus>>>> = {
  awaiting_deps: {
    deps_satisfied: 'pending',
    skip: 'skipped',
    cancel: 'cancelled',
    supersede: 'superseded',
  },
  pending: {
    enqueue: 'queued',
    skip: 'skipped',
    cancel: 'cancelled',
    supersede: 'superseded',
  },
  queued: {
    start: 'running',
    cancel: 'cancelled',
    supersede: 'superseded',
  },
  running: {
    succeed: 'succeeded',
    fail: 'failed',
    expire: 'expired',
    reach_checkpoint: 'waiting_approval',
    // T1.10a: auto-skip del nodo INAPLICABLE (PRD §7.1 / §7.2 N2 sin imágenes). Ojo
    // al par que NO está aquí: `skip` (el de usuario) sigue ILEGAL desde `running` a
    // propósito — ver el comentario de ambos eventos arriba y el test que lo fija.
    skip_inapplicable: 'skipped',
    cancel: 'cancelled',
    supersede: 'superseded',
  },
  failed: {
    // §7.1: running → failed → queued (retry si retry_count<max). La legalidad
    // de la transición no depende del contador; el orquestador comprueba el
    // contador antes de disparar `retry` (agotado ⇒ no dispara, queda terminal).
    retry: 'queued',
    cancel: 'cancelled',
    supersede: 'superseded',
  },
  waiting_approval: {
    approve: 'succeeded',
    approve_edited: 'succeeded', // + invalidación de sub-grafo (EFECTO T0.8)
    reject: 'rejected',
    cancel: 'cancelled',
    supersede: 'superseded',
  },
  // Estados terminales: sin transiciones de salida (§7.1). Un step ya
  // succeeded/rejected/skipped/cancelled/expired/superseded no vuelve a moverse.
};

/**
 * Aplica un evento a un estado según §7.1. Devuelve el estado destino si la
 * transición es válida, o `null` si es ilegal. Función PURA y total: el mismo
 * par siempre da el mismo resultado, sin efectos.
 */
export function nextStatus(from: StepStatus, event: StepEvent): StepStatus | null {
  return TRANSITIONS[from]?.[event] ?? null;
}

/** ¿Es legal aplicar `event` estando en `from`? Azúcar sobre `nextStatus`. */
export function isLegalTransition(from: StepStatus, event: StepEvent): boolean {
  return nextStatus(from, event) !== null;
}
