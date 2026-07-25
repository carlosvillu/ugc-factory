#!/usr/bin/env bash
# VERIFIER-OWNED probe (T5.8c). NO es el test del implementer.
#
# Qué prueba que el test del implementer NO prueba: que los PÍXELES del clip 1 (y 2) aterrizan en el
# vídeo de escena y SOBREVIVEN al fitter. El test `3 clips ... preserva el ORDEN temporal` crea clips
# rojo/verde/azul pero SOLO asserta la DURACIÓN — los colores son decorativos, nadie los mira. Un concat
# que repitiera el clip 0 tres veces pasaría ese test.
#
# Aquí se muestrea el color medio de un frame en cada tercio del output y se comprueba
# rojo → verde → azul EN ORDEN.
set -euo pipefail
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT

mk() { ffmpeg -hide_banner -loglevel error -f lavfi -i "color=c=$2:s=320x568:d=$3:r=30" \
        -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -y "$W/$1" ; }

# Tres clips de 4s: rojo, verde, azul (el troceo §7.5 de una escena de 12s).
mk c0.mp4 red 4
mk c1.mp4 green 4
mk c2.mp4 blue 4

echo "== duraciones de los clips de entrada =="
for f in c0 c1 c2; do
  printf '%s: ' "$f"; ffprobe -v error -show_entries format=duration -of csv=p=0 "$W/$f.mp4"
done

# El CONCAT DE PRODUCCIÓN: los args exactos que emite buildSceneConcatArgs (concat filter, -an,
# INTERMEDIATE_ENCODE_ARGS). Se replican aquí para probar el fichero, no el string.
echo "== concat intra-escena (3 clips) =="
ffmpeg -hide_banner -loglevel error -i "$W/c0.mp4" -i "$W/c1.mp4" -i "$W/c2.mp4" \
  -filter_complex "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]" -map "[v]" -an \
  -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -y "$W/scene.mp4"
printf 'scene.mp4 duracion: '; ffprobe -v error -show_entries format=duration -of csv=p=0 "$W/scene.mp4"

# Color medio de UN frame en el centro de cada clip (2s, 6s, 10s).
probe_color() {
  ffmpeg -hide_banner -loglevel error -ss "$2" -i "$1" -frames:v 1 -vf "scale=1:1" -f rawvideo -pix_fmt rgb24 - \
    | od -An -tu1 | tr -s ' '
}
echo "== color medio (R G B) por tercio de scene.mp4 =="
echo "t=2s  (esperado ROJO  ~ 237 28 36 ):$(probe_color "$W/scene.mp4" 2)"
echo "t=6s  (esperado VERDE ~ 0 177 64  ):$(probe_color "$W/scene.mp4" 6)"
echo "t=10s (esperado AZUL  ~ 0 0 255   ):$(probe_color "$W/scene.mp4" 10)"

# Y AHORA lo que importa para la clausula titular: el fitter recorta la escena a una narracion de 10.5s
# (> los 8s de tope de clip del modelo). Los pixeles del clip 1 y 2 DEBEN seguir ahi despues del fit.
echo "== fit a narracion 10.5s (trim) =="
ffmpeg -hide_banner -loglevel error -i "$W/scene.mp4" -t 10.500 \
  -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -y "$W/fitted.mp4"
printf 'fitted.mp4 duracion: '; ffprobe -v error -show_entries format=duration -of csv=p=0 "$W/fitted.mp4"
echo "t=2s  (ROJO,  clip0):$(probe_color "$W/fitted.mp4" 2)"
echo "t=6s  (VERDE, clip1):$(probe_color "$W/fitted.mp4" 6)"
echo "t=10s (AZUL,  clip2):$(probe_color "$W/fitted.mp4" 10)"
