---
name: deploy
description: Despliegue y operación de UGC Factory en el VPS de producción (ugc.carlosvillu.dev) — redeploy, rollback, verificación end-to-end, backups, logs y troubleshooting. Úsala SIEMPRE que el usuario diga "despliega", "deploy", "sube esto a producción", "actualiza el servidor", "¿está caído?", "¿está bien producción?", "mira los logs del VPS", "haz un backup", "vuelve atrás", o pregunte por el estado de producción; también antes de tocar nada del VPS por SSH, del Caddy central o del docker-compose.prod.yml. No la uses para el docker-compose.dev.yml (desarrollo local).
---

# Deploy — UGC Factory en producción

Producción existe y funciona: `https://ugc.carlosvillu.dev`. Ejecuta, no
investigues. Los scripts están probados contra el servidor real.

**Todas las rutas de abajo son literales desde la raíz del repo.** (Ojo: existe
también un `scripts/` en la raíz, que es otra cosa.)

| El usuario dice… | Ejecuta |
|---|---|
| "despliega", "sube esto a producción" | `.claude/skills/deploy/scripts/redeploy.sh` |
| "¿está bien?", "¿se ha caído?", "no me fío" | `.claude/skills/deploy/scripts/verify.sh` |
| "vuelve atrás", "deshaz el deploy", algo se rompió | `.claude/skills/deploy/scripts/rollback.sh` |
| "haz un backup" | `.claude/skills/deploy/scripts/backup.sh` |
| "¿qué hay desplegado?" | `.claude/skills/deploy/scripts/rollback.sh --status` |
| "mira los logs" | §Logs |

`redeploy.sh` y `rollback.sh` terminan llamando a `verify.sh`: **un deploy que no
se puede verificar falla**, en vez de aparentar éxito.

> **Estado de las pruebas** (sé honesto sobre esto): `verify.sh` y `backup.sh`
> están ejecutados contra producción y funcionan. `redeploy.sh` y `rollback.sh`
> están validados sintácticamente pero **no se han ejecutado enteros todavía** —
> hacerlo recrea los contenedores de producción y eso lo decide el humano. El
> primer `redeploy.sh` real es también su prueba: si algo falla, será ahí.
> Detalle: el deploy inicial (2026-07-14) se hizo a mano, así que **no dejó
> huella `.deployed`**; el primer redeploy con el script la creará y a partir de
> ahí `verify.sh` podrá comparar producción con tu HEAD.

## Topología

```
Internet → Cloudflare (DNS + proxy naranja, SSL Full strict)
         → Caddy central  (edge-caddy, ~/infra/caddy — COMPARTIDO por todos los proyectos del VPS)
         → 127.0.0.1:3100 → web (Next standalone)
                            ├── postgres:16  (sin puerto publicado)
                            └── worker       (comparte el volumen de assets)
```

- **El TLS no es de este proyecto**: lo termina el Caddy central. El
  `docker-compose.prod.yml` no lleva reverse proxy. El enrutado se toca en
  `~/infra/caddy/sites/ugc.carlosvillu.dev.caddy` (y hay que **recargar**: §Caddy).
- **web publica solo en `127.0.0.1:3100`.** Nunca en `0.0.0.0`: un puerto abierto
  **se salta UFW** y, peor, saca la app de detrás de Caddy — que es lo único que
  sostiene el trust boundary del login (Caddy sobrescribe `x-forwarded-for` con la
  IP real; sin eso, el rate-limit se bombea rotando una cabecera y el login vuelve
  a ser fuerza-bruteable).
- **Los secretos viven solo en el VPS** (`~/projects/ugc-factory/.env`, gitignored;
  el repo es público). `redeploy.sh` excluye `.env` del rsync a propósito.

Detalle completo en **`DEPLOY.md`** (raíz del repo). La guía del VPS como
plataforma multi-proyecto está en **`~/AGENTS.md` dentro del VPS** y manda sobre
todo lo que sea del VPS.

## Desplegar

```bash
.claude/skills/deploy/scripts/redeploy.sh          # rsync del árbol local (default)
.claude/skills/deploy/scripts/redeploy.sh --git    # git pull en el VPS
```

Qué hace, en orden: avisa si hay cambios sin commitear → sincroniza el código →
deja huella del commit desplegado en `.deployed` → reconstruye las imágenes →
espera a que web esté `healthy` → **verifica desde fuera**.

**No corre `pnpm gate`.** Correr los tests es decisión tuya antes de desplegar.

**Las migraciones se aplican solas** al arrancar web (con lock). Por eso el deploy
puede tardar: el healthcheck ya lo contempla.

**Downtime**: unos segundos al recrear los contenedores. Los jobs en curso
sobreviven (su estado vive en Postgres; pg-boss los re-entrega).

**Por qué el default es rsync**: el bucle de desarrollo **no hace `git push`**. Un
`git pull` en el VPS traería código viejo *sin avisar* y verías un deploy
"correcto" que no contiene tus cambios. Usa `--git` solo cuando el humano haya
pusheado.

**Antes de desplegar, comprueba si tu cambio toca uploads o assets** → §Trampas
(hay un fallo conocido que revienta en producción).

## Verificar

```bash
.claude/skills/deploy/scripts/verify.sh            # completo
.claude/skills/deploy/scripts/verify.sh --quick    # solo el dominio público
```

Comprueba cinco cosas **por separado**, y esa separación es lo que convierte un
síntoma en un diagnóstico: dominio público, **origen saltándose Cloudflare**,
contenedores, **qué commit corre** (vs. tu HEAD) y salud (errores en logs, disco,
antigüedad del último backup).

### Cómo leer un fallo

| Falla… | y pasa… | Entonces |
|---|---|---|
| dominio público | el origen | **Es Cloudflare, no el servidor.** No toques el VPS. Bucle de redirecciones ⇒ zona en SSL «Flexible» ⇒ el humano la pone en **Full (strict)** |
| dominio público | nada más | Mira `edge-caddy` (§Caddy) y luego los contenedores |
| `/api/health` con `db:false` | la app responde | web vive pero no habla con Postgres: logs de `web` + estado de `postgres` |
| web `unhealthy` | postgres `healthy` | Suele ser el arranque: web migra al boot. Logs de `web` |
| postgres `unhealthy` | — | La BD no arranca. Logs de `postgres`; mira el disco |
| "hay deriva" (SHA ≠ HEAD) | todo lo demás | Producción corre otro código. ¿Desplegaste con `--git` sin pushear? |
| "ningún backup en 48 h" | todo lo demás | El cron murió. Fuerza uno con `backup.sh` y revisa `crontab -l` en el VPS |

## Volver atrás

```bash
.claude/skills/deploy/scripts/rollback.sh          # al commit anterior al desplegado
.claude/skills/deploy/scripts/rollback.sh <sha>    # a uno concreto
.claude/skills/deploy/scripts/rollback.sh --status # qué hay desplegado ahora
```

Hace backup antes de tocar nada y despliega el commit destino sin mover tu copia
local (usa `git archive`, así que no te cambia de rama ni pierdes trabajo).

**Lo crítico**: el rollback de código **no deshace la base de datos**. Las
migraciones son de ida. Volver atrás te deja código viejo contra un schema nuevo —
lo cual suele funcionar (una columna nueva es invisible para el código viejo),
pero **no** si la migración borró o renombró algo que el código viejo usa. El
script detecta si el tramo traía migraciones y te obliga a confirmar. Si la
migración era destructiva, el rollback de código no basta: hay que restaurar.

## Backups y restauración

```bash
.claude/skills/deploy/scripts/backup.sh            # fuerza uno AHORA y prueba que es restaurable
.claude/skills/deploy/scripts/backup.sh --list     # lista los existentes
```

El cron del VPS hace un `pg_dump` diario (4:15 UTC) en `~/backups/ugc-factory/`,
retención 14 días. `backup.sh` además abre el dump con `pg_restore --list`: un
backup que nadie ha probado a leer no es un backup.

**Restaurar** (destructivo — se pierde todo lo ocurrido desde ese dump; confírmalo
con el humano antes):

```bash
ssh developer@80.190.75.149
cd ~/projects/ugc-factory
docker compose -f docker-compose.prod.yml stop web worker   # que nadie escriba durante la restauración
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  < ~/backups/ugc-factory/<el-dump>.dump
docker compose -f docker-compose.prod.yml start web worker
```

## Logs

```bash
# app (JSON de pino; correlaciona por request_id / run_id / step_id)
ssh developer@80.190.75.149 'cd ~/projects/ugc-factory && \
  docker compose -f docker-compose.prod.yml logs --tail 50 web'

# el borde (TLS, enrutado, certificados)
ssh developer@80.190.75.149 'cd ~/infra/caddy && docker compose logs --tail 50 caddy'
```

## Caddy

Un cambio en el site file no surte efecto hasta recargarlo. Valida antes:

```bash
ssh developer@80.190.75.149 'cd ~/infra/caddy && \
  docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile && \
  docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile'
```

## Acceso

`ssh developer@80.190.75.149` (solo clave; `BatchMode` funciona).

**`sudo` pide una contraseña que no tienes.** No la necesitas: `developer` está en
el grupo `docker`. Si algo exige sudo de verdad (paquetes del sistema, UFW),
prepara el comando exacto y **pídeselo al humano**; no intentes rodearlo.

## Trampas que ya nos han mordido

**Los uploads escriben desde `web`, que monta los assets en solo lectura.**
Contradicción viva entre el PRD (§18: solo el worker escribe) y lo construido en
T1.5/T1.13: en producción darán **EROFS**. No ha explotado porque nadie ha subido
nada aún. **Necesita una decisión de producto** (o web monta `rw`, o los uploads
pasan por el worker); documentado en `DEPLOY.md`. No lo parchees en silencio.

**`VAR: ${VAR:-}` en compose no significa "sin valor": significa cadena vacía.**
La variable se define igualmente aunque no esté en el `.env`, y los seeds del
primer arranque distinguen *ausente* de *vacío*: `Number('') === 0` **sembró un
presupuesto de 0 céntimos** en el primer deploy. Las opcionales van por `env_file`.

**Un `502` o un bucle de redirecciones en el borde no significa que el origen esté
roto.** Verifica el origen **por separado** (`verify.sh` lo hace) antes de tocar
el servidor. El 2026-07-14 se perdió una hora por esto.
