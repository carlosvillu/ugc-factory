# Verificación T0.13 — Despliegue inicial en VPS

- **Tarea**: T0.13 · Despliegue inicial en VPS (`planning.md`)
- **Fecha**: 2026-07-14
- **Ejecutor**: verifier (contexto fresco, escéptico) · agent-browser 0.27.0 · sesión `t0.13` · curl/ssh/psql
- **Sistema**: producción `https://ugc.carlosvillu.dev`; VPS `~/projects/ugc-factory`, `docker-compose.prod.yml`; contenedores web/worker rebuild ~30 min antes de la verificación; postgres 4 h.
- **Provenance (finding, no bloquea — ver Rarezas)**: el VPS corre `git HEAD = 6bca49c` **más un working tree sin commitear**. Los 9 ficheros críticos de T0.13 (compose, Dockerfiles, `rate-limit.ts`, `next.config.ts`, `apps/worker/package.json`, `.env.example`, `vps-backup-db.sh`, `DEPLOY.md`) son **byte-idénticos** a `HEAD local f9e2120` (diff vacío, ver `outputs/vps-tree/`). El código en producción es equivalente a lo que se cierra; el deploy se hizo por copia de working tree, no por el `git pull` que promete la Entrega.

## Verificación esperada (literal de planning.md)
> desde fuera del VPS, `https://<dominio>` sirve la app con certificado válido (⇒ el arranque de web en modo producción funciona de verdad, cerrando la deuda de arriba); login funciona; un run de demo completo corre en el VPS con el canvas actualizándose en vivo (SSE atraviesa Caddy); forzar el cron de backup → aparece el dump fechado y `pg_restore --list` lo lee sin error.

Deudas que la tarea resolvía (verificadas activamente):
- Trust boundary de `x-forwarded-for` (Caddy sobrescribe, la app no confía en el header crudo del cliente).
- `next start` (PROD) arranca de verdad (deuda T0.3/T0.14).

## Resultado observado vs esperado
| # | Esperado | Observado | Evidencia | OK |
|---|---|---|---|---|
| 1 | `https://<dominio>` con certificado válido | Cert Google Trust Services, CN carlosvillu.dev, válido; `/`→307 `/login`; health `{ok:true,db:true}` | `outputs/tls-cert.txt`, `outputs/health.txt` | OK |
| 2 | Arranque de web en PROD de verdad | PID 1 = `next-server (v16.2.10)`; `instrumentation.register()` sobrevive (db:true) | `outputs/web-pid1.txt` | OK |
| 3 | Login funciona | 200 + cookie de sesión HttpOnly/Secure | `outputs/login-success.txt` | OK |
| 4 | Run de demo completo corre en el VPS | N0->N1(checkpoint)->N2 hasta `completado` en el canvas de prod | `02-canvas-state.png`, `04-canvas-all-completed.png` | OK |
| 5 | Canvas actualizandose en vivo (SSE atraviesa Caddy) | Frames INCREMENTALES: snapshot +0.24s, step_changed N0->succeeded +6.01s, cascada N1 +6.0-6.1s, heartbeat +25.25s. No batched -> `flush_interval -1` OK. UI: N1/N2->completado tras Aprobar SIN reload | `outputs/sse-live.txt`, `03-checkpoint-waiting.png`, `04-...png` | OK |
| 6 | Uploads en `/data/assets` (web rw) | Upload real 201 -> 94 bytes en `/data/assets/intake/*.png` en el contenedor + download md5 identico (`2074f7db...`) | `outputs/upload-resp.txt`, `outputs/asset-on-disk.txt` | OK |
| 7 | Forzar cron backup -> dump fechado | Cron `15 4 * * *`; forzado -> `ugc-20260714T145053Z.dump` (124K) | `outputs/cron.txt`, `outputs/backup-run.txt` | OK |
| 8 | `pg_restore --list` lo lee sin error | exit 0, 30 TABLE DATA, stderr vacio | `outputs/pg_restore-list.txt` | OK |
| 9 | Trust boundary XFF: rotar el header NO salta el rate-limit | Origen directo (IP estable): monotonico 401,401,429,429,429 con XFF rotado en cada request -> header ignorado, bloqueo por IP se mantiene | `outputs/xff-attack-origin.txt`, `outputs/xff-attack.txt` | OK |

## Coste real
$0 — sin APIs de pago. El DAG de demo (`demo.canvas.*`) no inyecta `costCents`; el ledger de prod no se toco. (Los 33 centimos de Anthropic de la evidencia previa fueron runs REALES del usuario, fuera de esta verificacion.)

## Veredicto
**PASS** — las cuatro clausulas de la Verificacion y las dos deudas (trust boundary XFF, `next start` en PROD) se cumplen contra el sistema real, con evidencia dificil de falsificar (stream SSE sellado en el tiempo, checksum del upload en disco, monotonia del rate-limit con el header rotado).

### Rarezas (no bloquean, pero se reportan)
1. **Rate-limit del login diluible a traves de Cloudflare (residual, NO el hueco que la deuda cerraba).** Contra el dominio publico, el ataque de rotacion de XFF vio `401x5->429` y luego un `401` con IP nueva: no-monotonico. Causa raiz (confirmada con el test origen-directo): Caddy escribe `{client_ip}` = IP de egress de Cloudflare (CF esta proxied delante y Caddy no tiene `trusted_proxies` para CF), y la pool de egress de CF rota. El `x-forwarded-for` inyectado por el cliente SI se descarta (por eso aparece el 429 pese a rotar); la dilucion residual la produce la pool de CF, que el atacante no elige. El hueco que la deuda de T0.4 describia (header client-controllable) esta cerrado: origen directo con IP estable da `401,401,429` monotonico perfecto. Follow-up recomendado (no bloqueante, no es de T0.13): configurar `trusted_proxies` con los rangos de Cloudflare en Caddy (o bucketear por `CF-Connecting-IP`) para que el contador use la IP real del cliente.
2. **Provenance del deploy**: produccion corre un working tree sin commitear (identico byte a byte a `f9e2120`, verificado), no un `git pull` a un sha limpio. No bloquea (contenido equivalente + comportamiento verificado), pero conviene commitear/pushear y redeployar por `git pull` para que la Entrega sea reproducible.

### Deudas [verificar] cerradas
- Trust boundary `x-forwarded-for` (deuda T0.4): Caddy sobrescribe con `{client_ip}`, la app (`TRUST_PROXY=1`) toma la ultima entrada e ignora `x-real-ip`; verificado con ataque de rotacion (monotonico en origen directo).
- `next start` (PROD) arranca (deuda T0.3/T0.14): PID 1 = `next-server`, health `db:true` => `instrumentation.register()` sobrevive en modo produccion.
- Uploads web rw (reconciliacion PRD §18, `df05a57`): upload real persiste en `/data/assets` con checksum verificado.
- Worker con `APP_MASTER_KEY` (`e340e7f`): variable presente en el contenedor worker en ejecucion.

### Nota sobre el gate local
No se re-corrio `pnpm gate` en esta sesion (implementer reporto verde: 1285 tests + 56/56 e2e, `sse-contract.test.ts` en verde). El sustento de T0.13 es el VPS vivo; la verificacion se centro en produccion, como prescribe cua.md §Paso 1 para tareas cuyo objetivo es el VPS.
