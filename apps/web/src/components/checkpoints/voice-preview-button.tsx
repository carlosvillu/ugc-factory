'use client';

// BOTÓN ▶ DE PREVIEW DE VOZ (T4.6, §8.3): reproduce una muestra TTS de la voz de una Persona en el
// idioma dado, ANTES de gastar render. Se usa en CP2 (por Persona candidata × idioma del lote) y en
// CP3 (por variante, con la Persona y el idioma ya fijados).
//
// DS: el disparador es la primitiva `Button` (glifo Unicode ▶/⏸, `lucide` PROHIBIDO), con estado
// `loading` mientras se genera la muestra y `aria-label` descriptivo. La REPRODUCCIÓN usa `new Audio()`
// CRUDO — es una superficie legítima sin primitiva del DS (no se construye un componente player), y el
// `<audio src>` apunta al `GET /api/assets/:id/download` existente.
//
// CACHÉ: la PRIMERA reproducción llama a `POST /api/personas/:id/voice-preview` (que genera o
// reutiliza de caché en el servidor) y memoiza el `assetId` en el componente; las siguientes
// reproducen el MISMO `<audio>` sin volver a llamar a la API — así reproducir 5 veces no añade coste
// (y aunque volviera a llamar, el servidor haría un cache-hit sin tocar fal ni el ledger). El id de la
// muestra depende de (persona, idioma): cambiar cualquiera de los dos es OTRO botón (React lo remonta
// por `key`) o invalida el id memoizado.
import { useEffect, useRef, useState } from 'react';
import { ApiError, personaActions } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

export function VoicePreviewButton({
  personaId,
  language,
  languageLabel,
  personaName,
  size = 'sm',
}: {
  personaId: string;
  language: string;
  /** Etiqueta legible del idioma para el `aria-label` (p. ej. «Español»). */
  languageLabel: string;
  /** Nombre de la persona para el `aria-label` (p. ej. «Lucía»). */
  personaName: string;
  size?: 'sm' | 'md';
}) {
  const [assetId, setAssetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Al desmontar (o cambiar persona/idioma) se detiene y suelta el <audio> vivo — sin esto una muestra
  // seguiría sonando tras cerrar el panel.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [personaId, language]);

  async function play() {
    setError(null);
    // Si ya está sonando, esto es un PAUSE (toggle).
    if (playing && audioRef.current !== null) {
      audioRef.current.pause();
      return;
    }
    try {
      let id = assetId;
      if (id === null) {
        setLoading(true);
        const res = await personaActions.voicePreview(personaId, language);
        id = res.assetId;
        setAssetId(id);
      }
      // Un <audio> FRESCO por reproducción (la muestra es pequeña): reproducir desde el principio sin
      // arrastrar estado. Se para el anterior antes de crear el nuevo, y se guarda en el ref para que
      // el cleanup lo detenga al desmontar. El assetId ya está memoizado en el estado, así que la 2ª
      // reproducción NO vuelve a llamar a la API (solo re-crea el elemento local).
      audioRef.current?.pause();
      const audio = new Audio(`/api/assets/${id}/download`);
      audio.addEventListener('ended', () => {
        setPlaying(false);
      });
      audio.addEventListener('pause', () => {
        setPlaying(false);
      });
      audio.addEventListener('play', () => {
        setPlaying(true);
      });
      audioRef.current = audio;
      await audio.play();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo reproducir la muestra de voz.');
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }

  const label = `${playing ? 'Pausar' : 'Escuchar'} la voz de ${personaName} en ${languageLabel}`;

  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        type="button"
        variant="secondary"
        size={size}
        icon
        loading={loading}
        aria-label={label}
        aria-pressed={playing}
        data-slot="voice-preview"
        data-persona-id={personaId}
        data-language={language}
        data-playing={playing}
        onClick={() => {
          void play();
        }}
      >
        {/* Glifo Unicode (DS: sin librería de iconos). ▶ para reproducir, ⏸ mientras suena. */}
        <span aria-hidden="true">{playing ? '⏸' : '▶'}</span>
      </Button>
      {error !== null ? (
        <span role="alert" className="text-micro text-danger" data-slot="voice-preview-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
