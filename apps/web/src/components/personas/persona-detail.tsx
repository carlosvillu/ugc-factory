'use client';

// LA FICHA INMERSIVA de una persona — la traducción a código del mockup 6c
// (`docs/mockups/personas.html`, «ficha inmersiva · refs grandes + voz por idioma»), que es
// vinculante (skill frontend §4b: la página PARTE del mockup; el ds-reviewer rechaza una que se
// desvíe sin acuerdo).
//
// Estructura del mockup, literal: grid de 2 columnas (1fr / 1.2fr). Izquierda, las REFERENCIAS
// GRANDES (la primera a doble ancho en 4:5 — es el retrato principal del identity lock— y las
// siguientes en cuadrados); debajo, el pie «N imágenes de referencia · identity lock». Derecha,
// el kicker «PERSONA · SINTÉTICA», el nombre, la línea de demografía, la personalidad, el bloque
// de VOZ POR IDIOMA y la fila de acciones.
//
// LO QUE EL MOCKUP DIBUJA Y AQUÍ AÚN NO FUNCIONA — y CÓMO se resuelve (dictamen del ds-reviewer):
//
//   · LA FILA DE ACCIONES («Usar en lote», «Generar variación») SE PINTA, DESHABILITADA. Mi
//     primera versión la omitía entera, con el argumento de que «un botón que no lleva a ningún
//     sitio engaña». Es el MISMO argumento que el usuario ya descartó en T1.13 para «Biblioteca»
//     (F2), «Galería» (F5) y «Métricas» (F6): allí decidió MOSTRARLAS deshabilitadas con el
//     motivo en el nombre accesible, y preguntado de nuevo ha vuelto a elegir lo mismo. «Es de
//     una fase futura» no distingue este caso del precedente. Así que se reusa EXACTAMENTE el
//     patrón de `app-nav.tsx`: el motivo viaja en el `aria-label` (no solo en el `title`, que no
//     llega ni a teclado ni a lector de pantalla) y el `disabled` es prop de primera clase del
//     `Button` del DS — nunca simulado con clases.
//
//   · LOS ▶ DE «ESCUCHA SU VOZ» siguen omitidos (el ds-reviewer lo concede): el bloque de voz
//     conserva forma y jerarquía —las filas por idioma están, con proveedor y voiceId— y lleva su
//     nota de F4. Lo que no se sostenía era que la fila de acciones DESAPARECIERA entera.
//
// El mockup se respeta en LAYOUT y JERARQUÍA; lo que las fases futuras dejan es un afordance
// visible pero inerte y ANUNCIADO como tal.
import { useRef, useState } from 'react';
import { REFERENCE_IMAGES_MIN, VOICE_PROVIDER_LABEL, type Persona } from '@ugc/core/persona';
import { ApiError, personaActions } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const GENDER_LABEL = {
  female: 'femenino',
  male: 'masculino',
  non_binary: 'no binario',
} as const;

const LOCALE_LABEL: Record<string, string> = { es: 'Español', en: 'English' };

interface PersonaDetailProps {
  persona: Persona;
  /** El padre (la librería) mantiene la lista: toda mutación le devuelve la persona nueva. */
  onChange: (persona: Persona) => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function PersonaDetail({ persona, onChange, onEdit, onDelete }: PersonaDetailProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // El error del upload (típicamente el RECHAZO ≥2K). Vive en el componente y no en el store:
  // es feedback de una acción, no estado del dominio.
  const [uploadError, setUploadError] = useState<string | null>(null);

  const voices = Object.entries(persona.voiceMap);
  const images = persona.referenceImageIds;

  async function handleFile(file: File): Promise<void> {
    setUploadError(null);
    setUploading(true);
    try {
      // El SERVIDOR valida ≥2K leyendo el fichero (nunca el cliente: una validación de cliente
      // se salta con un curl, y esta protege el identity lock). Un rechazo llega como
      // `ApiError('validation_error')` y su `details.formErrors[0]` es el mensaje accionable.
      const { persona: updated } = await personaActions.addReferenceImage(persona.id, file);
      onChange(updated);
    } catch (err) {
      if (err instanceof ApiError) {
        setUploadError(firstFormError(err) ?? err.message);
        return;
      }
      throw err;
    } finally {
      setUploading(false);
      // Se limpia el input: si no, subir DOS VECES el mismo fichero (tras corregirlo) no
      // dispararía `change` — el valor no cambiaría.
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function handleRemoveImage(assetId: string): Promise<void> {
    setUploadError(null);
    onChange(await personaActions.removeReferenceImage(persona.id, assetId));
  }

  // EL CONTENEDOR: NI `Card` NI EL CHROME QUE YO LE HABÍA PUESTO. El ds-reviewer preguntó si esto
  // debía ser un `<Card>`; la respuesta la da el MOCKUP, y es «ninguna de las dos»: el panel de la
  // ficha (6c, `docs/mockups/personas.html:54`) es `padding:26px 32px; background:var(--bg)` — SIN
  // borde, SIN sombra y SIN relleno de superficie. O sea que el `rounded-lg border bg-surface` que
  // yo había escrito era chrome INVENTADO que el mockup no dibuja. Adoptar `Card` iría en la
  // dirección CONTRARIA y además costaría tres cosas: añade `shadow-sm` (que el mockup tampoco
  // dibuja), fuerza un `<div>` (perdiendo la semántica de `<article>` — esto ES una unidad de
  // contenido autónoma) y arrastra un `flex flex-col` muerto bajo un `grid`. Así que se QUITA el
  // chrome y se conserva el `<article>`: es lo que el mockup pide, y de paso el fondo vuelve a ser
  // el de la página (`--bg`), que es literalmente lo que dice esa línea 54.
  return (
    <article
      data-testid={`persona-detail-${persona.id}`}
      className="grid grid-cols-1 gap-7 px-8 py-6.5 lg:persona-detail-grid"
    >
      {/* ── Izquierda: las referencias GRANDES (identity lock) ─────────────── */}
      <section className="flex flex-col gap-2" aria-labelledby={`refs-${persona.id}`}>
        <h3 id={`refs-${persona.id}`} className="sr-only">
          Imágenes de referencia de {persona.name}
        </h3>

        {images.length === 0 ? (
          <div className="flex aspect-4/5 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-2 p-5 text-center">
            <p className="text-small text-text-3">Sin imágenes de referencia</p>
            <p className="max-w-60 text-micro text-text-3">
              El identity lock necesita al menos {REFERENCE_IMAGES_MIN} imágenes de 2K o más.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {images.map((assetId, index) => (
              <figure
                key={assetId}
                data-testid={`persona-reference-${assetId}`}
                // La PRIMERA a doble ancho y en 4:5 (el retrato principal del mockup); las
                // siguientes, cuadradas.
                className={
                  index === 0
                    ? 'relative col-span-2 aspect-4/5 overflow-hidden rounded-lg bg-surface-3'
                    : 'relative aspect-square overflow-hidden rounded-md bg-surface-3'
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- el asset se sirve por el
                    download proxificado de T0.5 (`/api/assets/:id/download`), que exige la cookie
                    de sesión; `next/image` lo optimizaría por su loader (otra request, sin
                    cookie) y además no conocemos las dimensiones en build. Es la misma decisión
                    que toma el intake manual con sus imágenes. */}
                <img
                  src={`/api/assets/${assetId}/download`}
                  alt={
                    index === 0
                      ? `Retrato principal de ${persona.name}`
                      : `Referencia ${String(index + 1)} de ${persona.name}`
                  }
                  className="size-full object-cover"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label={`Quitar la imagen ${String(index + 1)} de ${persona.name}`}
                  className="absolute right-2 top-2 bg-surface/80"
                  onClick={() => void handleRemoveImage(assetId)}
                >
                  ✕
                </Button>
              </figure>
            ))}
          </div>
        )}

        <p className="text-center text-micro text-text-3">
          {images.length} {images.length === 1 ? 'imagen de referencia' : 'imágenes de referencia'}{' '}
          · identity lock
        </p>

        {/* El upload MANUAL (§11 «curación manual»). La generación IA es F4. */}
        <label htmlFor={`upload-${persona.id}`} className="sr-only">
          Añadir imagen de referencia
        </label>
        <input
          ref={fileInput}
          id={`upload-${persona.id}`}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif"
          disabled={uploading}
          className="text-micro text-text-3 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border-2 file:bg-surface-3 file:px-3 file:py-1.5 file:text-small file:font-medium file:text-text"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        {uploading && (
          <p role="status" className="text-micro text-text-3">
            Subiendo imagen…
          </p>
        )}
        {uploadError && (
          // El RECHAZO ≥2K aterriza aquí, VISIBLE (es la cláusula de la Verificación: «una
          // imagen <2K es rechazada con mensaje claro»). `role="alert"` = urgente (bloquea).
          // `role="alert"` NO se pasa: la primitiva ya lo pone sola para `danger` (urgente =
          // assertive; `status` para el resto). Escribirlo aquí era redundante.
          <Alert tone="danger">{uploadError}</Alert>
        )}
      </section>

      {/* ── Derecha: la ficha ──────────────────────────────────────────────── */}
      <section className="flex flex-col">
        <p className="mb-2 font-mono text-micro font-semibold tracking-wider text-accent uppercase">
          Persona · sintética
        </p>
        <h2 className="text-h2 font-semibold tracking-h1 text-text">{persona.name}</h2>
        <p className="mt-1.5 text-small text-text-3">
          {persona.ageRange} · {GENDER_LABEL[persona.gender]} · {persona.ethnicity} ·{' '}
          {persona.style}
        </p>

        <p className="mt-4 text-body leading-relaxed text-text-2">{persona.personality}</p>

        {persona.wardrobeNotes && (
          <p className="mt-3 text-small text-text-3">
            <span className="font-medium text-text-2">Vestuario:</span> {persona.wardrobeNotes}
          </p>
        )}

        <p className="mt-3 text-small text-text-3">
          <span className="font-medium text-text-2">Escenario:</span> {persona.setting}
        </p>

        <h3 className="mt-6 mb-3 font-mono text-micro font-semibold tracking-wide text-text-3 uppercase">
          Voz por idioma
        </h3>
        {voices.length === 0 ? (
          <p className="text-small text-text-3">Sin voces asignadas.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {voices.map(([locale, voice]) => (
              <li
                key={locale}
                data-testid={`persona-voice-${locale}`}
                className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-4 py-3"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-mono font-medium text-text">
                    {LOCALE_LABEL[locale] ?? locale}
                  </span>
                  <span className="font-mono text-micro text-text-3">
                    {VOICE_PROVIDER_LABEL[voice.provider]}
                    {voice.label ? ` · ${voice.label}` : ''}
                  </span>
                </div>
                <Badge mono tone="neutral">
                  {voice.voiceId}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {/* El PREVIEW de voz (los ▶ del mockup) llega en F4: un botón que no suena engañaría. */}
        <p className="mt-2 text-micro text-text-3">
          El preview de voz llega en la fase F4 (generación).
        </p>

        {/* LA FILA DE ACCIONES DEL MOCKUP 6c (línea 67), con los dos botones DESHABILITADOS.
            El motivo viaja en el NOMBRE ACCESIBLE (`aria-label`), no solo en el `title`: el
            `title` solo aparece con hover del RATÓN, así que quien navega con teclado o lector
            oiría «Usar en lote, botón, deshabilitado» sin saber por qué ni cuándo llega. Es
            literalmente el patrón que T1.13 dejó escrito para los destinos de nav de fases
            futuras (`app-nav.tsx`), reusado tal cual. */}
        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <Button
            disabled
            aria-label="Usar en lote · llega en T2.3 (la UI de matriz de variantes)"
            title="Llega en T2.3 (la UI de matriz de variantes)"
          >
            Usar en lote
          </Button>
          <Button
            variant="secondary"
            disabled
            aria-label="Generar variación · llega en la fase F4 (generación IA de referencias)"
            title="Llega en la fase F4 (generación IA de referencias)"
          >
            Generar variación
          </Button>
        </div>

        {/* Editar/Eliminar NO están en el mockup (que dibuja una ficha de solo lectura): son el
            CRUD que ESTA tarea entrega, así que van en su propia fila, subordinados a las
            acciones de producto de arriba. */}
        <div className="mt-2.5 flex items-center gap-2.5">
          <Button variant="ghost" onClick={onEdit}>
            Editar
          </Button>
          <Button variant="danger-ghost" onClick={onDelete}>
            Eliminar
          </Button>
        </div>
      </section>
    </article>
  );
}

/** El primer `formErrors` del envelope (`z.flattenError` del servidor): es el mensaje redactado
 *  para el humano. Si no lo hay, el caller cae al `message` del envelope. */
function firstFormError(err: ApiError): string | undefined {
  const details = err.details as { formErrors?: string[] } | undefined;
  return details?.formErrors?.[0];
}
