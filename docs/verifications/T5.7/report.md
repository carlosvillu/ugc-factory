# Verificación T5.7 — Export bundle + biblioteca

- **Tarea**: T5.7 · Export bundle + biblioteca (`planning.md:751`)
- **Fecha**: 2026-07-23
- **Ejecutor**: verifier (contexto fresco, escéptico) · agent-browser 0.27.x · sesión `t5.7`
- **Sistema**: commit `dc777c1` (working tree con el diff T5.7 sin commitear) · docker compose dev (Postgres 16) + `pnpm dev` (web+worker) + migraciones · seed de una variante aprobada con linaje (script efímero del verifier, ya borrado)
- **Toolchain media (host)**: ffmpeg 4.4.1 + c2patool 0.27.1 (instalado por el verifier vía `arch -arm64 brew install c2patool` para correr la suite `RUN_MEDIA` en nativo)

## Verificación esperada (literal de planning.md)
> descargar un bundle y validar el JSON contra su schema (caption dentro de límites — test); un lote destino "ambos" produce las dos versiones de audio del mismo master SIN re-encode de vídeo (timestamps de ffmpeg lo confirman); el linaje en la UI llega del master hasta el hook line y el `template@version` exactos.

## Gate previo
`pnpm gate` → VERDE: 227 test files, **2378 tests passed** (`gate.txt`). Sin flaky. El e2e se corrió aparte (ver abajo).

## Cláusula 1 — descargar bundle + validar JSON contra su schema (caption dentro de límites, control negativo que muerde)
1. Semilla de variante aprobada `destination='both'`, template_version=7, hook exacto, con máster MP4 real + copia no-bed materializada, en BD y storage del dev vivo.
2. Descarga real por HTTP autenticado de `?audio=with_bed` y `?audio=no_bed` → dos ZIP (200, application/zip) con MP4 + metadata.json.
3. Checksum del MP4 extraído (with_bed) = `32542cf1…` == `asset.checksum` real == cabecera `X-Bundle-Mp4-Checksum`.
4. El metadata.json DESCARGADO pasado por el schema REAL `ExportBundleMetadataSchema`: with_bed y no_bed PARSEAN OK. Caption real 46 chars, sin @/#, brand «Nuvela» (6≤20). (`clause1-schema-validation.txt`)
5. Controles negativos (MUERDEN): caption con @ / # / https:// / dominio-TLD / 101 chars, brand 21 chars, aigc_disclosure:false → los 7 RECHAZADOS.
6. no_bed: audio_version=no_bed, audio_source=none (correcto).

## Cláusula 2 — dual "ambos": dos versiones del MISMO máster SIN re-encode (ffmpeg)
7. `apps/worker/test/media/export-remux.test.ts` con REQUIRE_MEDIA=1 (binario ausente ERRORA, no skip silencioso) + toolchain real.
8. El test EJECUTÓ (no skip) y PASÓ: aislado `worker:media > export-remux.test.ts` → Tests 1 passed (`clause2-export-remux-isolated.txt`). Asserta MD5 del stream de vídeo IDÉNTICO máster↔no-bed (`-map 0:v -c copy -f md5` → sin re-encode), codec/nb_frames/time_base/w/h coincidentes, audio MD5 DISTINTO, manifest C2PA presente.
9. Plomería dual web confirmada por el e2e y la descarga viva (ambas versiones comparten el checksum del máster).

## Cláusula 3 — linaje en la UI: máster → hook line + template@version EXACTOS (navegador)
10. Login (agent-browser) → `/library` → panel de linaje (`02-lineage-panel.png`): Hook line «La vitamina C que de verdad se nota en 15 días» (exacto); Template `before-after-skincare-verify@7` (columna template_version de la variante, no la última del template); Persona Lucía Verify · es; Máster 1080×1920·30fps·−14 LUFS.
11. Descarga feliz vía botón UI (with_bed) → sin banner de error.
12. Control negativo UI (code-review FIX 1): borrado el fichero no-bed → ruta 409; clicar «Sin bed» → banner de error VISIBLE y NINGÚN fichero descargado (`03-nobed-409-banner.png`).
13. Consola del navegador limpia (solo HMR/DevTools dev-only): `browser-console-final.txt`.
14. Contraste WCAG (alpha compositada sobre fondo real): download-bundle 5.42:1; badge success 7.69:1; badge info 4.93:1; download-nobed 14.58:1; score 6.25:1 — todos ≥4.5:1.

## Regresión e2e (checksum del MP4 extraído)
15. `library.spec.ts` (6 tests) → 6 passed (`library-e2e.txt`).

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | Descargar bundle, JSON pasa schema, caption en límites, negativo muerde | 2 ZIP 200; metadata.json real PARSEA el schema; caption 46/≤100 sin @/#; 7 negativos RECHAZADOS; checksum MP4==asset.checksum | clause1-schema-validation.txt, bundle-*.zip, library-e2e.txt | OK |
| 2 | Dual "ambos" → dos versiones del mismo máster SIN re-encode (ffmpeg) | export-remux.test.ts EJECUTÓ (REQUIRE_MEDIA=1) y PASÓ: stream vídeo MD5 idéntico, audio distinto, C2PA presente | clause2-export-remux-isolated.txt, clause2-media-test.txt | OK |
| 3 | Linaje UI → hook line + template@version EXACTOS | before-after-skincare-verify@7 + hook exacto + persona en navegador | 02-lineage-panel.png | OK |
| 3b | Descarga UI feliz + 409 → banner visible, sin fichero | botón descarga ok; no-bed 409 → banner, sin download | 03-nobed-409-banner.png, library-e2e.txt | OK |

## Coste real
$0 — másters sintéticos (random bytes / lavfi), sin fal ni APIs de pago. Estimado $0.

## Veredicto
PASS — las tres cláusulas verificadas contra el sistema real.

### Rarezas / notas (no bloquean T5.7)
- c2patool version-drift en un test AJENO (T5.5): la suite worker:media completa mostró 1 fallo en compose-variant.test.ts (T5.5) — `c2patool --info` sobre el host 0.27.1 devuelve `signingCredential.untrusted` y ya no imprime «Validated». NO es de T5.7 (su test asserta `contains('manifest')`, que pasa). Artefacto del binario host que instalé; en la imagen del worker (c2patool 0.9.12) ese assert de T5.5 pasa. Deuda de robustez del assert de T5.5 frente a versiones de c2patool.
- Desviaciones menores regla 6 (declaradas, deuda temporal no cimentada): destination en jsonb ad_batch.matrix (sin migración, default organic); ad_caption derivado del hook (sin generador de copy hasta F6); versión sin bed servida desde key pre-materializada (executor F6 → 409 hasta entonces). Consistentes con F5.
- El fallo inicial del e2e fue colisión de puertos autoinducida (mi pnpm dev en :3000 chocó con el segundo dev-server del e2e-stack); resuelto parando el dev server → 6/6 verde.
