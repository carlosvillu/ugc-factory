# Clip VEED para juicio humano de LIPSYNC (cláusula 4, T4.7b)

- **Fichero**: `clip-veed.mp4` (en este mismo directorio) — 5.457s, h264+aac, voz de librería VEED embebida.
- **avatar_id usado**: `emily_vertical_primary` (preset vertical 9:16, sembrado en el model_profile).
- **Texto del hook que VEED debía hablar (input `text`)**:
  > Tired of ads that feel fake? This one is different, watch what happens next.
- **Lo que el ASR transcribió del audio EXTRAÍDO del clip** (prueba de que la voz embebida dice el hook):
  > Tired of ads that feel fake? This one is different. Watch what happens next
- **word timestamps**: 14/14 palabras con tiempos (100%), en `word-timestamps.json`.

## Pregunta para el usuario
¿El avatar de `clip-veed.mp4` habla el hook con LIPSYNC aceptable (la boca sincroniza con la voz)?
El veredicto OBJETIVO (cláusulas 1-3) es PASS; solo falta este juicio humano para cerrar la cláusula 4.
