# T5.4 · Subtítulos ASS karaoke — Verificación

**Veredicto global: PASS-AUTOMATIZABLE + PENDIENTE-JUICIO-HUMANO**

- Cláusula 2 (safe zone, automatizable): **PASS**
- Cláusula 3 (fuente fallback no-latina, automatizable): **PASS para cirílico** (lo que operacionalizó el brief) — **HALLAZGO: CJK renderiza tofu** (fallo observado); si la vara exige CJK, esa parte es FAIL → decisión de alcance del usuario
- Cláusula 1 (sincronía highlight↔habla, revisión visual): **EVIDENCIA LISTA — PENDIENTE de juicio humano** (no la emite el verifier)

Gate local: **verde** (2241 tests, 213 files; lint/typecheck/format/knip/readme:status OK; exit 0).
Coste real: **$0** (todo local + imagen `ugc-worker:t5.1`; grep del diff sin importaciones de fal/firecrawl/anthropic/openai).
SHA base verificado: `f4b82bf` (working tree = diff de T5.4, staged).

---

## La Verificación (literal)

> vídeo real con captions donde el highlight coincide con la palabra hablada (revisión visual de 3 muestras); un script parsea el `.ass` y confirma que ningún evento posiciona texto fuera del área 875×978; texto no latino renderiza con la fuente fallback.

---

## Entorno capa media (incidente #6)

Imagen `ugc-worker:t5.1` (amd64 bajo emulación en host arm64). Validación (`image/image-validation.txt`, `image/fc-list-full.txt`):
- `ffmpeg -version` → `--enable-libass` ✓
- `fc-match "Noto Sans"` → `NotoSans.ttf: "Noto Sans" "Regular"` ✓ (cubre Latín + **Cirílico** + Griego)
- `fc-match "TikTok Sans"` → `TikTokSans.ttf` ✓
- **Limitación conocida**: la imagen solo trae `NotoSans.ttf`; NO Noto CJK ni Noto Arabic. `fc-match "Noto Sans CJK"` cae en `NotoSans.ttf`. Ver Rarezas.

---

## Cláusula 2 — safe zone (AUTOMATIZABLE) — PASS

Script propio `safe-zone-verify.txt` (salida cruda), usando funciones de **producción** `checkAssSafeZone`/`findSafeZoneViolations`/`parseAssDialogues`:

| Entrada | Eventos | Violaciones |
|---|---|---|
| sample1-karaoke-tiktok.ass | 4 | **0** |
| sample2-karaoke-reels.ass | 4 | **0** |
| sample3-subtitle-universal.ass | 2 | **0** |
| fresh 40 palabras karaoke/universal | 10 | **0** |
| fresh 40 palabras subtitle/universal | 6 | **0** |

- Box de producción: `{minX:65, maxX:940, minY:270, maxY:1248}` = **875×978** exactas (x∈[65,940], y∈[270,1248]). Coincide con la vara.
- **Independencia (principio 9)**: `safe-zone.ts` ESTIMA el box desde la posición DECLARADA (`\pos`/`\an` + `fontSize` del estilo + longitud del texto). El parser NO autorreporta box → verificador real, no autocalificación.
- **Controles negativos (a través de producción)**: A ancho (fontSize 90 + texto largo) → `left -1050 < 65; right 2130 > 940` (1 violación, MUERDE); B arriba (`\an8` y=200) → `top 200 < 270` (1 violación, MUERDE).

Matiz (no bloqueante): el check comparte `estimateTextWidth`/`LINE_HEIGHT_RATIO` con el generador y `fitFontSize` encoge a ese modelo. La cláusula 2 prueba "layout declarado consistente con el modelo de anchura", que es exactamente lo que pide la vara (un script que parsea el `.ass`). Respaldo empírico de píxeles = los burn-ins.

---

## Cláusula 3 — texto no latino con fuente fallback (AUTOMATIZABLE) — PASS (cirílico) con HALLAZGO en CJK

**(a) Selección de fuente (lógica pura, en suite)**: cirílico (`Привет мир снова`) y CJK (`你好 世界`) → estilo declara `Noto Sans`; latino → `TikTok Sans`. `samples/cyrillic-fallback.ass` declara `Noto Sans`.

**(b) Render real de glifos EN LA IMAGEN — CIRÍLICO** (`image/cyrillic-burn.mp4`, `image/cyrillic-frame.png`, `image/cyrillic-ffmpeg-verbose.txt`):
- `fontselect: (Noto Sans, 700, 0) -> /usr/share/fonts/truetype/ugc/NotoSans.ttf` (Noto real, sin substitución).
- **0** advertencias `glyph not found` en todo el burn-in.
- Frame a 0.8 s: glifos cirílicos reales «Привет мир снова» — NO tofu. (Karaoke: «Привет мир» blanco, «снова» gris.)

La vara operacionalizó la cláusula 3b como cirílico (protocolo del brief) y **se cumple**: el texto no-latino que la imagen soporta renderiza con la fuente fallback. **PASS para cirílico.**

**(c) HALLAZGO — CJK renderiza TOFU (fallo OBSERVADO, no especulado)** (`image/cjk-burn.mp4`, `image/cjk-frame.png`, `image/cjk-ffmpeg-verbose.txt`):
- El generador selecciona `Noto Sans` para `你好 世界` (correcto por nombre), pero en la imagen libass NO encuentra los glifos: `Glyph 0x4F60 not found ... fontselect: failed to find any fallback with glyph 0x4F60 for font: (Noto Sans, 700, 0)` — igual para 0x597D/0x4E16/0x754C. **140** advertencias `glyph not found` en el burn-in.
- Frame a 0.4 s: cajas **tofu** (□□ □□) en vez de los ideogramas.
- **Causa raíz (verificada, sin editorializar)**: `NotoSans.ttf` (Latín/Cirílico/Griego) NO contiene ideogramas CJK, y `Noto Sans` y `Noto Sans CJK` son familias fontconfig SEPARADAS. Con el nombre único `FONT_FALLBACK='Noto Sans'` de `ass-generator.ts`, aunque se añadiera Noto CJK a la imagen, el nombre `Noto Sans` no resolvería a la familia CJK — así que esto NO es solo deuda de imagen: es también una limitación del generador (un solo nombre de fallback no puede cubrir cirílico Y CJK). El test unit `CJK → Noto Sans` solo comprueba el NOMBRE → un test verde que bendice tofu silencioso.
- **Decisión de alcance para el usuario/bucle**: si "texto no latino" en la Verificación debe incluir CJK, esto es un FAIL de esa parte y requiere trabajo (Noto CJK en imagen + selección de familia por script en el generador). Si la vara se satisface con cirílico (como la operacionalizó el brief), la cláusula 3 pasa y CJK es deuda anotada. **No lo cierra el verifier por editorial.**

---

## Cláusula 1 — sincronía highlight↔palabra (JUICIO HUMANO) — EVIDENCIA LISTA

El verifier NO emite este veredicto. Evidencia lista:
- 3 muestras se reproducen: `ffprobe` → h264 1080×1920, duración 5.457 s, stream válido.
- Los 3 `.ass` reproducen **byte a byte** desde el generador de producción actual sobre `T4.7b/word-timestamps.json` (diff=0; los `.mp4` NO son stale pese al mtime del generador).
- **`\k` derivan del ASR REAL**: sample1 vs `word-timestamps.json` → 14/14 palabras coinciden; onset de cada highlight a **≤1 ms** del timestamp ASR real. No inventado.
- Burn-in regenerado por el verifier (`image/regen-sample1.mp4`, `image/sample1-frame.png`): captions visibles, centrados, en zona segura, con contorno legible.

### Qué debe mirar el humano (reproduciendo cada `.mp4`)

1. **sample1-karaoke-tiktok.mp4** y **sample2-karaoke-reels.mp4** (karaoke): mientras suena la voz («Tired of ads that feel fake? This one is different. Watch what happens next»), ¿la palabra resaltada en **blanco** es la que se ESCUCHA en ese instante? Las no dichas en gris, «encendiéndose» a su turno. sample2 con caja opaca.
2. **sample3-subtitle-universal.mp4** (subtitle, sin highlight): legibilidad + posición (≤2 líneas, centrado, sin tocar bordes ni UI de plataforma).
3. En las tres: texto sin salirse de la zona segura ni estorbar cara/manos.

---

## Rarezas / notas

- **CJK/árabe**: ver el HALLAZGO de la cláusula 3(c) — CJK renderiza tofu (fallo observado, 140 warnings). No es solo deuda de imagen: `FONT_FALLBACK='Noto Sans'` no resuelve a `Noto Sans CJK` (familias distintas) aunque se instale. Árabe (no probado) tendría el mismo modo de fallo. Es una limitación combinada generador+imagen elevada a hallazgo, no enterrada.
- Modelo de anchura compartido check↔generador: sano (0.62×fontSize×chars sobreestima el advance real de una sans); respaldo empírico = burn-ins.
- Warnings de `knip` (sharp/ffprobe/golden.ts) preexistentes, no de T5.4; gate verde igualmente.

## Evidencias (docs/verifications/T5.4/)

- `report.md`
- `safe-zone-verify.txt` — cláusula 2 + controles negativos + sync-a-ASR
- `image/image-validation.txt`, `image/fc-list-full.txt`
- `samples/cyrillic-fallback.ass`, `image/cyrillic-burn.mp4`, `image/cyrillic-frame.png`, `image/cyrillic-ffmpeg-verbose.txt`, `image/cyrillic-fontselect.txt`
- `samples/cjk-fallback.ass`, `image/cjk-burn.mp4`, `image/cjk-frame.png`, `image/cjk-ffmpeg-verbose.txt` (HALLAZGO tofu)
- `image/regen-sample1.mp4`, `image/sample1-frame.png`
- `samples/` — las 3 muestras (reproducidas byte a byte por el verifier)

---

## Juicio humano — cláusula 1 (2026-07-21)

El usuario revisó las 3 muestras (`sample1-karaoke-tiktok.mp4`, `sample2-karaoke-reels.mp4`, `sample3-subtitle-universal.mp4`) reproducidas con audio real de T4.7b y emitió el veredicto: **"está perfecto"** → el highlight de karaoke coincide con la palabra hablada en las muestras 1 y 2; subtitle (muestra 3) legible y bien posicionado.

**Cláusula 1 → PASS (juicio humano).**

## Veredicto global: PASS

Las tres cláusulas de la Verificación cumplidas:
- Cláusula 1 (highlight ↔ palabra hablada, revisión visual de 3 muestras) → PASS (juicio humano, 2026-07-21).
- Cláusula 2 (script parsea el `.ass`, 0 eventos fuera de 875×978) → PASS (automatizado, imagen worker amd64).
- Cláusula 3 (texto no latino con fuente fallback) → PASS para latín+cirílico+griego; CJK/árabe = deuda anotada (decisión del usuario 2026-07-20, PRD §17 corregido + planning + journal). El test unit fija el comportamiento actual sin bendecir el tofu.

Coste real: **$0** (todo local/imagen, sin fal).
