# Verificación T5.5 — Pase final, export master y QA automático

- **Tarea**: T5.5 · Pase final, export master y QA automático (`planning.md`)
- **Fecha**: 2026-07-21
- **Ejecutor**: verifier (agente escéptico, contexto fresco) · sin agent-browser (tarea backend/media, sin superficie UI) · imagen `ugc-worker:t5.1` (amd64) + Postgres real (Testcontainers)
- **Sistema**: commit base `0f35ba6` + diff en árbol de trabajo. Dos tiers: capa MEDIA en la imagen del worker; capa SQL en el gate contra Postgres real. NO se cablea el executor N8/N9 al DAG (deuda de fase anotada, patrón F5).

## Verificación esperada (literal de planning.md)
> la fila `qa_report` de una variante real contiene todos los checks en `pass` (query); el dump de C2PA del máster muestra el manifest con `trainedAlgorithmicMedia`; subir el fichero a mano a TikTok (borrador) no produce warnings de formato — paso manual del usuario (revisión humana): el bucle deja el master listo y pide este juicio.

(Corrección de planning aplicada, regla 6: `--info` NO surface el claim en c2patool v0.9.12; el substring aparece en el dump por defecto o `--detailed`. Verificado aquí — cláusula 2.)

## Régimen (dos tiers, patrón T5.2/T5.3)
- **Tier MEDIA** (imagen `ugc-worker:t5.1`, `RUN_MEDIA=1 REQUIRE_MEDIA=1`): cadena real ffmpeg + c2patool → `qaReport` sobre máster FIRMADO real. Cláusulas 1 y 2.
- **Tier SQL** (gate, Postgres real): `finalizeVariantMaster` persiste filas `asset` (máster con `parent_asset_ids` + thumbnail) + update de `ad_variant.{master_asset_id, thumbnail_asset_id, qa_report, score}` en una tx. Ruta "la fila `qa_report` ... query".

Reproduje AMBOS tiers desde cero. Escribí MIS PROPIOS instrumentos (no edité los del implementer); removidos del árbol de producto tras correr (copia `.ts.txt` en esta carpeta).

## Resultado observado vs esperado
| # | Cláusula | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|---|
| 1a | qa_report all-pass (módulo) | 8 checks `pass` sobre máster firmado real | `passed:true, score:100`, 8/8 pass (ffprobe+ebur128) | qa-report.measured.json | ✅ |
| 1b | qa_report all-pass (query, variante real) | fila qa_report de variante real, todos pass por query | `all_pass=true, passed=true, score=100` (jsonb bool_and) sobre qaReport REAL persistido | sql-real-variant-query.json | ✅ |
| 1c | persistencia rica (linaje/tx) | máster final_video + thumbnail filas propias, parent_asset_ids, tx atómica | 3/3 integration (linaje 6 ids, thumbnail parent=[master], rollback) | sql-integration.txt | ✅ |
| 2 | C2PA trainedAlgorithmicMedia | dump muestra el manifest con el claim | `c2pa.created` + `digitalSourceType: .../trainedAlgorithmicMedia`; `--info` → 0 matches | c2patool-dump.txt, c2patool-info.txt | ✅ |
| 3 | TikTok borrador sin warnings | subir a mano sin warnings | JUICIO HUMANO — máster firmado LISTO | master-signed.mp4 (+.sha256) | ⏸ pendiente-juicio-humano |

### Controles negativos (MUERDEN de verdad)
Capa de medición REAL (imagen): 25fps→fps=fail · −20 LUFS→loudness=fail · 720×1280→resolution=fail · violaciones>0→captions_safe_zone=fail · duración>techo→duration=fail. Capa pura (gate): 8 checks en negativo + score proporcional (11 casos).

### Anti-T1.9 (auditado)
`EXPORT_MASTER_PRESET` única verdad; res/fps/códec/pixfmt de `CANONICAL_VIDEO_PROFILE`; `evaluateQa` deriva de las mismas constantes. `buildFinalEncodeArgs` usa `p.videoEncoder` (=libx264); gate test ata `expect(args).toContain(P.videoEncoder)` + `not.toContain('-c:v copy')`. QA corre sobre el FIRMADO (ffprobe del firmado: 1080×1920/h264/yuv420p/aac, +faststart moov<mdat preservado).

### Fixtures C2PA — no secretos
Certs PÚBLICOS de ejemplo de contentauth/c2patool v0.9.12 (`FOR TESTING_ONLY` / `C2PA Test Signing Cert`). README lo declara. Producción usa cert real fuera del árbol.

### Coste $0
Diff no importa openai/anthropic/@fal/firecrawl (grep vacío salvo un comentario). Todo local/imagen.

## Coste real
$0 (local + imagen; assets reales committeados + sintéticos lavfi; cero APIs de pago). Estimado $0. Sin desviación.

## Veredicto
**PASS** — las dos cláusulas automatizables se cumplen contra el sistema real. La fila `qa_report` de una variante real da todos los checks en `pass` por query jsonb (persistencia hand-built 3/3 + qaReport REAL medido persistido y consultado: `all_pass=true`); el dump C2PA del máster firmado muestra `c2pa.created` + `trainedAlgorithmicMedia` (`--info` no → confirma la corrección de planning). 20+ controles negativos muerden en la capa real. Anti-T1.9 verificado.

**Cláusula 3 (TikTok borrador) PENDIENTE DE JUICIO HUMANO** — no bloquea el PASS (igual que T5.4). Máster firmado LISTO: `docs/verifications/T5.5/master-signed.mp4` (sha256 en `master-signed.sha256`). El usuario debe subirlo a TikTok (borrador) y confirmar ausencia de warnings de formato.

### Notas (PASS)
- Los dos tiers NO se unen en runtime (deuda de wiring N8/N9 anotada). La query del test del implementer usa un qaReport HAND-BUILT; lo fortalecí persistiendo/consultando el qaReport REAL medido (sql-real-variant-query.json) para que "variante real ... query all-pass" sea literal end-to-end.
- Máster de prueba 9 s (3×3s), ≤60s. audioBitrate 127948 (±32k de 128k). loudness −14 exacto (heredado de T5.3 via -c:a copy).

## Índice de evidencias
- qa-report.measured.json — qaReport REAL medido (8/8 pass, score 100)
- parent-asset-ids.json — linaje del máster (6 ids en orden)
- master-signed.mp4 + master-signed.sha256 — máster FIRMADO para juicio humano (cláusula 3)
- thumbnail.jpg — thumbnail extraído
- c2patool-dump.txt — dump C2PA por defecto (contiene trainedAlgorithmicMedia)
- c2patool-info.txt — --info (solo Validated, sin claim)
- master-ffprobe.json — ffprobe del firmado (h264 1080×1920 yuv420p 30fps + aac 48k)
- sql-integration.txt — finalize-variant-master (3/3, Postgres real)
- sql-real-variant-query.json — query jsonb del qaReport REAL persistido (all_pass=true)
- verifier-extract-spec.ts.txt, verifier-real-qa-spec.ts.txt — instrumentos del verifier
