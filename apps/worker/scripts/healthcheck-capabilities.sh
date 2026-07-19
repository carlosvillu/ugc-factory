#!/bin/sh
# Capability healthcheck for the render worker image (T5.1).
#
# The worker is a daemon with no HTTP surface, so "is it healthy?" cannot be a
# fetch. Instead it must assert the RENDER TOOLCHAIN is present and capable:
# every capability the composition steps (F5: T5.2 normalize, T5.4 subtitles,
# audio ducking, C2PA signing) depend on. A missing capability here is a latent
# failure that would only surface on the first real render — this script turns it
# into a boot-time, exit!=0 signal with a clear message.
#
# Wired as Docker HEALTHCHECK in apps/worker/Dockerfile. Also runnable by hand:
#   docker exec <worker> /app/scripts/healthcheck-capabilities.sh
#
# POSIX sh (no bashisms): keeps it valid regardless of the image's default shell.
set -eu

fail() {
  echo "healthcheck FAILED: $1" >&2
  exit 1
}

# 1) ffmpeg present + the audio-ducking filter used to sidechain-compress the
#    background music under the voiceover (verification command #1 of T5.1).
command -v ffmpeg >/dev/null 2>&1 || fail "ffmpeg not on PATH"
ffmpeg -hide_banner -filters 2>/dev/null | grep -qw sidechaincompress \
  || fail "ffmpeg lacks the sidechaincompress filter (audio ducking)"

# 2) ffmpeg built with libass: the 'ass' filter renders the styled subtitle
#    track (T5.4). Without it the subtitle step is impossible.
ffmpeg -hide_banner -filters 2>/dev/null | grep -qE '^ [.TSC.]* ass ' \
  || ffmpeg -hide_banner -filters 2>/dev/null | grep -qw ass \
  || fail "ffmpeg lacks the 'ass' filter (libass / subtitles)"

# 3) ffprobe present: duration/stream measurement (already used by the N7c smoke).
command -v ffprobe >/dev/null 2>&1 || fail "ffprobe not on PATH"
ffprobe -version >/dev/null 2>&1 || fail "ffprobe does not run"

# 4) c2patool present + runnable: C2PA provenance signing of the final render.
command -v c2patool >/dev/null 2>&1 || fail "c2patool not on PATH"
c2patool --version >/dev/null 2>&1 || fail "c2patool does not run"

# 5) The three font families the render pipeline resolves by name via fontconfig.
#    fc-list reports the internal family name; libass/drawtext look them up by it.
command -v fc-list >/dev/null 2>&1 || fail "fc-list not on PATH (fontconfig)"
for family in "TikTok Sans" "Poppins" "Noto Sans"; do
  fc-list | grep -qi "$family" || fail "font family not installed: $family"
done

echo "healthcheck OK: ffmpeg(sidechaincompress+ass) ffprobe c2patool fonts(TikTok Sans,Poppins,Noto Sans)"
