# Verificación T0.5 — StorageAdapter local + download proxificado

- **Tarea**: T0.5 · StorageAdapter local + download proxificado (`planning.md`)
- **Fecha**: 2026-07-10
- **Ejecutor**: verifier (subagente escéptico) · sin agent-browser (verificación backend-only: script + curl + psql) · sesión `t0.5`
- **Sistema**: commit `4886a64` + working tree del diff T0.5 (no committeado) · stack `apps/web/scripts/e2e-stack.ts` (Postgres 16 testcontainer, puerto 33196) + `next dev` en puerto 3100 · migraciones 0000–0003 aplicadas en boot · password sembrado (first boot)

## Verificación esperada (literal de planning.md)
> subir un fichero con un script de smoke → aparece en `/data/assets` con su fila en `asset` → descargarlo por `/api/assets/:id/download` con checksum idéntico; sin sesión, el endpoint devuelve 401.

(En dev/test la raíz es `ASSETS_DIR`, un tmpdir absoluto compartido por web y el seed — no `/data/assets` literal, que es el default de PRODUCCIÓN; journal T0.7b.)

## Metodología (escéptica)
- Gate previo `pnpm gate` en verde ANTES de verificar (typecheck + format + knip + 349 tests, exit 0).
- El script de smoke del implementer (`apps/web/scripts/smoke-assets.ts`) fue **auditado y NO ejecutado**: solo comprueba checksum, nunca Content-Type/Content-Length. Se **reescribió** el seed con inputs propios (`docs/verifications/T0.5/seed.ts`) y el resto (psql, sha256sum, curl, header asserts) en shell crudo.
- **Inputs propios** (no los del implementer): 7777 bytes aleatorios (el smoke usa 5000), mime **distintivo** `video/mp4` (el smoke usa `application/octet-stream`) para probar que el header deriva de la fila y no de un default, kind `final_video`.
- **Evidencia independiente del código bajo prueba**: hash del origen con `sha256sum` del sistema; fila leída con `psql` real dentro del contenedor (no el repo); fichero en disco con `ls`/`sha256sum` (no un log del adaptador); roundtrip HTTP con `curl -D` (headers) y comparación de checksum del cuerpo.
- La subida SÍ usa `makeLocalStorageAdapter().put()` + `createAsset()` (clause 1 exige "vía el StorageAdapter"), contra el MISMO `DATABASE_URL`/`ASSETS_DIR` que usa web (leídos de `e2e/.runtime.json`).

## Cadena de checksum (4-way match)
Un único sha256 `51365c2c1bd994309862f3ed438c62eaf591b0d26b2c32202332a7d0bbb06f6d` aparece idéntico en las cuatro fuentes independientes:
1. Origen: `sha256sum input.bin` (sistema).
2. Fichero en disco: `sha256sum $ASSETS_DIR/verifier/….mp4`.
3. Columna `asset.checksum` (psql).
4. Cuerpo descargado: `sha256sum downloaded.bin`. Además `cmp` confirma input≡download byte a byte.

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1a | El fichero subido aparece físicamente en la raíz de storage (`ASSETS_DIR`) | `-rw-r--r-- 7777` en `$ASSETS_DIR/verifier/01KX5AC81R24CS1MAKWCZ1JGCA.mp4`, hash == origen | evidence.txt (CLAUSE 1a) | ✅ |
| 1b | Su fila en `asset` con id/kind/storage_key/mime/bytes/checksum | Fila `01KX5AC8…` kind=final_video, mime=video/mp4, bytes=7777, checksum==origen; tabla con las 6 columnas + timestamps, PK btree | evidence.txt (CLAUSE 1b) | ✅ |
| 2 | `GET /api/assets/:id/download` autenticado → stream con checksum idéntico y Content-Type/Length coherentes con la fila | 200; Content-Type `video/mp4` (==DB mime), Content-Length `7777` (==DB bytes), Cache-Control `private, no-store`, Content-Disposition filename=id; cuerpo byte-idéntico al origen | download-headers.txt, downloaded.bin, evidence.txt (CLAUSE 2) | ✅ |
| 3 | Sin sesión → 401 sin exponer la ruta de storage | 401 JSON tipado `{"code":"unauthorized","message":"sesión requerida"}` sobre un id VÁLIDO (auth precede a la BD/FS); ni storage_key ni raíz de storage en headers/body; sin stack trace | anon-headers.txt, anon-body.txt, evidence.txt (CLAUSE 3) | ✅ |

Log de `next dev`: exactamente `download 200` seguido de `download 401`, sin errores/warnings ni traces.

## Coste real
$0 — sin APIs de pago (filesystem local + Postgres testcontainer). Coincide con el estimado ($0).

## Veredicto
**PASS** — las tres cláusulas se cumplen contra el sistema real levantado, con checksum idéntico en 4 fuentes independientes y 401 tipado sin fuga de ruta.

Notas / rarezas:
- El header `vary: rsc, next-router-state-tree, …` lo añade Next a toda respuesta de route handler; irrelevante para el contrato de descarga.
- Fuera del alcance literal (extras de code-review, no bloquean ni dirigen el veredicto): guard léxico de path-traversal y 404 opaco. No se probaron como cláusulas; sus tests unit/integration están en el diff y el gate los cubre (349 tests verde).

## Evidencias
- `docs/verifications/T0.5/report.md` (este fichero)
- `docs/verifications/T0.5/evidence.txt` (salida cruda: sha256, ls/stat, psql \d + fila, headers, leak check, cmp)
- `docs/verifications/T0.5/seed.ts` (seed propio del verifier, vía StorageAdapter.put + createAsset)
- `docs/verifications/T0.5/seed-result.txt`
- `docs/verifications/T0.5/download-headers.txt`, `anon-headers.txt`, `anon-body.txt`
- `docs/verifications/T0.5/input.bin` (origen 7777B), `downloaded.bin` (descarga)
