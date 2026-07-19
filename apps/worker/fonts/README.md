# Vendored fonts (worker render image, T5.1)

These OFL-licensed font families are committed to the repo (not fetched at build
time) so the worker image is reproducible and offline-buildable. The render
pipeline (T5.4 subtitles via libass, `drawtext` overlays) resolves fonts **by
family name** through fontconfig, so the exact family names below are
load-bearing, not cosmetic.

The image copies these to `/usr/share/fonts/truetype/ugc/` and runs `fc-cache -f`.

| Family (fontconfig name)       | Files                                                | License | Upstream (canonical OFL source)                                              |
| ------------------------------ | ---------------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `TikTok Sans`                  | `tiktoksans/TikTokSans.ttf` (variable)               | OFL 1.1 | Google Fonts `ofl/tiktoksans`; upstream https://github.com/tiktok/TikTokSans |
| `Poppins`                      | `poppins/Poppins-{Regular,Medium,SemiBold,Bold}.ttf` | OFL 1.1 | Google Fonts `ofl/poppins`; upstream https://github.com/itfoundry/Poppins    |
| `Noto Sans` (Unicode fallback) | `notosans/NotoSans.ttf` (variable)                   | OFL 1.1 | Google Fonts `ofl/notosans`; Google Noto                                     |

## License compliance (why the OFL.txt files are here)

The SIL Open Font License **requires** its text to travel with the font files
(OFL §clause 2: the license must be bundled with any redistribution). This repo
is public (AGPL-3.0), so each family ships its own `OFL.txt` next to the `.ttf`
files. Do not remove them.

## Updating

Re-download from Google Fonts (`github.com/google/fonts`, `ofl/<family>`) keeping
the same layout and the accompanying `OFL.txt`. The internal family name (the
`name` table entry `fc-list` reports) must stay `TikTok Sans` / `Poppins` /
`Noto Sans` or the render pipeline will not resolve them.
