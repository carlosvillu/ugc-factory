# T5.4 · Muestras de subtítulos ASS para revisión humana

Estas 3 muestras están **RENDERIZADAS y listas** para el juicio humano que pide la Verificación de T5.4
(«vídeo real con captions donde el highlight coincide con la palabra hablada — revisión visual de 3
muestras»). El implementer NO juzga la sincronía: la decide el usuario/bucle.

## Origen (coste $0 — nada generado con fal)

- Vídeo + voz REALES: `../../T4.7b/clip-veed.mp4` (avatar hablando, VEED, T4.7b).
- Word timestamps ASR REALES de esa voz: `../../T4.7b/word-timestamps.json`
  (texto: «Tired of ads that feel fake? This one is different. Watch what happens next»).

Los `.ass` los genera el **generador de producción** (`apps/worker/src/captions/ass-generator.ts`) desde
esos timestamps: el highlight `\k` de cada palabra deriva del onset REAL del ASR (no inventado).

## Las 3 muestras

| Fichero | Preset | Plataforma | Qué la distingue |
|---|---|---|---|
| `sample1-karaoke-tiktok.mp4` | karaoke (1–4 palabras/página) | tiktok | TikTok Sans blanco + **contorno** negro; word-highlight `\k` |
| `sample2-karaoke-reels.mp4` | karaoke (1–4 palabras/página) | reels | Igual highlight pero con **caja opaca** (`BorderStyle=3`) |
| `sample3-subtitle-universal.mp4` | subtitle (3–7 palabras/2 líneas) | universal | Sin highlight; páginas más largas en ≤2 líneas |

## Qué debe juzgar el humano

En las dos muestras **karaoke** (1 y 2): mientras se reproduce, **la palabra resaltada en blanco debe ser
la que suena en ese instante** (las aún no dichas se ven en gris y se «encienden» al llegar su turno). Ese
es el criterio de la Verificación. Confirmar también que el texto cae dentro de la zona segura (centrado,
sin tocar bordes ni la parte inferior de UI de la plataforma) y que la fuente/contorno se lee sobre el
fondo. En la muestra 3 (subtitle) no hay highlight: se juzga solo legibilidad y posición.

## Cómo reproducir las muestras (el verifier las regenera así)

Los `.ass` y los `.mp4` son deterministas. Requieren la **imagen del worker** `ugc-worker:t5.1`
(ffmpeg + libass + fuentes TikTok Sans/Noto), NO el ffmpeg del Mac (incidente #6).

1. Generar los `.ass` desde los timestamps reales con el script committeado (llama a `generateAss` de
   producción — parsea `word-timestamps.json` con `WordTimestampsSchema` y genera los 3 pares de la tabla):

   ```sh
   node --experimental-strip-types docs/verifications/T5.4/gen-samples.mjs
   ```

2. Quemar cada `.ass` sobre el clip real dentro de la imagen worker:

   ```sh
   docker run --rm -v "$PWD/docs/verifications:/work" -w /work ugc-worker:t5.1 sh -c '
     for s in T5.4/samples/sample1-karaoke-tiktok \
              T5.4/samples/sample2-karaoke-reels \
              T5.4/samples/sample3-subtitle-universal; do
       ffmpeg -y -loglevel error -i T4.7b/clip-veed.mp4 -vf "ass=$s.ass" \
         -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a copy "$s.mp4"
     done'
   ```

   Salida: 3 `.mp4` H.264 1080×1920 con los captions quemados. Este es un harness DESECHABLE de muestreo,
   NO el pase final de T5.5 (sin mix, sin `-c:a copy` como contrato, sin C2PA ni QA).
