# T5.1 — Verificación: Imagen Docker del worker de render

**Fecha**: 2026-07-19
**Veredicto**: **PASS**
**Coste real**: $0 (build local + qemu; sin APIs de pago)

## Contexto de la prueba

- **Imagen verificada**: `ugc-worker:t5.1-verify`, reconstruida por el verifier desde el árbol de trabajo actual (`docker build --platform linux/amd64 -f apps/worker/Dockerfile .`).
- **Cache-check dispositivo**: el rebuild salió **100% CACHED** en todas las capas (ver `build-amd64.log`), lo que prueba que las imágenes prebuilt del implementer (`ugc-worker:t5.1`, `ugc_ads-worker:latest`) corresponden al Dockerfile + fonts + healthcheck bajo prueba. La verificación corre sobre la imagen reconstruida desde el diff.
- **Arch de DEPLOY (amd64), no arm64 nativo**: `docker image inspect --format '{{.Architecture}}'` → **`amd64`** (host es arm64/Mac; los comandos corren bajo qemu — el warning "platform does not match" en cada `docker run` lo confirma). `c2patool --version` responde bajo qemu ⇒ el binario amd64 (x86_64-unknown-linux-gnu, el del VPS) es correcto.
- **Estado del árbol**: diff de T5.1 sin commitear al verificar (`M Dockerfile`, `?? apps/worker/fonts/`, `?? apps/worker/scripts/healthcheck-capabilities.sh`) — esperado; ES lo que está bajo prueba.
- **Gate previo**: `pnpm gate` en verde (207 test files, 2127 tests). Ver `gate.log`.

## Resultado por cláusula

### Las 3 cláusulas LITERALES (planning.md:678)

| Cláusula | Comando | Observado | Veredicto |
|---|---|---|---|
| ffmpeg sidechaincompress | `ffmpeg -filters \| grep sidechaincompress` | ` ..C sidechaincompress AA->A  Sidechain compressor.` (exit 0) | OK |
| c2patool responde | `c2patool --version` | `c2patool 0.9.12` (binario amd64 bajo qemu) | OK |
| fc-list muestra TikTok Sans | `fc-list \| grep -i TikTok` | `TikTok Sans,TikTok Sans Light` (family name interno) | OK |

### Boot smoke (cierra nota abierta de T0.13)

| Aspecto | Observado | Veredicto |
|---|---|---|
| Arranca contra Postgres real | `pg-boss arrancado: colas y consumers listos` + `worker ready {health:{ok:true,db:true}}` | OK |
| USER node (no root) | `id` → `uid=1000(node) gid=1000(node)`, PID 1 | OK |
| `/data/assets` escribible | `touch /data/assets/probe.txt` → WROTE OK, owner `node:node` | OK |
| Bundle + node_modules hoisted resuelven | pg-boss arranca ⇒ imports external resuelven en runtime | OK |
| Graceful shutdown SIGTERM | `worker shutting down {signal:SIGTERM}` → `sweeper detenido`, **exit code 0** | OK |

### Healthcheck de capacidades

| Aspecto | Observado | Veredicto |
|---|---|---|
| Happy path | `healthcheck OK: ffmpeg(sidechaincompress+ass) ffprobe c2patool fonts(...)` exit 0 | OK |
| Docker HEALTHCHECK (inspect) | `starting` → `healthy` en ~4s, último log exit=0 | OK |
| Control negativo — c2patool | `rm c2patool && healthcheck` → `FAILED: c2patool not on PATH` **exit 1** | MUERDE |
| Control negativo — fuente | `rm TikTokSans.ttf && fc-cache && healthcheck` → `FAILED: font family not installed: TikTok Sans` **exit 1** | MUERDE |

## Verificaciones adicionales

| Check | Observado | Veredicto |
|---|---|---|
| libass filtro `ass` (T5.4) | ` ... ass  V->V  Render ASS subtitles ... using the libass library.` | OK |
| ffprobe responde | `ffprobe version 5.1.9-0+deb12u1` | OK |
| 3 familias de fuente | `TikTok Sans`, `Poppins`, `Noto Sans` — todas en fc-list | OK |

## Compliance OFL (repo público AGPL)

`ls /usr/share/fonts/truetype/ugc/` DENTRO de la imagen construida:
- `TikTokSans.OFL.txt` (4370 B) + `TikTokSans.ttf`
- `Poppins.OFL.txt` (4385 B) + `Poppins-{Regular,Medium,SemiBold,Bold}.ttf`
- `NotoSans.OFL.txt` (4396 B) + `NotoSans.ttf`

La imagen redistribuye los binarios y la licencia OFL viaja junto a ellos. Sin secretos (c2patool pineado por versión + checksum).

## Rarezas / notas

- `docker stop` retorna en <1s porque pg-boss no tenía jobs en vuelo; el `SHUTDOWN_TIMEOUT_MS=120000` es techo de drenado, no espera fija — lo verificado es el drain limpio + exit 0.
- La rama arm64 del stage c2patool está diseñada para fallar en voz alta (exit 1); no se ejecutó (opcional). El amd64 corriendo c2patool real bajo qemu ya prueba el binario del arch de deploy.
- c2patool v0.9.12 (glibc floor 2.34, compat bookworm 2.36); subir de versión exigiría base trixie — fuera de alcance T5.1, deuda anotada en el Dockerfile.

## Output crudo adjunto
- `build-amd64.log` — rebuild 100% CACHED
- `gate.log` — `pnpm gate` verde
