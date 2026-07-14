# T0.13 — evidencia de producción (runs REALES, 2026-07-14)

> Recogida por el bucle tras el primer uso real del usuario. **NO es el report de
> cierre**: el gate completo no ha podido correr (kernel panics del Mac) y la
> Verificación formal la debe ejecutar el `verifier` (regla de oro 3: quien
> implementa no se evalúa). Esto es materia prima para ese cierre.

## Lo verificado en el VPS (`https://ugc.carlosvillu.dev`)

### Runs reales ejecutados por el usuario

| Run | Hora | N1 | N2 | N3 (checkpoint) | Notas |
|---|---|---|---|---|---|
| `01KXGCVB` | 13:25 | **cancelled** | cancelled | cancelled | `APP_MASTER_KEY no está definida` — el bug del worker (ver abajo) |
| `01KXGDPF` | 13:40 | succeeded | succeeded | **succeeded** | **Pipeline completo tras el fix** |
| `01KXGE9P` | 13:50 | succeeded | skipped | **succeeded** | Completo; `N2 skipped` es ruta legítima del DAG |

N3 tiene `is_checkpoint = t` y alcanzó `succeeded` ⇒ el flujo de checkpoints
funciona en producción.

### Gasto real registrado (ledger)

| Proveedor | Llamadas | Céntimos |
|---|---|---|
| anthropic | 3 | **33** |
| firecrawl | 1 | 0 |

Dinero real cobrado y contabilizado: la prueba más difícil de falsificar de que el
pipeline corrió de verdad (no un mock).

### Infraestructura (`scripts/verify.sh`, todo verde)

- `https://ugc.carlosvillu.dev` con **certificado válido**; `/` → 307 `/login`; `/login` → 200; `/api/health` → `{"ok":true,"db":true}`.
- Origen verificado **por separado** (saltándose Cloudflare): TLS válido.
- 4 contenedores sanos (web healthy, worker, postgres healthy, edge-caddy).
- Sin errores (`level>=50`) en los logs de web/worker. Disco al 12 %.

### Backup

`scripts/backup.sh` forzado: dump fechado + **`pg_restore --list` lo lee sin error
(30 tablas con datos)**. Cron diario a las 04:15 UTC registrado.

## El bug que este uso real destapó (y que ningún healthcheck podía ver)

El worker era el **único servicio sin `APP_MASTER_KEY`** (web veía 6 variables de
secreto; el worker, 3). Y el worker es **quien ejecuta los steps** ⇒ quien descifra
las credenciales de `app_setting`.

**Por qué el deploy salió verde**: la clave se lee **perezosa y memoizada**
(`packages/core/src/secrets/env.ts` — «solo revienta quien de verdad la
necesita»). El worker arrancó, loggeó `worker ready`, pasó el healthcheck y vivió
3 h sano; murió en el primer step que descifró algo. **La salud de un proceso no
prueba que tenga lo que necesita para TRABAJAR.**

Fix: `env_file` + `APP_MASTER_KEY` en el worker (commit `e340e7f`), desplegado con
`redeploy.sh` (su primera ejecución real: pasó).

## Qué falta para cerrar T0.13

1. **Gate completo en verde** (hoy imposible: `pnpm gate` provoca kernel panics —
   `WindowServer` watchdog — en la máquina del usuario; ver journal 2026-07-14).
   Pendiente: los tests de integración y el e2e, incluido `sse-contract.test.ts`,
   cuyo rojo **no está diagnosticado**.
2. **Verificación formal del `verifier`** (contexto fresco, escéptico), incluida la
   cláusula del **canvas actualizándose en vivo** (SSE a través de Caddy), que esta
   evidencia NO cubre: los runs se observaron en BD, no se instrumentó el SSE.
